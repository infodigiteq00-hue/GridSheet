import * as XLSX from "xlsx";
import { Row } from "./types";

export interface ParsedSheet {
  rows: Row[];
  sheetName: string;
}

type GridRow = unknown[];

const HEADER_WORDS =
  /\b(date|month|year|plant|material|description|customer|vendor|supplier|account|document|order|item|quantity|qty|amount|value|rate|currency|status|type|code|number|location|batch|department|cost|sales|tax|unit)\b/i;

/**
 * `\b` treats underscore as a word character, so it never fires at the join
 * in a snake_case name — "account_code" scores zero header-word credit while
 * an ordinary data row containing space-separated words like "Cost of Goods
 * Sold" scores higher and gets mistaken for the header instead. Normalizing
 * separators to spaces first restores the boundary without changing the
 * word list or the matching semantics for already-space-separated text.
 */
function matchesHeaderWord(value: string): boolean {
  return HEADER_WORDS.test(value.replace(/[_-]+/g, " "));
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function headerText(value: unknown): string {
  if (value instanceof Date) return value.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function dataLikeScore(row: GridRow): number {
  const values = row.filter((value) => !isBlank(value));
  if (values.length === 0) return 0;
  return values.filter((value) => value instanceof Date || typeof value === "number").length / values.length;
}

/** Finds the real field-name row in report-style sheets with titles and totals above it. */
function findHeaderRow(grid: GridRow[]): number {
  const max = Math.min(grid.length - 1, 24);
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let index = 0; index <= max; index++) {
    const cells = grid[index].filter((value) => !isBlank(value));
    if (cells.length === 0) continue;
    const strings = cells.filter((value) => typeof value === "string").map(headerText).filter(Boolean);
    const numeric = cells.filter((value) => typeof value === "number").length;
    const headerWords = strings.filter(matchesHeaderWord).length;
    const followingData = grid.slice(index + 1, Math.min(grid.length, index + 4)).reduce((sum, row) => sum + dataLikeScore(row), 0);

    // Label-rich rows before typed records are strong header candidates. A
    // report title or a summary-number line scores poorly because it has only
    // one label or mostly numeric cells.
    const score = strings.length * 4 + cells.length + headerWords * 6 + followingData * 3 - numeric * 3;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function hasGroupHeader(row: GridRow | undefined): boolean {
  if (!row) return false;
  return row.filter((value) => (typeof value === "string" || value instanceof Date) && !isBlank(value)).length >= 2;
}

function makeHeaders(grid: GridRow[], headerIndex: number): string[] {
  // Report exports often use two or three header bands. Keep every label-rich
  // band above the selected field row so grouped columns remain distinct: e.g.
  // "FG Net Sales Summary - Grand Total - Value With GST (Cr)", not a
  // duplicate of the sales or return column beside it. One-cell report titles
  // are deliberately excluded by hasGroupHeader.
  const headerRows = grid.slice(0, headerIndex + 1).filter(hasGroupHeader);
  const width = Math.max(
    ...headerRows.map((line) => line.length),
    ...grid.slice(headerIndex + 1, headerIndex + 4).map((line) => line.length),
    0
  );
  const headers: string[] = [];
  const used = new Set<string>();
  const carriedLabels = headerRows.map(() => "");

  for (let index = 0; index < width; index++) {
    const parts: string[] = [];
    headerRows.forEach((row, rowIndex) => {
      const label = headerText(row[index]);
      // Upper bands describe merged groups and legitimately span blank cells.
      // The final field-name band does not: carrying it across a spacer would
      // turn the next group's Month column into "Month - Value With GST".
      const isFieldRow = rowIndex === headerRows.length - 1;
      if (label) carriedLabels[rowIndex] = label;
      const carried = label || (isFieldRow ? "" : carriedLabels[rowIndex]);
      if (carried && !parts.some((part) => part.toLowerCase() === carried.toLowerCase())) {
        parts.push(carried);
      }
    });
    const base = parts.join(" - ") || `Column ${index + 1}`;
    let label = base;
    let duplicate = 2;
    while (used.has(label)) label = `${base} (${duplicate++})`;
    used.add(label);
    headers.push(label);
  }
  return headers;
}

function isGrandTotalRow(values: unknown[]): boolean {
  return values.some(
    (value) => typeof value === "string" && /^(grand\s+total|total(?:\s*\([^)]*\))?|subtotal)\b/i.test(value.trim())
  );
}

function isFootnoteRow(values: unknown[]): boolean {
  const present = values.filter((value) => !isBlank(value));
  return present.length === 1 && typeof present[0] === "string" && /^note\s*[:\-]/i.test(present[0].trim());
}

function toCellValue(value: unknown): Row[string] {
  if (value instanceof Date || typeof value === "number" || typeof value === "string") return value;
  return String(value ?? "");
}

function parseSheet(sheet: XLSX.WorkSheet): Row[] {
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as GridRow[];
  if (grid.length === 0) return [];

  const headerIndex = findHeaderRow(grid);
  const headers = makeHeaders(grid, headerIndex);
  // Decorative spacer columns are common in financial reports. They must not
  // become fake fields merely because a merged group header was carried over.
  const populatedIndexes = headers
    .map((_, index) => index)
    .filter((index) => grid.slice(headerIndex + 1).some((row) => !isBlank(row[index])));
  const rows: Row[] = [];

  for (const values of grid.slice(headerIndex + 1)) {
    if (values.every(isBlank) || isGrandTotalRow(values) || isFootnoteRow(values)) continue;
    const row: Row = {};
    populatedIndexes.forEach((index) => {
      const header = headers[index];
      row[header] = toCellValue(values[index]);
    });
    rows.push(row);
  }
  return rows;
}

/** Every non-empty tab in a workbook, in workbook order. A CSV yields a single sheet. */
export function parseSpreadsheetSheets(buffer: ArrayBuffer | Uint8Array): ParsedSheet[] {
  const workbook = XLSX.read(buffer, { cellDates: true, type: "array" });
  const out: ParsedSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = parseSheet(sheet);
    if (rows.length === 0 || Object.keys(rows[0]).length === 0) continue;
    out.push({ rows, sheetName: sheetName || `Sheet${out.length + 1}` });
  }

  return out;
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer();
  return parseSpreadsheetSheets(buffer);
}
