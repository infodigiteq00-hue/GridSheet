import type { CSSProperties } from "react";
import { Widget } from "./types";

export const GRID_COLS = 12;
export const GRID_GAP = 14;
export const ROW_SNAP = 8;
export const MIN_SPAN = 2;
export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 560;

export interface GridBox {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  height: number;
}

export interface GridMetrics {
  inner: number;
  colSize: number;
  step: number;
  gap: number;
}

export function metricsFromInner(inner: number): GridMetrics {
  const gap = GRID_GAP;
  const colSize = Math.max(1, (inner - (GRID_COLS - 1) * gap) / GRID_COLS);
  return { inner, colSize, step: colSize + gap, gap };
}

export function snapRow(y: number): number {
  return Math.max(0, Math.round(y / ROW_SNAP) * ROW_SNAP);
}

export function clampSpan(span: number): number {
  return Math.max(MIN_SPAN, Math.min(GRID_COLS, Math.round(span)));
}

export function clampHeight(height: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height / ROW_SNAP) * ROW_SNAP));
}

export function asBox(w: Pick<Widget, "id" | "colSpan" | "height"> & { col?: number; row?: number }): GridBox {
  return {
    id: w.id,
    col: Number.isFinite(w.col) ? (w.col as number) : 0,
    row: Number.isFinite(w.row) ? (w.row as number) : 0,
    colSpan: clampSpan(w.colSpan),
    height: clampHeight(w.height),
  };
}

export function boxesOverlap(a: GridBox, b: GridBox): boolean {
  if (a.id === b.id) return false;
  const cols = a.col < b.col + b.colSpan && a.col + a.colSpan > b.col;
  // Touching or sitting in the visual gutter is not an overlap. This matters
  // in infinite canvas mode, where a tile should remain exactly where it was
  // released unless its rectangle actually intersects another tile.
  const rows = a.row < b.row + b.height && b.row < a.row + a.height;
  return cols && rows;
}

export function collides(box: GridBox, others: GridBox[]): boolean {
  return others.some((o) => boxesOverlap(box, o));
}

export function colToX(col: number, m: GridMetrics): number {
  return col * m.step;
}

export function spanToWidth(span: number, m: GridMetrics): number {
  return span * m.colSize + Math.max(0, span - 1) * m.gap;
}

export function xToCol(x: number, span: number, m: GridMetrics): number {
  const col = Math.round(x / m.step);
  return Math.max(0, Math.min(GRID_COLS - span, col));
}

export function yToRow(y: number): number {
  return snapRow(y);
}

export function gridPlacementStyle(w: GridBox): CSSProperties {
  const rowStart = Math.floor(w.row / ROW_SNAP) + 1;
  const rowSpan = Math.max(1, Math.round(w.height / ROW_SNAP));
  return {
    gridColumn: `${w.col + 1} / span ${w.colSpan}`,
    gridRow: `${rowStart} / span ${rowSpan}`,
    height: w.height,
  };
}

export function boardGridStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
    gridAutoRows: `${ROW_SNAP}px`,
    columnGap: GRID_GAP,
    rowGap: 0,
    alignContent: "start",
  };
}

export function absolutePlacementStyle(w: GridBox, m: GridMetrics): CSSProperties {
  return {
    position: "absolute",
    left: colToX(w.col, m),
    top: w.row,
    width: spanToWidth(w.colSpan, m),
    height: w.height,
  };
}

export function boardHeight(boxes: GridBox[], extra = 180): number {
  const bottom = boxes.reduce((m, b) => Math.max(m, b.row + b.height), 0);
  return Math.max(320, bottom + extra);
}

// Compact stat cards are deliberately fixed-size — stretching a KPI or gauge
// to fill six empty columns just spreads a small number across dead space
// instead of using it. Every other type genuinely benefits from more room.
const NO_AUTO_STRETCH: Widget["type"][] = ["kpi", "gauge"];

export function packFlow(widgets: Widget[]): Widget[] {
  const colY = Array<number>(GRID_COLS).fill(0);
  const placed = widgets.map((w) => {
    const span = clampSpan(w.colSpan);
    const height = clampHeight(w.height);
    let bestX = 0;
    let bestY = Number.POSITIVE_INFINITY;
    for (let x = 0; x <= GRID_COLS - span; x++) {
      let y = 0;
      for (let i = 0; i < span; i++) y = Math.max(y, colY[x + i]);
      if (y < bestY) {
        bestY = y;
        bestX = x;
      }
    }
    for (let i = 0; i < span; i++) colY[bestX + i] = bestY + height + GRID_GAP;
    return { ...w, colSpan: span, height, col: bestX, row: bestY };
  });
  return growTrailingTiles(placed);
}

/**
 * The shelf packer above places every widget at its own requested width, so
 * a lone half-width chart with nothing queued to sit beside it leaves the
 * rest of its row empty — the gap is real free space, not a rendering bug,
 * but nothing ever reclaims it. This grows each tile rightward up to the
 * nearest column any OTHER tile actually occupies across its vertical span,
 * so a row fills automatically whenever the leftover space genuinely fits.
 */
function growTrailingTiles(widgets: Widget[]): Widget[] {
  return widgets.map((w, i) => {
    if (NO_AUTO_STRETCH.includes(w.type)) return w;
    const rightEdge = w.col + w.colSpan;
    if (rightEdge >= GRID_COLS) return w;
    let maxRight = GRID_COLS;
    for (let j = 0; j < widgets.length; j++) {
      if (j === i) continue;
      const other = widgets[j];
      const sharesVerticalSpace = w.row < other.row + other.height && other.row < w.row + w.height;
      if (sharesVerticalSpace && other.col >= rightEdge) maxRight = Math.min(maxRight, other.col);
    }
    return maxRight > rightEdge ? { ...w, colSpan: maxRight - w.col } : w;
  });
}

export function findOpenSlot(box: GridBox, others: GridBox[]): { col: number; row: number } {
  const span = clampSpan(box.colSpan);
  const height = clampHeight(box.height);
  const trial = { ...box, colSpan: span, height };
  for (let row = 0; row < 12000; row += ROW_SNAP) {
    for (let col = 0; col <= GRID_COLS - span; col++) {
      if (!collides({ ...trial, col, row }, others)) return { col, row };
    }
  }
  return { col: 0, row: boardHeight(others, 0) };
}

export function nearestFree(desired: GridBox, others: GridBox[]): { col: number; row: number } {
  const span = clampSpan(desired.colSpan);
  const height = clampHeight(desired.height);
  const col0 = Math.max(0, Math.min(GRID_COLS - span, Math.round(desired.col)));
  const row0 = snapRow(desired.row);
  const base = { ...desired, colSpan: span, height, col: col0, row: row0 };
  if (!collides(base, others)) return { col: col0, row: row0 };

  for (let r = 1; r < 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const col = Math.max(0, Math.min(GRID_COLS - span, col0 + dx));
        const row = Math.max(0, row0 + dy * ROW_SNAP);
        if (!collides({ ...base, col, row }, others)) return { col, row };
      }
    }
  }

  let row = row0;
  while (collides({ ...base, col: col0, row }, others)) row += ROW_SNAP;
  return { col: col0, row };
}

/**
 * Same nearest-empty-space spiral search as nearestFree, generalized for
 * infinite-canvas placement: no 12-column clamp (tiles may sit beyond the
 * nominal grid width there), and the horizontal step is caller-supplied
 * since infinite mode's "column" is a continuous pixel-derived unit, not a
 * fixed grid cell.
 */
export function nearestFreeUnbounded(desired: GridBox, others: GridBox[], colStep: number): { col: number; row: number } {
  const height = clampHeight(desired.height);
  // Genuinely unbounded — a tile released above or left of the canvas origin
  // stays there rather than snapping back to 0, which is what made panning
  // past the top-left edge feel bounded despite "infinite" in the name.
  const col0 = desired.col;
  const row0 = desired.row;
  const base = { ...desired, height, col: col0, row: row0 };
  if (!collides(base, others)) return { col: col0, row: row0 };

  for (let r = 1; r < 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const col = col0 + dx * colStep;
        const row = row0 + dy * ROW_SNAP;
        if (!collides({ ...base, col, row }, others)) return { col, row };
      }
    }
  }

  let row = row0;
  while (collides({ ...base, col: col0, row }, others)) row += ROW_SNAP;
  return { col: col0, row };
}

/**
 * How far this tile can grow left/up — the mirror of maxGrow for a top-left
 * resize handle, where the bottom-right corner stays anchored and col/row
 * move as the span/height grow instead.
 */
export function maxGrowTopLeft(box: GridBox, others: GridBox[]): { colSpan: number; height: number } {
  const rightEdge = box.col + box.colSpan;
  const bottomEdge = box.row + box.height;
  let maxSpan = rightEdge; // col can't go below 0, so span is capped by the current right edge
  let maxH = Math.min(MAX_HEIGHT, bottomEdge); // row can't go below 0 either
  for (const o of others) {
    const rowsOverlap = box.row < o.row + o.height + GRID_GAP && o.row < box.row + box.height + GRID_GAP;
    const colsOverlap = box.col < o.col + o.colSpan && box.col + box.colSpan > o.col;
    if (rowsOverlap && o.col + o.colSpan <= box.col) {
      maxSpan = Math.min(maxSpan, rightEdge - (o.col + o.colSpan));
    }
    if (colsOverlap && o.row + o.height + GRID_GAP <= box.row) {
      maxH = Math.min(maxH, bottomEdge - (o.row + o.height + GRID_GAP));
    }
  }
  return { colSpan: Math.max(MIN_SPAN, Math.min(GRID_COLS, maxSpan)), height: Math.max(MIN_HEIGHT, maxH) };
}

/** How far this tile can grow right/down from its current origin without overlapping. */
export function maxGrow(box: GridBox, others: GridBox[]): { colSpan: number; height: number } {
  let maxSpan = GRID_COLS - box.col;
  let maxH = MAX_HEIGHT;
  for (const o of others) {
    const rowsOverlap = box.row < o.row + o.height + GRID_GAP && o.row < box.row + box.height + GRID_GAP;
    const colsOverlap = box.col < o.col + o.colSpan && box.col + box.colSpan > o.col;
    if (rowsOverlap && o.col >= box.col + box.colSpan) {
      maxSpan = Math.min(maxSpan, o.col - box.col);
    } else if (rowsOverlap && o.col > box.col) {
      maxSpan = Math.min(maxSpan, o.col - box.col);
    }
    if (colsOverlap && o.row >= box.row + box.height) {
      maxH = Math.min(maxH, o.row - GRID_GAP - box.row);
    } else if (colsOverlap && o.row > box.row) {
      maxH = Math.min(maxH, o.row - GRID_GAP - box.row);
    }
  }
  return { colSpan: Math.max(MIN_SPAN, maxSpan), height: Math.max(MIN_HEIGHT, maxH) };
}

/** Push tiles down far enough to make room for a resized tile. */
export function pushDownLayout(target: GridBox, others: GridBox[]): Map<string, number> {
  const placed: GridBox[] = [target];
  const moved = new Map<string, number>();
  const ordered = [...others].sort((a, b) => a.row - b.row || a.col - b.col);

  for (const candidate of ordered) {
    let row = candidate.row;
    let guard = 0;
    while (guard++ < 200) {
      const blockers = placed.filter((p) => {
        const horizontal = candidate.col < p.col + p.colSpan && candidate.col + candidate.colSpan > p.col;
        const vertical = row < p.row + p.height && p.row < row + candidate.height;
        return horizontal && vertical;
      });
      if (blockers.length === 0) break;
      row = Math.max(...blockers.map((p) => p.row + p.height + GRID_GAP));
    }
    moved.set(candidate.id, row);
    placed.push({ ...candidate, row });
  }

  return moved;
}

/** True when two tiles collide, treating the board gutter as required space. */
function collidesWithGutter(candidate: GridBox, placed: GridBox[]): boolean {
  return placed.some((other) => {
    const horizontal = candidate.col < other.col + other.colSpan && candidate.col + candidate.colSpan > other.col;
    const vertical = candidate.row < other.row + other.height + GRID_GAP && other.row < candidate.row + candidate.height + GRID_GAP;
    return horizontal && vertical;
  });
}

/**
 * Reflow a board after a resize while keeping the resized tile fixed. Every
 * other tile is placed in the highest available row where it fits; when a row
 * has several openings, it prefers the column closest to its current one.
 * This gives the canvas a useful vertical compaction without arbitrarily
 * moving the tile the user just resized to the bottom of the dashboard.
 */
export function compactAround(target: GridBox, others: GridBox[]): Map<string, Pick<GridBox, "col" | "row">> {
  const placed: GridBox[] = [target];
  const positions = new Map<string, Pick<GridBox, "col" | "row">>();
  const sorted = [...others].sort((a, b) => a.row - b.row || a.col - b.col);
  const searchLimit = Math.max(
    boardHeight([target, ...others], 0) + sorted.reduce((sum, box) => sum + box.height + GRID_GAP, 0),
    target.row + target.height + GRID_GAP
  );

  for (const candidate of sorted) {
    const span = clampSpan(candidate.colSpan);
    const height = clampHeight(candidate.height);
    let slot: Pick<GridBox, "col" | "row"> | null = null;

    for (let row = 0; row <= searchLimit && !slot; row += ROW_SNAP) {
      let closest: Pick<GridBox, "col" | "row"> | null = null;
      for (let col = 0; col <= GRID_COLS - span; col++) {
        const trial = { ...candidate, col, row, colSpan: span, height };
        if (collidesWithGutter(trial, placed)) continue;
        if (!closest || Math.abs(col - candidate.col) < Math.abs(closest.col - candidate.col)) {
          closest = { col, row };
        }
      }
      slot = closest;
    }

    // The finite 12-column board always has a slot before searchLimit. Keep a
    // defensive fallback so malformed imported coordinates cannot create an
    // invalid overlapping layout.
    const resolved = slot ?? { col: 0, row: boardHeight(placed, GRID_GAP) };
    positions.set(candidate.id, resolved);
    placed.push({ ...candidate, ...resolved, colSpan: span, height });
  }

  return positions;
}

export function constrainBox(box: GridBox, others: GridBox[]): GridBox {
  const colSpan = clampSpan(box.colSpan);
  const height = clampHeight(box.height);
  // Infinite-canvas tiles may intentionally sit beyond the original
  // twelve-column editing area, in any direction — including negative
  // col/row. Normal grid interactions (xToCol/yToRow) already clamp their
  // input to non-negative before it reaches this function, so this stays a
  // no-op for the fixed grid and only matters for infinite-canvas placement.
  const grown = { ...box, colSpan, height };
  if (!collides(grown, others)) return grown;
  const { col: fc, row: fr } = nearestFree(grown, others);
  return { ...grown, col: fc, row: fr };
}

export function withPositions(widgets: Widget[]): Widget[] {
  if (widgets.length === 0) return widgets;

  // Normalize in widget order. Valid coordinates remain unchanged when they
  // are free; an old/corrupt overlap is moved to the nearest free slot so the
  // builder, landing page, and published page all share the same guarantee.
  const placed: GridBox[] = [];
  return widgets.map((w) => {
    const box = asBox(w);
    const hasPosition = Number.isFinite(w.col) && Number.isFinite(w.row);
    const slot = hasPosition
      ? collides(box, placed)
        ? nearestFree(box, placed)
        : { col: box.col, row: box.row }
      : findOpenSlot(box, placed);
    const next = { ...w, col: slot.col, row: slot.row, colSpan: box.colSpan, height: box.height };
    placed.push({ ...box, ...slot });
    return next;
  });
}
