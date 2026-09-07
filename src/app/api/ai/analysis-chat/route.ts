import { NextRequest, NextResponse } from "next/server";
import { buildColumnSummary } from "@/lib/aiLayout";
import { getOpenAIClient } from "@/lib/openaiClient";
import { StatsDigest } from "@/lib/statsDigest";
import { ColumnMeta } from "@/lib/types";

export const runtime = "nodejs";

// A scoping reply is a few sentences, not a document — keeping this well
// below the provider's available-credit threshold, same reasoning as the
// auto-layout route's cap.
const CHAT_MAX_TOKENS = 700;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface SheetContext {
  sheetName: string;
  columns: ColumnMeta[];
  digest: StatsDigest;
}

interface RequestBody {
  message: string;
  history?: ChatTurn[];
  sheets: SheetContext[];
}

const NEEDS_KEY_MESSAGE =
  "I need an OPENAI_API_KEY set in .env.local to have this conversation and read your sheets " +
  "(see .env.example). You can still describe what you want in one message below and click " +
  "\"Create dashboard\" — the builder will do its best without the back-and-forth.";

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body.message || "").toString().trim();
  const sheets = Array.isArray(body.sheets) ? body.sheets : [];
  if (!message) return NextResponse.json({ error: "Say what you need first." }, { status: 400 });
  if (sheets.length === 0) return NextResponse.json({ error: "No sheets loaded yet." }, { status: 400 });

  const ai = await getOpenAIClient();
  if (!ai) {
    return NextResponse.json({ reply: NEEDS_KEY_MESSAGE, source: "unavailable", reason: "OPENAI_API_KEY not configured" });
  }

  try {
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      temperature: 0.4,
      max_tokens: Math.min(ai.maxTokens, CHAT_MAX_TOKENS),
      messages: [
        {
          role: "system",
          content:
            "You are a senior BI analyst helping someone scope a dashboard build across one or more spreadsheet " +
            "sheets, before anything is built. You can see every sheet's column names, types, roles " +
            "(dimension/measure/ignored), a few sample values per column, and aggregate stats (totals, top " +
            "categories, trend) — never raw rows. " +
            "When they describe what they want: confirm in plain, brief conversational language what you " +
            "understand, and name which sheets/columns are relevant. If they mention a specific period, filter, " +
            "or scope (e.g. \"just FY26-27\"), check the actual sample values and date ranges you can see and be " +
            "directly honest about whether that scope actually exists in the data — if it doesn't, say so plainly " +
            "and ask how they'd like to proceed instead of pretending it's there. Note plainly that dashboard " +
            "tiles group and total the whole sheet rather than hiding other periods outright, so \"just FY26-27\" " +
            "means grouping by that period so it's visible, not excluding everything else from the file. " +
            "If the request is ambiguous, ask ONE focused clarifying question rather than guessing. Keep replies " +
            "short — 2 to 4 sentences, plain prose, no markdown — and end by inviting them to add more detail or " +
            "click \"Create dashboard\" when ready. Never invent figures beyond what the given stats show.",
        },
        {
          role: "user",
          content: JSON.stringify({
            sheets: sheets.map((s) => ({
              sheetName: s.sheetName,
              columns: buildColumnSummary(Array.isArray(s.columns) ? s.columns : []),
              stats: s.digest,
            })),
          }),
        },
        ...history.map((h) => ({ role: h.role, content: h.content }) as const),
        { role: "user", content: message },
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      return NextResponse.json({ reply: "I couldn't come up with a reply to that — try rephrasing?", source: "ai" });
    }
    return NextResponse.json({ reply, source: "ai" });
  } catch (err) {
    return NextResponse.json({
      reply: "Couldn't reach the planning assistant right now. You can still click \"Create dashboard\" for a general overview, or try again in a moment.",
      source: "error",
      reason: err instanceof Error ? err.message : "AI request failed",
    });
  }
}
