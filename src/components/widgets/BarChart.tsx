"use client";

import { aggregate, total as sumTotal } from "@/lib/aggregate";
import { fmtShort, fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { AxisLabels, WidgetBodyProps } from "./types";

export default function BarChart({ widget, rows, scale = 1 }: WidgetBodyProps) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const data = aggregate(rows, widget.dim, widget.measure, widget.sort, widget.topN);
  const max = Math.max(...data.map((d) => d.value), 1);
  const grandTotal = sumTotal(rows, widget.measure);
  const tooltip = useChartTooltip();

  if (data.length === 0) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 3, minHeight: 0 }}>
        {data.map((d, i) => (
          <div
            key={i}
            style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%", gap: 4 }}
          >
            <div style={{ fontSize: 9.5 * s, color: "#8a8990", fontFamily: "var(--font-plex-mono), monospace" }}>{fmtShort(d.value)}</div>
            <div
              {...tooltip.handlers(() => ({
                title: d.key,
                rows: [
                  { label: widget.measure || "Value", value: fmtValueFull(d.value, widget.measure), color: c[i % c.length] },
                  ...(grandTotal > 0 ? [{ label: "Share of total", value: Math.round((d.value / grandTotal) * 100) + "%" }] : []),
                ],
              }))}
              style={{
                width: "100%",
                height: (d.value / max) * 100 + "%",
                background: c[i % c.length],
                borderRadius: "4px 4px 2px 2px",
                minHeight: 3,
                cursor: "default",
                transition: "height 320ms cubic-bezier(0.22,1,0.36,1), background 200ms ease-out",
              }}
            />
          </div>
        ))}
      </div>
      <AxisLabels data={data} s={s} />
    </div>
  );
}
