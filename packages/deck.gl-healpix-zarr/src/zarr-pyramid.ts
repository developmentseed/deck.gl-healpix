import * as zarr from 'zarrita';
import { CachedZarrStore } from './cached-zarr-store';
import { rowRangeFromOffsetPair } from './utils';
import type { HealpixZarrTileData } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────────

export interface ZarrPyramidMetadata {
  bands: string[];
  nsides: number[];
  baseNside: number;
  minNside: number;
  /** Number of HEALPix levels between data nside and partition nside (root `parent_levels`). */
  parentLevels: number;
}

export interface GroupHandle {
  nside: number;
  nsideParent: number;
  cellIdArr: zarr.Array<zarr.DataType, CachedZarrStore>;
  parentOffsetsArr: zarr.Array<zarr.DataType, CachedZarrStore>;
  bandArrs: Map<string, zarr.Array<zarr.DataType, CachedZarrStore>>;
  allBands: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Caches — shared across all layer instances pointing to the same URL
// ──────────────────────────────────────────────────────────────────────────────

const rootCache = new Map<string, Promise<zarr.Group<CachedZarrStore>>>();
const metadataCache = new Map<string, Promise<ZarrPyramidMetadata>>();
const groupCache = new Map<string, Promise<GroupHandle>>();

// ──────────────────────────────────────────────────────────────────────────────
// Store / root access
// ──────────────────────────────────────────────────────────────────────────────

export function getRoot(url: string): Promise<zarr.Group<CachedZarrStore>> {
  if (!rootCache.has(url)) {
    rootCache.set(url, zarr.open(new CachedZarrStore(url), { kind: 'group' }));
  }
  return rootCache.get(url)!;
}

export async function loadRootMetadata(
  url: string
): Promise<ZarrPyramidMetadata> {
  if (!metadataCache.has(url)) {
    metadataCache.set(
      url,
      getRoot(url).then((root) => {
        const baseNside = root.attrs['base_nside'] as number;
        const minNside = root.attrs['min_nside'] as number;
        const bands = (root.attrs['bands'] as string[] | undefined) ?? [];
        const parentLevels = root.attrs['parent_levels'] as number;
        const nsides: number[] = [];
        for (let n = minNside; n <= baseNside; n *= 2) nsides.push(n);
        return { bands, nsides, baseNside, minNside, parentLevels };
      })
    );
  }
  return metadataCache.get(url)!;
}

// ──────────────────────────────────────────────────────────────────────────────
// Group handle — opened once per (url, nside) pair
// ──────────────────────────────────────────────────────────────────────────────

export function getGroupHandle(
  url: string,
  nside: number
): Promise<GroupHandle> {
  const key = `${url}:${nside}`;
  if (!groupCache.has(key)) {
    groupCache.set(
      key,
      (async () => {
        const root = await getRoot(url);
        const meta = await loadRootMetadata(url);
        const grp = await zarr.open.v3(root.resolve(`nside_${nside}`), {
          kind: 'group'
        });
        const [cellIdArr, parentOffsetsArr, ...bandArrList] = await Promise.all(
          [
            zarr.open.v3(grp.resolve('cell_id'), { kind: 'array' }),
            zarr.open.v3(grp.resolve('parent_offsets'), { kind: 'array' }),
            ...meta.bands.map((band) =>
              zarr.open.v3(grp.resolve(`bands/${band}`), { kind: 'array' })
            )
          ]
        );
        const bandArrs = new Map<
          string,
          zarr.Array<zarr.DataType, CachedZarrStore>
        >(meta.bands.map((band, i) => [band, bandArrList[i]]));
        return {
          nside,
          nsideParent: grp.attrs['nside_parent'] as number,
          cellIdArr,
          parentOffsetsArr,
          bandArrs,
          allBands: meta.bands
        };
      })()
    );
  }
  return groupCache.get(key)!;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tile loader
// ──────────────────────────────────────────────────────────────────────────────

export function assembleTileData(
  nside: number,
  parentOffsets: ArrayLike<bigint | number>,
  rawCellIds: ArrayLike<number | bigint>,
  bandSlices: ArrayLike<number>[],
  selectedBands: string[]
): HealpixZarrTileData | null {
  const range = rowRangeFromOffsetPair(parentOffsets);
  if (!range) return null;

  const cellIds = new Float64Array(rawCellIds.length);
  for (let i = 0; i < rawCellIds.length; i++) {
    cellIds[i] = Number(rawCellIds[i]);
  }
  if (cellIds.length === 0) return null;

  const npix = cellIds.length;
  const nb = selectedBands.length;
  const values = new Float32Array(npix * nb);
  for (let b = 0; b < nb; b++) {
    const src = bandSlices[b];
    for (let p = 0; p < npix; p++) {
      values[p * nb + b] = Number(src[p]);
    }
  }

  return { nside, cellIds, values, bands: selectedBands };
}

export async function loadTileFromGroup(
  group: GroupHandle,
  parentCell: number,
  selectedBands: string[],
  signal?: AbortSignal
): Promise<HealpixZarrTileData | null> {
  if (selectedBands.length === 0) return null;
  if (signal?.aborted) return null;

  const poResult = await zarr.get(group.parentOffsetsArr, [
    zarr.slice(parentCell, parentCell + 2)
  ]);
  const range = rowRangeFromOffsetPair(
    poResult.data as ArrayLike<bigint | number>
  );
  if (!range) return null;

  if (signal?.aborted) return null;

  const { rowStart, rowEnd } = range;

  const [idsResult, ...bandResults] = await Promise.all([
    zarr.get(group.cellIdArr, [zarr.slice(rowStart, rowEnd)]),
    ...selectedBands.map((band) =>
      zarr.get(group.bandArrs.get(band)!, [zarr.slice(rowStart, rowEnd)])
    )
  ]);

  if (signal?.aborted) return null;

  return assembleTileData(
    group.nside,
    poResult.data as ArrayLike<bigint | number>,
    idsResult.data as ArrayLike<number | bigint>,
    bandResults.map((r) => r.data as ArrayLike<number>),
    selectedBands
  );
}
