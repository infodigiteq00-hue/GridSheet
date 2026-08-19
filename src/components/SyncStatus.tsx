"use client";

import { useEffect, useState } from "react";
import { selectActiveDataset, useAppStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

const INTERVALS = [
  { sec: 15, label: "15s" },
  { sec: 30, label: "30s" },
  { sec: 60, label: "1m" },
  { sec: 300, label: "5m" },
];

interface Props {
  compact?: boolean;
  /** Defaults to the active dataset. */
  datasetId?: string;
}

export default function SyncStatus({ compact = false, datasetId }: Props) {
  useAutoRefresh(datasetId);
  const dataset = useAppStore((s) =>
    datasetId ? s.datasets.find((d) => d.id === datasetId) ?? null : selectActiveDataset(s)
  );
  const refreshFromSource = useAppStore((s) => s.refreshFromSource);
  const setAutoRefresh = useAppStore((s) => s.setAutoRefresh);
  const setRefreshIntervalSec = useAppStore((s) => s.setRefreshIntervalSec);
  const detachSource = useAppStore((s) => s.detachSource);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  if (!dataset?.sourceUrl) return null;
  const id = dataset.id;

  return (
    <div className="flex items-center gap-2.5 flex-wrap text-[12.5px]">
      <span className="flex items-center gap-1.5 font-medium" style={{ color: dataset.syncError ? "#c0341c" : "#00806f" }}>
        <span
          className="w-[7px] h-[7px] rounded-full"
          style={{ background: dataset.syncError ? "#ff5c46" : "#00a6a6" }}
        />
        {dataset.syncError ? "Sync failed" : dataset.syncing ? "Syncing…" : dataset.autoRefresh ? "Live" : "Linked"}
      </span>
      {!compact && (
        <span className="text-[#8a8990] font-mono-plex">
          {dataset.lastSyncedAt ? `synced ${timeAgo(dataset.lastSyncedAt)}` : "not synced yet"}
        </span>
      )}
      <button
        onClick={() => refreshFromSource(id)}
        disabled={dataset.syncing}
        className="text-[#2b4bff] hover:text-[#1a2fb8] font-medium cursor-pointer disabled:opacity-50"
      >
        Refresh now
      </button>
      {!compact && (
        <>
          <label className="flex items-center gap-1.5 text-[#55545c]">
            <input
              type="checkbox"
              checked={!!dataset.autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked, id)}
            />
            Auto every
          </label>
          <select
            value={dataset.refreshIntervalSec || 60}
            onChange={(e) => setRefreshIntervalSec(Number(e.target.value), id)}
            className="border border-[rgba(23,22,26,0.14)] bg-[#fdfcfa] rounded-md px-1.5 py-1 text-[12px]"
          >
            {INTERVALS.map((i) => (
              <option key={i.sec} value={i.sec}>
                {i.label}
              </option>
            ))}
          </select>
          <button onClick={() => detachSource(id)} className="text-[#8a8990] hover:text-[#c0341c] cursor-pointer">
            Stop syncing
          </button>
        </>
      )}
      {dataset.syncError && <span className="text-[#c0341c]">{dataset.syncError}</span>}
    </div>
  );
}
