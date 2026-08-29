import { hasKeySuffix } from "./relationships";
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
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return false;
  // Requiring a genuine date *shape* first. Merely containing "-" and being
  // tolerated by Date.parse is far too weak: it typed identifiers like
  // "TXN-000001" and "IC-00001" as dates, which then drove trend lines and
  // date-axis charts built on data that has no time meaning at all.
  const numericDate = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}([ T]|$)/.test(s);
  const monthName = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(s);
  if (!numericDate && !monthName) return false;
  return !isNaN(Date.parse(s));
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

/**
 * `\b` does not fire across an underscore (both sides are word characters), so
 * this only ever matched spaced/hyphenated names — "account_code" and
 * "subsidiary_id" slipped straight through. Kept for the free-text names it
 * does catch; identifier detection proper now goes through hasKeySuffix,
 * which tokenizes on underscores and camelCase.
 */
const IGNORE_NAME_RE = /(^|[^a-z0-9])(uuid|guid|url|link|email|address)([^a-z0-9]|$)/i;

/** "fiscal_year", "yr", "FY" — numerically typed, but a period label, not a quantity. */
const YEAR_NAME_RE = /(^|[^a-z0-9])(year|yr|fy)([^a-z0-9]|$)/i;

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
      // Numeric does not mean quantitative. Identifiers and period labels are
      // stored as numbers too, and summing them yields nonsense like
      // "Total account_code = 174,879,504". Only a real quantity is a measure;
      // a code that repeats across rows stays groupable as a dimension, and a
      // per-row primary key is not worth charting at all.
      const isLabel = hasKeySuffix(name) || YEAR_NAME_RE.test(name) || IGNORE_NAME_RE.test(name);
      if (!isLabel) role = "measure";
      else if (cardinalityRatio > 0.9 && rows.length > 20) role = "ignore";
      else role = "dimension";
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
