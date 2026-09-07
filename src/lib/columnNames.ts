import { ColumnMeta, Row } from "./types";

/** SheetJS uses this shape for a blank header cell. It must never reach charts. */
export function isPlaceholderColumnName(name: string): boolean {
  return /^__empty(?:_\d+)?$/i.test(name.trim());
}

function fallbackLabel(name: string, index: number): string {
  const suffix = name.match(/_(\d+)$/)?.[1];
  return `Unlabeled field ${suffix ? Number(suffix) + 1 : index + 1}`;
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.replace(/\s+/g, " ").trim().slice(0, 72);
  return label && !isPlaceholderColumnName(label) ? label : null;
}

/**
 * Applies a header mapping to row keys and metadata, preserving every value.
 * Invalid, duplicated, or omitted AI suggestions get a stable readable fallback.
 */
export function applyColumnLabels(
  rows: Row[],
  columns: ColumnMeta[],
  labels: Record<string, string> | undefined
): { rows: Row[]; columns: ColumnMeta[] } {
  const used = new Set(columns.filter((column) => !isPlaceholderColumnName(column.name)).map((column) => column.name));
  const rename = new Map<string, string>();

  columns.forEach((column, index) => {
    if (!isPlaceholderColumnName(column.name)) return;
    const preferred = cleanLabel(labels?.[column.name]) || fallbackLabel(column.name, index);
    let label = preferred;
    let duplicate = 2;
    while (used.has(label)) label = `${preferred} (${duplicate++})`;
    used.add(label);
    rename.set(column.name, label);
  });

  if (rename.size === 0) return { rows, columns };

  return {
    rows: rows.map((row) => {
      const next: Row = {};
      for (const [key, value] of Object.entries(row)) next[rename.get(key) ?? key] = value;
      return next;
    }),
    columns: columns.map((column) => ({ ...column, name: rename.get(column.name) ?? column.name })),
  };
}
