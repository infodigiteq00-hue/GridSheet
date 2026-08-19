"use client";

import { useMemo, useState } from "react";
import { useAppStore, useVisibleRelationships } from "@/lib/store";
import RelationshipsPanel from "@/components/relationships/RelationshipsPanel";

/**
 * Sheet switcher for the builder sidebar, plus the Connections drawer. Lives in
 * the palette so the builder page itself stays untouched.
 */
export default function DataPanel() {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const setActiveDatasetId = useAppStore((s) => s.setActiveDatasetId);
  const relationships = useVisibleRelationships();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeId = datasets.some((d) => d.id === activeDatasetId) ? activeDatasetId : datasets[0]?.id;

  const relatedCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rel of relationships) {
      counts.set(rel.fromDatasetId, (counts.get(rel.fromDatasetId) || 0) + 1);
      counts.set(rel.toDatasetId, (counts.get(rel.toDatasetId) || 0) + 1);
    }
    return counts;
  }, [relationships]);

  if (datasets.length === 0) return null;

  return (
    <>
      <div className="text-[11px] tracking-[0.08em] uppercase text-[#8a8990] font-semibold px-1.5 pb-2">
        Sheets ({datasets.length})
      </div>
      <div className="flex flex-col gap-1 pb-2.5" data-testid="sheet-switcher">
        {datasets.map((d) => {
          const active = d.id === activeId;
          const links = relatedCount.get(d.id) || 0;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDatasetId(d.id)}
              data-testid="sheet-switcher-item"
              data-dataset-label={d.label}
              data-active={active ? "true" : "false"}
              title={`${d.label} — ${d.rows.length} rows`}
              className="flex items-center gap-2 rounded-[9px] px-2.5 py-[7px] cursor-pointer text-left border transition-colors"
              style={{
                borderColor: active ? "#2b4bff" : "rgba(23,22,26,0.09)",
                background: active ? "#e5e9ff" : "#fdfcfa",
              }}
            >
              <span className="flex-1 min-w-0">
                <span
                  className="block text-[12.5px] font-medium truncate"
                  style={{ color: active ? "#1a2fb8" : "#17161a" }}
                >
                  {d.label}
                </span>
                <span className="block font-mono-plex text-[10.5px] text-[#8a8990]">
                  {d.rows.length.toLocaleString("en-US")} rows
                </span>
              </span>
              {links > 0 && (
                <span
                  className="font-mono-plex text-[10px] px-1.5 py-[2px] rounded-full flex-none"
                  style={{ background: "rgba(0,166,166,0.14)", color: "#00806f" }}
                  title={`${links} connection${links === 1 ? "" : "s"}`}
                >
                  {links}🔗
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => setDrawerOpen(true)}
        data-testid="open-connections-drawer"
        className="flex items-center gap-2 border rounded-[9px] px-2.5 py-2 cursor-pointer text-left text-[12.5px] font-medium mb-3 transition-colors"
        style={{
          borderColor: relationships.length ? "rgba(0,166,166,0.4)" : "rgba(23,22,26,0.09)",
          background: relationships.length ? "rgba(0,166,166,0.08)" : "#fdfcfa",
        }}
      >
        <span>🔗</span>
        <span className="flex-1">Connections</span>
        <span className="font-mono-plex text-[11px] text-[#00806f]">{relationships.length}</span>
      </button>

      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="fixed left-0 right-0 top-[62px] bottom-0 z-30 bg-[rgba(23,22,26,0.28)]"
          aria-hidden="true"
        />
      )}
      <div
        data-testid="connections-drawer"
        className="fixed left-0 top-[62px] bottom-0 z-40 flex flex-col bg-[#f7f5f1] border-r border-[rgba(23,22,26,0.1)] transition-transform duration-200 ease-out"
        style={{
          width: 460,
          maxWidth: "92vw",
          boxShadow: "18px 0 44px -30px rgba(23,22,26,0.6)",
          transform: drawerOpen ? "translateX(0)" : "translateX(-102%)",
          visibility: drawerOpen ? "visible" : "hidden",
        }}
        aria-hidden={!drawerOpen}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[rgba(23,22,26,0.08)] bg-[#fdfcfa]">
          <div className="font-display font-semibold text-[15px] tracking-[-0.015em]">🔗 How your sheets connect</div>
          <div className="flex-1" />
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close connections"
            className="border-0 bg-transparent text-[#a3a2a9] cursor-pointer text-[17px] leading-none px-1.5 py-1 rounded-[5px] hover:bg-[rgba(23,22,26,0.06)] hover:text-[#17161a]"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <RelationshipsPanel variant="compact" showHeader={false} />
        </div>
      </div>
    </>
  );
}
