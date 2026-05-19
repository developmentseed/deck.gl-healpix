/** Font Awesome 6 paths (same as FaPaintbrush / FaEraser from react-icons/fa6). */
const FA_VIEW_BOX = '0 0 576 512';

const PAINTBRUSH_PATH =
  'M339.3 367.1c27.3-3.9 51.9-19.4 67.2-42.9L568.2 74.1c12.6-19.5 9.4-45.3-7.6-61.2S517.7-4.4 499.1 9.6L262.4 187.2c-24 18-38.2 46.1-38.4 76.1L339.3 367.1zm-19.6 25.4l-116-104.4C143.9 290.3 96 339.6 96 400c0 3.9 .2 7.8 .6 11.6C98.4 429.1 86.4 448 68.8 448L64 448c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0c61.9 0 112-50.1 112-112c0-2.5-.1-5-.2-7.5z';

const ERASER_PATH =
  'M290.7 57.4L57.4 290.7c-25 25-25 65.5 0 90.5l80 80c12 12 28.3 18.7 45.3 18.7L288 480l9.4 0L512 480c17.7 0 32-14.3 32-32s-14.3-32-32-32l-124.1 0L518.6 285.3c25-25 25-65.5 0-90.5L381.3 57.4c-25-25-65.5-25-90.5 0zM297.4 416l-9.4 0-105.4 0-80-80L227.3 211.3 364.7 348.7 297.4 416z';

const CURSOR_SIZE = 24;
const ERASE_COLOR = '#e53e3e';
const STROKE_COLOR = '#1a1a1a';
/** ~1px outline at cursor display size (viewBox units). */
const STROKE_WIDTH = 576 / CURSOR_SIZE;

/** Map a FA viewBox point to cursor pixel coordinates. */
function hotspot(viewBoxX: number, viewBoxY: number): [number, number] {
  return [
    Math.round((viewBoxX / 576) * CURSOR_SIZE),
    Math.round((viewBoxY / 512) * CURSOR_SIZE)
  ];
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function cursorFromSvg(
  svg: string,
  hotspotX: number,
  hotspotY: number,
  fallback: string
): string {
  return `url("${svgDataUrl(svg)}") ${hotspotX} ${hotspotY}, ${fallback}`;
}

function iconCursorSvg(pathD: string, fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" viewBox="${FA_VIEW_BOX}">
  <path fill="none" stroke="${STROKE_COLOR}" stroke-width="${STROKE_WIDTH}" stroke-linejoin="round" d="${pathD}"/>
  <path fill="${fill}" d="${pathD}" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.55))"/>
</svg>`;
}

const paintCursorCache = new Map<string, string>();

/** FaPaintbrush; fill matches the active swatch. */
export function getPaintToolCursor(colorHex: string): string {
  const cached = paintCursorCache.get(colorHex);
  if (cached) return cached;

  const [hx, hy] = hotspot(175, 465);
  const cursor = cursorFromSvg(
    iconCursorSvg(PAINTBRUSH_PATH, colorHex),
    hx,
    hy,
    'crosshair'
  );
  paintCursorCache.set(colorHex, cursor);
  return cursor;
}

/** FaEraser. */
const [eraseHx, eraseHy] = hotspot(300, 430);
export const ERASE_TOOL_CURSOR = cursorFromSvg(
  iconCursorSvg(ERASER_PATH, ERASE_COLOR),
  eraseHx,
  eraseHy,
  'cell'
);
