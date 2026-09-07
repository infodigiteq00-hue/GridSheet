import { CellValue } from "@/lib/types";
import { toScaledNumber } from "@/lib/inferColumns";
import { fmtFull } from "@/lib/format";
import { WidgetBodyProps } from "./types";

const TABLE_ROW_CAP = 500;

/** Identifiers are numeric but not quantities — render 1000, never "1,000".
 * Measure cells are scaled to true rupee-equivalent value per the column's
 * own declared unit (e.g. "(Cr)"/"(Lakh)"), same as every aggregate/total. */
function renderCell(v: CellValue | undefined, isMeasure: boolean, columnName: string): string {
  if (isMeasure) return fmtFull(toScaledNumber(v as CellValue, columnName));
  if (v instanceof Date) return v.toLocaleDateString("en-US");
  return String(v ?? "");
}

export default function DataTable({ widget, rows, columns, scale = 1 }: WidgetBodyProps) {
  const s = (widget.fontScale || 1) * scale;
  // Every column in sheet order, and every row. A table tile is the one place
  // the underlying data should be visible in full — it previously showed only
  // (dim, dim2, measure) and the first 60 rows, which silently hid most of a
  // sheet. The tile scrolls, so completeness costs nothing but scroll height.
  const cols = columns.map((c) => c.name);
  const measures = new Set(columns.filter((c) => c.role === "measure").map((c) => c.name));
  // The AI and Inspector use the selected numeric measure as a table sort key.
  // Keep source order for "natural" so a table can still be used to inspect
  // the spreadsheet exactly as it was imported.
  const sortedRows =
    widget.sort === "natural" || !measures.has(widget.measure)
      ? rows
      : rows
          .map((row, index) => ({ row, index }))
          .sort((a, b) => {
            const difference =
              toScaledNumber(a.row[widget.measure], widget.measure) - toScaledNumber(b.row[widget.measure], widget.measure);
            const ordered = widget.sort === "desc" ? -difference : difference;
            return ordered || a.index - b.index;
          })
          .map(({ row }) => row);
  // Cap at TABLE_ROW_CAP for performance; footer reports when rows are truncated.
  const visibleRows = sortedRows.slice(0, TABLE_ROW_CAP);

  if (cols.length === 0 || rows.length === 0) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid rgba(23,22,26,0.07)", borderRadius: 9 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 * s }}>
          <thead>
            <tr>
              {cols.map((cn) => (
                <th
                  key={cn}
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f7f5f1",
                    textAlign: measures.has(cn) ? "right" : "left",
                    padding: "7px 10px",
                    fontSize: 10.5 * s,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#7a7981",
                    borderBottom: "1px solid rgba(23,22,26,0.1)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cn}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => (
              <tr key={i} style={{ background: i % 2 ? "rgba(23,22,26,0.018)" : "transparent" }}>
                {cols.map((cn) => (
                  <td
                    key={cn}
                    style={{
                      padding: "6px 10px",
                      textAlign: measures.has(cn) ? "right" : "left",
                      color: "#3d3c44",
                      fontFamily: measures.has(cn) ? "var(--font-plex-mono), monospace" : "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {renderCell(r[cn], measures.has(cn), cn)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          flex: "none",
          paddingTop: 6,
          fontSize: 10.5 * s,
          color: "#8a8990",
          fontFamily: "var(--font-plex-mono), monospace",
        }}
      >
        {rows.length > TABLE_ROW_CAP
          ? `Showing ${fmtFull(TABLE_ROW_CAP)} of ${fmtFull(rows.length)} rows × ${cols.length} columns`
          : `${fmtFull(rows.length)} rows × ${cols.length} columns`}
      </div>
    </div>
  );
}
