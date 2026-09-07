import { mk, pickAllMeasures, pickDims, pickMeasures } from "./heuristicLayout";
import { packFlow } from "./gridLayout";
import { ColumnMeta, DashboardState, MAX_TOP_N, PaletteKey, SortMode, TYPES, Widget, WidgetType } from "./types";

/** Tile types whose whole purpose is arithmetic over a measure. */
const QUANTITATIVE_TYPES = new Set<WidgetType>(TYPES.filter((t) => t !== "text" && t !== "table"));

export interface AiWidgetSpec {
  type?: string;
  title?: string;
  dim?: string;
  measure?: string;
  colSpan?: number;
  height?: number;
  palette?: string;
  sort?: string;
  topN?: number;
  text?: string;
  target?: number;
}

export interface AiLayoutSpec {
  boardTitle?: string;
  widgets?: AiWidgetSpec[];
}

const PALETTE_KEYS: PaletteKey[] = ["cobalt", "ember", "ink", "bloom"];
const SORT_MODES: SortMode[] = ["natural", "desc", "asc"];

/** Categorical charts should answer "which is largest?" by default. */
function defaultSortFor(type: WidgetType): SortMode {
  return type === "bar" || type === "pie" ? "desc" : "natural";
}

export function buildColumnSummary(columns: ColumnMeta[]) {
  return columns.map((c) => ({
    name: c.name,
    type: c.type,
    role: c.role,
    distinctValues: c.cardinality,
    examples: c.sampleValues,
  }));
}

export function schemaDescription(): string {
  return `Return strict JSON with this shape:
{
  "boardTitle": string,
  "widgets": [
    {
      "type": one of ${JSON.stringify(TYPES)},
      "title": short string,
      "dim": a column name to group by (use "" if not applicable, e.g. for "table"/"text"),
      "measure": a column name that is numeric (use "" only for "text"),
      "colSpan": integer 2-12 (12-column grid, 3 = quarter width, 6 = half, 12 = full),
      "height": integer 120-480 (pixels),
      "palette": one of ["cobalt","ember","ink","bloom"],
      "sort": one of ["natural","desc","asc"],
      "topN": integer 2-${MAX_TOP_N},
      "text": string, only meaningful for type "text" — a short 1-3 sentence insight written from the data,
      "target": integer, only meaningful for type "gauge" — a realistic goal value for the measure
    }
  ]
}
The user's requested analysis is the scope of the dashboard. When they name a metric, period, question, chart count, or a limited set of outputs, include only what is needed to answer that request. Do not add unrelated measures or generic overview tiles merely because those columns are available. If the request clearly does not apply to this sheet, return an empty "widgets" array for this sheet.
When there is no requested analysis, make a concise overview of only the most useful measures — usually 4-8 tiles, never a chart for every numeric column by default.
For each selected measure, choose the chart type based on its shape: line/area when grouped by a date dimension (a real trend), pie/donut only when the grouping dimension has 6 or fewer distinct values and no negative values (a real share-of-total), bar for other categorical breakdowns, kpi for a single headline total worth calling out on its own. Use table/pivot for full-detail rows and heatmap/scatter/gauge only where they directly answer the request. For bar and pie charts, set "sort" to "desc" so the largest real categories appear first; use "asc" or "natural" only when the user explicitly asks for that order, or when a date axis needs chronological order. For a table, use its selected numeric measure as the sort key when an ascending or descending order is requested. Only reference column names that were provided. Do not wrap the JSON in markdown.`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function singleWidgetSchemaDescription(): string {
  return `Return strict JSON describing exactly one dashboard tile with this shape:
{
  "type": one of ${JSON.stringify(TYPES)},
  "title": short string (<=60 chars),
  "dim": a column name to group by (use "" if not applicable),
  "measure": a column name that is numeric (use "" only for "text"),
  "sort": one of ["natural","desc","asc"],
  "topN": integer 2-${MAX_TOP_N},
  "text": string, only meaningful for type "text" — a short 1-2 sentence insight,
  "target": integer, only meaningful for type "gauge"
}
If the input includes a "current" tile, the user is editing that existing tile: keep any field their
request doesn't clearly ask to change (reuse the current type/dim/measure/etc. as-is). For a new bar
or pie chart, use "desc" to put the largest categories first unless the user asks for another order. Only reference
column names that were provided. Do not wrap the JSON in markdown.`;
}

/**
 * Sanitizes a single AI- or heuristic-produced widget spec into a real Widget.
 * Unlike sanitizeAiLayout (which drops whole widgets on invalid type), this
 * always returns a usable tile — falling back to `base` (the widget being
 * edited, if any) or sensible defaults — since a single "create/edit tile"
 * request should never come back empty-handed.
 */
export function sanitizeAiWidget(raw: unknown, columns: ColumnMeta[], base?: Widget): Widget {
  const item = (raw && typeof raw === "object" ? (raw as AiWidgetSpec) : {}) as AiWidgetSpec;
  const validNames = new Set(columns.map((c) => c.name));
  const dims = pickDims(columns, 2);
  const measures = pickMeasures(columns, 3);

  const fallbackType: WidgetType = base?.type || "bar";
  let type: WidgetType = (TYPES as string[]).includes(item.type || "") ? (item.type as WidgetType) : fallbackType;

  const allowedMeasures = new Set(pickAllMeasures(columns));
  const hasMeasures = allowedMeasures.size > 0;

  // If no measures are available and the requested type is quantitative,
  // fall back to "table" instead of producing a chart of an identifier.
  if (!hasMeasures && QUANTITATIVE_TYPES.has(type)) type = "table";

  const fallbackDim = base?.dim || dims[0] || "";
  const fallbackMeasure = base?.measure || measures[0] || "";
  const dim = item.dim && validNames.has(item.dim) ? item.dim : fallbackDim;
  // Same enforcement as sanitizeAiLayout: existing-column is not the bar,
  // being an actual measure is. Otherwise "make a KPI of account_code"
  // produces arithmetic over an identifier.
  const measure = item.measure && allowedMeasures.has(item.measure) ? item.measure : fallbackMeasure;

  const palette = PALETTE_KEYS.includes(item.palette as PaletteKey) ? (item.palette as PaletteKey) : base?.palette || "cobalt";
  const sort = SORT_MODES.includes(item.sort as SortMode) ? (item.sort as SortMode) : base?.sort || defaultSortFor(type);
  const compact = type === "kpi" || type === "gauge";

  const partial: Partial<Widget> & { type: WidgetType; title: string } = {
    type,
    title: (item.title || base?.title || "").toString().slice(0, 60) || type,
    dim,
    measure,
    colSpan: clamp(Number(item.colSpan) || base?.colSpan || (compact ? 3 : 6), 2, 12),
    height: clamp(Number(item.height) || base?.height || (compact ? 150 : 260), 120, 480),
    palette,
    sort,
    topN: clamp(Number(item.topN) || base?.topN || MAX_TOP_N, 2, MAX_TOP_N),
    text: (item.text || base?.text || "").toString().slice(0, 400),
    target: Number(item.target) || base?.target || 0,
  };
  if (base?.id) partial.id = base.id;
  if (base?.fontScale) partial.fontScale = base.fontScale;
  if (base?.font) partial.font = base.font;

  return mk(partial);
}

export function sanitizeAiLayout(raw: unknown, columns: ColumnMeta[]): DashboardState | null {
  if (!raw || typeof raw !== "object") return null;
  const spec = raw as AiLayoutSpec;
  if (!Array.isArray(spec.widgets)) return null;
  // An empty array is a valid, intentional answer when a multi-sheet upload
  // contains a tab outside the user's stated analysis scope.
  if (spec.widgets.length === 0) {
    return { boardTitle: (spec.boardTitle || "Untitled dashboard").toString().slice(0, 80), widgets: [] };
  }

  const validNames = new Set(columns.map((c) => c.name));
  const dims = pickDims(columns, 2);
  const measures = pickMeasures(columns, 3);
  const fallbackDim = dims[0] || "";
  const fallbackMeasure = measures[0] || "";
  // The model is told each column's role but does not reliably respect it —
  // it still returned "total account_code" tiles. Checking only that a column
  // exists is not validation, so the allowed set is the real measure list.
  const allowedMeasures = new Set(pickAllMeasures(columns));
  const hasMeasures = allowedMeasures.size > 0;

  const widgets: Widget[] = [];
  for (const item of spec.widgets) {
    if (!item || typeof item !== "object") continue;
    const type = (TYPES as string[]).includes(item.type || "") ? (item.type as WidgetType) : null;
    if (!type) continue;
    // A sheet with nothing to count gets no quantitative tiles at all, rather
    // than a chart of an identifier or a KPI that renders a meaningless 0.
    if (!hasMeasures && QUANTITATIVE_TYPES.has(type)) continue;

    const dim = item.dim && validNames.has(item.dim) ? item.dim : fallbackDim;
    const measure = item.measure && allowedMeasures.has(item.measure) ? item.measure : fallbackMeasure;
    const palette = PALETTE_KEYS.includes(item.palette as PaletteKey) ? (item.palette as PaletteKey) : "cobalt";
    const sort = SORT_MODES.includes(item.sort as SortMode) ? (item.sort as SortMode) : defaultSortFor(type);
    const compact = type === "kpi" || type === "gauge";

    widgets.push(
      mk({
        type,
        title: (item.title || "").toString().slice(0, 60) || type,
        dim,
        measure,
        colSpan: clamp(Number(item.colSpan) || (compact ? 3 : 6), 2, 12),
        height: clamp(Number(item.height) || (compact ? 150 : 260), 120, 480),
        palette,
        sort,
        topN: clamp(Number(item.topN) || MAX_TOP_N, 2, MAX_TOP_N),
        text: (item.text || "").toString().slice(0, 400),
        target: Number(item.target) || 0,
      })
    );
  }

  if (widgets.length === 0) return null;

  return {
    boardTitle: (spec.boardTitle || "Untitled dashboard").toString().slice(0, 80),
    widgets: packFlow(widgets),
  };
}
