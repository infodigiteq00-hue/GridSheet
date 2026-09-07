"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { browserStateStorage, readHistoryRecord, removeHistoryRecord, saveHistoryRecord } from "./browserStateStorage";
import { defaultWidgetForType } from "./heuristicLayout";
import { asBox, compactAround, constrainBox, findOpenSlot, nearestFree, withPositions } from "./gridLayout";
import { newDatasetId, newId } from "./id";
import { mergeColumns } from "./inferColumns";
import { buildManualRelationship, detectRelationships } from "./relationships";
import {
  ColumnMeta,
  ColumnRole,
  DataHistoryEntry,
  DataHistorySnapshot,
  Dataset,
  DatasetInput,
  DashboardState,
  Relationship,
  RelationshipStatus,
  Row,
  Widget,
  WidgetType,
} from "./types";

export type LayoutSource = "ai" | "heuristic" | null;

export const DEFAULT_REFRESH_INTERVAL_SEC = 60;
// Layout normalization is part of the persisted state contract. Bump this
// whenever the collision repair rules change so existing boards are repaired
// instead of continuing to render stale overlapping coordinates.
export const STORE_VERSION = 6;

export type { DatasetInput };

export interface SheetPayload {
  sheetName: string;
  rows: Row[];
  columns: ColumnMeta[];
}

interface AppState {
  hasHydrated: boolean;
  datasets: Dataset[];
  activeDatasetId: string | null;
  /** Recomputed from `datasets`; user decisions live in `relationshipStatus`. */
  relationships: Relationship[];
  relationshipStatus: Record<string, RelationshipStatus>;
  manualRelationships: Relationship[];
  history: DataHistoryEntry[];
  currentHistoryId: string | null;
  dashboard: DashboardState;
  selectedId: string | null;
  layoutSource: LayoutSource;

  setHasHydrated: (v: boolean) => void;

  addDatasets: (inputs: DatasetInput[]) => string[];
  removeDataset: (id: string) => void;
  clearAllDatasets: () => void;
  setActiveDatasetId: (id: string) => void;
  setColumnRole: (name: string, role: ColumnRole, datasetId?: string) => void;

  setDashboard: (dashboard: DashboardState, source?: LayoutSource, datasetId?: string) => void;
  setBoardTitle: (title: string) => void;
  addWidget: (type: WidgetType) => void;
  addCustomWidget: (widget: Widget) => void;
  updateWidget: (id: string, patch: Partial<Widget>) => void;
  resizeWidget: (id: string, patch: Pick<Widget, "colSpan" | "height"> & Partial<Pick<Widget, "col" | "row">>) => void;
  compactDashboard: () => void;
  saveHistorySnapshot: () => void;
  restoreHistorySnapshot: (id: string) => Promise<boolean>;
  removeHistorySnapshot: (id: string) => void;
  removeWidget: (id: string) => void;
  duplicateWidget: (id: string) => void;
  reorderWidgets: (fromId: string, toId: string) => void;
  setWidgetOrder: (ids: string[]) => void;
  select: (id: string | null) => void;

  attachSource: (opts: { url: string; fileName: string; sheets: SheetPayload[] }) => string[];
  refreshFromSource: (datasetId?: string) => Promise<void>;
  detachSource: (datasetId?: string) => void;
  setAutoRefresh: (v: boolean, datasetId?: string) => void;
  setRefreshIntervalSec: (sec: number, datasetId?: string) => void;

  recomputeRelationships: () => void;
  setRelationshipStatus: (id: string, status: RelationshipStatus | null) => void;
  addManualRelationship: (opts: {
    fromDatasetId: string;
    fromColumn: string;
    toDatasetId: string;
    toColumn: string;
  }) => boolean;
  removeManualRelationship: (id: string) => void;
}

const emptyDashboard: DashboardState = { boardTitle: "Untitled dashboard", widgets: [] };

/* ---------------------------------------------------------------- selectors */

export function selectActiveDataset(s: {
  datasets: Dataset[];
  activeDatasetId: string | null;
}): Dataset | null {
  return s.datasets.find((d) => d.id === s.activeDatasetId) ?? s.datasets[0] ?? null;
}

export function useActiveDataset(): Dataset | null {
  return useAppStore(selectActiveDataset);
}

/** Detected + manual links, minus anything the user dismissed. */
export function selectVisibleRelationships(s: {
  relationships: Relationship[];
  manualRelationships: Relationship[];
  relationshipStatus: Record<string, RelationshipStatus>;
}): Relationship[] {
  const manualIds = new Set(s.manualRelationships.map((r) => r.id));
  return [...s.manualRelationships, ...s.relationships.filter((r) => !manualIds.has(r.id))].filter(
    (r) => s.relationshipStatus[r.id] !== "dismissed"
  );
}

/**
 * Memoized because `selectVisibleRelationships` builds a fresh array — passing it
 * straight to `useAppStore` would break zustand's snapshot caching.
 */
export function useVisibleRelationships(): Relationship[] {
  const relationships = useAppStore((s) => s.relationships);
  const manualRelationships = useAppStore((s) => s.manualRelationships);
  const relationshipStatus = useAppStore((s) => s.relationshipStatus);
  return useMemo(
    () => selectVisibleRelationships({ relationships, manualRelationships, relationshipStatus }),
    [relationships, manualRelationships, relationshipStatus]
  );
}

/* ------------------------------------------------------------------ helpers */

function deriveLabel(input: { sheetName?: string; fileName?: string; label?: string }): string {
  const sheet = (input.sheetName || "").trim();
  const generic = /^sheet\s*\d*$/i.test(sheet) || sheet === "";
  if (input.label?.trim()) return input.label.trim();
  if (!generic) return sheet;
  const base = (input.fileName || "Sheet")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return base || sheet || "Sheet";
}

function uniqueLabel(desired: string, taken: Set<string>): string {
  if (!taken.has(desired)) return desired;
  let n = 2;
  while (taken.has(`${desired} (${n})`)) n += 1;
  return `${desired} (${n})`;
}

function materialize(inputs: DatasetInput[], existing: Dataset[]): Dataset[] {
  const taken = new Set(existing.map((d) => d.label));
  return inputs.map((input) => {
    const label = uniqueLabel(deriveLabel(input), taken);
    taken.add(label);
    return { ...input, id: newDatasetId(), label };
  });
}

function withRelationships(datasets: Dataset[]): { datasets: Dataset[]; relationships: Relationship[] } {
  return { datasets, relationships: detectRelationships(datasets) };
}

function persistedSnapshot(state: AppState): PersistedShape {
  // Full row data is retained in IndexedDB, so dashboards remain usable after
  // a reload even when the source workbook is larger than localStorage allows.
  return {
    datasets: state.datasets,
    activeDatasetId: state.activeDatasetId,
    dashboard: state.dashboard,
    layoutSource: state.layoutSource,
    relationshipStatus: state.relationshipStatus,
    manualRelationships: state.manualRelationships,
    history: state.history,
    currentHistoryId: state.currentHistoryId,
  };
}

function historyTitle(datasets: Dataset[], dashboard: DashboardState): string {
  if (dashboard.boardTitle && dashboard.boardTitle !== emptyDashboard.boardTitle) return dashboard.boardTitle;
  const names = [...new Set(datasets.map((dataset) => dataset.fileName.replace(/\.[^.]+$/, "")))];
  return names.length === 1 ? names[0] : names[0] ? `${names[0]} + ${names.length - 1} more` : "Imported data";
}

function historyEntry(state: AppState, id: string, createdAt = Date.now()): DataHistoryEntry {
  return {
    id,
    title: historyTitle(state.datasets, state.dashboard),
    createdAt,
    sheetCount: state.datasets.length,
    rowCount: state.datasets.reduce((total, dataset) => total + dataset.rows.length, 0),
    fileNames: [...new Set(state.datasets.map((dataset) => dataset.fileName))],
  };
}

function historySnapshot(state: AppState, entry: DataHistoryEntry): DataHistorySnapshot {
  return {
    ...entry,
    datasets: state.datasets,
    activeDatasetId: state.activeDatasetId,
    dashboard: state.dashboard,
    layoutSource: state.layoutSource,
    relationshipStatus: state.relationshipStatus,
    manualRelationships: state.manualRelationships,
  };
}

/* -------------------------------------------------------------------- store */

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      datasets: [],
      activeDatasetId: null,
      relationships: [],
      relationshipStatus: {},
      manualRelationships: [],
      history: [],
      currentHistoryId: null,
      dashboard: emptyDashboard,
      selectedId: null,
      layoutSource: null,

      setHasHydrated: (v) => set({ hasHydrated: v }),

      addDatasets: (inputs) => {
        if (inputs.length === 0) return [];
        const created = materialize(inputs, get().datasets);
        set((s) => {
          const datasets = [...s.datasets, ...created];
          return {
            ...withRelationships(datasets),
            activeDatasetId: s.activeDatasetId ?? created[0].id,
          };
        });
        // A multi-sheet upload arrives as one input batch, so it becomes one
        // restorable history item rather than a separate entry per worksheet.
        // Reuse the in-progress workspace's existing history id (if any) so
        // "Add another sheet" updates that entry instead of forking a new
        // one — saveHistorySnapshot already falls back to a fresh id when
        // there is no current workspace yet.
        if (created.some((dataset) => !dataset.isSample)) {
          get().saveHistorySnapshot();
        }
        return created.map((d) => d.id);
      },

      removeDataset: (id) =>
        set((s) => {
          const datasets = s.datasets.filter((d) => d.id !== id);
          const activeDatasetId = s.activeDatasetId === id ? datasets[0]?.id ?? null : s.activeDatasetId;
          const widgets = s.dashboard.widgets.map((w) => {
            const next: Widget = { ...w };
            if (next.datasetId === id) next.datasetId = activeDatasetId ?? undefined;
            if (next.dimRef?.datasetId === id) {
              next.dimRef = undefined;
              next.dim = "";
            }
            return next;
          });
          return {
            ...withRelationships(datasets),
            activeDatasetId,
            dashboard: { ...s.dashboard, widgets },
            manualRelationships: s.manualRelationships.filter(
              (r) => r.fromDatasetId !== id && r.toDatasetId !== id
            ),
          };
        }),

      clearAllDatasets: () =>
        set({
          datasets: [],
          activeDatasetId: null,
          relationships: [],
          manualRelationships: [],
          relationshipStatus: {},
          dashboard: emptyDashboard,
          selectedId: null,
          layoutSource: null,
          // Start over clears the active workspace, not the saved local
          // history. A past upload can still be reopened from History.
          currentHistoryId: null,
        }),

      setActiveDatasetId: (id) => set((s) => (s.datasets.some((d) => d.id === id) ? { activeDatasetId: id } : s)),

      setColumnRole: (name, role, datasetId) =>
        set((s) => {
          const targetId = datasetId ?? selectActiveDataset(s)?.id;
          if (!targetId) return s;
          return {
            datasets: s.datasets.map((d) =>
              d.id === targetId
                ? { ...d, columns: d.columns.map((c) => (c.name === name ? { ...c, role } : c)) }
                : d
            ),
          };
        }),

      setDashboard: (dashboard, source = null, datasetId) => {
        set((s) => {
          const boundId = datasetId ?? selectActiveDataset(s)?.id;
          const widgets = withPositions(
            dashboard.widgets.map((w) => (w.datasetId ? w : { ...w, datasetId: boundId }))
          );
          return {
            dashboard: { ...dashboard, widgets },
            selectedId: null,
            layoutSource: source,
          };
        });
        // A freshly created dashboard completes the current import's saved
        // snapshot, so reopening it restores both data and its dashboard.
        if (get().datasets.length > 0) get().saveHistorySnapshot();
      },

      setBoardTitle: (title) => set((s) => ({ dashboard: { ...s.dashboard, boardTitle: title } })),

      addWidget: (type) => {
        const active = selectActiveDataset(get());
        const w = defaultWidgetForType(type, active?.columns || []);
        w.title = w.title || "";
        w.datasetId = active?.id;
        set((s) => {
          const others = s.dashboard.widgets.map(asBox);
          const slot = findOpenSlot(asBox(w), others);
          const placed = { ...w, col: slot.col, row: slot.row };
          return { dashboard: { ...s.dashboard, widgets: [...s.dashboard.widgets, placed] }, selectedId: placed.id };
        });
      },

      addCustomWidget: (widget) =>
        set((s) => {
          const bound: Widget = widget.datasetId
            ? widget
            : { ...widget, datasetId: selectActiveDataset(s)?.id };
          const others = s.dashboard.widgets.map(asBox);
          const slot = findOpenSlot(asBox(bound), others);
          const placed = { ...bound, col: slot.col, row: slot.row };
          return { dashboard: { ...s.dashboard, widgets: [...s.dashboard.widgets, placed] }, selectedId: placed.id };
        }),

      updateWidget: (id, patch) =>
        set((s) => {
          const current = s.dashboard.widgets.find((w) => w.id === id);
          if (!current) return s;
          const next = { ...current, ...patch };
          const sizeChanged = "colSpan" in patch || "height" in patch;
          const positionChanged = "col" in patch || "row" in patch;

          // Inspector controls and AI tile edits change size via updateWidget,
          // not the pointer-resize action. Give them the exact same anchored
          // compaction behavior so a smaller tile cannot leave a dead gap.
          if (sizeChanged) {
            const resizedBox = asBox(next);
            const others = s.dashboard.widgets.filter((w) => w.id !== id).map(asBox);
            const reflowed = compactAround(resizedBox, others);
            return {
              dashboard: {
                ...s.dashboard,
                widgets: s.dashboard.widgets.map((w) => {
                  if (w.id === id) return { ...next, ...resizedBox };
                  const position = reflowed.get(w.id);
                  return position === undefined ? w : { ...w, ...position };
                }),
              },
            };
          }

          return {
            dashboard: {
              ...s.dashboard,
              widgets: s.dashboard.widgets.map((w) => {
                if (w.id !== id) return w;
                if (!positionChanged) return next;
                const others = s.dashboard.widgets.filter((x) => x.id !== id).map(asBox);
                const resolved = constrainBox(asBox(next), others);
                return { ...next, ...resolved };
              }),
            },
          };
        }),

      resizeWidget: (id, patch) =>
        set((s) => {
          const current = s.dashboard.widgets.find((w) => w.id === id);
          if (!current) return s;
          const resizedBox = asBox({ ...current, ...patch });
          const others = s.dashboard.widgets.filter((w) => w.id !== id).map(asBox);
          const reflowed = compactAround(resizedBox, others);
          return {
            dashboard: {
              ...s.dashboard,
              widgets: s.dashboard.widgets.map((w) => {
                // The resized tile is the anchor. Preserve its position and
                // make room by reflowing the surrounding tiles, rather than
                // feeding it through constrainBox (which finds an empty slot
                // and can send the tile itself to the bottom of the board).
                if (w.id === id) {
                  return {
                    ...w,
                    col: resizedBox.col,
                    row: resizedBox.row,
                    colSpan: resizedBox.colSpan,
                    height: resizedBox.height,
                  };
                }
                const position = reflowed.get(w.id);
                return position === undefined ? w : { ...w, ...position };
              }),
            },
          };
        }),

      compactDashboard: () =>
        set((s) => {
          const boxes = s.dashboard.widgets.map(asBox);
          if (boxes.length < 2) return s;
          // Keep the visually first tile fixed and compact every other tile
          // around it. This repairs legacy boards that were created before
          // size changes reflowed their neighbours.
          const [anchor, ...others] = [...boxes].sort((a, b) => a.row - b.row || a.col - b.col);
          const reflowed = compactAround(anchor, others);
          return {
            dashboard: {
              ...s.dashboard,
              widgets: s.dashboard.widgets.map((w) => {
                if (w.id === anchor.id) return { ...w, ...anchor };
                const position = reflowed.get(w.id);
                return position === undefined ? w : { ...w, ...position };
              }),
            },
          };
        }),

      saveHistorySnapshot: () => {
        const state = get();
        if (state.datasets.length === 0 || state.datasets.every((dataset) => dataset.isSample)) return;
        const id = state.currentHistoryId ?? newId();
        const previous = state.history.find((entry) => entry.id === id);
        const entry = historyEntry(state, id, previous?.createdAt);
        // History is user-owned: retain every saved workspace until the user
        // explicitly removes it. The full data lives in IndexedDB, while this
        // small list is only the index shown on the History page.
        const history = [entry, ...state.history.filter((item) => item.id !== id)];
        set({ history, currentHistoryId: id });
        void saveHistoryRecord(historySnapshot(get(), entry)).catch(() => {
          // Current data remains usable even if the browser rejects storage.
        });
      },

      restoreHistorySnapshot: async (id) => {
        try {
          const snapshot = await readHistoryRecord<DataHistorySnapshot>(id);
          if (!snapshot) return false;
          const restored = normalizePersisted(snapshot);
          set((state) => ({
            ...restored,
            selectedId: null,
            history: state.history,
            currentHistoryId: id,
          }));
          get().compactDashboard();
          get().recomputeRelationships();
          return true;
        } catch {
          return false;
        }
      },

      removeHistorySnapshot: (id) => {
        set((state) => ({
          history: state.history.filter((entry) => entry.id !== id),
          currentHistoryId: state.currentHistoryId === id ? null : state.currentHistoryId,
        }));
        void removeHistoryRecord(id).catch(() => {});
      },

      removeWidget: (id) =>
        set((s) => ({
          dashboard: { ...s.dashboard, widgets: s.dashboard.widgets.filter((w) => w.id !== id) },
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),

      duplicateWidget: (id) =>
        set((s) => {
          const w = s.dashboard.widgets.find((x) => x.id === id);
          if (!w) return s;
          const copy: Widget = { ...w, id: newId() };
          const others = s.dashboard.widgets.map(asBox);
          const slot = nearestFree({ ...asBox(copy), row: copy.row + copy.height + 14 }, others);
          copy.col = slot.col;
          copy.row = slot.row;
          const idx = s.dashboard.widgets.findIndex((x) => x.id === id);
          const widgets = s.dashboard.widgets.slice();
          widgets.splice(idx + 1, 0, copy);
          return { dashboard: { ...s.dashboard, widgets }, selectedId: copy.id };
        }),

      reorderWidgets: (fromId, toId) =>
        set((s) => {
          if (fromId === toId) return s;
          const widgets = s.dashboard.widgets.slice();
          const fi = widgets.findIndex((w) => w.id === fromId);
          const ti = widgets.findIndex((w) => w.id === toId);
          if (fi < 0 || ti < 0) return s;
          const [moved] = widgets.splice(fi, 1);
          widgets.splice(ti, 0, moved);
          return { dashboard: { ...s.dashboard, widgets } };
        }),

      setWidgetOrder: (ids) =>
        set((s) => {
          if (ids.length !== s.dashboard.widgets.length) return s;
          const byId = new Map(s.dashboard.widgets.map((w) => [w.id, w]));
          const widgets = ids.map((id) => byId.get(id)).filter((w): w is Widget => !!w);
          if (widgets.length !== s.dashboard.widgets.length) return s;
          return { dashboard: { ...s.dashboard, widgets } };
        }),

      select: (id) => set({ selectedId: id }),

      attachSource: ({ url, fileName, sheets }) =>
        get().addDatasets(
          sheets.map((sheet) => ({
            fileName,
            sheetName: sheet.sheetName,
            rows: sheet.rows,
            columns: sheet.columns,
            isSample: false,
            sourceUrl: url,
            lastSyncedAt: Date.now(),
            autoRefresh: true,
            refreshIntervalSec: DEFAULT_REFRESH_INTERVAL_SEC,
            syncError: null,
            syncing: false,
          }))
        ),

      refreshFromSource: async (datasetId) => {
        const state = get();
        const target = datasetId
          ? state.datasets.find((d) => d.id === datasetId)
          : selectActiveDataset(state);
        if (!target || !target.sourceUrl) return;
        const id = target.id;

        const patch = (fn: (d: Dataset) => Dataset) =>
          set((s) => ({ datasets: s.datasets.map((d) => (d.id === id ? fn(d) : d)) }));

        patch((d) => ({ ...d, syncing: true }));
        try {
          const res = await fetch("/api/import-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: target.sourceUrl }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Refresh failed");
          const sheets: SheetPayload[] = Array.isArray(data.sheets)
            ? data.sheets
            : [{ sheetName: data.sheetName, rows: data.rows, columns: data.columns }];
          const match = sheets.find((sh) => sh.sheetName === target.sheetName) ?? sheets[0];
          if (!match) throw new Error("The linked file no longer contains that sheet.");
          patch((d) => ({
            ...d,
            rows: match.rows,
            columns: mergeColumns(d.columns, match.columns),
            lastSyncedAt: Date.now(),
            syncError: null,
            syncing: false,
          }));
          get().recomputeRelationships();
        } catch (err) {
          patch((d) => ({
            ...d,
            syncing: false,
            syncError: err instanceof Error ? err.message : "Refresh failed",
          }));
        }
      },

      detachSource: (datasetId) =>
        set((s) => {
          const id = datasetId ?? selectActiveDataset(s)?.id;
          if (!id) return s;
          return {
            datasets: s.datasets.map((d) =>
              d.id === id ? { ...d, sourceUrl: undefined, autoRefresh: false, syncError: null } : d
            ),
          };
        }),

      setAutoRefresh: (v, datasetId) =>
        set((s) => {
          const id = datasetId ?? selectActiveDataset(s)?.id;
          if (!id) return s;
          return { datasets: s.datasets.map((d) => (d.id === id ? { ...d, autoRefresh: v } : d)) };
        }),

      setRefreshIntervalSec: (sec, datasetId) =>
        set((s) => {
          const id = datasetId ?? selectActiveDataset(s)?.id;
          if (!id) return s;
          return { datasets: s.datasets.map((d) => (d.id === id ? { ...d, refreshIntervalSec: sec } : d)) };
        }),

      recomputeRelationships: () => set((s) => ({ relationships: detectRelationships(s.datasets) })),

      setRelationshipStatus: (id, status) =>
        set((s) => {
          const next = { ...s.relationshipStatus };
          if (status === null) delete next[id];
          else next[id] = status;
          return { relationshipStatus: next };
        }),

      addManualRelationship: (opts) => {
        const rel = buildManualRelationship({ datasets: get().datasets, ...opts });
        if (!rel) return false;
        set((s) => ({
          manualRelationships: [rel, ...s.manualRelationships.filter((r) => r.id !== rel.id)],
          relationshipStatus: { ...s.relationshipStatus, [rel.id]: "confirmed" },
        }));
        return true;
      },

      removeManualRelationship: (id) =>
        set((s) => {
          const next = { ...s.relationshipStatus };
          delete next[id];
          return { manualRelationships: s.manualRelationships.filter((r) => r.id !== id), relationshipStatus: next };
        }),
    }),
    {
      name: "gridsheet-app-state",
      version: STORE_VERSION,
      storage: createJSONStorage(() => browserStateStorage),
      partialize: persistedSnapshot,
      migrate: (persisted, version) => migratePersisted(persisted, version),
      merge: (persisted, current) => ({ ...current, ...normalizePersisted(persisted) }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        state?.compactDashboard();
        state?.recomputeRelationships();
        // Workspaces saved before History existed become visible on their
        // first reload too; users should not need to import the same file
        // again just to create an entry.
        if (state?.currentHistoryId === null && state.datasets.some((dataset) => !dataset.isSample)) {
          state.saveHistorySnapshot();
        }
      },
    }
  )
);

/* ---------------------------------------------------------------- migration */

/** The slice of state that gets persisted, as it comes back off disk. */
type PersistedShape = Partial<{
  datasets: Dataset[];
  activeDatasetId: string | null;
  dashboard: DashboardState;
  layoutSource: LayoutSource;
  relationshipStatus: Record<string, RelationshipStatus>;
  manualRelationships: Relationship[];
  history: DataHistoryEntry[];
  currentHistoryId: string | null;
}>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function looksLikeDataset(v: unknown): v is Partial<Dataset> {
  return isRecord(v) && Array.isArray(v.rows) && Array.isArray(v.columns);
}

function repairHistoryEntry(raw: unknown): DataHistoryEntry | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "Imported data",
    createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    sheetCount: typeof raw.sheetCount === "number" && raw.sheetCount >= 0 ? raw.sheetCount : 0,
    rowCount: typeof raw.rowCount === "number" && raw.rowCount >= 0 ? raw.rowCount : 0,
    fileNames: Array.isArray(raw.fileNames) ? raw.fileNames.filter((name): name is string => typeof name === "string") : [],
  };
}

function repairDataset(raw: Partial<Dataset>, index: number, taken: Set<string>): Dataset {
  const fileName = typeof raw.fileName === "string" ? raw.fileName : "spreadsheet";
  const sheetName = typeof raw.sheetName === "string" ? raw.sheetName : `Sheet${index + 1}`;
  const label = uniqueLabel(
    typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : deriveLabel({ sheetName, fileName }),
    taken
  );
  taken.add(label);
  return {
    ...raw,
    id: typeof raw.id === "string" && raw.id ? raw.id : newDatasetId(),
    label,
    fileName,
    sheetName,
    rows: Array.isArray(raw.rows) ? (raw.rows as Row[]) : [],
    columns: Array.isArray(raw.columns) ? (raw.columns as ColumnMeta[]) : [],
    isSample: !!raw.isSample,
  };
}

/**
 * v1 (and earlier, unversioned) persisted a single `dataset`. Lift it into the
 * collection shape so an existing board keeps rendering instead of wiping.
 */
export function migratePersisted(persisted: unknown, version: number): PersistedShape {
  if (!isRecord(persisted)) return {};
  if (version >= STORE_VERSION) return normalizePersisted(persisted);

  // The pre-v2 shape held a single `dataset`; `normalizePersisted` lifts it into
  // the collection, so all this needs to do is drop the rest on the floor.
  return normalizePersisted(persisted);
}

/** Coerces any persisted payload (legacy, hand-crafted, or corrupted) into valid state. */
export function normalizePersisted(persisted: unknown): PersistedShape {
  if (!isRecord(persisted)) return {};
  const out: PersistedShape = {};

  const taken = new Set<string>();
  const rawDatasets = Array.isArray(persisted.datasets)
    ? persisted.datasets
    : looksLikeDataset(persisted.dataset)
      ? [persisted.dataset]
      : [];
  const datasets = rawDatasets.filter(looksLikeDataset).map((d, i) => repairDataset(d, i, taken));
  out.datasets = datasets;

  const activeId = typeof persisted.activeDatasetId === "string" ? persisted.activeDatasetId : null;
  const resolvedActive = datasets.some((d) => d.id === activeId) ? activeId : datasets[0]?.id ?? null;
  out.activeDatasetId = resolvedActive;

  if (isRecord(persisted.dashboard)) {
    const d = persisted.dashboard as Partial<DashboardState>;
    const widgets = Array.isArray(d.widgets) ? (d.widgets as Widget[]) : [];
    const knownIds = new Set(datasets.map((x) => x.id));
    out.dashboard = {
      boardTitle: typeof d.boardTitle === "string" ? d.boardTitle : "Untitled dashboard",
      widgets: withPositions(
        widgets
          .filter((w) => isRecord(w) && typeof w.id === "string")
          .map((w) => ({
            ...w,
            datasetId: w.datasetId && knownIds.has(w.datasetId) ? w.datasetId : resolvedActive ?? undefined,
            dimRef: w.dimRef && knownIds.has(w.dimRef.datasetId) ? w.dimRef : undefined,
          }))
      ),
    };
  }

  out.layoutSource =
    persisted.layoutSource === "ai" || persisted.layoutSource === "heuristic" ? persisted.layoutSource : null;

  out.relationshipStatus = isRecord(persisted.relationshipStatus)
    ? (persisted.relationshipStatus as Record<string, RelationshipStatus>)
    : {};
  out.manualRelationships = Array.isArray(persisted.manualRelationships)
    ? (persisted.manualRelationships as Relationship[])
    : [];

  out.history = Array.isArray(persisted.history)
    ? persisted.history.map(repairHistoryEntry).filter((entry): entry is DataHistoryEntry => entry !== null)
    : [];
  out.currentHistoryId =
    typeof persisted.currentHistoryId === "string" && out.history.some((entry) => entry.id === persisted.currentHistoryId)
      ? persisted.currentHistoryId
      : null;

  return out;
}
