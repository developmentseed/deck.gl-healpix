import { PathLayer, TextLayer } from '@deck.gl/layers';
import type { LayerProps } from '@deck.gl/core';
import { cornersNestLonLat, pix2LonLatNest } from 'healpix-ts';

export type TileDebugLayerOptions = {
  /** Sub-layer id suffix (typically `tile.id`). */
  id: string;
  /** Parent cell at partition nside (tile index `x`). */
  parentCell: number;
  /** Partition nside for this tile's outline and label. */
  partitionNside: number;
  /** Label text (typically `${z}-${y}-${x}`). */
  tileId: string;
  getSubLayerProps: (props: { id: string }) => LayerProps;
};

/** Path + text sublayers outlining one HEALPix Zarr tile. */
export function createTileDebugLayers(opts: TileDebugLayerOptions) {
  const { id, parentCell, partitionNside, tileId, getSubLayerProps } = opts;

  return [
    new PathLayer({
      ...getSubLayerProps({ id: `debug-outline-${id}` }),
      data: [null],
      getPath: () => {
        const poly = cornersNestLonLat(partitionNside, parentCell);
        return [...poly, poly[0]];
      },
      getColor: [255, 255, 0, 220],
      getWidth: 2,
      widthMinPixels: 2,
      pickable: false
    }),
    new TextLayer({
      ...getSubLayerProps({ id: `debug-label-${id}` }),
      data: [null],
      getPosition: () => pix2LonLatNest(partitionNside, parentCell),
      getText: () => tileId,
      getColor: [255, 255, 255, 255],
      getSize: 14,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 200],
      pickable: false
    })
  ];
}
