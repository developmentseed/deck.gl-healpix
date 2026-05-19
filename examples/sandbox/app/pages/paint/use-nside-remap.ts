import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { CellLine } from './colored-cells';
import { remapCellLinesToNside } from './healpix-geo';
import type { HealpixScheme } from './types';

type UseNsideRemapOptions = {
  nside: number;
  scheme: HealpixScheme;
  setLines: Dispatch<SetStateAction<CellLine[]>>;
};

/**
 * When nside or scheme changes, remap line IDs to the new grid so geographic
 * coverage is preserved; each line keeps its colorIndex.
 */
export function useNsideRemap(opts: UseNsideRemapOptions) {
  const { nside, scheme, setLines } = opts;
  const gridRef = useRef({ nside, scheme });

  useEffect(() => {
    const prev = gridRef.current;
    if (prev.nside === nside && prev.scheme === scheme) return;

    setLines((lines) => {
      if (lines.length === 0) return lines;
      return remapCellLinesToNside(
        lines,
        prev.nside,
        nside,
        prev.scheme,
        scheme
      );
    });

    gridRef.current = { nside, scheme };
  }, [nside, scheme, setLines]);
}
