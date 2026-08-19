"use client";

import { listDimNames, pickComplementDim, pivot } from "@/lib/aggregate";
import { fmtShort, fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { WidgetBodyProps } from "./types";

export default function PivotTable({ widget, rows, columns, scale = 1 }: WidgetBodyProps) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const dims = listDimNames(columns);
  const dimRow = widget.dim || dims[0] || "";
  const dimCol = pickComplementDim(dimRow, columns, 2, 8);
  const tooltip = useChartTooltip();

  if (!dimRow || !widget.measure) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  const p = pivot(rows, dimRow, dimCol, widget.measure);
  const max = Math.max(...p.rowKeys.flatMap((r) => p.colKeys.map((cc) => p.cell(r, cc))), 1);

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 * s }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "7px 9px", fontSize: 10.5 * s, textTransform: "uppercase", letterSpacing: "0.05em", color: "#7a7981" }}>
              {dimRow}
            </th>
            {p.colKeys.map((cc) => (
              <th key={cc} style={{ textAlign: "right", padding: "7px 9px", fontSize: 10.5 * s, color: "#7a7981", fontFamily: "var(--font-plex-mono), monospace" }}>
                {cc}
              </th>
            ))}
            <th style={{ textAlign: "right", padding: "7px 9px", fontSize: 10.5 * s, color: "#7a7981" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {p.rowKeys.map((rk) => (
            <tr key={rk} style={{ borderTop: "1px solid rgba(23,22,26,0.07)" }}>
              <td style={{ padding: "8px 9px", fontWeight: 500 }}>{rk}</td>
              {p.colKeys.map((cc) => {
                const v = p.cell(rk, cc);
                const alpha = Math.round(10 + (v / max) * 40).toString(16).padStart(2, "0");
                return (
                  <td
                    key={cc}
                    {...tooltip.handlers(() => ({
                      title: `${rk} × ${cc}`,
                      rows: [{ label: widget.measure || "Value", value: fmtValueFull(v, widget.measure), color: c[0] }],
                    }))}
                    style={{
                      padding: "8px 9px",
                      textAlign: "right",
                      fontFamily: "var(--font-plex-mono), monospace",
                      color: "#3d3c44",
                      background: c[0] + alpha,
                      cursor: "default",
                    }}
                  >
                    {fmtShort(v)}
                  </td>
                );
              })}
              <td style={{ padding: "8px 9px", textAlign: "right", fontWeight: 600, fontFamily: "var(--font-plex-mono), monospace" }}>
                {fmtShort(p.rowTotal(rk))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
