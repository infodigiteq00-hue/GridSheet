"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataHistoryEntry } from "@/lib/types";
import { useAppStore } from "@/lib/store";

function savedWhen(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function dataLabel(entry: DataHistoryEntry): string {
  return `${entry.sheetCount} ${entry.sheetCount === 1 ? "sheet" : "sheets"} · ${entry.rowCount.toLocaleString("en-IN")} rows`;
}

export default function HistoryPage() {
  const router = useRouter();
  const hasHydrated = useAppStore((state) => state.hasHydrated);
  const history = useAppStore((state) => state.history);
  const currentHistoryId = useAppStore((state) => state.currentHistoryId);
  const datasets = useAppStore((state) => state.datasets);
  const saveHistorySnapshot = useAppStore((state) => state.saveHistorySnapshot);
  const restoreHistorySnapshot = useAppStore((state) => state.restoreHistorySnapshot);
  const removeHistorySnapshot = useAppStore((state) => state.removeHistorySnapshot);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Also cover a live workspace already open when this feature was added;
  // hot reload does not run Zustand's hydration callback again.
  useEffect(() => {
    if (hasHydrated && currentHistoryId === null && datasets.some((dataset) => !dataset.isSample)) saveHistorySnapshot();
  }, [currentHistoryId, datasets, hasHydrated, saveHistorySnapshot]);

  async function openEntry(id: string) {
    if (openingId) return;
    setError(null);
    setOpeningId(id);
    const restored = await restoreHistorySnapshot(id);
    setOpeningId(null);
    if (restored) router.push("/builder");
    else setError("That saved data is no longer available in this browser.");
  }

  return (
    <main className="flex-1 w-full max-w-[1000px] mx-auto px-8 pt-[46px] pb-24">
      <div className="font-mono-plex text-xs text-[#8a8990] mb-2.5">LOCAL DATA HISTORY</div>
      <h1 className="font-display text-[38px] font-bold tracking-[-0.03em] mb-2">Saved workspaces</h1>
      <p className="text-base text-[#5c5b63] max-w-[640px] leading-[1.55] mb-8">
        Imported workspaces are saved in this browser only. Reopen one to restore its sheets and dashboard exactly where you left off. They remain here until you remove them.
      </p>

      {!hasHydrated ? (
        <div className="text-sm text-[#7a7981]">Loading saved workspaces…</div>
      ) : history.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-[rgba(23,22,26,0.18)] bg-[#fdfcfa] px-7 py-10 text-center">
          <div className="font-display text-lg font-semibold mb-2">No saved imports yet</div>
          <p className="text-sm leading-[1.5] text-[#6b6a71] mb-5">Import a spreadsheet and it will appear here automatically.</p>
          <Link href="/upload" className="inline-block rounded-[9px] bg-[#17161a] px-4 py-2.5 text-[13.5px] font-semibold text-[#f8f7f4]">
            Import a spreadsheet
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((entry) => {
            const active = entry.id === currentHistoryId;
            const opening = entry.id === openingId;
            return (
              <article
                key={entry.id}
                className="rounded-[15px] border bg-[#fdfcfa] px-5 py-4 flex flex-wrap items-center gap-4"
                style={{ borderColor: active ? "#2b4bff" : "rgba(23,22,26,0.1)", boxShadow: active ? "0 0 0 3px rgba(43,75,255,0.1)" : "none" }}
              >
                <div className="w-10 h-10 rounded-[10px] grid place-items-center bg-[#e5e9ff] text-[#1a2fb8] font-mono-plex text-[11px] font-semibold flex-none">
                  XLS
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] truncate">{entry.title}</h2>
                    {active && <span className="rounded-full bg-[#e5e9ff] px-2 py-[3px] text-[11px] font-semibold text-[#1a2fb8]">Open now</span>}
                  </div>
                  <p className="font-mono-plex text-[12px] text-[#7a7981] mt-1">{dataLabel(entry)} · Saved {savedWhen(entry.createdAt)}</p>
                  <p className="text-[12px] text-[#7a7981] mt-1 truncate">{entry.fileNames.join(" · ")}</p>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => openEntry(entry.id)}
                    disabled={!!openingId}
                    className="rounded-[9px] bg-[#17161a] px-3.5 py-2 text-[13px] font-semibold text-[#f8f7f4] disabled:opacity-55"
                  >
                    {opening ? "Opening…" : "Open"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHistorySnapshot(entry.id)}
                    className="rounded-[9px] border border-[rgba(23,22,26,0.15)] px-3 py-2 text-[13px] font-medium text-[#6b6a71] hover:border-[#d93a20] hover:text-[#c0341c]"
                    aria-label={`Delete ${entry.title} from history`}
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {error && <div className="mt-5 rounded-[10px] border border-[rgba(217,58,32,0.28)] bg-[rgba(255,92,70,0.08)] px-3.5 py-3 text-sm text-[#a52d1a]">{error}</div>}
    </main>
  );
}
