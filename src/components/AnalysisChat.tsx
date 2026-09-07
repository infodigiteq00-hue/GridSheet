"use client";

import { useEffect, useRef, useState } from "react";
import { AnalysisChatTurn, requestAnalysisChat } from "@/lib/aiClient";
import { Dataset } from "@/lib/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  errored?: boolean;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `ac${seq}`;
}

interface Props {
  datasets: Dataset[];
  /** Fires on every change so the parent always has the current transcript
   * ready for the actual build request — pass a state setter directly. */
  onMessagesChange: (messages: { role: "user" | "assistant"; text: string }[]) => void;
}

export default function AnalysisChat({ datasets, onMessagesChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onMessagesChange(messages.map(({ role, text }) => ({ role, text })));
    // onMessagesChange is expected to be a stable setState setter — see Props doc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading || datasets.length === 0) return;
    setInput("");
    setMessages((m) => [...m, { id: nextId(), role: "user", text }]);
    setLoading(true);
    try {
      const history: AnalysisChatTurn[] = messages.slice(-6).map((m) => ({ role: m.role, content: m.text }));
      const { reply, source } = await requestAnalysisChat(text, datasets, history);
      setMessages((m) => [...m, { id: nextId(), role: "assistant", text: reply, errored: source === "error" }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: "assistant",
          text: err instanceof Error ? err.message : "Something went wrong — please try again.",
          errored: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-3.5 rounded-2xl border border-[rgba(23,22,26,0.1)] bg-[#fdfcfa] p-6">
      <div className="font-display text-[19px] font-semibold tracking-[-0.02em]">Describe the analysis you need</div>
      <p className="mt-1.5 text-sm leading-[1.55] text-[#6b6a71]">
        Tell the assistant what you need — it can see every sheet&rsquo;s columns and stats, and will confirm what
        it found before you build. For example: &ldquo;Show overdue receivables by customer and currency, then
        highlight the biggest risks.&rdquo;
      </p>

      {messages.length > 0 && (
        <div ref={listRef} className="mt-4 max-h-[360px] overflow-y-auto flex flex-col gap-3 pr-1">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[86%] rounded-[11px] px-3.5 py-2.5 text-[13.5px] leading-[1.55] whitespace-pre-wrap"
                style={
                  m.role === "user"
                    ? { background: "#17161a", color: "#f8f7f4" }
                    : {
                        background: "#f0eee8",
                        color: "#3d3c44",
                        border: m.errored ? "1px solid rgba(192,52,28,0.3)" : "1px solid rgba(23,22,26,0.08)",
                      }
                }
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div
                className="rounded-[11px] px-3.5 py-2.5 text-[13.5px]"
                style={{ background: "#f0eee8", color: "#8a8990", border: "1px solid rgba(23,22,26,0.08)" }}
              >
                Thinking…
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2.5 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder="What should this dashboard answer?"
          rows={messages.length > 0 ? 2 : 3}
          disabled={loading}
          className="flex-1 resize-y rounded-[11px] border border-[rgba(23,22,26,0.16)] bg-[#fdfcfa] px-3.5 py-3 text-sm leading-[1.55] outline-none focus:border-[#2b4bff] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={send}
          disabled={loading || !input.trim()}
          className="flex-none rounded-[9px] border-0 bg-[#17161a] text-[#f8f7f4] px-4 py-3 text-[13.5px] font-semibold cursor-pointer transition-transform active:scale-[0.975] disabled:opacity-45 disabled:cursor-default"
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
      <div className="mt-2 text-[12.5px] text-[#7a7981]">
        Press Ctrl/⌘ + Enter to send. When you&rsquo;re ready, click &ldquo;Create dashboard&rdquo; below.
      </div>
    </section>
  );
}
