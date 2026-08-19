import { relationshipEndpoints } from "./relationships";
import { CellValue, ColumnMeta, Dataset, RelatedFieldRef, Relationship, Row, Widget } from "./types";

/**
 * Single-hop lookups only: a widget on one sheet can group by a column that
 * lives one relationship away. There is deliberately no multi-hop / N-way join
 * engine here — anything beyond one hop is out of scope.
 */

export function qualifiedFieldName(datasetLabel: string, column: string): string {
  return `${datasetLabel}.${column}`;
}

function lookupKey(v: CellValue | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") return isFinite(v) ? String(v) : null;
  const s = String(v).trim();
  if (s === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (isFinite(n)) return String(n);
  }
  return s.toLowerCase();
}

export interface ResolvedData {
  rows: Row[];
  columns: ColumnMeta[];
}

/**
 * Copies `field` from the related dataset onto every base row, keyed by the
 * relationship's columns. When the related side isn't unique the first matching
 * row wins — a lookup, not a row-multiplying join, so measures never get
 * double-counted.
 */
export function denormalizeField(
  base: Dataset,
  related: Dataset,
  rel: Relationship,
  field: string
): ResolvedData {
  const { localColumn, otherColumn } = relationshipEndpoints(rel, base.id);
  const fieldName = qualifiedFieldName(related.label, field);

  const lookup = new Map<string, CellValue>();
  for (const row of related.rows) {
    const key = lookupKey(row[otherColumn]);
    if (key === null || lookup.has(key)) continue;
    lookup.set(key, row[field] ?? "");
  }

  const rows: Row[] = base.rows.map((row) => {
    const key = lookupKey(row[localColumn]);
    const value = key === null ? "" : lookup.get(key);
    return { ...row, [fieldName]: value ?? "—" };
  });

  const relatedMeta = related.columns.find((c) => c.name === field);
  const distinct = new Set(rows.map((r) => String(r[fieldName]))).size;
  const joinedColumn: ColumnMeta = {
    name: fieldName,
    type: relatedMeta?.type ?? "text",
    role: "dimension",
    sampleValues: relatedMeta?.sampleValues ?? [],
    cardinality: distinct,
  };

  return { rows, columns: [...base.columns, joinedColumn] };
}

export function resolveWidgetData(
  widget: Widget,
  datasets: Dataset[],
  relationships: Relationship[],
  activeDatasetId: string | null
): ResolvedData {
  const base =
    datasets.find((d) => d.id === widget.datasetId) ??
    datasets.find((d) => d.id === activeDatasetId) ??
    datasets[0] ??
    null;

  if (!base) return { rows: [], columns: [] };

  const ref = widget.dimRef;
  if (!ref) return { rows: base.rows, columns: base.columns };

  const rel = relationships.find((r) => r.id === ref.relationshipId);
  const related = datasets.find((d) => d.id === ref.datasetId);
  if (!rel || !related) return { rows: base.rows, columns: base.columns };
  if (rel.fromDatasetId !== base.id && rel.toDatasetId !== base.id) {
    return { rows: base.rows, columns: base.columns };
  }
  if (!related.columns.some((c) => c.name === ref.column)) {
    return { rows: base.rows, columns: base.columns };
  }

  return denormalizeField(base, related, rel, ref.column);
}

export interface RelatedFieldOption {
  ref: RelatedFieldRef;
  /** The name the widget's `dim` should be set to. */
  fieldName: string;
  datasetLabel: string;
  column: string;
  viaColumn: string;
}

/** Every dimension one hop away from `datasetId`, grouped per related sheet. */
export function relatedFieldOptions(
  datasetId: string | null,
  datasets: Dataset[],
  relationships: Relationship[]
): { datasetLabel: string; viaColumn: string; options: RelatedFieldOption[] }[] {
  if (!datasetId) return [];
  const groups: { datasetLabel: string; viaColumn: string; options: RelatedFieldOption[] }[] = [];

  for (const rel of relationships) {
    if (rel.fromDatasetId !== datasetId && rel.toDatasetId !== datasetId) continue;
    const { localColumn, otherDatasetId, otherColumn } = relationshipEndpoints(rel, datasetId);
    const related = datasets.find((d) => d.id === otherDatasetId);
    if (!related) continue;

    const options = related.columns
      .filter((c) => c.role !== "ignore" && c.name !== otherColumn)
      .map((c) => ({
        ref: { relationshipId: rel.id, datasetId: related.id, column: c.name },
        fieldName: qualifiedFieldName(related.label, c.name),
        datasetLabel: related.label,
        column: c.name,
        viaColumn: localColumn,
      }));

    if (options.length) groups.push({ datasetLabel: related.label, viaColumn: localColumn, options });
  }

  return groups;
}
