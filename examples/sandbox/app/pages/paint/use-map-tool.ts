import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Map as MaplibreMap, MapTouchEvent } from 'maplibre-gl';
import type { MapMouseEvent, MapRef } from 'react-map-gl/maplibre';

import { lonLatToCell } from './healpix-geo';
import { ERASE_TOOL_CURSOR, getPaintToolCursor } from './map-tool-cursors';
import type { HealpixScheme, MapTool } from './types';

const STROKE_THRESHOLD_PX = 10;

type UseMapToolOptions = {
  mapRef: RefObject<MapRef | null>;
  isMapLoaded: boolean;
  activeTool: MapTool | null;
  paintColorHex: string;
  isCoarsePointer: boolean;
  nside: number;
  scheme: HealpixScheme;
  onPaintCells: (cellIds: number[]) => void;
  onEraseCells: (cellIds: number[]) => void;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

function isDrawTool(tool: MapTool | null): tool is 'paint' | 'erase' {
  return tool === 'paint' || tool === 'erase';
}

function allowsOneFingerPan(tool: MapTool | null, spaceHeld: boolean): boolean {
  if (spaceHeld) return true;
  return !isDrawTool(tool);
}

/** Map tools: desktop draw + Space-pan; touch tap-draw + two-finger pan. */
export function useMapTool(opts: UseMapToolOptions) {
  const {
    mapRef,
    isMapLoaded,
    activeTool,
    paintColorHex,
    isCoarsePointer,
    nside,
    scheme,
    onPaintCells,
    onEraseCells
  } = opts;

  const draggingRef = useRef(false);
  const spaceHeldRef = useRef(false);
  const touchStrokeRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [spacePan, setSpacePan] = useState(false);

  const syncPan = (map: MaplibreMap) => {
    if (allowsOneFingerPan(activeTool, spaceHeldRef.current)) {
      map.dragPan.enable();
    } else {
      map.dragPan.disable();
    }
  };

  const syncCursor = (canvas: HTMLCanvasElement) => {
    const tool = activeTool;
    const space = spaceHeldRef.current;

    if (!tool) {
      canvas.style.cursor = '';
      return;
    }
    if (space && isDrawTool(tool)) {
      canvas.style.cursor = 'grab';
      return;
    }
    if (tool === 'erase') {
      canvas.style.cursor = ERASE_TOOL_CURSOR;
      return;
    }
    if (tool === 'paint') {
      canvas.style.cursor = getPaintToolCursor(paintColorHex);
    }
  };

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !isMapLoaded) return;

    const canvas = map.getCanvas();
    syncPan(map);
    syncCursor(canvas);

    return () => {
      canvas.style.cursor = '';
    };
  }, [
    mapRef,
    isMapLoaded,
    activeTool,
    paintColorHex,
    spacePan,
    isCoarsePointer
  ]);

  // Desktop: Space temporarily pans while paint/erase is active.
  useEffect(() => {
    if (isCoarsePointer || !isDrawTool(activeTool) || !isMapLoaded) {
      spaceHeldRef.current = false;
      setSpacePan(false);
      return;
    }

    const map = mapRef.current?.getMap();
    if (!map) return;

    const releaseSpace = () => {
      if (!spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      setSpacePan(false);
      draggingRef.current = false;
      syncPan(map);
      syncCursor(map.getCanvas());
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isEditableTarget(e.target)) return;
      e.preventDefault();
      spaceHeldRef.current = true;
      setSpacePan(true);
      draggingRef.current = false;
      syncPan(map);
      syncCursor(map.getCanvas());
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      releaseSpace();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseSpace);

    return () => {
      releaseSpace();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseSpace);
    };
  }, [activeTool, isMapLoaded, mapRef, isCoarsePointer]);

  // Desktop: click-drag to paint/erase.
  useEffect(() => {
    if (isCoarsePointer || !isDrawTool(activeTool) || !isMapLoaded) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const applyAtEvent = (e: MapMouseEvent) => {
      const id = lonLatToCell(nside, e.lngLat.lng, e.lngLat.lat, scheme);
      if (activeTool === 'paint') onPaintCells([id]);
      else onEraseCells([id]);
    };

    const onMouseDown = (e: MapMouseEvent) => {
      if (e.originalEvent.button !== 0 || spaceHeldRef.current) return;
      draggingRef.current = true;
      map.dragPan.disable();
      applyAtEvent(e);
    };

    const onMouseMove = (e: MapMouseEvent) => {
      if (!draggingRef.current || spaceHeldRef.current) return;
      applyAtEvent(e);
    };

    const stopDragging = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      syncPan(map);
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', stopDragging);
    map.on('mouseleave', stopDragging);

    return () => {
      draggingRef.current = false;
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', stopDragging);
      map.off('mouseleave', stopDragging);
      map.dragPan.enable();
    };
  }, [
    activeTool,
    isMapLoaded,
    mapRef,
    nside,
    scheme,
    isCoarsePointer,
    onPaintCells,
    onEraseCells
  ]);

  // Touch: tap cell; drag after threshold; two-finger pan.
  useEffect(() => {
    if (!isCoarsePointer || !isDrawTool(activeTool) || !isMapLoaded) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const tool = activeTool;

    const applyAtLngLat = (lng: number, lat: number) => {
      const id = lonLatToCell(nside, lng, lat, scheme);
      if (tool === 'paint') onPaintCells([id]);
      else onEraseCells([id]);
    };

    const applyAtTouchEvent = (e: MapTouchEvent) => {
      const lngLat = e.lngLat ?? e.lngLats?.[0];
      if (!lngLat) return;
      applyAtLngLat(lngLat.lng, lngLat.lat);
    };

    const touchCount = (e: MapTouchEvent) =>
      e.originalEvent.touches.length || e.points.length;

    const blockBrowserScroll = (e: MapTouchEvent) => {
      if (touchCount(e) === 1 && e.originalEvent.cancelable) {
        e.originalEvent.preventDefault();
      }
    };

    const onTouchStart = (e: MapTouchEvent) => {
      if (touchCount(e) >= 2) {
        draggingRef.current = false;
        touchStrokeRef.current = false;
        touchStartRef.current = null;
        map.dragPan.enable();
        return;
      }

      blockBrowserScroll(e);
      map.dragPan.disable();
      touchStrokeRef.current = false;
      touchStartRef.current = { x: e.point.x, y: e.point.y };
      applyAtTouchEvent(e);
    };

    const onTouchMove = (e: MapTouchEvent) => {
      if (touchCount(e) >= 2) {
        map.dragPan.enable();
        return;
      }

      blockBrowserScroll(e);

      if (!touchStartRef.current) return;

      const dx = e.point.x - touchStartRef.current.x;
      const dy = e.point.y - touchStartRef.current.y;
      if (
        !touchStrokeRef.current &&
        dx * dx + dy * dy >= STROKE_THRESHOLD_PX * STROKE_THRESHOLD_PX
      ) {
        touchStrokeRef.current = true;
        draggingRef.current = true;
      }

      if (touchStrokeRef.current) applyAtTouchEvent(e);
    };

    const onTouchEnd = () => {
      draggingRef.current = false;
      touchStrokeRef.current = false;
      touchStartRef.current = null;
      syncPan(map);
    };

    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    map.on('touchend', onTouchEnd);
    map.on('touchcancel', onTouchEnd);

    return () => {
      map.off('touchstart', onTouchStart);
      map.off('touchmove', onTouchMove);
      map.off('touchend', onTouchEnd);
      map.off('touchcancel', onTouchEnd);
      map.dragPan.enable();
    };
  }, [
    activeTool,
    isMapLoaded,
    mapRef,
    nside,
    scheme,
    isCoarsePointer,
    onPaintCells,
    onEraseCells
  ]);

  // Non-passive canvas listeners stop mobile browsers from scrolling / pull-to-refresh.
  useEffect(() => {
    if (!isCoarsePointer || !isDrawTool(activeTool) || !isMapLoaded) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const canvas = map.getCanvas();
    const container = map.getContainer();

    canvas.style.touchAction = 'none';
    container.style.touchAction = 'none';

    const blockIfSingleTouch = (e: TouchEvent) => {
      if (e.touches.length === 1 && e.cancelable) e.preventDefault();
    };

    canvas.addEventListener('touchstart', blockIfSingleTouch, {
      passive: false
    });
    canvas.addEventListener('touchmove', blockIfSingleTouch, {
      passive: false
    });

    return () => {
      canvas.style.touchAction = '';
      container.style.touchAction = '';
      canvas.removeEventListener('touchstart', blockIfSingleTouch);
      canvas.removeEventListener('touchmove', blockIfSingleTouch);
    };
  }, [activeTool, isMapLoaded, mapRef, isCoarsePointer]);

  const drawToolActive = isDrawTool(activeTool);

  return {
    spacePan,
    dragPanEnabled: allowsOneFingerPan(activeTool, spacePan),
    /** Apply to the map wrapper while painting on touch devices. */
    mapTouchAction: isCoarsePointer && drawToolActive ? 'none' : 'auto'
  };
}
