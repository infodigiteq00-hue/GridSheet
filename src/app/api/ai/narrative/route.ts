import { NextRequest, NextResponse } from "next/server";
import { buildColumnSummary } from "@/lib/aiLayout";
import { generateHeuristicNarrative } from "@/lib/narrativeHeuristic";
import { getOpenAIClient } from "@/lib/openaiClient";
import { StatsDigest } from "@/lib/statsDigest";
import { ColumnMeta } from "@/lib/types";

export const runtime = "nodejs";

interface RelatedSheet {
  label: string;
  viaColumn: string;
  toColumn: string;
}

interface RequestBody {
  columns: ColumnMeta[];
  digest: StatsDigest;
  fileName?: string;
  sheetLabel?: string;
  relatedSheets?: RelatedSheet[];
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const columns = Array.isArray(body.columns) ? body.columns : [];
  const digest = body.digest;
  if (columns.length === 0 || !digest) {
    return NextResponse.json({ error: "No dataset provided" }, { status: 400 });
  }

  const relatedSheets = Array.isArray(body.relatedSheets) ? body.relatedSheets : [];

  const ai = await getOpenAIClient();
  if (!ai) {
    const text = generateHeuristicNarrative(digest);
    return NextResponse.json({ text, source: "heuristic", reason: "OPENAI_API_KEY not configured" });
  }

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      temperature: 0.5,
      max_tokens: ai.maxTokens,
      messages: [
        {
          role: "system",
          content:
            "You are a senior BI analyst. Write a short, concrete narrative summary (2-4 sentences, plain prose, no markdown, no bullet points) " +
            "of a dataset for a dashboard text tile, using only the aggregate statistics provided. Mention specific numbers and leading categories. " +
            "Never invent data that isn't in the digest. If relatedSheets is non-empty, you may mention in one clause that this sheet joins to " +
            "those sheets, but never invent figures from them — you have no statistics for them.",
        },
        {
          role: "user",
          content: JSON.stringify({
            fileName: body.fileName || "spreadsheet",
            sheet: body.sheetLabel || undefined,
            columns: buildColumnSummary(columns),
            stats: digest,
            relatedSheets,
          }),
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      return NextResponse.json({
        text: generateHeuristicNarrative(digest),
        source: "heuristic",
        reason: "AI response was empty",
      });
    }

    return NextResponse.json({ text, source: "ai" });
  } catch (err) {
    return NextResponse.json({
      text: generateHeuristicNarrative(digest),
      source: "heuristic",
      reason: err instanceof Error ? err.message : "AI request failed",
    });
  }
}
