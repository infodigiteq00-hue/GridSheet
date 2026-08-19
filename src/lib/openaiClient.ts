import type OpenAI from "openai";

export interface OpenAIHandle {
  client: OpenAI;
  model: string;
  /** Pass as `max_tokens`; see DEFAULT_MAX_TOKENS for why routes must send it. */
  maxTokens: number;
}

/**
 * Reasoning models such as GPT-5.6 Luna default to their full (65k) output
 * ceiling when `max_tokens` is omitted, and OpenRouter rejects the request
 * outright if the balance can't cover that ceiling — even though the reply
 * would only be a few hundred tokens. Every call therefore sends an explicit
 * cap, generous enough for a dashboard layout plus reasoning tokens.
 */
const DEFAULT_MAX_TOKENS = 4000;

/**
 * Returns null when OPENAI_API_KEY isn't configured, so every route can use
 * the same `if (!ai) { ...fallback... }` shape instead of duplicating the
 * env-check + dynamic-import dance.
 *
 * OPENAI_BASE_URL points the official `openai` package at any OpenAI-compatible
 * endpoint (OpenRouter, a local gateway, Azure-style proxies). Left unset it
 * talks to OpenAI directly.
 */
export async function getOpenAIClient(): Promise<OpenAIHandle | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const { default: OpenAI } = await import("openai");

  return {
    client: new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      // OpenRouter uses these to attribute traffic to an app; other providers ignore them.
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENAI_APP_URL?.trim() || "http://localhost:3000",
        "X-Title": "Gridsheet",
      },
    }),
    model: process.env.OPENAI_MODEL?.trim() || defaultModelFor(baseURL),
    maxTokens: parseMaxTokens(process.env.OPENAI_MAX_TOKENS),
  };
}

/** OpenRouter needs namespaced slugs (`openai/gpt-5.6-luna`), OpenAI needs bare ones. */
function defaultModelFor(baseURL: string | undefined): string {
  return baseURL?.includes("openrouter.ai") ? "openai/gpt-5.6-luna" : "gpt-4o-mini";
}

function parseMaxTokens(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_TOKENS;
}

/**
 * Models reached through a gateway don't always honour `response_format:
 * json_object`, so tolerate a plain-text reply that wraps the object in prose
 * or a ```json fence. Returns null when nothing parseable comes back, which
 * leaves the caller's heuristic fallback in charge.
 */
export function parseJsonContent(content: string | null | undefined): unknown {
  if (!content) return null;

  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    // Fall through to salvaging the outermost {...} block.
  }

  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}
