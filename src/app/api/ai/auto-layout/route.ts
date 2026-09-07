import { NextRequest, NextResponse } from "next/server";
import { buildColumnSummary, sanitizeAiLayout, schemaDescription } from "@/lib/aiLayout";
import { generateHeuristicLayout } from "@/lib/heuristicLayout";
import { getOpenAIClient, parseJsonContent } from "@/lib/openaiClient";
import { ColumnMeta } from "@/lib/types";
import { StatsDigest } from "@/lib/statsDigest";

export const runtime = "nodejs";

// A first dashboard is compact JSON, not a long-form response. Keeping this
// below the provider's available-credit threshold prevents a 402 from quietly
// sending the user to the generic heuristic layout instead of the AI path.
const LAYOUT_MAX_TOKENS = 1_800;

interface RequestBody {
  columns: ColumnMeta[];
  fileName?: string;
  rowCount?: number;
  /** Aggregate-only context: no raw spreadsheet records are sent to the model. */
  digest?: StatsDigest;
  userPrompt?: string;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const columns = Array.isArray(body.columns) ? body.columns : [];
  if (columns.length === 0) {
    return NextResponse.json({ error: "No columns provided" }, { status: 400 });
  }

  const ai = await getOpenAIClient();

  if (!ai) {
    const layout = generateHeuristicLayout(columns, "overview", body.fileName ? niceTitle(body.fileName) : undefined);
    return NextResponse.json({ dashboard: layout, source: "heuristic", reason: "OPENAI_API_KEY not configured" });
  }

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: Math.min(ai.maxTokens, LAYOUT_MAX_TOKENS),
      messages: [
        {
          role: "system",
          content:
            "You are a senior BI analyst that designs the first draft of a dashboard from a spreadsheet's column metadata. " +
            "Honor the user's requested analysis when it is provided, but only use the available columns. " +
            schemaDescription(),
        },
        {
          role: "user",
          content: JSON.stringify({
            fileName: body.fileName || "spreadsheet",
            rowCount: body.rowCount || 0,
            columns: buildColumnSummary(columns),
            dataSummary: body.digest,
            // A full scoping conversation, not a one-line prompt — raised from
            // 1,000 chars so a multi-turn "just FY26-27" back-and-forth survives.
            requestedAnalysis: typeof body.userPrompt === "string" ? body.userPrompt.slice(0, 4_000) : undefined,
          }),
        },
      ],
    });

    const layout = sanitizeAiLayout(parseJsonContent(completion.choices[0]?.message?.content), columns);

    if (!layout) {
      const fallback = generateHeuristicLayout(columns, "overview", body.fileName ? niceTitle(body.fileName) : undefined);
      return NextResponse.json({ dashboard: fallback, source: "heuristic", reason: "AI response failed validation" });
    }

    return NextResponse.json({ dashboard: layout, source: "ai" });
  } catch (err) {
    const fallback = generateHeuristicLayout(columns, "overview", body.fileName ? niceTitle(body.fileName) : undefined);
    return NextResponse.json({
      dashboard: fallback,
      source: "heuristic",
      reason: err instanceof Error ? err.message : "AI request failed",
    });
  }
}

function niceTitle(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
