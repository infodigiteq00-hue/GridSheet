import { NextRequest, NextResponse } from "next/server";
import { suggestColumnLabels } from "@/lib/aiColumnLabels";
import { ColumnMeta } from "@/lib/types";

export const runtime = "nodejs";

interface RequestBody {
  sheets?: Array<{ sheetName?: string; columns?: ColumnMeta[] }>;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sheets = (Array.isArray(body.sheets) ? body.sheets : [])
    .filter((sheet) => typeof sheet?.sheetName === "string" && Array.isArray(sheet.columns))
    .slice(0, 30)
    .map((sheet) => ({ sheetName: sheet.sheetName as string, columns: sheet.columns as ColumnMeta[] }));
  if (sheets.length === 0) return NextResponse.json({ error: "No columns provided" }, { status: 400 });

  return NextResponse.json({ labels: await suggestColumnLabels(sheets) });
}
