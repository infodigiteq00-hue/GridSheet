import { mk, pickDims, pickMeasures } from "./heuristicLayout";
import { packFlow } from "./gridLayout";
import { ColumnMeta, DashboardState, PaletteKey, SortMode, TYPES, Widget, WidgetType } from "./types";

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
      "topN": integer 2-12,
      "text": string, only meaningful for type "text" — a short 1-3 sentence insight written from the data,
      "target": integer, only meaningful for type "gauge" — a realistic goal value for the measure
    }
  ]
}
Cover every column with role "measure" — at least one chart per numeric measure, no exceptions, even if that means well over 9 widgets on a wide sheet. Don't silently drop a measure because it seems minor.
For each measure, choose the chart type yourself based on its shape: line/area when grouped by a date dimension (a real trend), pie/donut only when the grouping dimension has 6 or fewer distinct values (a real share-of-total), bar for other categorical breakdowns, kpi for a single headline total worth calling out on its own. Use table/pivot for full-detail rows and heatmap/scatter/gauge only where they add real insight beyond what the per-measure charts already show — don't add them just to hit a type quota.
A few KPI stat cards up front for the most important measures is good, but every measure still needs its own chart tile even if it also got a KPI card. Only reference column names that were provided. Do not wrap the JSON in markdown.`;
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
  "topN": integer 2-12,
  "text": string, only meaningful for type "text" — a short 1-2 sentence insight,
  "target": integer, only meaningful for type "gauge"
}
If the input includes a "current" tile, the user is editing that existing tile: keep any field their
request doesn't clearly ask to change (reuse the current type/dim/measure/etc. as-is). Only reference
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
  const type = (TYPES as string[]).includes(item.type || "") ? (item.type as WidgetType) : fallbackType;

  const fallbackDim = base?.dim || dims[0] || "";
  const fallbackMeasure = base?.measure || measures[0] || "";
  const dim = item.dim && validNames.has(item.dim) ? item.dim : fallbackDim;
  const measure = item.measure && validNames.has(item.measure) ? item.measure : fallbackMeasure;

  const palette = PALETTE_KEYS.includes(item.palette as PaletteKey) ? (item.palette as PaletteKey) : base?.palette || "cobalt";
  const sort = SORT_MODES.includes(item.sort as SortMode) ? (item.sort as SortMode) : base?.sort || "natural";
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
    topN: clamp(Number(item.topN) || base?.topN || 12, 2, 12),
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
  if (!Array.isArray(spec.widgets) || spec.widgets.length === 0) return null;

  const validNames = new Set(columns.map((c) => c.name));
  const dims = pickDims(columns, 2);
  const measures = pickMeasures(columns, 3);
  const fallbackDim = dims[0] || "";
  const fallbackMeasure = measures[0] || "";

  const widgets: Widget[] = [];
  for (const item of spec.widgets) {
    if (!item || typeof item !== "object") continue;
    const type = (TYPES as string[]).includes(item.type || "") ? (item.type as WidgetType) : null;
    if (!type) continue;

    const dim = item.dim && validNames.has(item.dim) ? item.dim : fallbackDim;
    const measure = item.measure && validNames.has(item.measure) ? item.measure : fallbackMeasure;
    const palette = PALETTE_KEYS.includes(item.palette as PaletteKey) ? (item.palette as PaletteKey) : "cobalt";
    const sort = SORT_MODES.includes(item.sort as SortMode) ? (item.sort as SortMode) : "natural";
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
        topN: clamp(Number(item.topN) || 12, 2, 12),
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
