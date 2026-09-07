import { hasKeySuffix } from "./relationships";
import { CellValue, ColumnMeta, ColumnType, Row } from "./types";

export function isEmpty(v: CellValue | undefined | null): boolean {
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

/**
 * Manually validated DD.MM.YYYY / YYYY.MM.DD — Date.parse's handling of
 * dotted dates is locale-ambiguous and silently swaps day/month instead of
 * failing (e.g. "9.4.2026" resolves to Sep 4 in V8, not the intended Apr 9;
 * "20.04.2026" — an unambiguous day-first value — returns Invalid Date
 * outright). Real day/month range validation avoids both failure modes.
 */
function parseDottedDate(s: string): Date | null {
  const dmy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const ymd = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  const m = dmy || ymd;
  if (!m) return null;
  const [day, month, year] = dmy ? [+m[1], +m[2], +m[3]] : [+m[3], +m[2], +m[1]];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function looksDate(v: CellValue): boolean {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return false;
    // A bare time-of-day cell (SAP-style "Time of Entry" exports) decodes to
    // the 1900 date-system epoch with only the time component meaningful.
    // Treating it as a calendar date collapses every row into one bucket.
    if (v.getFullYear() === 1899 && v.getMonth() === 11 && v.getDate() === 31) return false;
    return true;
  }
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return false;
  // Dotted dates are checked before the version-string rejection below,
  // since both share the "N.N.N" shape.
  if (parseDottedDate(s)) return true;
  // Requiring a genuine date *shape* first. Merely containing "-" and being
  // tolerated by Date.parse is far too weak: it typed identifiers like
  // "TXN-000001" and "IC-00001" as dates, which then drove trend lines and
  // date-axis charts built on data that has no time meaning at all.
  // 1.2.3 / 2020.1.1 — version strings and other dotted triples that aren't
  // valid dates. Date.parse("1.2.3") is a real date in some engines (Jan 2,
  // 2003), so reject before the shape check.
  if (/^\d+(\.\d+){2,}/.test(s)) return false;
  // Last group needs ≥2 digits so "1.2.3"-like slash forms also fail; dots are
  // handled separately above. Year-month (2024-01) is a separate shape.
  const numericDate = /^\d{1,4}[-/]\d{1,2}[-/]\d{2,4}([ T]|$)/.test(s);
  const monthName =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(
      s
    );
  const yearMonth = /^\d{4}[-/]\d{1,2}$/.test(s);
  if (!numericDate && !monthName && !yearMonth) return false;
  return !isNaN(Date.parse(s));
}

/**
 * Actually parses a date-shaped string/Date the same way looksDate validates
 * it, so a dashboard can bucket by month even when a sheet stores dates as
 * text rather than real Excel date cells (aggregate.ts's keyOf/chronological
 * sort both need this, not just type inference).
 */
export function parseLooseDate(v: CellValue): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  const dotted = parseDottedDate(s);
  if (dotted) return dotted;
  if (!looksDate(s)) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

function toNumber(v: CellValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v.replace(/[,$%\s]/g, "")) || 0;
  return 0;
}

// Indian financial exports very commonly pre-scale an entire column and only
// say so in the header — "Value (Cr)", "Value in Cr", "Value (Lakh)" — with
// each cell holding just the raw pre-scaled number (34.316, not
// 343160000). Aggregating and formatting that raw number as plain rupees
// understates the true value by 1,00,00,000x (crore) or 1,00,000x (lakh).
// Deliberately conservative on crore: bare "Cr"/"CR" without parens or an
// "in" qualifier is left unscaled, since ledgers commonly abbreviate
// Credit/Debit the same way and a false match there would corrupt a real
// column instead of fixing a mislabeled one.
const CRORE_NAME_RE = /\(\s*(?:in\s+)?cr(?:ores?)?\.?\s*\)|\bin\s+cr(?:ores?)?\b/i;
const LAKH_NAME_RE = /\(\s*(?:in\s+)?(?:lakhs?|lacs?)\.?\s*\)|\bin\s+(?:lakhs?|lacs?)\b|\blakhs?\b|\blacs?\b/i;

export function unitScaleFor(columnName: string): number {
  if (CRORE_NAME_RE.test(columnName)) return 1_00_00_000;
  if (LAKH_NAME_RE.test(columnName)) return 1_00_000;
  return 1;
}

/** toNumber, but scaled to true rupee-equivalent value per the column's own
 * declared unit (see unitScaleFor). Use this — not toNumber — anywhere a
 * named measure column's values are summed/displayed as a business figure. */
export function toScaledNumber(v: CellValue, columnName: string): number {
  return toNumber(v) * unitScaleFor(columnName);
}

export function formatSample(v: CellValue): string {
  if (v instanceof Date) return v.toLocaleDateString("en-US");
  if (typeof v === "number") return v.toLocaleString("en-IN");
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

// ERP exports frequently store document references and master-data codes as
// numbers. They must remain labels, never become amounts a chart can sum.
const IDENTIFIER_NAME_RE =
  /\b(material|purchase\s*order|sales\s*(order|doc|document)|bill(?:ing)?\s*(doc|document)|material\s*doc|document|supplier|customer|vendor|hsn|obd|routing|movement\s*type|reason\s*for\s*movement|storage\s*location|cost\s*center|company\s*code|plant|item|counter|reservation)\b/i;

const YEAR_TOKENS = new Set(["year", "yr", "fy"]);

/** Last underscore/camelCase token, matching hasKeySuffix's tokenization. */
function lastNameToken(name: string): string {
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

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
      //
      // A prior "high-cardinality + name isn't on a known measure-word list"
      // clause lived here. It reused the same \b-doesn't-cross-underscore
      // mistake hasKeySuffix exists to avoid (amount_usd never matched
      // \bamount\b), and a fixed word list can never cover real vocabulary
      // (cogs, ebitda, payables, equity...). Continuous financial measures
      // are high-cardinality by nature — almost every row's dollar amount is
      // unique — so the clause wiped the vast majority of a real accounts
      // workbook's measures (cash, receivables, total_assets, debt, ebitda,
      // etc.) to "ignore". hasKeySuffix/IDENTIFIER_NAME_RE already cover the
      // identifier case explicitly; a name with no such signal is a measure.
      const isLabel =
        hasKeySuffix(name) ||
        YEAR_TOKENS.has(lastNameToken(name)) ||
        IGNORE_NAME_RE.test(name) ||
        IDENTIFIER_NAME_RE.test(name);
      if (!isLabel) role = "measure";
      else if (cardinalityRatio > 0.9 && rows.length > 20) role = "ignore";
      else role = "dimension";
    } else if (type === "date") {
      role = "dimension";
    } else {
      // A small reference table (e.g. 22 materials, one row each) has every
      // row's label be distinct by construction — that's the table's own
      // category axis, not noise. Free-text junk (notes, per-row IDs) only
      // reads as safely ignorable once the sheet is large enough that
      // near-uniqueness really does mean "this doesn't group anything".
      role = cardinalityRatio > 0.6 && rows.length > 50 ? "ignore" : "dimension";
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
