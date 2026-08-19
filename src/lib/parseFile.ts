import * as XLSX from "xlsx";
import { Row } from "./types";

export interface ParsedSheet {
  rows: Row[];
  sheetName: string;
}

function normalizeRows(json: Record<string, unknown>[]): Row[] {
  return json.map((r) => {
    const out: Row = {};
    for (const key of Object.keys(r)) {
      const v = r[key];
      if (v instanceof Date || typeof v === "number" || typeof v === "string") {
        out[key.trim()] = v;
      } else {
        out[key.trim()] = String(v ?? "");
      }
    }
    return out;
  });
}

function hasAnyValue(row: Row): boolean {
  return Object.values(row).some((v) => !(typeof v === "string" && v.trim() === ""));
}

/** Every non-empty tab in a workbook, in workbook order. A CSV yields a single sheet. */
export function parseSpreadsheetSheets(buffer: ArrayBuffer | Uint8Array): ParsedSheet[] {
  const workbook = XLSX.read(buffer, { cellDates: true, type: "array" });
  const out: ParsedSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
    const rows = normalizeRows(json).filter(hasAnyValue);
    if (rows.length === 0) continue;
    if (Object.keys(rows[0]).length === 0) continue;
    out.push({ rows, sheetName: sheetName || `Sheet${out.length + 1}` });
  }

  return out;
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer();
  return parseSpreadsheetSheets(buffer);
}
