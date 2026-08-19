import { AiWidgetSpec } from "./aiLayout";
import { ColumnMeta, WidgetType } from "./types";

const TYPE_KEYWORDS: [RegExp, WidgetType][] = [
  [/\bdonut\b|\bpie\b/, "pie"],
  [/\bheatmap\b|\bheat map\b/, "heatmap"],
  [/\bscatter\b/, "scatter"],
  [/\bgauge\b|\btarget\b|\bgoal\b/, "gauge"],
  [/\bpivot\b|\bcross ?tab\b/, "pivot"],
  [/\btable\b|\brows?\b/, "table"],
  [/\bkpi\b|\bstat\b|\bnumber\b|\bmetric\b/, "kpi"],
  [/\barea\b/, "area"],
  [/\bline\b|\btrend\b/, "line"],
  [/\bbar\b|\bcolumn chart\b/, "bar"],
  [/\btext\b|\bsummary\b|\binsight\b|\bnote\b/, "text"],
  [/\bmap\b|\bregion\b/, "map"],
];

/** Very small "did the phrasing ask to edit the currently selected tile?" detector. */
const EDIT_INTENT_RE = /\b(make|turn|change|convert|update|switch)\b.{0,12}\b(this|it|the current|the selected)\b|\bthis (chart|tile|widget|graph)\b/i;

export function looksLikeEditIntent(prompt: string): boolean {
  return EDIT_INTENT_RE.test(prompt);
}

export interface ParsedTile {
  spec: AiWidgetSpec;
  confident: boolean;
}

/**
 * Local, no-API-key fallback for turning a short natural-language request
 * ("show me revenue by region as a donut") into a widget spec. Matches
 * widget-type keywords and fuzzy-matches column names mentioned by name.
 * Never returns null — worst case, the caller gets a best-guess default so
 * the user's tile still gets created.
 */
export function parseTilePrompt(prompt: string, columns: ColumnMeta[]): ParsedTile {
  const p = prompt.toLowerCase();

  let type: WidgetType | undefined;
  for (const [re, t] of TYPE_KEYWORDS) {
    if (re.test(p)) {
      type = t;
      break;
    }
  }

  const sortedCols = [...columns].sort((a, b) => b.name.length - a.name.length);
  const mentioned = sortedCols.filter((c) => c.name.length > 1 && p.includes(c.name.toLowerCase()));
  const dimMatch = mentioned.find((c) => c.type !== "number");
  const measureMatch = mentioned.find((c) => c.type === "number");

  const confident = !!type && (!!dimMatch || !!measureMatch);

  const title = prompt
    .trim()
    .replace(/^(show( me)?|create|add|make|display|give me)\s+/i, "")
    .replace(/\s+/g, " ")
    .slice(0, 60);

  return {
    spec: {
      type,
      dim: dimMatch?.name,
      measure: measureMatch?.name,
      title: title ? title.charAt(0).toUpperCase() + title.slice(1) : undefined,
    },
    confident,
  };
}
