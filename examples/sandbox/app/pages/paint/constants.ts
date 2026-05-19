/** Powers of 2 from 2 through 262144. */
export const NSIDE_OPTIONS = Array.from({ length: 18 }, (_, i) => 2 ** (i + 1));

/** Default map view for the paint page. */
export const DEFAULT_VIEW_STATE = {
  latitude: 20,
  longitude: 0,
  zoom: 1.5
};
