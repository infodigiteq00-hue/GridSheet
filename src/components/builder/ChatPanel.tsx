"use client";

import { useEffect, useRef, useState } from "react";
import { ChatTurn, requestChatAnswer } from "@/lib/aiClient";
import { useActiveDataset } from "@/lib/store";
import { useAiDatasetContext } from "@/lib/useAiContext";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  heuristic?: boolean;
}

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

export default function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dataset = useActiveDataset();
  const aiContext = useAiDatasetContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastDatasetKey = useRef<string | null>(null);

  const datasetKey = dataset ? `${dataset.id}:${dataset.rows.length}:${dataset.columns.length}` : null;

  useEffect(() => {
    if (datasetKey !== lastDatasetKey.current) {
      lastDatasetKey.current = datasetKey;
      setMessages([]);
    }
  }, [datasetKey]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  async function send() {
    const question = input.trim();
    if (!question || loading || !dataset) return;
    setInput("");
    setMessages((m) => [...m, { id: nextId(), role: "user", text: question }]);
    setLoading(true);
    try {
      const history: ChatTurn[] = messages.slice(-4).map((m) => ({ role: m.role, content: m.text }));
      const { answer, source, reason } = await requestChatAnswer(question, dataset, history, aiContext);
      setMessages((m) => [
        ...m,
        { id: nextId(), role: "assistant", text: answer, heuristic: source !== "ai" },
      ]);
      void reason;
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: "assistant",
          text: err instanceof Error ? err.message : "Something went wrong answering that — please try again.",
          heuristic: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed right-0 top-[62px] bottom-0 z-30 flex flex-col bg-[#fdfcfa] border-l border-[rgba(23,22,26,0.1)] transition-transform duration-200 ease-out"
      style={{
        width: 336,
        boxShadow: "-18px 0 40px -28px rgba(23,22,26,0.55)",
        transform: open ? "translateX(0)" : "translateX(100%)",
      }}
      aria-hidden={!open}
    >
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[rgba(23,22,26,0.08)]">
        <div className="font-display font-semibold text-[15px] tracking-[-0.015em] text-[#17161a]">💬 Ask the data</div>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="border-0 bg-transparent text-[#a3a2a9] cursor-pointer text-[17px] leading-none px-1.5 py-1 rounded-[5px] hover:bg-[rgba(23,22,26,0.06)] hover:text-[#17161a]"
        >
          ×
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-[#8a8990] text-[13px] leading-[1.6]">
            Ask a free-form question about the current dataset — e.g. &ldquo;what&apos;s our best performing region?&rdquo; or
            &ldquo;which month had the biggest drop?&rdquo;
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[86%] rounded-[11px] px-3 py-2 text-[13px] leading-[1.55]"
              style={
                m.role === "user"
                  ? { background: "#17161a", color: "#f8f7f4" }
                  : { background: "#f0eee8", color: "#3d3c44", border: "1px solid rgba(23,22,26,0.08)" }
              }
            >
              {m.text}
              {m.heuristic && m.role === "assistant" && (
                <div className="mt-1.5 text-[10.5px] uppercase tracking-[0.06em] text-[#8a8990] font-mono-plex">Heuristic answer</div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div
              className="rounded-[11px] px-3 py-2 text-[13px]"
              style={{ background: "#f0eee8", color: "#8a8990", border: "1px solid rgba(23,22,26,0.08)" }}
            >
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="px-3.5 py-3 border-t border-[rgba(23,22,26,0.08)] flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          disabled={!dataset || loading}
          placeholder="Ask about your data…"
          className="flex-1 min-w-0 border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-[9px] px-2.5 py-2 text-[13px] outline-none focus:border-[#2b4bff] disabled:opacity-60"
        />
        <button
          onClick={send}
          disabled={!dataset || loading || !input.trim()}
          className="flex-none border-0 bg-[#2b4bff] text-white px-3.5 py-2 rounded-[9px] text-[13px] font-semibold cursor-pointer transition-transform active:scale-[0.97] disabled:opacity-45 disabled:cursor-default"
        >
          Ask
        </button>
      </div>
    </div>
  );
}
