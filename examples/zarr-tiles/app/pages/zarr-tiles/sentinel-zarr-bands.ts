/** RGB composites: bands are loaded in [r, g, b] order → shader indices 0, 1, 2. */
export const COMPOSITES = {
  true_color: { label: 'True color', bands: ['b04', 'b03', 'b02'] },
  infrared_false_color: {
    label: 'Infrared false color',
    bands: ['b8a', 'b04', 'b03']
  },
  swir: { label: 'SWIR composite', bands: ['b12', 'b8a', 'b04'] },
  /** NDVI: bands loaded as [b04=red @ idx 0, b8a=nir @ idx 1]. Scalar output. */
  ndvi: { label: 'NDVI', bands: ['b04', 'b8a'] }
} as const satisfies Record<string, { label: string; bands: string[] }>;

export type CompositeKey = keyof typeof COMPOSITES;
