import { isEmpty, parseLooseDate, toScaledNumber } from "./inferColumns";
import { ColumnMeta, MAX_TOP_N, Row, SortMode } from "./types";

export function listDimNames(columns: ColumnMeta[]): string[] {
  const d = columns.filter((c) => c.role === "dimension").map((c) => c.name);
  if (d.length) return d;
  const fallback = columns.filter((c) => c.type !== "number").map((c) => c.name);
  return fallback.length ? fallback : columns.map((c) => c.name);
}

export function listMeasureNames(columns: ColumnMeta[]): string[] {
  const m = columns.filter((c) => c.role === "measure").map((c) => c.name);
  if (m.length) return m;
  // Only unclassified numerics may fall through. Columns explicitly marked
  // dimension/ignore (account codes, years, keys) are labels, and the old
  // "else use every column" fallback made even text columns look chartable.
  return columns.filter((c) => c.type === "number" && c.role !== "dimension" && c.role !== "ignore").map((c) => c.name);
}

export interface AggPoint {
  key: string;
  value: number;
}

function keyOf(row: Row, dim: string): string {
  const v = row[dim];
  // A date-shaped value stored as text (common when a sheet is pasted rather
  // than typed as a real Excel date cell) must bucket by month the same way
  // an actual Date cell does — otherwise it groups by exact literal string,
  // one bar per unique day instead of per month.
  const d = parseLooseDate(v);
  if (d) return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  return String(v ?? "—");
}

export function aggregate(
  rows: Row[],
  dim: string,
  measure: string,
  sort: SortMode,
  topN: number,
  chronological = false,
  rollupOther = false
): AggPoint[] {
  const order: string[] = [];
  const map = new Map<string, number>();
  const dates = new Map<string, number>();
  for (const row of rows) {
    const k = keyOf(row, dim);
    if (!map.has(k)) {
      map.set(k, 0);
      order.push(k);
    }
    map.set(k, (map.get(k) || 0) + toScaledNumber(row[measure], measure));
    if (chronological && !dates.has(k)) {
      const parsed = parseLooseDate(row[dim]);
      if (parsed) dates.set(k, parsed.getTime());
    }
  }
  let out: AggPoint[] = order.map((k) => ({ key: k, value: map.get(k) || 0 }));
  if (chronological && dates.size > 0) {
    out = out.slice().sort((a, b) => (dates.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (dates.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  }

  const limit = topN || MAX_TOP_N;
  if (out.length <= limit) {
    if (!chronological) {
      if (sort === "desc") out = out.slice().sort((a, b) => b.value - a.value);
      if (sort === "asc") out = out.slice().sort((a, b) => a.value - b.value);
    }
    return out;
  }

  // A time series must stay contiguous — folding the tail of a date axis into
  // one bucket would invent a point that never existed.
  if (chronological) return out.slice(0, limit);

  // Rank by value to decide the retained categories whenever an Other bucket is
  // visible. Natural-sort charts then put those retained categories back into
  // encounter order for display; KPI sparklines and other non-rollup callers
  // retain their original truncating behaviour.
  let kept: AggPoint[];
  let rest: AggPoint[];
  if (sort === "desc" || sort === "asc" || rollupOther) {
    const ranked = out.slice().sort((a, b) => b.value - a.value);
    const retained = ranked.slice(0, limit);
    rest = ranked.slice(limit);
    if (sort === "natural") {
      const retainedKeys = new Set(retained.map((point) => point.key));
      kept = out.filter((point) => retainedKeys.has(point.key));
    } else {
      kept = retained;
      if (sort === "asc") kept.sort((a, b) => a.value - b.value);
    }
  } else {
    kept = out.slice(0, limit);
    rest = out.slice(limit);
  }

  if (!rollupOther) return kept;
  return [...kept, { key: `Other (${rest.length})`, value: rest.reduce((s, p) => s + p.value, 0) }];
}

export function total(rows: Row[], measure: string): number {
  return rows.reduce((s, r) => s + toScaledNumber(r[measure], measure), 0);
}

/**
 * null means "not enough real data to compare" — distinct from a real 0%.
 * A naive first-half-vs-second-half split manufactures a fake -100%/+100%
 * swing whenever one half is entirely unreported (a forward-looking fiscal
 * template where only a few months have happened yet, a partial export,
 * etc.) rather than genuinely zero activity. Blank cells collapse to 0 the
 * same as real zeros once they reach toNumber, so this checks the *raw* rows
 * for actual presence of data before trusting the comparison.
 */
export function trendPct(rows: Row[], measure: string): number | null {
  if (rows.length < 4) return null;
  const mid = Math.floor(rows.length / 2);
  const firstRows = rows.slice(0, mid);
  const secondRows = rows.slice(mid);
  const hasData = (bucket: Row[]) => bucket.some((r) => !isEmpty(r[measure]));
  if (!hasData(firstRows) || !hasData(secondRows)) return null;
  const first = total(firstRows, measure);
  const second = total(secondRows, measure);
  if (first === 0) return second === 0 ? 0 : 100;
  return ((second - first) / Math.abs(first)) * 100;
}

export function distinctValues(rows: Row[], dim: string, cap = 8): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const k = keyOf(row, dim);
    if (!seen.has(k)) {
      seen.add(k);
      order.push(k);
    }
  }
  return order.slice(0, cap);
}

export interface PivotResult {
  rowKeys: string[];
  colKeys: string[];
  cell: (r: string, c: string) => number;
  rowTotal: (r: string) => number;
}

// Caps exist to keep a cross-tab readable, not to hide data — the tile scrolls,
// so they are set well above typical dimension cardinality (quarters, regions,
// departments, account codes) rather than at the old 8x6.
export function pivot(rows: Row[], dimRow: string, dimCol: string, measure: string, rowCap = 50, colCap = 24): PivotResult {
  const rowKeys = distinctValues(rows, dimRow, rowCap);
  const colKeys = distinctValues(rows, dimCol, colCap);
  const map = new Map<string, number>();
  const rowSums = new Map<string, number>();
  for (const row of rows) {
    const rk = keyOf(row, dimRow);
    const ck = keyOf(row, dimCol);
    const val = toScaledNumber(row[measure], measure);
    if (rowKeys.includes(rk)) {
      rowSums.set(rk, (rowSums.get(rk) || 0) + val);
    }
    if (!rowKeys.includes(rk) || !colKeys.includes(ck)) continue;
    const mk = rk + "|" + ck;
    map.set(mk, (map.get(mk) || 0) + val);
  }
  return {
    rowKeys,
    colKeys,
    cell: (r, c) => map.get(r + "|" + c) || 0,
    rowTotal: (r) => rowSums.get(r) || 0,
  };
}

export interface ScatterPoint {
  x: number;
  y: number;
  group: string;
}

export function scatterPoints(rows: Row[], xMeasure: string, yMeasure: string, groupDim: string): ScatterPoint[] {
  return rows.map((r) => ({
    x: toScaledNumber(r[xMeasure], xMeasure),
    y: toScaledNumber(r[yMeasure], yMeasure),
    group: keyOf(r, groupDim),
  }));
}

export function pickOther(current: string, all: string[]): string {
  const other = all.find((v) => v !== current);
  return other || current || all[0] || "";
}

function cardinalityScore(c: ColumnMeta, targetMin: number, targetMax: number): number {
  if (c.cardinality < 2) return 1000;
  if (c.cardinality < targetMin) return targetMin - c.cardinality;
  if (c.cardinality > targetMax) return 200 + (c.cardinality - targetMax);
  return 0;
}

/** Picks the best second dimension for a cross-tab (pivot/heatmap), preferring
 * a column with a small-to-moderate number of distinct values, different from `current`. */
export function pickComplementDim(current: string, columns: ColumnMeta[], targetMin = 2, targetMax = 14): string {
  const dims = columns.filter((c) => c.role === "dimension");
  const pool = dims.length ? dims : columns.filter((c) => c.type !== "number");
  const candidates = pool.filter((c) => c.name !== current);
  if (candidates.length === 0) return pickOther(current, listDimNames(columns));
  const best = [...candidates].sort((a, b) => cardinalityScore(a, targetMin, targetMax) - cardinalityScore(b, targetMin, targetMax))[0];
  return best.name;
}
