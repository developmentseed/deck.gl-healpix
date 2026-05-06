import {
  interpolateCool,
  interpolatePlasma,
  interpolateRainbow,
  interpolateRdYlBu,
  interpolateViridis
} from 'd3';

/** d3 sequential interpolators used for HEALPix value → color mapping. */
export const schemeFns = {
  interpolateViridis,
  interpolatePlasma,
  interpolateCool,
  interpolateRainbow,
  // reverse RdYlBu so low values are blue and high values are red
  interpolateRdYlBu: (t: number) => interpolateRdYlBu(1 - t)
} as const;

export type ColorSchemeName = keyof typeof schemeFns;
