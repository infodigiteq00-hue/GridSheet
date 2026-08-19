"use client";

import { useMemo, useState } from "react";
import { requestNarrative } from "@/lib/aiClient";
import { relatedFieldOptions } from "@/lib/join";
import { GRID_COLS } from "@/lib/gridLayout";
import { pickDims, pickMeasures } from "@/lib/heuristicLayout";
import { useAppStore, useVisibleRelationships } from "@/lib/store";
import { FontKey, PaletteKey, SortMode, TYPE_LABEL, TYPES, Widget, WidgetType } from "@/lib/types";
import { useAiDatasetContext } from "@/lib/useAiContext";
import { PALETTES } from "@/lib/palettes";
import TypeIcon from "@/components/icons/TypeIcon";

function chipStyle(active: boolean) {
  return active
    ? { border: "#2b4bff", bg: "#e5e9ff", fg: "#1a2fb8" }
    : { border: "rgba(23,22,26,0.14)", bg: "#fdfcfa", fg: "#4a4952" };
}

const SPAN_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const FONT_OPTIONS: { key: FontKey; label: string; family: string }[] = [
  { key: "grotesk", label: "Space Grotesk", family: "var(--font-space-grotesk), sans-serif" },
  { key: "plex", label: "IBM Plex Sans", family: "var(--font-plex-sans), sans-serif" },
];

function layoutForType(type: WidgetType): Pick<Widget, "colSpan" | "height"> {
  switch (type) {
    case "kpi":
    case "gauge":
      return { colSpan: 3, height: 148 };
    case "table":
    case "pivot":
      return { colSpan: 8, height: 300 };
    case "text":
      return { colSpan: 4, height: 220 };
    default:
      return { colSpan: 6, height: 260 };
  }
}

export default function Inspector() {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const dashboard = useAppStore((s) => s.dashboard);
  const selectedId = useAppStore((s) => s.selectedId);
  const updateWidget = useAppStore((s) => s.updateWidget);
  const duplicateWidget = useAppStore((s) => s.duplicateWidget);
  const removeWidget = useAppStore((s) => s.removeWidget);
  const relationships = useVisibleRelationships();
  const aiContext = useAiDatasetContext();

  const sel = dashboard.widgets.find((w) => w.id === selectedId) || null;

  // A tile reads its own sheet, which may differ from the one being edited elsewhere.
  const dataset =
    datasets.find((d) => d.id === sel?.datasetId) ??
    datasets.find((d) => d.id === activeDatasetId) ??
    datasets[0] ??
    null;

  const columns = dataset?.columns ?? [];
  const dimOptions = columns.filter((c) => c.role === "dimension");
  const measureOptions = columns.filter((c) => c.role === "measure");

  const relatedGroups = useMemo(
    () => relatedFieldOptions(dataset?.id ?? null, datasets, relationships),
    [dataset?.id, datasets, relationships]
  );
  const flatRelated = useMemo(() => relatedGroups.flatMap((g) => g.options), [relatedGroups]);

  const dimValue = sel?.dimRef
    ? (() => {
        const idx = flatRelated.findIndex(
          (o) => o.ref.relationshipId === sel.dimRef!.relationshipId && o.column === sel.dimRef!.column
        );
        return idx >= 0 ? `rel#${idx}` : "";
      })()
    : sel?.dim ?? "";

  function changeDim(value: string) {
    if (!sel) return;
    if (value.startsWith("rel#")) {
      const option = flatRelated[Number(value.slice(4))];
      if (!option) return;
      updateWidget(sel.id, { dim: option.fieldName, dimRef: option.ref });
      return;
    }
    updateWidget(sel.id, { dim: value, dimRef: undefined });
  }

  function changeWidgetDataset(datasetId: string) {
    if (!sel) return;
    const next = datasets.find((d) => d.id === datasetId);
    if (!next) return;
    updateWidget(sel.id, {
      datasetId,
      dim: pickDims(next.columns, 1)[0] || "",
      measure: pickMeasures(next.columns, 1)[0] || "",
      dimRef: undefined,
    });
  }

  function changeWidgetType(type: WidgetType) {
    if (!sel || type === sel.type) return;
    const dateDimension = columns.find((column) => column.type === "date")?.name;
    updateWidget(sel.id, {
      type,
      ...layoutForType(type),
      ...(type === "line" || type === "area" ? { dim: dateDimension ?? sel.dim } : {}),
    });
  }

  const [insightLoading, setInsightLoading] = useState(false);
  const [insightNote, setInsightNote] = useState<string | null>(null);
  const [insightNoteFor, setInsightNoteFor] = useState<string | null>(null);
  if (insightNoteFor !== selectedId) {
    setInsightNoteFor(selectedId);
    if (insightNote !== null) setInsightNote(null);
  }

  async function generateInsight() {
    if (!dataset || !sel) return;
    setInsightLoading(true);
    setInsightNote(null);
    try {
      const { text, source, reason } = await requestNarrative(dataset, aiContext);
      updateWidget(sel.id, { text });
      if (source === "heuristic") {
        setInsightNote(reason || "Heuristic summary — add OPENAI_API_KEY in .env.local for AI-generated insights.");
      }
    } catch (err) {
      setInsightNote(err instanceof Error ? err.message : "Couldn't generate an insight — try again.");
    } finally {
      setInsightLoading(false);
    }
  }

  return (
    <aside className="border-l border-[rgba(23,22,26,0.09)] bg-[#f0eee8] overflow-y-auto">
      {!sel && (
        <div className="px-5 py-[26px] text-[#7a7981] text-sm leading-[1.6]">
          <div className="font-display text-base font-semibold text-[#17161a] mb-2 tracking-[-0.015em]">Nothing selected</div>
          Click any tile to change its chart type, data, size, palette, and text. Drag a tile into empty space · corner to resize.
        </div>
      )}

      {sel && (
        <div className="px-4 pt-4 pb-10 flex flex-col gap-5">
          <Section label="Tile">
            <input
              value={sel.title}
              onChange={(e) => updateWidget(sel.id, { title: e.target.value })}
              placeholder={TYPE_LABEL[sel.type]}
              className="w-full border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-[9px] px-[11px] py-2.5 text-sm outline-none focus:border-[#2b4bff]"
            />
          </Section>

          {sel.type === "text" && (
            <Section label="Insight">
              <button
                onClick={generateInsight}
                disabled={insightLoading}
                className="w-full border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-[9px] py-2.5 text-[13px] font-medium cursor-pointer hover:border-[#2b4bff] disabled:opacity-60 disabled:cursor-default"
              >
                {insightLoading ? "Generating…" : "✨ Generate insight"}
              </button>
              {insightNote && (
                <div className="mt-2 text-[11.5px] leading-[1.5] text-[#7a7981] bg-[#f7f5f1] border border-[rgba(23,22,26,0.09)] rounded-[7px] px-2.5 py-2">
                  {insightNote}
                </div>
              )}
            </Section>
          )}

          <Section label="Chart type">
            <div className="grid grid-cols-4 gap-1.5">
              {TYPES.map((t) => {
                const active = sel.type === t;
                const cs = chipStyle(active);
                return (
                  <button
                    key={t}
                    title={TYPE_LABEL[t]}
                    onClick={() => changeWidgetType(t as WidgetType)}
                    className="aspect-square grid place-items-center rounded-[9px] cursor-pointer p-0 border hover:border-[#2b4bff]"
                    style={{ borderColor: cs.border, background: cs.bg }}
                  >
                    <TypeIcon type={t} color={active ? "#1a2fb8" : "#4a4952"} />
                  </button>
                );
              })}
            </div>
          </Section>

          <Section label="Data">
            <div className="flex flex-col gap-2">
              {datasets.length > 1 && (
                <Field label="Sheet">
                  <select
                    data-testid="widget-sheet-select"
                    value={dataset?.id ?? ""}
                    onChange={(e) => changeWidgetDataset(e.target.value)}
                    className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-[7px] text-[13.5px]"
                  >
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Group by">
                <select
                  data-testid="widget-dim-select"
                  value={dimValue}
                  onChange={(e) => changeDim(e.target.value)}
                  className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-[7px] text-[13.5px]"
                >
                  <option value="">—</option>
                  {dimOptions.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                  {relatedGroups.map((g) => (
                    <optgroup key={`${g.datasetLabel}:${g.viaColumn}`} label={`🔗 ${g.datasetLabel} (via ${g.viaColumn})`}>
                      {g.options.map((o) => (
                        <option key={o.fieldName} value={`rel#${flatRelated.indexOf(o)}`}>
                          {o.datasetLabel}.{o.column}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              {sel.dimRef && (
                <div className="text-[11.5px] leading-[1.5] text-[#00806f] bg-[rgba(0,166,166,0.08)] border border-[rgba(0,166,166,0.28)] rounded-[7px] px-2.5 py-2">
                  Grouping by a field looked up from{" "}
                  <span className="font-mono-plex">{datasets.find((d) => d.id === sel.dimRef?.datasetId)?.label}</span> through
                  the detected connection.
                </div>
              )}
              <Field label="Measure">
                <select
                  value={sel.measure}
                  onChange={(e) => updateWidget(sel.id, { measure: e.target.value })}
                  className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-[7px] text-[13.5px]"
                >
                  <option value="">—</option>
                  {measureOptions.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sort">
                <select
                  value={sel.sort}
                  onChange={(e) => updateWidget(sel.id, { sort: e.target.value as SortMode })}
                  className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-[7px] text-[13.5px]"
                >
                  <option value="natural">Sheet order</option>
                  <option value="desc">Highest first</option>
                  <option value="asc">Lowest first</option>
                </select>
              </Field>
              <Field label="Show top">
                <span className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={2}
                    max={12}
                    step={1}
                    value={sel.topN}
                    onChange={(e) => updateWidget(sel.id, { topN: Number(e.target.value) })}
                    className="flex-1"
                  />
                  <span className="font-mono-plex text-[12.5px] w-[18px] text-right">{sel.topN}</span>
                </span>
              </Field>
              {sel.type === "gauge" && (
                <Field label="Goal">
                  <input
                    type="number"
                    value={sel.target || ""}
                    onChange={(e) => updateWidget(sel.id, { target: Number(e.target.value) || 0 })}
                    placeholder="auto"
                    className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-[7px] text-[13.5px] w-full"
                  />
                </Field>
              )}
            </div>
          </Section>

          <Section label="Size">
            <div className="grid grid-cols-4 gap-1.5 mb-2.5">
              {SPAN_OPTIONS.map((n) => {
                const cs = chipStyle(sel.colSpan === n);
                return (
                  <button
                    key={n}
                    onClick={() =>
                      updateWidget(sel.id, {
                        colSpan: n,
                        col: Math.max(0, Math.min(GRID_COLS - n, sel.col)),
                      })
                    }
                    className="rounded-lg py-[7px] text-[12.5px] font-medium cursor-pointer border"
                    style={{ borderColor: cs.border, background: cs.bg, color: cs.fg }}
                  >
                    {n === 12 ? "Full" : `${n}/12`}
                  </button>
                );
              })}
            </div>
            <Field label="Height">
              <span className="flex items-center gap-2.5">
                <input
                  type="range"
                  min={120}
                  max={480}
                  step={10}
                  value={sel.height}
                  onChange={(e) => updateWidget(sel.id, { height: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="font-mono-plex text-[12.5px] w-[30px] text-right">{sel.height}</span>
              </span>
            </Field>
          </Section>

          <Section label="Palette">
            <div className="flex flex-col gap-1.5">
              {(Object.keys(PALETTES) as PaletteKey[]).map((k) => {
                const cs = chipStyle(sel.palette === k);
                return (
                  <button
                    key={k}
                    onClick={() => updateWidget(sel.id, { palette: k })}
                    className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] cursor-pointer border"
                    style={{ borderColor: cs.border, background: cs.bg }}
                  >
                    <span className="flex gap-[3px]">
                      {PALETTES[k].colors.slice(0, 5).map((c, i) => (
                        <span key={i} className="w-[13px] h-[13px] rounded-[3px] block" style={{ background: c }} />
                      ))}
                    </span>
                    <span className="text-[12.5px] text-[#55545c]">{PALETTES[k].label}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section label="Type">
            <Field label="Text size">
              <span className="flex items-center gap-2.5">
                <input
                  type="range"
                  min={0.8}
                  max={1.6}
                  step={0.05}
                  value={sel.fontScale}
                  onChange={(e) => updateWidget(sel.id, { fontScale: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="font-mono-plex text-[12.5px] w-[30px] text-right">{Math.round(sel.fontScale * 100)}%</span>
              </span>
            </Field>
            <div className="flex gap-1.5 mt-2.5">
              {FONT_OPTIONS.map((f) => {
                const cs = chipStyle(sel.font === f.key);
                return (
                  <button
                    key={f.key}
                    onClick={() => updateWidget(sel.id, { font: f.key })}
                    className="flex-1 rounded-lg py-2 text-[12.5px] font-medium cursor-pointer border"
                    style={{ borderColor: cs.border, background: cs.bg, color: cs.fg, fontFamily: f.family }}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </Section>

          <div className="flex gap-2">
            <button
              onClick={() => duplicateWidget(sel.id)}
              className="flex-1 border border-[rgba(23,22,26,0.16)] bg-[#fdfcfa] rounded-[9px] py-2.5 text-[13px] cursor-pointer hover:border-[#2b4bff]"
            >
              Duplicate
            </button>
            <button
              onClick={() => removeWidget(sel.id)}
              className="flex-1 border border-[rgba(217,58,32,0.3)] bg-[rgba(255,92,70,0.08)] text-[#c0341c] rounded-[9px] py-2.5 text-[13px] cursor-pointer hover:bg-[rgba(255,92,70,0.16)]"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] tracking-[0.08em] uppercase text-[#8a8990] font-semibold mb-2.5">{label}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 items-center text-[13px] text-[#55545c]" style={{ gridTemplateColumns: "74px 1fr" }}>
      {label}
      {children}
    </label>
  );
}
