import { NextRequest, NextResponse } from "next/server";
import { buildColumnSummary, sanitizeAiWidget, singleWidgetSchemaDescription } from "@/lib/aiLayout";
import { getOpenAIClient, parseJsonContent } from "@/lib/openaiClient";
import { parseTilePrompt } from "@/lib/tileHeuristic";
import { ColumnMeta, Widget } from "@/lib/types";

export const runtime = "nodejs";

interface RequestBody {
  prompt: string;
  columns: ColumnMeta[];
  current?: Widget;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = (body.prompt || "").toString().trim();
  const columns = Array.isArray(body.columns) ? body.columns : [];
  if (!prompt) return NextResponse.json({ error: "Describe the tile you want first." }, { status: 400 });
  if (columns.length === 0) return NextResponse.json({ error: "No dataset loaded yet." }, { status: 400 });

  const ai = await getOpenAIClient();
  if (!ai) {
    const { spec, confident } = parseTilePrompt(prompt, columns);
    const widget = sanitizeAiWidget(spec, columns, body.current);
    return NextResponse.json({
      widget,
      source: "heuristic",
      reason: confident
        ? "OPENAI_API_KEY not set — matched with local keyword parsing."
        : "OPENAI_API_KEY not set in .env.local — used a best guess. Add a key for smarter matching.",
    });
  }

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: ai.maxTokens,
      messages: [
        {
          role: "system",
          content: "You turn a short natural-language request into a single dashboard tile spec. " + singleWidgetSchemaDescription(),
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt,
            columns: buildColumnSummary(columns),
            current: body.current
              ? {
                  type: body.current.type,
                  title: body.current.title,
                  dim: body.current.dim,
                  measure: body.current.measure,
                  sort: body.current.sort,
                  topN: body.current.topN,
                }
              : null,
          }),
        },
      ],
    });

    const widget = sanitizeAiWidget(parseJsonContent(completion.choices[0]?.message?.content), columns, body.current);
    return NextResponse.json({ widget, source: "ai" });
  } catch (err) {
    const { spec } = parseTilePrompt(prompt, columns);
    const widget = sanitizeAiWidget(spec, columns, body.current);
    return NextResponse.json({
      widget,
      source: "heuristic",
      reason: err instanceof Error ? err.message : "AI request failed",
    });
  }
}
