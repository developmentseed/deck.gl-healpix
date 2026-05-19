import type { PaintColorIndex } from './colors';
import { DEFAULT_COLOR_INDEX } from './colors';

/** Map-ready cell with a resolved ID. */
export type ColoredCell = {
  id: number;
  colorIndex: PaintColorIndex;
};

/** One editor row: ID and color stay paired (id null = blank line). */
export type CellLine = {
  id: number | null;
  colorIndex: PaintColorIndex;
};

export function emptyEditorLine(
  colorIndex: PaintColorIndex = DEFAULT_COLOR_INDEX
): CellLine {
  return { id: null, colorIndex };
}

export function linesToText(lines: CellLine[]): string {
  return lines.map((l) => (l.id === null ? '' : String(l.id))).join('\n');
}

/**
 * Sync editor text to lines. Colors are keyed by cell ID, not line index, so
 * deleting a row removes that id+color pair and rows below keep their colors.
 */
export function linesFromText(
  text: string,
  prev: CellLine[],
  defaultColorIndex: PaintColorIndex = DEFAULT_COLOR_INDEX
): CellLine[] {
  if (text === '') {
    return [emptyEditorLine(defaultColorIndex)];
  }

  const colorById = new Map<number, PaintColorIndex>();
  for (const line of prev) {
    if (line.id !== null) colorById.set(line.id, line.colorIndex);
  }

  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { id: null, colorIndex: defaultColorIndex };

    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 0) {
      return { id: null, colorIndex: defaultColorIndex };
    }

    return {
      id: n,
      colorIndex: colorById.get(n) ?? defaultColorIndex
    };
  });
}

/**
 * One row per cell ID (last row wins for color), matching `linesToMapCells`.
 * Blank lines are dropped when any IDs remain.
 */
export function dedupeCellLinesById<T extends CellLine>(lines: T[]): T[] {
  const lastById = new Map<number, T>();
  const order: number[] = [];

  for (const line of lines) {
    if (line.id === null) continue;
    if (!lastById.has(line.id)) order.push(line.id);
    lastById.set(line.id, line);
  }

  if (order.length === 0) {
    const blanks = lines.filter((l) => l.id === null);
    return blanks.length > 0 ? blanks : lines;
  }

  return order.map((id) => lastById.get(id)!);
}

/** Drop trailing blank lines (keeps one blank row when the list is empty). */
export function trimTrailingBlankLines(lines: CellLine[]): CellLine[] {
  const next = [...lines];
  while (next.length > 1 && next[next.length - 1].id === null) {
    next.pop();
  }
  return next;
}

/** Cells to render on the map (last line wins for duplicate IDs). */
export function linesToMapCells(lines: CellLine[]): ColoredCell[] {
  const map = new Map<number, PaintColorIndex>();
  for (const line of lines) {
    if (line.id !== null) map.set(line.id, line.colorIndex);
  }
  return [...map.entries()].map(([id, colorIndex]) => ({ id, colorIndex }));
}

export function countFilledLines(lines: CellLine[]): number {
  return lines.filter((l) => l.id !== null).length;
}

export function upsertPaintedLines(
  lines: CellLine[],
  ids: number[],
  colorIndex: PaintColorIndex
): CellLine[] {
  const next = [...lines];

  for (const id of ids) {
    const idx = next.findIndex((l) => l.id === id);
    if (idx >= 0) {
      next[idx] = { id, colorIndex };
      continue;
    }

    const blankIdx = next.findIndex((l) => l.id === null);
    if (blankIdx >= 0) {
      next[blankIdx] = { id, colorIndex };
    } else {
      next.push({ id, colorIndex });
    }
  }

  return next;
}

export function removeLinesByCellIds(
  lines: CellLine[],
  ids: number[]
): CellLine[] {
  const remove = new Set(ids);
  const next = lines.filter((l) => l.id === null || !remove.has(l.id));
  return next.length > 0 ? next : [emptyEditorLine()];
}

export function coloredCellIds(cells: ColoredCell[]): number[] {
  return cells.map((c) => c.id);
}
