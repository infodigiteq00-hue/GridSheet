"use client";

import { useMemo } from "react";
import { DatasetContext } from "./aiClient";
import { relationshipEndpoints } from "./relationships";
import { selectActiveDataset, useAppStore, useVisibleRelationships } from "./store";

/** Names the active sheet and the sheets it joins to, for the narrative/chat routes. */
export function useAiDatasetContext(): DatasetContext | undefined {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const relationships = useVisibleRelationships();

  return useMemo(() => {
    const active = selectActiveDataset({ datasets, activeDatasetId });
    if (!active) return undefined;
    const relatedSheets = relationships
      .filter((r) => r.fromDatasetId === active.id || r.toDatasetId === active.id)
      .map((r) => {
        const { localColumn, otherDatasetId, otherColumn } = relationshipEndpoints(r, active.id);
        const other = datasets.find((d) => d.id === otherDatasetId);
        return other ? { label: other.label, viaColumn: localColumn, toColumn: otherColumn } : null;
      })
      .filter((x): x is { label: string; viaColumn: string; toColumn: string } => !!x);
    return { sheetLabel: active.label, relatedSheets };
  }, [datasets, activeDatasetId, relationships]);
}
