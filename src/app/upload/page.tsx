"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveDataset, useAppStore } from "@/lib/store";
import { parseSpreadsheetFile } from "@/lib/parseFile";
import { inferColumns } from "@/lib/inferColumns";
import { buildSampleDataset } from "@/lib/sampleData";
import { generateHeuristicLayout } from "@/lib/heuristicLayout";
import { packFlow } from "@/lib/gridLayout";
import { ColumnRole, DashboardState, Dataset, DatasetInput, Widget } from "@/lib/types";
import DatasetList from "@/components/datasets/DatasetList";
import RelationshipsPanel from "@/components/relationships/RelationshipsPanel";

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

const ROLE_CHIPS: { value: ColumnRole; label: string }[] = [
  { value: "dimension", label: "Group" },
  { value: "measure", label: "Measure" },
  { value: "ignore", label: "Skip" },
];

export default function UploadPage() {
  const router = useRouter();
  const datasets = useAppStore((s) => s.datasets);
  const dataset = useActiveDataset();
  const addDatasets = useAppStore((s) => s.addDatasets);
  const clearAllDatasets = useAppStore((s) => s.clearAllDatasets);
  const setColumnRole = useAppStore((s) => s.setColumnRole);
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
  const [linkError, setLinkError] = useState<string | null>(null);
  const [importerOpen, setImporterOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasData = datasets.length > 0;
  const showImporter = !hasData || importerOpen;

  async function handleFiles(files: File[]) {
    setError(null);
    setNotice(null);
    const accepted: DatasetInput[] = [];
    const rejected: string[] = [];

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
        for (const sheet of sheets) {
          accepted.push({
            fileName: file.name,
            sheetName: sheet.sheetName,
            rows: sheet.rows,
            columns: inferColumns(sheet.rows),
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
          isSample: true,
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

  async function buildLayoutForDataset(ds: Dataset): Promise<{ dashboard: DashboardState; source: "ai" | "heuristic" }> {
    try {
      const res = await fetch("/api/ai/auto-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: ds.columns, fileName: ds.fileName, rowCount: ds.rows.length }),
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
    const results = await Promise.all(datasets.map((ds) => buildLayoutForDataset(ds)));

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

  const measureCount = dataset?.columns.filter((c) => c.role === "measure").length ?? 0;
  const dimensionCount = dataset?.columns.filter((c) => c.role === "dimension").length ?? 0;

  return (
    <main className="flex-1 w-full max-w-[1000px] mx-auto px-8 pt-[46px] pb-[90px]">
      <div className="font-mono-plex text-xs text-[#8a8990] mb-2.5">
        {hasData ? "STEP 2 OF 2 — MAP COLUMNS" : "STEP 1 OF 2 — IMPORT"}
      </div>
      <h2 className="font-display text-[38px] font-bold tracking-[-0.03em] mb-2">
        {hasData ? "Check how we read your columns" : "Bring in your spreadsheets"}
      </h2>
      <p className="text-base text-[#5c5b63] mb-8 max-w-[600px] leading-[1.55]">
        {hasData
          ? "We guessed a role for each column. Groups become axes and categories, measures become the numbers we chart."
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
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) handleFiles(files);
              }}
              className="border-[1.5px] border-dashed rounded-[18px] bg-[#fdfcfa] px-8 py-[66px] text-center cursor-pointer transition-colors"
              style={{
                borderColor: dragOver ? "#2b4bff" : "rgba(23,22,26,0.25)",
                background: dragOver ? "#fbf9f5" : "#fdfcfa",
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

          {datasets.length >= 2 && (
            <div className="mt-3.5 border-t border-[rgba(23,22,26,0.1)] pt-6">
              <RelationshipsPanel variant="compact" />
              <div className="mt-3 text-[13px] text-[#6b6a71]">
                Want the full view?{" "}
                <Link href="/connections" className="text-[#2b4bff] hover:text-[#1a2fb8]">
                  Open the connections map
                </Link>
                .
              </div>
            </div>
          )}

          <div className="mt-3.5 flex items-center gap-2.5 flex-wrap">
            <div className="text-[11px] tracking-[0.08em] uppercase text-[#8a8990] font-semibold">
              Columns in {dataset.label}
            </div>
            {datasets.length > 1 && (
              <div className="text-[12.5px] text-[#8a8990]">— pick another sheet above to map its columns</div>
            )}
          </div>

          <div className="bg-[#fdfcfa] border border-[rgba(23,22,26,0.1)] rounded-2xl overflow-hidden">
            <div
              className="grid gap-3 px-[18px] py-[13px] bg-[#f7f5f1] border-b border-[rgba(23,22,26,0.08)] text-[11.5px] tracking-[0.06em] uppercase text-[#7a7981] font-semibold"
              style={{ gridTemplateColumns: "1.3fr 0.9fr 1.5fr 1.4fr" }}
            >
              <div>Column</div>
              <div>Type</div>
              <div>Sample values</div>
              <div>Use as</div>
            </div>
            {dataset.columns.map((c) => (
              <div
                key={c.name}
                className="grid gap-3 px-[18px] py-[13px] border-b border-[rgba(23,22,26,0.06)] items-center"
                style={{ gridTemplateColumns: "1.3fr 0.9fr 1.5fr 1.4fr" }}
              >
                <div className="font-medium text-[14.5px] truncate">{c.name}</div>
                <div className="font-mono-plex text-[12.5px] text-[#6b6a71]">{c.type}</div>
                <div className="text-[13px] text-[#7a7981] font-mono-plex overflow-hidden text-ellipsis whitespace-nowrap">
                  {c.sampleValues.join(", ")}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {ROLE_CHIPS.map((r) => {
                    const active = c.role === r.value;
                    return (
                      <button
                        key={r.value}
                        onClick={() => setColumnRole(c.name, r.value, dataset.id)}
                        className="px-[9px] py-[5px] rounded-[7px] text-xs font-medium cursor-pointer border"
                        style={{
                          borderColor: active ? "#2b4bff" : "rgba(23,22,26,0.14)",
                          background: active ? "#e5e9ff" : "#fdfcfa",
                          color: active ? "#1a2fb8" : "#4a4952",
                        }}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Sticky: with several sheets imported this page runs past seven
              screens (sheet cards, then every detected connection, then the
              column table), which left the primary action stranded at the
              very bottom. Keeping it docked means "Build my dashboard" is
              always one click away no matter how much data is loaded. */}
          <div className="sticky bottom-0 z-20 -mx-8 mt-2 flex flex-wrap items-center gap-3 border-t border-[rgba(23,22,26,0.1)] bg-[#f8f7f4]/92 px-8 py-4 backdrop-blur">
            <button
              onClick={buildFromUpload}
              disabled={building}
              className="border-0 bg-[#17161a] text-[#f8f7f4] px-6 py-3.5 rounded-[11px] text-[15px] font-semibold cursor-pointer transition-transform active:scale-[0.975] disabled:opacity-60"
            >
              {building ? "Drafting your dashboard…" : "Build my dashboard"}
            </button>
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
            <div className="text-[13px] text-[#7a7981]">
              {/* The build covers every imported sheet, so say so — naming only
                  the sheet being mapped read as though the rest were ignored. */}
              {datasets.length > 1
                ? `Builds all ${datasets.length} sheets · ${measureCount} measures, ${dimensionCount} groups in ${dataset.label}`
                : `${measureCount} measures · ${dimensionCount} groups in ${dataset.label}`}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
