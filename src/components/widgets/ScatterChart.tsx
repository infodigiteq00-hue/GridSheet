"use client";

import { listDimNames, listMeasureNames, pickOther, scatterPoints } from "@/lib/aggregate";
import { fmtShort, fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { WidgetBodyProps } from "./types";

export default function ScatterChart({ widget, rows, columns, scale = 1 }: WidgetBodyProps) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const dims = listDimNames(columns);
  const measures = listMeasureNames(columns);
  const groupDim = widget.dim || dims[0] || "";
  const xMeasure = pickOther(widget.measure, measures);
  const groups = Array.from(new Set(rows.map((r) => String(r[groupDim] ?? "—")))).slice(0, c.length);
  const tooltip = useChartTooltip();

  const pts = scatterPoints(rows, xMeasure, widget.measure, groupDim);
  if (pts.length === 0) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          {[25, 50, 75].map((y) => (
            <line key={y} x1={0} x2={100} y1={y} y2={y} stroke="rgba(23,22,26,0.07)" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
          ))}
          {pts.map((p, i) => {
            const cx = ((p.x - xmin) / (xmax - xmin || 1)) * 96 + 2;
            const cy = 98 - ((p.y - ymin) / (ymax - ymin || 1)) * 94;
            const color = c[groups.indexOf(p.group) % c.length];
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={1.5} fill={color} fillOpacity={0.78} />
                <circle
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill="transparent"
                  style={{ cursor: "default" }}
                  {...tooltip.handlers(() => ({
                    title: p.group,
                    rows: [
                      { label: xMeasure || "X", value: fmtValueFull(p.x, xMeasure), color },
                      { label: widget.measure || "Y", value: fmtValueFull(p.y, widget.measure) },
                    ],
                  }))}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 * s, color: "#8a8990", fontFamily: "var(--font-plex-mono), monospace", marginTop: 5 }}>
        <span>{xMeasure || "x"} →</span>
        <span>{fmtShort(xmax)}</span>
      </div>
    </div>
  );
}
