"use client";

import { listDimNames, pickComplementDim, pivot } from "@/lib/aggregate";
import { fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { WidgetBodyProps } from "./types";

export default function HeatmapChart({ widget, rows, columns, scale = 1 }: WidgetBodyProps) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const dims = listDimNames(columns);
  const dimRow = widget.dim || dims[0] || "";
  const dimCol = pickComplementDim(dimRow, columns, 2, 14);
  const tooltip = useChartTooltip();

  if (!dimRow || !widget.measure) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  const p = pivot(rows, dimRow, dimCol, widget.measure, 6, 14);
  const max = Math.max(...p.rowKeys.flatMap((r) => p.colKeys.map((cc) => p.cell(r, cc))), 1);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: `52px repeat(${p.colKeys.length}, 1fr)`,
          gridTemplateRows: `repeat(${p.rowKeys.length}, 1fr)`,
          gap: 3,
          minHeight: 0,
        }}
      >
        {p.rowKeys.flatMap((rk) => [
          <div key={`row:${rk}`} style={{ fontSize: 11 * s, color: "#7a7981", display: "flex", alignItems: "center", overflow: "hidden", whiteSpace: "nowrap" }}>
            {rk}
          </div>,
          ...p.colKeys.map((cc) => {
            const v = p.cell(rk, cc);
            return (
              <div
                key={`cell:${rk}|${cc}`}
                {...tooltip.handlers(() => ({
                  title: `${rk} × ${cc}`,
                  rows: [{ label: widget.measure || "Value", value: fmtValueFull(v, widget.measure), color: c[0] }],
                }))}
                style={{ background: c[0], opacity: 0.14 + (v / max) * 0.86, borderRadius: 3, cursor: "default" }}
              />
            );
          }),
        ])}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${p.colKeys.length}, 1fr)`, gap: 3 }}>
        <div />
        {p.colKeys.map((cc) => (
          <div
            key={`colhead:${cc}`}
            style={{
              fontSize: 9 * s,
              color: "#a3a2a9",
              textAlign: "center",
              fontFamily: "var(--font-plex-mono), monospace",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {String(cc).slice(0, 3)}
          </div>
        ))}
      </div>
    </div>
  );
}
