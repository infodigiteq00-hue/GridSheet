"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { confidenceLabel, KIND_LABEL } from "@/lib/relationships";
import { Dataset, Relationship } from "@/lib/types";
import RelationshipGraph from "./RelationshipGraph";

interface Props {
  /** "compact" trims the copy and the manual-link form for inline placements. */
  variant?: "full" | "compact";
  showHeader?: boolean;
}

function confidenceColor(confidence: number): { fg: string; bg: string; border: string } {
  if (confidence >= 0.85) return { fg: "#00806f", bg: "rgba(0,166,166,0.1)", border: "rgba(0,166,166,0.32)" };
  if (confidence >= 0.65) return { fg: "#1a2fb8", bg: "#e5e9ff", border: "rgba(43,75,255,0.3)" };
  return { fg: "#6b6a71", bg: "#f0eee8", border: "rgba(23,22,26,0.14)" };
}

export default function RelationshipsPanel({ variant = "full", showHeader = true }: Props) {
  const datasets = useAppStore((s) => s.datasets);
  const detected = useAppStore((s) => s.relationships);
  const manual = useAppStore((s) => s.manualRelationships);
  const status = useAppStore((s) => s.relationshipStatus);
  const setRelationshipStatus = useAppStore((s) => s.setRelationshipStatus);
  const removeManualRelationship = useAppStore((s) => s.removeManualRelationship);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const { active, dismissed } = useMemo(() => {
    const manualIds = new Set(manual.map((r) => r.id));
    const all = [...manual, ...detected.filter((r) => !manualIds.has(r.id))];
    const rank = (r: Relationship) => (status[r.id] === "confirmed" ? 1 : 0);
    const sorted = all.slice().sort((a, b) => rank(b) - rank(a) || b.confidence - a.confidence);
    return {
      active: sorted.filter((r) => status[r.id] !== "dismissed"),
      dismissed: sorted.filter((r) => status[r.id] === "dismissed"),
    };
  }, [detected, manual, status]);

  const confirmedIds = useMemo(
    () => new Set(active.filter((r) => status[r.id] === "confirmed").map((r) => r.id)),
    [active, status]
  );

  const byId = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets]);
  const label = (id: string) => byId.get(id)?.label ?? "Unknown sheet";

  if (datasets.length < 2) {
    return (
      <section data-testid="relationships-panel">
        {showHeader && <PanelHeader count={0} variant={variant} />}
        <div
          data-testid="relationships-empty"
          className="border border-[rgba(23,22,26,0.1)] bg-[#fdfcfa] rounded-2xl px-7 py-9 text-center"
        >
          <div className="font-display text-[17px] font-semibold tracking-[-0.02em] mb-1.5">
            {datasets.length === 0 ? "No sheets imported yet" : "Only one sheet so far"}
          </div>
          <div className="text-sm text-[#6b6a71] leading-[1.55] max-w-[460px] mx-auto">
            Connections appear once you have at least two sheets. Import a multi-tab workbook, or add another
            file or link — every tab becomes its own sheet.{" "}
            <Link href="/upload" className="text-[#2b4bff] hover:text-[#1a2fb8]">
              Import a spreadsheet
            </Link>
            .
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="relationships-panel">
      {showHeader && <PanelHeader count={active.length} variant={variant} />}

      <div className="border border-[rgba(23,22,26,0.1)] bg-[#f7f5f1] rounded-2xl overflow-hidden mb-3.5">
        <div className="px-[18px] py-3 border-b border-[rgba(23,22,26,0.08)] bg-[#fdfcfa] flex items-center gap-2.5 flex-wrap">
          <div className="text-[11.5px] tracking-[0.06em] uppercase text-[#7a7981] font-semibold">Schema map</div>
          <div className="flex-1" />
          <div className="font-mono-plex text-[11.5px] text-[#8a8990]">
            {datasets.length} sheets · {active.length} connections
          </div>
        </div>
        <div className="px-3 py-2">
          <RelationshipGraph
            datasets={datasets}
            relationships={active}
            confirmedIds={confirmedIds}
            highlightId={highlightId}
            onHighlight={setHighlightId}
          />
        </div>
      </div>

      {active.length === 0 && (
        <div
          data-testid="relationships-empty"
          className="border border-[rgba(23,22,26,0.1)] bg-[#fdfcfa] rounded-2xl px-7 py-8 text-center"
        >
          <div className="font-display text-[17px] font-semibold tracking-[-0.02em] mb-1.5">
            No connections found between these sheets
          </div>
          <div className="text-sm text-[#6b6a71] leading-[1.55] max-w-[520px] mx-auto">
            We compared every pair of columns and none of them shared enough values to look like a shared key. If
            you know two columns line up, link them by hand below.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {active.map((rel) => (
          <RelationshipCard
            key={rel.id}
            rel={rel}
            fromLabel={label(rel.fromDatasetId)}
            toLabel={label(rel.toDatasetId)}
            status={status[rel.id]}
            highlighted={highlightId === rel.id}
            onHover={setHighlightId}
            onConfirm={() => setRelationshipStatus(rel.id, status[rel.id] === "confirmed" ? null : "confirmed")}
            onDismiss={() =>
              rel.origin === "manual" ? removeManualRelationship(rel.id) : setRelationshipStatus(rel.id, "dismissed")
            }
          />
        ))}
      </div>

      {dismissed.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] tracking-[0.08em] uppercase text-[#8a8990] font-semibold mb-2">
            Dismissed ({dismissed.length})
          </div>
          <div className="flex flex-col gap-1.5">
            {dismissed.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center gap-2.5 flex-wrap border border-[rgba(23,22,26,0.08)] bg-[#f7f5f1] rounded-[10px] px-3 py-2"
              >
                <span className="font-mono-plex text-[12.5px] text-[#8a8990]">
                  {label(rel.fromDatasetId)}.{rel.fromColumn} → {label(rel.toDatasetId)}.{rel.toColumn}
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => setRelationshipStatus(rel.id, null)}
                  className="text-[12.5px] text-[#2b4bff] hover:text-[#1a2fb8] font-medium cursor-pointer"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "full" && <ManualLinkForm datasets={datasets} />}
    </section>
  );
}

function PanelHeader({ count, variant }: { count: number; variant: "full" | "compact" }) {
  return (
    <div className="flex items-end gap-3 flex-wrap mb-3.5">
      <div>
        <div className="flex items-center gap-2.5">
          <h3
            className={`font-display font-bold tracking-[-0.025em] ${variant === "full" ? "text-[26px]" : "text-[20px]"}`}
          >
            Connections
          </h3>
          {count > 0 && (
            <span className="font-mono-plex text-[11.5px] text-[#1a2fb8] bg-[#e5e9ff] px-2 py-[3px] rounded-full">
              {count} found
            </span>
          )}
        </div>
        <p className="text-[13.5px] text-[#6b6a71] mt-1 leading-[1.5] max-w-[620px]">
          Columns that share values across sheets — the shape of how your data joins together.
        </p>
      </div>
    </div>
  );
}

function RelationshipCard({
  rel,
  fromLabel,
  toLabel,
  status,
  highlighted,
  onHover,
  onConfirm,
  onDismiss,
}: {
  rel: Relationship;
  fromLabel: string;
  toLabel: string;
  status?: "confirmed" | "dismissed";
  highlighted: boolean;
  onHover: (id: string | null) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const cc = confidenceColor(rel.confidence);
  const confirmed = status === "confirmed";

  return (
    <div
      data-testid="relationship-card"
      data-relationship={`${fromLabel}.${rel.fromColumn}->${toLabel}.${rel.toColumn}`}
      onMouseEnter={() => onHover(rel.id)}
      onMouseLeave={() => onHover(null)}
      className="bg-[#fdfcfa] rounded-[14px] px-[18px] py-[15px] transition-[border-color,box-shadow]"
      style={{
        border: `1px solid ${highlighted || confirmed ? "#2b4bff" : "rgba(23,22,26,0.1)"}`,
        boxShadow: highlighted ? "0 0 0 3px rgba(43,75,255,0.12)" : "none",
      }}
    >
      <div className="flex items-center gap-2.5 flex-wrap mb-2">
        <span className="font-mono-plex text-[13.5px] text-[#17161a]">
          <span className="font-semibold">{fromLabel}</span>.{rel.fromColumn}
        </span>
        <span className="text-[#2b4bff] text-[15px] leading-none">→</span>
        <span className="font-mono-plex text-[13.5px] text-[#17161a]">
          <span className="font-semibold">{toLabel}</span>.{rel.toColumn}
        </span>
        <div className="flex-1" />
        <span
          className="text-[11.5px] font-semibold px-2 py-[3px] rounded-full whitespace-nowrap"
          style={{ color: cc.fg, background: cc.bg, border: `1px solid ${cc.border}` }}
        >
          {rel.origin === "manual" ? "Manual" : `${confidenceLabel(rel.confidence)} · ${Math.round(rel.confidence * 100)}%`}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <span className="text-[11.5px] text-[#55545c] bg-[#f0eee8] border border-[rgba(23,22,26,0.1)] px-2 py-[3px] rounded-[6px]">
          {KIND_LABEL[rel.kind]}
        </span>
        {confirmed && (
          <span className="text-[11.5px] font-medium text-[#1a2fb8] bg-[#e5e9ff] px-2 py-[3px] rounded-[6px]">
            ✓ Confirmed
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1 mb-3">
        {rel.evidence.map((line, i) => (
          <li key={i} className="text-[12.5px] text-[#6b6a71] leading-[1.5] flex gap-2">
            <span className="text-[#a3a2a9] flex-none">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="border rounded-[8px] px-3 py-[7px] text-[12.5px] font-medium cursor-pointer"
          style={{
            borderColor: confirmed ? "#2b4bff" : "rgba(23,22,26,0.16)",
            background: confirmed ? "#e5e9ff" : "#fdfcfa",
            color: confirmed ? "#1a2fb8" : "#4a4952",
          }}
        >
          {confirmed ? "Confirmed" : "Confirm"}
        </button>
        <button
          onClick={onDismiss}
          className="border border-[rgba(23,22,26,0.16)] bg-[#fdfcfa] rounded-[8px] px-3 py-[7px] text-[12.5px] text-[#4a4952] cursor-pointer hover:border-[rgba(217,58,32,0.4)] hover:text-[#c0341c]"
        >
          {rel.origin === "manual" ? "Remove" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}

function ManualLinkForm({ datasets }: { datasets: Dataset[] }) {
  const addManualRelationship = useAppStore((s) => s.addManualRelationship);
  const [open, setOpen] = useState(false);
  const [fromDatasetId, setFromDatasetId] = useState(datasets[0]?.id ?? "");
  const [fromColumn, setFromColumn] = useState("");
  const [toDatasetId, setToDatasetId] = useState(datasets[1]?.id ?? "");
  const [toColumn, setToColumn] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fromColumns = datasets.find((d) => d.id === fromDatasetId)?.columns ?? [];
  const toColumns = datasets.find((d) => d.id === toDatasetId)?.columns ?? [];

  function submit() {
    setError(null);
    if (!fromColumn || !toColumn) {
      setError("Pick a column on both sides.");
      return;
    }
    const ok = addManualRelationship({ fromDatasetId, fromColumn, toDatasetId, toColumn });
    if (!ok) {
      setError("Those two columns can't be linked — pick two different sheets.");
      return;
    }
    setFromColumn("");
    setToColumn("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 border border-[rgba(23,22,26,0.16)] bg-[#fdfcfa] rounded-[10px] px-4 py-2.5 text-[13px] font-medium cursor-pointer hover:border-[#2b4bff]"
      >
        + Link two columns by hand
      </button>
    );
  }

  return (
    <div className="mt-4 border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-2xl p-[18px]">
      <div className="font-display text-[15px] font-semibold tracking-[-0.015em] mb-3">Link two columns by hand</div>
      <div className="grid gap-2.5 items-end" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] tracking-[0.06em] uppercase text-[#8a8990] font-semibold">From</span>
          <select
            value={fromDatasetId}
            onChange={(e) => {
              setFromDatasetId(e.target.value);
              setFromColumn("");
            }}
            className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-2 text-[13px]"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <select
            value={fromColumn}
            onChange={(e) => setFromColumn(e.target.value)}
            className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-2 text-[13px]"
          >
            <option value="">Choose a column…</option>
            {fromColumns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] tracking-[0.06em] uppercase text-[#8a8990] font-semibold">To</span>
          <select
            value={toDatasetId}
            onChange={(e) => {
              setToDatasetId(e.target.value);
              setToColumn("");
            }}
            className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-2 text-[13px]"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <select
            value={toColumn}
            onChange={(e) => setToColumn(e.target.value)}
            className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-lg px-2.5 py-2 text-[13px]"
          >
            <option value="">Choose a column…</option>
            {toColumns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={submit}
            className="border-0 bg-[#17161a] text-[#f8f7f4] rounded-[9px] px-4 py-2 text-[13px] font-semibold cursor-pointer"
          >
            Link
          </button>
          <button
            onClick={() => setOpen(false)}
            className="border border-[rgba(23,22,26,0.16)] bg-transparent rounded-[9px] px-3 py-2 text-[13px] cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
      {error && <div className="mt-2.5 text-[13px] text-[#c0341c]">{error}</div>}
    </div>
  );
}
