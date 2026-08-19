"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_REFRESH_INTERVAL_SEC, selectActiveDataset, useAppStore } from "./store";

/** Polls one linked dataset. Pass a datasetId to sync a sheet other than the active one. */
export function useAutoRefresh(datasetId?: string) {
  const dataset = useAppStore((s) =>
    datasetId ? s.datasets.find((d) => d.id === datasetId) ?? null : selectActiveDataset(s)
  );
  const refreshFromSource = useAppStore((s) => s.refreshFromSource);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const id = dataset?.id;
  const sourceUrl = dataset?.sourceUrl;
  const autoRefresh = dataset?.autoRefresh;
  const refreshIntervalSec = dataset?.refreshIntervalSec;

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!id || !sourceUrl || !autoRefresh) return;
    const sec = Math.max(10, refreshIntervalSec || DEFAULT_REFRESH_INTERVAL_SEC);
    timerRef.current = setInterval(() => {
      refreshFromSource(id);
    }, sec * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [id, sourceUrl, autoRefresh, refreshIntervalSec, refreshFromSource]);
}
