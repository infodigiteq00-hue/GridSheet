"use client";

import { aggregate } from "@/lib/aggregate";
import { fmtShort, fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { WidgetBodyProps } from "./types";

export default function Donut({ widget, rows, columns, scale = 1 }: WidgetBodyProps) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const isDateDimension = columns.find((column) => column.name === widget.dim)?.type === "date";
  const data = aggregate(rows, widget.dim, widget.measure, "desc", Math.max(widget.topN, 6), isDateDimension, true);
  const totalVal = data.reduce((a, d) => a + d.value, 0) || 1;
  const tooltip = useChartTooltip();

  if (data.length === 0) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  const R = 15.9155;
  const circ = 2 * Math.PI * R;
  const segments = data.reduce<{ list: { frac: number; offset: number }[]; running: number }>(
    (acc, d) => {
      const frac = d.value / totalVal;
      return { list: [...acc.list, { frac, offset: acc.running }], running: acc.running + frac };
    },
    { list: [], running: 0 }
  ).list;

  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ position: "relative", height: "100%", aspectRatio: "1", flex: "none" }}>
        <svg viewBox="0 0 42 42" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
          {segments.map((seg, i) => {
            const dash = seg.frac * circ;
            const d = data[i];
            const handlers = tooltip.handlers(() => ({
              title: d.key,
              rows: [
                { label: widget.measure || "Value", value: fmtValueFull(d.value, widget.measure), color: c[i % c.length] },
                { label: "Share of whole", value: Math.round(seg.frac * 100) + "%" },
              ],
            }));
            return (
              <g key={i}>
                {/* Wider, invisible hit-path so the thin visible ring is easy to hover */}
                <circle
                  cx={21}
                  cy={21}
                  r={R}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  strokeDasharray={`${dash.toFixed(2)} ${(circ - dash).toFixed(2)}`}
                  strokeDashoffset={(-seg.offset * circ).toFixed(2)}
                  style={{ cursor: "pointer" }}
                  {...handlers}
                />
                <circle
                  cx={21}
                  cy={21}
                  r={R}
                  fill="none"
                  stroke={c[i % c.length]}
                  strokeWidth={7}
                  strokeDasharray={`${dash.toFixed(2)} ${(circ - dash).toFixed(2)}`}
                  strokeDashoffset={(-seg.offset * circ).toFixed(2)}
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none" }}>
          <div style={{ fontFamily: "var(--font-space-grotesk), sans-serif", fontSize: 17 * s, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {fmtShort(totalVal)}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        {data.slice(0, 6).map((d, i) => {
          const frac = d.value / totalVal;
          return (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 * s, cursor: "default", borderRadius: 5 }}
              {...tooltip.handlers(() => ({
                title: d.key,
                rows: [
                  { label: widget.measure || "Value", value: fmtValueFull(d.value, widget.measure), color: c[i % c.length] },
                  { label: "Share of whole", value: Math.round(frac * 100) + "%" },
                ],
              }))}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c[i % c.length], flex: "none" }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#3d3c44" }}>{d.key}</span>
              <span style={{ fontFamily: "var(--font-plex-mono), monospace", color: "#8a8990", fontSize: 11 * s }}>
                {Math.round(frac * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
