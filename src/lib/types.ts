export type ColumnType = "text" | "number" | "date";
export type ColumnRole = "dimension" | "measure" | "ignore";

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  role: ColumnRole;
  sampleValues: string[];
  cardinality: number;
}

export type CellValue = string | number | Date;
export type Row = Record<string, CellValue>;

export interface Dataset {
  /** Stable identity used to bind widgets, relationships and sync state to this sheet. */
  id: string;
  /** Short, user-facing name for the sheet — usually the tab name. */
  label: string;
  fileName: string;
  sheetName: string;
  rows: Row[];
  columns: ColumnMeta[];
  isSample: boolean;
  sourceUrl?: string;
  lastSyncedAt?: number;
  autoRefresh?: boolean;
  refreshIntervalSec?: number;
  syncError?: string | null;
  syncing?: boolean;
}

/** A dataset before the store has assigned it an id and a unique label. */
export type DatasetInput = Omit<Dataset, "id" | "label"> & { label?: string };

export type RelationshipKind = "one-to-one" | "one-to-many" | "many-to-many";
export type RelationshipStatus = "confirmed" | "dismissed";
export type RelationshipOrigin = "detected" | "manual";

export interface Relationship {
  /** Deterministic and direction-independent, so user decisions survive re-detection. */
  id: string;
  /** The "many" side when one could be determined. */
  fromDatasetId: string;
  fromColumn: string;
  /** The "one" side — the column that looks like a primary key. */
  toDatasetId: string;
  toColumn: string;
  kind: RelationshipKind;
  /** 0–1. See scoreRelationship in relationships.ts for the weighting. */
  confidence: number;
  matchedValues: number;
  fromDistinct: number;
  toDistinct: number;
  /** Fraction of the from-side's distinct values that exist on the to-side. */
  overlapFrom: number;
  overlapTo: number;
  nameScore: number;
  evidence: string[];
  origin: RelationshipOrigin;
}

/** A field pulled in from a directly-related dataset via a single-hop lookup. */
export interface RelatedFieldRef {
  relationshipId: string;
  datasetId: string;
  column: string;
}

export type WidgetType =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "kpi"
  | "table"
  | "pivot"
  | "text"
  | "heatmap"
  | "scatter"
  | "gauge"
  | "map";

export type PaletteKey = "cobalt" | "ember" | "ink" | "bloom";
export type SortMode = "natural" | "desc" | "asc";
export type FontKey = "grotesk" | "plex";

/** Shared cap for chart top-N (inspector, AI sanitizers, and aggregate fallback). */
export const MAX_TOP_N = 12;

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  dim: string;
  measure: string;
  colSpan: number;
  height: number;
  /** 0-based column origin on the 12-column board. */
  col: number;
  /** Pixel offset from the top of the board, snapped to 8px. */
  row: number;
  palette: PaletteKey;
  fontScale: number;
  sort: SortMode;
  /** Categories to keep on a chart before folding the rest into Other. */
  topN: number;
  font: FontKey;
  text: string;
  target: number;
  /** Which dataset this tile reads. Undefined falls back to the active dataset. */
  datasetId?: string;
  /** Set when `dim` is a field looked up from a related dataset rather than a local column. */
  dimRef?: RelatedFieldRef;
}

export interface DashboardState {
  boardTitle: string;
  widgets: Widget[];
}

/** A lightweight index entry for a locally saved workbook snapshot. */
export interface DataHistoryEntry {
  id: string;
  title: string;
  createdAt: number;
  sheetCount: number;
  rowCount: number;
  fileNames: string[];
}

/** The complete local-only snapshot used when reopening a history entry. */
export interface DataHistorySnapshot extends DataHistoryEntry {
  datasets: Dataset[];
  activeDatasetId: string | null;
  dashboard: DashboardState;
  layoutSource: "ai" | "heuristic" | null;
  relationshipStatus: Record<string, "confirmed" | "dismissed">;
  manualRelationships: Relationship[];
}

export const TYPE_LABEL: Record<WidgetType, string> = {
  bar: "Bar",
  line: "Line",
  area: "Area",
  pie: "Donut",
  kpi: "KPI stat",
  table: "Table",
  pivot: "Pivot table",
  text: "Text block",
  heatmap: "Heatmap",
  scatter: "Scatter",
  gauge: "Gauge",
  map: "Region map",
};

export const TYPES: WidgetType[] = [
  "bar",
  "line",
  "area",
  "pie",
  "kpi",
  "table",
  "pivot",
  "text",
  "heatmap",
  "scatter",
  "gauge",
  "map",
];
