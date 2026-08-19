import { NextRequest, NextResponse } from "next/server";
import { inferColumns } from "@/lib/inferColumns";
import { normalizeSpreadsheetLink } from "@/lib/linkSource";
import { parseSpreadsheetSheets } from "@/lib/parseFile";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body.url || "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let normalized;
  try {
    normalized = normalizeSpreadsheetLink(raw);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
  }

  if (!/^https?:$/.test(new URL(normalized.fetchUrl).protocol)) {
    return NextResponse.json({ error: "Only http/https links are supported." }, { status: 400 });
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    res = await fetch(normalized.fetchUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Gridsheet/1.0 (+spreadsheet-sync)" },
    });
    clearTimeout(timeout);
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach that link. Check it's public and try again." },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const hint =
      normalized.kind === "google-sheets"
        ? " Make sure the Google Sheet is shared as \"Anyone with the link\" (Viewer)."
        : "";
    return NextResponse.json({ error: `The link responded with ${res.status}.${hint}` }, { status: 502 });
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: "That link returned an empty file." }, { status: 422 });
  }
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "That file is larger than the 15MB limit for linked sheets." }, { status: 413 });
  }

  try {
    const parsed = parseSpreadsheetSheets(buffer);
    if (parsed.length === 0) {
      return NextResponse.json({ error: "That sheet parsed but had no rows." }, { status: 422 });
    }
    const sheets = parsed.map((sheet) => ({
      sheetName: sheet.sheetName,
      rows: sheet.rows,
      columns: inferColumns(sheet.rows),
    }));
    return NextResponse.json({
      sheets,
      // First sheet is also returned flat so older callers keep working.
      rows: sheets[0].rows,
      columns: sheets[0].columns,
      sheetName: sheets[0].sheetName,
      fileName: normalized.suggestedName,
      fetchedAt: Date.now(),
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't parse that as a spreadsheet. Make sure it's a CSV or Excel file." },
      { status: 422 }
    );
  }
}
