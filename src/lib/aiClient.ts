"use client";

import { buildStatsDigest } from "./statsDigest";
import { Dataset, Widget } from "./types";

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
