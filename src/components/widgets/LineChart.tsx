"use client";

import { aggregate } from "@/lib/aggregate";
import { fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { AxisLabels, WidgetBodyProps } from "./types";

export default function LineChart({ widget, rows, columns, scale = 1, filled = false }: WidgetBodyProps & { filled?: boolean }) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const isDateDimension = columns.find((column) => column.name === widget.dim)?.type === "date";
  const data = aggregate(rows, widget.dim, widget.measure, "natural", Math.max(widget.topN, 12), isDateDimension);
  const tooltip = useChartTooltip();

  if (data.length === 0) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const span = max - min || 1;
  const pts = data.map((d, i): [number, number] => [
    data.length > 1 ? (i / (data.length - 1)) * 100 : 50,
    96 - ((d.value - min) / span) * 82,
  ]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" ");
  const gid = "g" + widget.id;
  const bandWidth = data.length > 1 ? 100 / data.length : 100;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%", overflow: "visible" }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c[0]} stopOpacity={0.32} />
              <stop offset="100%" stopColor={c[0]} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {[20, 45, 70, 95].map((y) => (
            <line key={y} x1={0} x2={100} y1={y} y2={y} stroke="rgba(23,22,26,0.08)" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
          ))}
          {filled && <path d={line + " L100 100 L0 100 Z"} fill={`url(#${gid})`} />}
          <path d={line} fill="none" stroke={c[0]} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {pts.map((p, i) => (
            <circle key={`dot:${i}`} cx={p[0]} cy={p[1]} r={1.4} fill="#fdfcfa" stroke={c[0]} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          ))}
          {pts.map((p, i) => (
            <rect
              key={`hit:${i}`}
              x={p[0] - bandWidth / 2}
              y={0}
              width={bandWidth}
              height={100}
              fill="transparent"
              style={{ cursor: "default" }}
              {...tooltip.handlers(() => ({
                title: String(data[i].key),
                rows: [{ label: widget.measure || "Value", value: fmtValueFull(data[i].value, widget.measure), color: c[0] }],
              }))}
            />
          ))}
        </svg>
      </div>
      <AxisLabels data={data} s={s} />
    </div>
  );
}
