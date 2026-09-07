import { aggregate, total, trendPct } from "./aggregate";
import { pickDims, pickMeasures } from "./heuristicLayout";
import { ColumnMeta, Row } from "./types";

/**
 * Compact statistical summary of a dataset — safe to send to an LLM (or to
 * drive a heuristic template) in place of raw rows. Keeps payloads small and
 * privacy-conscious: only aggregates, never individual records.
 */
export interface MeasureStat {
  name: string;
  total: number;
  average: number;
}

export interface DimensionStat {
  name: string;
  distinctCount: number;
  leadMeasure: string;
  top: { key: string; value: number }[];
}

export interface TrendStat {
  dim: string;
  measure: string;
  pctChange: number;
  direction: "up" | "down" | "flat";
}

export interface StatsDigest {
  rowCount: number;
  measures: MeasureStat[];
  dimensions: DimensionStat[];
  trend: TrendStat | null;
}

export function buildStatsDigest(columns: ColumnMeta[], rows: Row[]): StatsDigest {
  const measureNames = uniq(pickMeasures(columns, 3)).filter((m) => columns.some((c) => c.name === m));
  const dimNames = uniq(pickDims(columns, 2)).filter((d) => columns.some((c) => c.name === d));
  const leadMeasure = measureNames[0] || "";

  const measures: MeasureStat[] = measureNames.map((m) => {
    const t = total(rows, m);
    return { name: m, total: t, average: rows.length ? t / rows.length : 0 };
  });

  const dimensions: DimensionStat[] = dimNames.map((d) => {
    const col = columns.find((c) => c.name === d);
    return {
      name: d,
      distinctCount: col?.cardinality ?? 0,
      leadMeasure,
      top: leadMeasure ? aggregate(rows, d, leadMeasure, "desc", 3) : [],
    };
  });

  const dateCol = columns.find((c) => c.type === "date");
  let trend: TrendStat | null = null;
  if (dateCol && leadMeasure && rows.length >= 4) {
    const raw = trendPct(rows, leadMeasure);
    // null means one comparison half had no real data at all (e.g. a
    // forward-looking period that hasn't happened yet) — not a real trend,
    // so this stays unset rather than reporting a fabricated swing to the AI.
    if (raw !== null) {
      const pct = Math.round(raw * 10) / 10;
      trend = {
        dim: dateCol.name,
        measure: leadMeasure,
        pctChange: pct,
        direction: pct > 2 ? "up" : pct < -2 ? "down" : "flat",
      };
    }
  }

  return { rowCount: rows.length, measures, dimensions, trend };
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}
