import { useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay, MapboxOverlayProps } from '@deck.gl/mapbox';

/** Renders Deck.gl layers as an overlay on the react-map-gl Map (MapLibre). */
export function DeckGlOverlay(props: MapboxOverlayProps) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}
