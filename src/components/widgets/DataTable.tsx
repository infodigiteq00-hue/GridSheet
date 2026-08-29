import { CellValue } from "@/lib/types";
import { toNumber } from "@/lib/inferColumns";
import { WidgetBodyProps } from "./types";

/** Identifiers are numeric but not quantities — render 1000, never "1,000". */
function renderCell(v: CellValue | undefined, isMeasure: boolean): string {
  if (isMeasure) return toNumber(v as CellValue).toLocaleString("en-US");
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
            {rows.map((r, i) => (
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
                    {renderCell(r[cn], measures.has(cn))}
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
        {rows.length.toLocaleString("en-US")} rows × {cols.length} columns
      </div>
    </div>
  );
}
