import { newId } from "./id";
import { packFlow } from "./gridLayout";
import { ColumnMeta, DashboardState, MAX_TOP_N, TYPE_LABEL, Widget, WidgetType } from "./types";

export type TemplateKind = "overview" | "kpi" | "table" | "exec";

function cardinalityScore(c: ColumnMeta): number {
  if (c.cardinality < 2) return 1000;
  if (c.cardinality > 60) return 500 + c.cardinality;
  return Math.abs(c.cardinality - 7);
}

export function pickDims(columns: ColumnMeta[], n: number): string[] {
  let cands = columns.filter((c) => c.role === "dimension");
  if (!cands.length) cands = columns.filter((c) => c.type !== "number");
  if (!cands.length) cands = columns;
  const names = [...cands].sort((a, b) => cardinalityScore(a) - cardinalityScore(b)).map((c) => c.name);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(names[Math.min(i, names.length - 1)] ?? "Category");
  return out;
}

/**
 * Numeric columns that are safe to do arithmetic on. The shape-based fallback
 * deliberately skips anything already classified as a dimension or ignored:
 * an account code or a year is stored as a number but summing it is
 * meaningless, and the old fallback let exactly those back in whenever a sheet
 * happened to have no real measures. When nothing qualifies the answer is an
 * empty list — a sheet with no quantities should produce no quantitative
 * charts rather than charting a label.
 */
export function pickAllMeasures(columns: ColumnMeta[]): string[] {
  const measures = columns.filter((c) => c.role === "measure");
  if (measures.length) return measures.map((c) => c.name);
  return columns.filter((c) => c.type === "number" && c.role !== "dimension" && c.role !== "ignore").map((c) => c.name);
}

export function pickMeasures(columns: ColumnMeta[], n: number): string[] {
  const names = pickAllMeasures(columns);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(names[Math.min(i, names.length - 1)] ?? "");
  return out;
}

/** Line for a date-indexed trend, pie for a small category breakdown, bar as the general case. */
function chartTypeFor(dim: ColumnMeta | undefined): WidgetType {
  if (!dim) return "bar";
  if (dim.type === "date") return "line";
  if (dim.cardinality >= 2 && dim.cardinality <= 6) return "pie";
  return "bar";
}

export function mk(partial: Partial<Widget> & { type: WidgetType; title: string }): Widget {
  return {
    id: newId(),
    dim: "",
    measure: "",
    colSpan: 6,
    height: 260,
    col: 0,
    row: 0,
    palette: "cobalt",
    fontScale: 1,
    sort: "natural",
    topN: MAX_TOP_N,
    font: "grotesk",
    text: "",
    target: 0,
    ...partial,
  };
}

export function generateHeuristicLayout(columns: ColumnMeta[], kind: TemplateKind = "overview", boardTitleHint?: string): DashboardState {
  const allMeasures = pickAllMeasures(columns);
  if (allMeasures.length === 0) {
    const dims = pickDims(columns, 2);
    const [d0] = dims;
    return {
      boardTitle: boardTitleHint || "Untitled dashboard",
      widgets: packFlow([mk({ type: "table", title: boardTitleHint || "All records", dim: d0 || "", measure: "", colSpan: 12, height: 320 })]),
    };
  }
  const dims = pickDims(columns, 2);
  const measures = pickMeasures(columns, 4);
  const [d0, d1] = dims;
  const [m0, m1, m2] = measures;

  let widgets: Widget[] = [];

  if (kind === "kpi") {
    widgets = [
      mk({ type: "kpi", title: `Total ${m0}`, dim: d0, measure: m0, colSpan: 3, height: 150 }),
      mk({ type: "kpi", title: `${m1} total`, dim: d0, measure: m1, colSpan: 3, height: 150, palette: "bloom" }),
      mk({ type: "kpi", title: `${m2} total`, dim: d0, measure: m2, colSpan: 3, height: 150, palette: "ember" }),
      mk({ type: "gauge", title: "Target attainment", measure: m0, colSpan: 3, height: 150 }),
      mk({ type: "line", title: `${m0} by ${d0}`, dim: d0, measure: m0, colSpan: 8, height: 280 }),
      mk({ type: "pie", title: `Share by ${d1}`, dim: d1, measure: m0, colSpan: 4, height: 280, palette: "bloom" }),
    ];
  } else if (kind === "table") {
    widgets = [
      mk({ type: "pivot", title: `${m0}: ${d0} × ${d1}`, dim: d0, measure: m0, colSpan: 7, height: 300 }),
      mk({ type: "table", title: "Raw rows", dim: d0, measure: m0, colSpan: 5, height: 300 }),
      mk({ type: "bar", title: `${m1} by ${d1}`, dim: d1, measure: m1, colSpan: 6, height: 250, sort: "desc" }),
      mk({ type: "heatmap", title: `${m0} density`, dim: d1, measure: m0, colSpan: 6, height: 250, palette: "ink" }),
    ];
  } else if (kind === "exec") {
    widgets = [
      mk({
        type: "text",
        title: "The period in a sentence",
        colSpan: 5,
        height: 220,
        fontScale: 1.1,
        text: `${m0} is tracked across ${d0}, broken down by ${d1}. Use this tile to summarize what matters most this period.`,
      }),
      mk({ type: "area", title: `${m0} trend`, dim: d0, measure: m0, colSpan: 7, height: 220 }),
      mk({ type: "kpi", title: m0, dim: d0, measure: m0, colSpan: 4, height: 150 }),
      mk({ type: "kpi", title: m1, dim: d0, measure: m1, colSpan: 4, height: 150, palette: "ember" }),
      mk({ type: "gauge", title: "Attainment", measure: m0, colSpan: 4, height: 150 }),
    ];
  } else {
    // "overview" is what "Build my dashboard" actually runs. Every numeric
    // measure gets its own chart here — a 4-measure sheet shouldn't silently
    // drop the other 3 just because the old template only had 4 slots.
    const dimMeta = columns.find((c) => c.name === d0);
    const chartType = chartTypeFor(dimMeta);
    const palettes: Widget["palette"][] = ["cobalt", "bloom", "ember", "ink"];

    widgets = [];
    const headline = allMeasures.slice(0, 4);
    headline.forEach((m, i) => {
      widgets.push(
        mk({ type: "kpi", title: `Total ${m}`, dim: d0, measure: m, colSpan: 3, height: 148, palette: palettes[i % palettes.length] })
      );
    });
    allMeasures.forEach((m, i) => {
      widgets.push(
        mk({
          type: chartType,
          title: `${m} by ${d0}`,
          dim: d0,
          measure: m,
          colSpan: chartType === "pie" ? 4 : 6,
          height: 260,
          palette: palettes[i % palettes.length],
          sort: chartType === "line" ? "natural" : "desc",
        })
      );
    });
    if (d1 && allMeasures.length) {
      widgets.push(mk({ type: "pivot", title: `${allMeasures[0]}: ${d0} × ${d1}`, dim: d0, measure: allMeasures[0], colSpan: 12, height: 300 }));
    }
  }

  return {
    boardTitle: boardTitleHint || "Untitled dashboard",
    widgets: packFlow(widgets),
  };
}

export function defaultWidgetForType(type: WidgetType, columns: ColumnMeta[]): Widget {
  const dims = pickDims(columns, 1);
  const measures = pickMeasures(columns, 1);
  const compact = type === "kpi" || type === "gauge";
  return mk({
    type,
    title: TYPE_LABEL[type],
    dim: dims[0] || "",
    measure: measures[0] || "",
    colSpan: compact ? 3 : 6,
    height: compact ? 148 : 260,
  });
}
