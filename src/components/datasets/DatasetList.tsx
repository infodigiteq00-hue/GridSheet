"use client";

import { useAppStore } from "@/lib/store";
import SyncStatus from "@/components/SyncStatus";

/** All imported sheets, with the active one highlighted. Used on full-width pages. */
export default function DatasetList({ onAddMore }: { onAddMore?: () => void }) {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const setActiveDatasetId = useAppStore((s) => s.setActiveDatasetId);
  const removeDataset = useAppStore((s) => s.removeDataset);

  if (datasets.length === 0) return null;
  const activeId = datasets.some((d) => d.id === activeDatasetId) ? activeDatasetId : datasets[0]?.id;

  return (
    <div data-testid="dataset-list" className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="text-[11px] tracking-[0.08em] uppercase text-[#8a8990] font-semibold">
          Imported sheets ({datasets.length})
        </div>
        <div className="flex-1" />
        {onAddMore && (
          <button
            onClick={onAddMore}
            className="text-[12.5px] font-medium text-[#2b4bff] hover:text-[#1a2fb8] cursor-pointer"
          >
            + Add another file or link
          </button>
        )}
      </div>

      {datasets.map((d) => {
        const active = d.id === activeId;
        return (
          <div
            key={d.id}
            data-testid="dataset-row"
            data-dataset-label={d.label}
            data-active={active ? "true" : "false"}
            className="flex items-center gap-3.5 bg-[#fdfcfa] rounded-[14px] px-[18px] py-[13px] transition-[border-color,box-shadow]"
            style={{
              border: `1px solid ${active ? "#2b4bff" : "rgba(23,22,26,0.1)"}`,
              boxShadow: active ? "0 0 0 3px rgba(43,75,255,0.1)" : "none",
            }}
          >
            <div
              className="w-9 h-9 rounded-[9px] grid place-items-center font-mono-plex text-[10.5px] flex-none"
              style={{
                background: active ? "#17161a" : "#eae7e0",
                color: active ? "#f3f1ec" : "#4a4952",
              }}
            >
              {d.sourceUrl ? "URL" : (d.fileName.split(".").pop() || "TAB").toUpperCase().slice(0, 3)}
            </div>
            <button
              onClick={() => setActiveDatasetId(d.id)}
              className="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer"
            >
              <div className="font-semibold text-[15px] tracking-[-0.01em] truncate">{d.label}</div>
              <div className="text-[12.5px] text-[#7a7981] font-mono-plex truncate">
                {d.rows.length.toLocaleString("en-IN")} rows · {d.columns.length} columns · {d.fileName}
              </div>
            </button>
            {d.sourceUrl ? (
              <SyncStatus compact datasetId={d.id} />
            ) : (
              <span className="flex items-center gap-1.5 text-[12.5px] text-[#00806f] font-medium flex-none">
                <span className="w-[7px] h-[7px] rounded-full bg-[#00a6a6]" />
                Parsed
              </span>
            )}
            {active ? (
              <span className="text-[11.5px] font-semibold text-[#1a2fb8] bg-[#e5e9ff] px-2 py-[3px] rounded-full flex-none">
                Editing
              </span>
            ) : (
              <button
                onClick={() => setActiveDatasetId(d.id)}
                className="text-[12.5px] text-[#2b4bff] hover:text-[#1a2fb8] font-medium cursor-pointer flex-none"
              >
                Edit this
              </button>
            )}
            <button
              onClick={() => removeDataset(d.id)}
              aria-label={`Remove ${d.label}`}
              className="border-0 bg-transparent text-[#a3a2a9] cursor-pointer text-[16px] leading-none px-1.5 py-1 rounded-[6px] hover:bg-[rgba(255,92,70,0.14)] hover:text-[#d93a20] flex-none"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
