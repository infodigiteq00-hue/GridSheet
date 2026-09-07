"use client";

import { buildStatsDigest } from "./statsDigest";
import { Dataset, Widget } from "./types";

export interface AnalysisChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AnalysisChatResult {
  reply: string;
  source: "ai" | "unavailable" | "error";
  reason?: string;
}

/**
 * Scopes a dashboard build across every loaded sheet — distinct from
 * requestChatAnswer, which answers questions about one already-built
 * dashboard's active dataset. Sends column summaries + aggregate digests
 * per sheet, never raw rows.
 */
export function requestAnalysisChat(
  message: string,
  datasets: Dataset[],
  history: AnalysisChatTurn[]
): Promise<AnalysisChatResult> {
  return postJson<AnalysisChatResult>("/api/ai/analysis-chat", {
    message,
    history,
    sheets: datasets.map((ds) => ({
      sheetName: ds.label,
      columns: ds.columns,
      digest: buildStatsDigest(ds.columns, ds.rows),
    })),
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data as T;
}

/** Which sheet a request is about, and what it joins to — so answers can name related sheets. */
export interface DatasetContext {
  sheetLabel: string;
  relatedSheets: { label: string; viaColumn: string; toColumn: string }[];
}

export interface NarrativeResult {
  text: string;
  source: "ai" | "heuristic";
  reason?: string;
}

export function requestNarrative(dataset: Dataset, context?: DatasetContext): Promise<NarrativeResult> {
  const digest = buildStatsDigest(dataset.columns, dataset.rows);
  return postJson<NarrativeResult>("/api/ai/narrative", {
    columns: dataset.columns,
    digest,
    fileName: dataset.fileName,
    sheetLabel: context?.sheetLabel ?? dataset.label,
    relatedSheets: context?.relatedSheets ?? [],
  });
}

export interface CreateTileResult {
  widget: Widget;
  source: "ai" | "heuristic";
  reason?: string;
}

export function requestTileFromPrompt(prompt: string, dataset: Dataset, current?: Widget): Promise<CreateTileResult> {
  return postJson<CreateTileResult>("/api/ai/create-tile", {
    prompt,
    columns: dataset.columns,
    current,
  });
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  answer: string;
  source: "ai" | "heuristic" | "unavailable" | "error";
  reason?: string;
}

export function requestChatAnswer(
  question: string,
  dataset: Dataset,
  history: ChatTurn[],
  context?: DatasetContext
): Promise<ChatResult> {
  const digest = buildStatsDigest(dataset.columns, dataset.rows);
  return postJson<ChatResult>("/api/ai/chat", {
    question,
    columns: dataset.columns,
    digest,
    history,
    sheetLabel: context?.sheetLabel ?? dataset.label,
    relatedSheets: context?.relatedSheets ?? [],
  });
}
