"use client";

import { useCallback, useMemo } from "react";
import { ResolvedData, resolveWidgetData } from "./join";
import { useAppStore, useVisibleRelationships } from "./store";
import { Widget } from "./types";

function shapeKey(widget: Widget, activeDatasetId: string | null): string {
  const refKey = widget.dimRef ? `${widget.dimRef.relationshipId}:${widget.dimRef.column}` : "";
  return `${widget.datasetId ?? activeDatasetId ?? ""}|${refKey}`;
}

/**
 * Returns a resolver mapping a widget to the rows/columns it should render — its
 * own dataset, plus any single-hop related field it groups by. Tiles that read
 * the same sheet through the same relationship share one denormalized copy, so a
 * full board costs one join per distinct shape rather than one per tile.
 */
export function useWidgetDataResolver(): (widget: Widget) => ResolvedData {
  const datasets = useAppStore((s) => s.datasets);
  const activeDatasetId = useAppStore((s) => s.activeDatasetId);
  const widgets = useAppStore((s) => s.dashboard.widgets);
  const relationships = useVisibleRelationships();

  const byShape = useMemo(() => {
    const map = new Map<string, ResolvedData>();
    for (const widget of widgets) {
      const key = shapeKey(widget, activeDatasetId);
      if (map.has(key)) continue;
      map.set(key, resolveWidgetData(widget, datasets, relationships, activeDatasetId));
    }
    return map;
  }, [widgets, datasets, relationships, activeDatasetId]);

  return useCallback(
    (widget: Widget) =>
      byShape.get(shapeKey(widget, activeDatasetId)) ??
      resolveWidgetData(widget, datasets, relationships, activeDatasetId),
    [byShape, datasets, relationships, activeDatasetId]
  );
}
