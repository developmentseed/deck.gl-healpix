import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { lonLat2PixNest } from 'healpix-ts';
import {
  HealpixCellsLayer,
  HEALPIX_COLOR_MODE_SCALAR,
  makeColorMap
} from '@developmentseed/deck.gl-healpix';

const NSIDE = 32;
const FADE_MS = 1000;

// Brand primary #1E7BC6, alpha fades from 200 (fresh) to 0 (gone).
const TRAIL_COLOR_MAP = makeColorMap((t) => [
  30,
  123,
  198,
  Math.round(200 * (1 - t))
]);

export function useHealpixTrail(mapRef: RefObject<MapRef | null>) {
  const trailRef = useRef<Map<number, number>>(new Map());
  const hadCellsRef = useRef(false);
  const [layers, setLayers] = useState<HealpixCellsLayer[]>([]);

  // Window-level listener so overlay elements don't block mouse events.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const rect = map.getCanvas().getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      const { lng, lat } = map.unproject([x, y]);
      trailRef.current.set(lonLat2PixNest(NSIDE, lng, lat), Date.now());
    };

    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, [mapRef]);

  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const now = Date.now();
      const trail = trailRef.current;

      for (const [id, addedAt] of trail) {
        if (now - addedAt >= FADE_MS) trail.delete(id);
      }

      const hasNow = trail.size > 0;

      if (hasNow || hadCellsRef.current) {
        const count = trail.size;
        const cellIds = new Uint32Array(count);
        const values = new Float32Array(count);
        let i = 0;
        for (const [id, addedAt] of trail) {
          cellIds[i] = id;
          values[i] = (now - addedAt) / FADE_MS;
          i++;
        }

        setLayers(
          count === 0
            ? []
            : [
                new HealpixCellsLayer({
                  id: 'healpix-trail',
                  nside: NSIDE,
                  scheme: 'nest',
                  cellIds,
                  values,
                  min: 0,
                  max: 1,
                  dimensions: 1,
                  colorMode: HEALPIX_COLOR_MODE_SCALAR,
                  colorMap: TRAIL_COLOR_MAP
                })
              ]
        );
      }

      hadCellsRef.current = hasNow;
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return { layers };
}
