"use client";

import { useState } from "react";
import { requestTileFromPrompt } from "@/lib/aiClient";
import { useActiveDataset, useAppStore } from "@/lib/store";
import { looksLikeEditIntent } from "@/lib/tileHeuristic";
import { TYPE_LABEL, TYPES, WidgetType } from "@/lib/types";
import TypeIcon from "@/components/icons/TypeIcon";
import DataPanel from "@/components/builder/DataPanel";

export default function Palette() {
  const dataset = useActiveDataset();
  const dashboard = useAppStore((s) => s.dashboard);
  const selectedId = useAppStore((s) => s.selectedId);
  const addWidget = useAppStore((s) => s.addWidget);
  const addCustomWidget = useAppStore((s) => s.addCustomWidget);
  const updateWidget = useAppStore((s) => s.updateWidget);

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const selected = dashboard.widgets.find((w) => w.id === selectedId) || null;

  function handleAdd(type: WidgetType) {
    addWidget(type);
    // Text tiles used to auto-fire an AI narrative call the moment they were
    // added — an unrequested API cost on every drag. The Inspector's own
    // "Generate insight" button covers this on demand instead.
  }

  async function submitPrompt() {
    const text = prompt.trim();
    if (!text || !dataset || loading) return;
    setLoading(true);
    setNote(null);
    try {
      const isEdit = !!selected && looksLikeEditIntent(text);
      const { widget, source, reason } = await requestTileFromPrompt(text, dataset, isEdit ? selected! : undefined);
      if (isEdit && selected) {
        updateWidget(selected.id, { ...widget, id: selected.id });
      } else {
        addCustomWidget(widget);
      }
      setPrompt("");
      if (source === "heuristic") {
        setNote(reason || "Using local keyword matching — add OPENAI_API_KEY in .env.local for smarter results.");
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't create that tile — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="border-r border-[rgba(23,22,26,0.09)] px-3.5 py-[18px] bg-[#f0eee8] flex flex-col gap-1.5 overflow-y-auto">
      <DataPanel />

      <div className="text-[11px] tracking-[0.08em] uppercase text-[#8a8990] font-semibold px-1.5 pb-2">Describe a tile</div>
      <div className="pb-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitPrompt();
            }
          }}
          placeholder={selected ? `e.g. "make this a bar chart"` : `e.g. "revenue by region as a donut"`}
          rows={2}
          className="w-full resize-none border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-[9px] px-2.5 py-2 text-[12.5px] leading-[1.45] outline-none focus:border-[#2b4bff]"
        />
        <button
          onClick={submitPrompt}
          disabled={loading || !prompt.trim() || !dataset}
          className="mt-1.5 w-full border-0 bg-[#2b4bff] text-white rounded-[9px] py-2 text-[12.5px] font-semibold cursor-pointer transition-transform active:scale-[0.98] disabled:opacity-45 disabled:cursor-default"
        >
          {loading ? "Thinking…" : selected ? "✨ Generate / edit tile" : "✨ Generate tile"}
        </button>
        {note && (
          <div className="mt-1.5 text-[11px] leading-[1.5] text-[#7a7981] bg-[#f7f5f1] border border-[rgba(23,22,26,0.09)] rounded-[7px] px-2 py-1.5">
            {note}
          </div>
        )}
      </div>

      <div className="h-px bg-[rgba(23,22,26,0.09)] mb-2.5" />

      <div className="text-[11px] tracking-[0.08em] uppercase text-[#8a8990] font-semibold px-1.5 pb-2">Add a tile</div>
      {TYPES.map((t) => (
        <button
          key={t}
          onClick={() => handleAdd(t)}
          className="flex items-center gap-2.5 border border-[rgba(23,22,26,0.09)] bg-[#fdfcfa] px-2.5 py-2 rounded-[9px] cursor-pointer text-left text-[13.5px] font-medium transition-transform active:scale-[0.98] hover:border-[#2b4bff]"
        >
          <span className="w-[22px] h-[22px] flex-none grid place-items-center">
            <TypeIcon type={t} />
          </span>
          {TYPE_LABEL[t]}
        </button>
      ))}
    </aside>
  );
}
