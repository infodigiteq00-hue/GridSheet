import { CellValue, ColumnMeta, ColumnType, Row } from "./types";

function isEmpty(v: CellValue | undefined | null): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function looksNumeric(v: CellValue): boolean {
  if (typeof v === "number") return isFinite(v);
  if (v instanceof Date) return false;
  if (typeof v === "string") {
    const cleaned = v.replace(/[,$%\s]/g, "");
    if (cleaned === "") return false;
    return !isNaN(Number(cleaned));
  }
  return false;
}

function looksDate(v: CellValue): boolean {
  if (v instanceof Date) return !isNaN(v.getTime());
  if (typeof v === "string") {
    if (/^\d+(\.\d+)?$/.test(v.trim())) return false;
    const t = Date.parse(v);
    return !isNaN(t) && /[-/]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(v);
  }
  return false;
}

function toNumber(v: CellValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v.replace(/[,$%\s]/g, "")) || 0;
  return 0;
}

export function formatSample(v: CellValue): string {
  if (v instanceof Date) return v.toLocaleDateString("en-US");
  if (typeof v === "number") return v.toLocaleString("en-US");
  return String(v);
}

const IGNORE_NAME_RE = /\b(id|uuid|guid|url|link|email|phone|zip|postal|code|address)\b/i;

export function inferColumns(rows: Row[]): ColumnMeta[] {
  if (rows.length === 0) return [];
  const names = Object.keys(rows[0]);
  const sampleSize = Math.min(rows.length, 200);
  const sample = rows.slice(0, sampleSize);

  return names.map((name) => {
    const values = sample.map((r) => r[name]).filter((v) => !isEmpty(v));
    const total = values.length || 1;
    const numericCount = values.filter(looksNumeric).length;
    const dateCount = values.filter(looksDate).length;

    let type: ColumnType = "text";
    if (dateCount / total > 0.6) type = "date";
    else if (numericCount / total > 0.85) type = "number";

    const distinctSet = new Set(rows.map((r) => String(r[name] ?? "")));
    const distinct = distinctSet.size;
    const cardinalityRatio = distinct / rows.length;

    let role: ColumnMeta["role"];
    if (type === "number") {
      role = IGNORE_NAME_RE.test(name) ? "ignore" : "measure";
    } else if (type === "date") {
      role = "dimension";
    } else {
      role = cardinalityRatio > 0.6 && rows.length > 20 ? "ignore" : "dimension";
    }

    const sampleValues = values.slice(0, 3).map(formatSample);

    return { name, type, role, sampleValues, cardinality: distinct };
  });
}

/** Re-infers columns for refreshed rows, but keeps any role the user previously chose
 * (by column name) so a live-synced sheet doesn't reset "Group/Measure/Skip" choices. */
export function mergeColumns(oldColumns: ColumnMeta[], freshColumns: ColumnMeta[]): ColumnMeta[] {
  const oldByName = new Map(oldColumns.map((c) => [c.name, c]));
  return freshColumns.map((c) => {
    const prev = oldByName.get(c.name);
    return prev ? { ...c, role: prev.role } : c;
  });
}

export { toNumber };
