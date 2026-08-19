import { listDimNames, pickOther } from "@/lib/aggregate";
import { toNumber } from "@/lib/inferColumns";
import { formatSample } from "@/lib/inferColumns";
import { WidgetBodyProps } from "./types";

export default function DataTable({ widget, rows, columns, scale = 1 }: WidgetBodyProps) {
  const s = (widget.fontScale || 1) * scale;
  const dims = listDimNames(columns);
  const dim = widget.dim || dims[0] || "";
  const dim2 = pickOther(dim, dims);
  const measure = widget.measure;
  const cols = [dim, dim2, measure].filter((c, i, arr) => c && arr.indexOf(c) === i);
  const data = rows.slice(0, 60);

  if (cols.length === 0 || data.length === 0) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  return (
    <div style={{ height: "100%", overflow: "auto", border: "1px solid rgba(23,22,26,0.07)", borderRadius: 9 }}>
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
                  textAlign: cn === measure ? "right" : "left",
                  padding: "7px 10px",
                  fontSize: 10.5 * s,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#7a7981",
                  borderBottom: "1px solid rgba(23,22,26,0.1)",
                }}
              >
                {cn}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? "rgba(23,22,26,0.018)" : "transparent" }}>
              {cols.map((cn) => (
                <td
                  key={cn}
                  style={{
                    padding: "6px 10px",
                    textAlign: cn === measure ? "right" : "left",
                    color: "#3d3c44",
                    fontFamily: cn === measure ? "var(--font-plex-mono), monospace" : "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cn === measure ? toNumber(r[cn]).toLocaleString("en-US") : formatSample(r[cn])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
