"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveDataset, useAppStore } from "@/lib/store";
import { applyColumnLabels } from "@/lib/columnNames";
import { parseSpreadsheetFile } from "@/lib/parseFile";
import { inferColumns } from "@/lib/inferColumns";
import { buildSampleDataset } from "@/lib/sampleData";
import { generateHeuristicLayout } from "@/lib/heuristicLayout";
import { packFlow } from "@/lib/gridLayout";
import { buildStatsDigest } from "@/lib/statsDigest";
import { DashboardState, Dataset, DatasetInput, Widget } from "@/lib/types";
import DatasetList from "@/components/datasets/DatasetList";
import AnalysisChat from "@/components/AnalysisChat";

function niceTitle(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "Untitled dashboard"
  );
}

export default function UploadPage() {
  const router = useRouter();
  const datasets = useAppStore((s) => s.datasets);
  const dataset = useActiveDataset();
  const addDatasets = useAppStore((s) => s.addDatasets);
  const clearAllDatasets = useAppStore((s) => s.clearAllDatasets);
  const setDashboard = useAppStore((s) => s.setDashboard);
  const attachSource = useAppStore((s) => s.attachSource);

  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [mode, setMode] = useState<"file" | "link">("file");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [importerOpen, setImporterOpen] = useState(false);
  // The full back-and-forth from AnalysisChat — sent verbatim as the build's
  // requested-analysis context, not just the last message, so a scope agreed
  // over several turns (e.g. "just FY26-27" then a clarifying answer) survives
  // into the actual dashboard build.
  const [chatTranscript, setChatTranscript] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasData = datasets.length > 0;
  const showImporter = !hasData || importerOpen;

  async function nameBlankColumns(sheets: Array<{ sheetName: string; rows: DatasetInput["rows"] }>) {
    const parsed = sheets.map((sheet) => ({ ...sheet, columns: inferColumns(sheet.rows) }));
    let labels: Record<string, Record<string, string>> = {};
    try {
      const res = await fetch("/api/ai/column-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheets: parsed.map((sheet) => ({ sheetName: sheet.sheetName, columns: sheet.columns })),
        }),
      });
      const data = await res.json();
      if (res.ok && data.labels && typeof data.labels === "object") labels = data.labels;
    } catch {
      // applyColumnLabels still replaces technical placeholders with stable fallbacks.
    }

    return parsed.map((sheet) => {
      const renamed = applyColumnLabels(sheet.rows, sheet.columns, labels[sheet.sheetName]);
      return { sheetName: sheet.sheetName, rows: renamed.rows, columns: inferColumns(renamed.rows) };
    });
  }

  async function handleFiles(files: File[]) {
    if (uploading) return;
    setUploading(true);
    // SheetJS can parse a small workbook synchronously enough that React never
    // gets a paint between selecting the file and completing the import. Yield
    // one frame so the upload spinner is always visible to the user.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    setError(null);
    setNotice(null);
    const accepted: DatasetInput[] = [];
    const rejected: string[] = [];

    try {
      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (!ext || !["xlsx", "xls", "csv"].includes(ext)) {
          rejected.push(`${file.name} — only .xlsx, .xls and .csv are supported`);
          continue;
        }
        try {
          const sheets = await parseSpreadsheetFile(file);
          if (sheets.length === 0) {
            rejected.push(`${file.name} — parsed but every sheet was empty`);
            continue;
          }
          const namedSheets = await nameBlankColumns(sheets);
          for (const sheet of namedSheets) {
            accepted.push({
              fileName: file.name,
              sheetName: sheet.sheetName,
              rows: sheet.rows,
              columns: sheet.columns,
              isSample: false,
            });
          }
        } catch {
          rejected.push(`${file.name} — couldn't be read as a spreadsheet`);
        }
      }

      if (accepted.length) {
        addDatasets(accepted);
        setImporterOpen(false);
        setNotice(
          accepted.length === 1
            ? `Imported 1 sheet.`
            : `Imported ${accepted.length} sheets — every tab becomes its own sheet you can chart and connect.`
        );
      }
      if (rejected.length) setError(rejected.join(" · "));
    } finally {
      setUploading(false);
    }
  }

  function loadSample() {
    setError(null);
    setNotice(null);
    addDatasets([buildSampleDataset()]);
    setImporterOpen(false);
  }

  /**
   * One-click path to the multi-sheet features. The built-in sample is a
   * single 48-row sheet, so relationship detection and cross-sheet tiles were
   * only reachable if you happened to have a linked workbook of your own to
   * hand. This loads the bundled accounts workbook straight from /public.
   */
  async function loadAccountsSample() {
    setError(null);
    setNotice(null);
    setSampleLoading(true);
    try {
      const res = await fetch("/api/import-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `${window.location.origin}/samples/Meridian_Global_Accounts_Sample.xlsx` }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't load the accounts sample.");
        return;
      }
      addDatasets(
        data.sheets.map((s: { sheetName: string; rows: DatasetInput["rows"]; columns: DatasetInput["columns"] }) => ({
          fileName: data.fileName,
          sheetName: s.sheetName,
          rows: s.rows,
          columns: s.columns,
          isSample: false,
        }))
      );
      setImporterOpen(false);
      setNotice(`Loaded the accounts sample — ${data.sheets.length} connected sheets.`);
    } catch {
      setError("Couldn't load the accounts sample.");
    } finally {
      setSampleLoading(false);
    }
  }

  async function importFromLink() {
    if (!linkUrl.trim()) return;
    setLinkError(null);
    setLinkLoading(true);
    try {
      const res = await fetch("/api/import-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLinkError(data.error || "Couldn't import that link.");
        return;
      }
      const sheets = Array.isArray(data.sheets)
        ? data.sheets
        : [{ sheetName: data.sheetName, rows: data.rows, columns: data.columns }];
      attachSource({ url: linkUrl.trim(), fileName: data.fileName, sheets });
      setLinkUrl("");
      setImporterOpen(false);
      setNotice(
        sheets.length === 1
          ? "Linked 1 sheet — it will keep itself in sync."
          : `Linked ${sheets.length} sheets — each one stays in sync with the source.`
      );
    } catch {
      setLinkError("Couldn't reach that link. Check your connection and try again.");
    } finally {
      setLinkLoading(false);
    }
  }

  // The whole conversation, not just the last line — a scope agreed over
  // several turns needs every turn for the builder to actually honor it.
  function transcriptToPrompt(): string | undefined {
    if (chatTranscript.length === 0) return undefined;
    return chatTranscript.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n");
  }

  async function buildLayoutForDataset(ds: Dataset): Promise<{ dashboard: DashboardState; source: "ai" | "heuristic" }> {
    try {
      const res = await fetch("/api/ai/auto-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: ds.columns,
          fileName: ds.fileName,
          rowCount: ds.rows.length,
          // Let the model reason about real totals and leading categories
          // without sending the workbook's individual rows off-device.
          digest: buildStatsDigest(ds.columns, ds.rows),
          userPrompt: transcriptToPrompt(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.dashboard) return { dashboard: data.dashboard, source: data.source === "ai" ? "ai" : "heuristic" };
      }
    } catch {
      // fall through to local heuristic
    }
    return { dashboard: generateHeuristicLayout(ds.columns, "overview", niceTitle(ds.fileName)), source: "heuristic" };
  }

  // Every imported sheet contributes its own section — not just the active
  // one. Each dataset is built independently (same per-sheet logic as
  // before, just looped) and every widget is stamped with the sheet it
  // actually reads from, so the combined board doesn't silently collapse
  // onto whichever dataset happened to be active.
  async function buildFromUpload() {
    if (!datasets.length) return;
    setBuilding(true);
    // Sequential, not Promise.all: firing one AI request per sheet
    // concurrently trips the provider's in-flight-credit limit well before
    // any of them finish (observed: all 7 calls 402 "would exceed your
    // available credits given your current in-flight requests" on a
    // 7-sheet workbook). Every 402'd call falls back to the local heuristic,
    // which has no concept of the user's typed analysis request — so a
    // specific "show only X" prompt silently got ignored on most or all
    // sheets. One request in flight at a time costs wall-clock time but
    // means the AI path — and the prompt it was told to honor — actually runs.
    const results: { dashboard: DashboardState; source: "ai" | "heuristic" }[] = [];
    for (const ds of datasets) {
      results.push(await buildLayoutForDataset(ds));
    }

    const widgets: Widget[] = [];
    results.forEach(({ dashboard: dsDashboard }, i) => {
      const ds = datasets[i];
      dsDashboard.widgets.forEach((w) => widgets.push({ ...w, datasetId: ds.id }));
    });

    const source: "ai" | "heuristic" = results.some((r) => r.source === "ai") ? "ai" : "heuristic";
    const boardTitle =
      datasets.length === 1
        ? results[0].dashboard.boardTitle
        : `${niceTitle(datasets[0]?.fileName || "Workspace")} — Full Overview`;

    setDashboard({ boardTitle, widgets: packFlow(widgets) }, source, dataset?.id ?? datasets[0]?.id);
    setBuilding(false);
    router.push("/builder");
  }

  return (
    <main className="flex-1 w-full max-w-[1000px] mx-auto px-8 pt-[46px] pb-[90px]">
      <div className="font-mono-plex text-xs text-[#8a8990] mb-2.5">
        {hasData ? "STEP 2 OF 2 — DESCRIBE YOUR DASHBOARD" : "STEP 1 OF 2 — IMPORT"}
      </div>
      <h2 className="font-display text-[38px] font-bold tracking-[-0.03em] mb-2">
        {hasData ? "What would you like to understand?" : "Bring in your spreadsheets"}
      </h2>
      <p className="text-base text-[#5c5b63] mb-8 max-w-[600px] leading-[1.55]">
        {hasData
          ? "Tell us the question or outcome you care about. We’ll use it to guide the first dashboard."
          : "Excel (.xlsx/.xls) or CSV — drop in several files at once, and every tab of a workbook comes in as its own sheet. Parsing happens entirely in your browser."}
      </p>

      {showImporter && (
        <div className={hasData ? "mb-7" : ""}>
          <div className="flex gap-1.5 mb-5 bg-[#e7e4dc] p-1 rounded-[11px] w-fit">
            {(["file", "link"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="px-4 py-2 rounded-[8px] text-[13.5px] font-medium cursor-pointer transition-colors"
                style={{
                  background: mode === m ? "#17161a" : "transparent",
                  color: mode === m ? "#f8f7f4" : "#4a4952",
                }}
              >
                {m === "file" ? "Upload a file" : "Link a spreadsheet"}
              </button>
            ))}
            {hasData && (
              <button
                onClick={() => setImporterOpen(false)}
                className="px-4 py-2 rounded-[8px] text-[13.5px] text-[#6b6a71] cursor-pointer hover:text-[#17161a]"
              >
                Cancel
              </button>
            )}
          </div>

          {mode === "link" && (
            <div>
              <div className="border border-[rgba(23,22,26,0.14)] rounded-[18px] bg-[#fdfcfa] p-8">
                <div className="font-display text-[19px] font-semibold tracking-[-0.02em] mb-1.5">
                  Sync from a Google Sheet or a direct file link
                </div>
                <div className="text-sm text-[#6b6a71] mb-5 leading-[1.55] max-w-[560px]">
                  Paste a Google Sheets link shared as &quot;Anyone with the link&quot;, or a direct URL to a
                  public <span className="font-mono-plex">.csv</span>/<span className="font-mono-plex">.xlsx</span>{" "}
                  file. Multi-tab workbooks come in as one synced sheet per tab. Once linked, the dashboard can
                  refresh itself automatically as the source data changes.
                </div>
                <div className="flex gap-2.5 flex-wrap">
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") importFromLink();
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    className="flex-1 min-w-[280px] border border-[rgba(23,22,26,0.16)] rounded-[10px] px-3.5 py-3 text-sm outline-none focus:border-[#2b4bff]"
                  />
                  <button
                    onClick={importFromLink}
                    disabled={linkLoading || !linkUrl.trim()}
                    className="border-0 bg-[#17161a] text-[#f8f7f4] px-5 py-3 rounded-[10px] text-sm font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {linkLoading ? "Importing…" : "Import"}
                  </button>
                </div>
                {linkError && <div className="mt-3 text-sm text-[#c0341c]">{linkError}</div>}
              </div>
            </div>
          )}

          {mode === "file" && (
            <div
              onClick={() => {
                if (!uploading) inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (uploading) return;
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (uploading) return;
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) handleFiles(files);
              }}
              aria-busy={uploading}
              className={`border-[1.5px] border-dashed rounded-[18px] bg-[#fdfcfa] px-8 py-[66px] text-center transition-colors ${uploading ? "cursor-wait" : "cursor-pointer"}`}
              style={{
                borderColor: uploading || dragOver ? "#2b4bff" : "rgba(23,22,26,0.25)",
                background: uploading || dragOver ? "#fbf9f5" : "#fdfcfa",
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length) handleFiles(files);
                  e.target.value = "";
                }}
              />
              {uploading ? (
                <div role="status" aria-live="polite">
                  <div className="w-[52px] h-[52px] rounded-full border-[3px] border-[#d9defe] border-t-[#2b4bff] animate-spin mx-auto mb-[18px]" />
                  <div className="font-display text-[19px] font-semibold tracking-[-0.02em] mb-1.5">Importing your spreadsheet…</div>
                  <div className="text-sm text-[#6b6a71]">Reading sheets and preparing your data</div>
                </div>
              ) : (
                <>
                  <div className="w-[52px] h-[52px] rounded-[14px] bg-[#eae7e0] grid place-items-center mx-auto mb-[18px] font-mono-plex text-[13px] font-medium text-[#4a4952]">
                    XLS
                  </div>
                  <div className="font-display text-[19px] font-semibold tracking-[-0.02em] mb-1.5">
                    Drop your .xlsx or .csv files here
                  </div>
                  <div className="text-sm text-[#6b6a71]">
                    Or{" "}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        loadSample();
                      }}
                      className="underline text-[#2b4bff] hover:text-[#1a2fb8] cursor-pointer"
                    >
                      use the sample workbook
                    </button>{" "}
                    — 48 rows of regional sales, or{" "}
                    <button
                      type="button"
                      disabled={sampleLoading}
                      onClick={(e) => {
                        e.stopPropagation();
                        loadAccountsSample();
                      }}
                      className="underline text-[#2b4bff] hover:text-[#1a2fb8] cursor-pointer disabled:opacity-60 disabled:cursor-default"
                    >
                      {sampleLoading ? "loading…" : "the 7-sheet accounts sample"}
                    </button>{" "}
                    — a multinational ledger, to see connected sheets
                  </div>
                </>
              )}
            </div>
          )}
          {mode === "file" && error && <div className="mt-3 text-sm text-[#c0341c]">{error}</div>}
        </div>
      )}

      {hasData && dataset && (
        <div className="flex flex-col gap-3.5">
          {notice && (
            <div className="text-[13px] text-[#00806f] bg-[rgba(0,166,166,0.08)] border border-[rgba(0,166,166,0.28)] rounded-[10px] px-3.5 py-2.5">
              {notice}
            </div>
          )}

          <DatasetList onAddMore={() => setImporterOpen(true)} />

          <AnalysisChat datasets={datasets} onMessagesChange={setChatTranscript} />

          {/* Right below the chat: the natural "I'm done describing it, build
              it" moment, reachable without scrolling back down past however
              many sheets/connections got imported. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={buildFromUpload}
              disabled={building}
              className="border-0 bg-[#17161a] text-[#f8f7f4] px-6 py-3.5 rounded-[11px] text-[15px] font-semibold cursor-pointer transition-transform active:scale-[0.975] disabled:opacity-60"
            >
              {building ? "Drafting your dashboard…" : "Create dashboard"}
            </button>
            <div className="text-[13px] text-[#7a7981]">
              {datasets.length > 1 ? `Uses all ${datasets.length} imported sheets` : `Uses ${dataset.label}`}
            </div>
          </div>

          {/* Sticky: with several sheets imported this page runs past seven
              screens (sheet cards, then every detected connection, then the
              column table). "Add another sheet"/"Start over" stay reachable
              from anywhere; "Create dashboard" itself lives with the chat
              above now instead of duplicating here. */}
          <div className="sticky bottom-0 z-20 -mx-8 mt-2 flex flex-wrap items-center gap-3 border-t border-[rgba(23,22,26,0.1)] bg-[#f8f7f4]/92 px-8 py-4 backdrop-blur">
            <button
              onClick={() => setImporterOpen(true)}
              className="bg-transparent border border-[rgba(23,22,26,0.2)] px-5 py-3.5 rounded-[11px] text-[14.5px] cursor-pointer hover:bg-[rgba(23,22,26,0.045)]"
            >
              Add another sheet
            </button>
            <button
              onClick={() => {
                clearAllDatasets();
                setNotice(null);
                setImporterOpen(false);
              }}
              className="bg-transparent border-0 text-[14px] text-[#7a7981] cursor-pointer hover:text-[#c0341c]"
            >
              Start over
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
