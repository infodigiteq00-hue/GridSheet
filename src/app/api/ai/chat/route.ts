import { NextRequest, NextResponse } from "next/server";
import { buildColumnSummary } from "@/lib/aiLayout";
import { heuristicChatAnswer } from "@/lib/chatHeuristic";
import { getOpenAIClient } from "@/lib/openaiClient";
import { StatsDigest } from "@/lib/statsDigest";
import { ColumnMeta } from "@/lib/types";

export const runtime = "nodejs";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface RelatedSheet {
  label: string;
  viaColumn: string;
  toColumn: string;
}

interface RequestBody {
  question: string;
  columns: ColumnMeta[];
  digest: StatsDigest;
  history?: ChatTurn[];
  sheetLabel?: string;
  relatedSheets?: RelatedSheet[];
}

const NEEDS_KEY_MESSAGE =
  "The chat assistant needs an OPENAI_API_KEY set in .env.local to answer free-form questions (see .env.example). " +
  "I can still answer a few simple questions like \"total revenue\" or \"best performing region\" without one.";

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = (body.question || "").toString().trim();
  const columns = Array.isArray(body.columns) ? body.columns : [];
  const digest = body.digest;
  if (!question) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  if (columns.length === 0 || !digest) {
    return NextResponse.json({ error: "No dataset loaded yet." }, { status: 400 });
  }

  const ai = await getOpenAIClient();
  if (!ai) {
    const heuristicAnswer = heuristicChatAnswer(question, digest);
    return NextResponse.json({
      answer: heuristicAnswer || NEEDS_KEY_MESSAGE,
      source: heuristicAnswer ? "heuristic" : "unavailable",
      reason: "OPENAI_API_KEY not configured",
    });
  }

  try {
    const history = Array.isArray(body.history) ? body.history.slice(-2) : [];
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      temperature: 0.4,
      max_tokens: ai.maxTokens,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful data analyst answering questions about a spreadsheet's dataset. You only receive aggregate " +
            "statistics (totals, averages, top categories) — never raw rows — so answer from those, keep it concise (1-3 sentences, " +
            "plain prose), and say when something isn't determinable from the given stats instead of guessing. The stats describe one sheet only. " +
            "relatedSheets lists other sheets it joins to; if a question needs their data, say which related sheet the user should switch to " +
            "rather than guessing.",
        },
        {
          role: "user",
          content: JSON.stringify({
            sheet: body.sheetLabel || undefined,
            columns: buildColumnSummary(columns),
            stats: digest,
            relatedSheets: Array.isArray(body.relatedSheets) ? body.relatedSheets : [],
          }),
        },
        ...history.map((h) => ({ role: h.role, content: h.content }) as const),
        { role: "user", content: question },
      ],
    });

    const answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) {
      return NextResponse.json({ answer: "I couldn't come up with an answer to that — try rephrasing?", source: "ai" });
    }
    return NextResponse.json({ answer, source: "ai" });
  } catch (err) {
    const heuristicAnswer = heuristicChatAnswer(question, digest);
    return NextResponse.json({
      answer: heuristicAnswer || "Something went wrong reaching the AI assistant. Please try again in a moment.",
      source: heuristicAnswer ? "heuristic" : "error",
      reason: err instanceof Error ? err.message : "AI request failed",
    });
  }
}
