"use client";

import { aggregate, total, trendPct } from "@/lib/aggregate";
import { fmtValue, fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { WidgetBodyProps } from "./types";

export default function Kpi({ widget, rows, scale = 1 }: WidgetBodyProps) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const v = total(rows, widget.measure);
  const delta = trendPct(rows, widget.measure);
  const spark = widget.dim ? aggregate(rows, widget.dim, widget.measure, "natural", 14) : [];
  const max = Math.max(...spark.map((d) => d.value), 1);
  const deltaLabel = (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%";
  const tooltip = useChartTooltip();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontFamily: "var(--font-space-grotesk), sans-serif", fontSize: 34 * s, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1 }}>
          {fmtValue(v, widget.measure)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 11.5 * s,
              color: "#fff",
              background: delta >= 0 ? c[0] : "#c0341c",
              padding: "2px 6px",
              borderRadius: 5,
              fontWeight: 600,
            }}
          >
            {deltaLabel}
          </span>
          <span style={{ fontSize: 12 * s, color: "#7a7981" }}>{widget.measure || "value"} · vs earlier period</span>
        </div>
      </div>
      {spark.length > 1 && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 26 }}>
          {spark.map((d, i) => (
            <div
              key={i}
              {...tooltip.handlers(() => ({
                title: d.key,
                rows: [{ label: widget.measure || "Value", value: fmtValueFull(d.value, widget.measure), color: c[0] }],
              }))}
              style={{
                flex: 1,
                height: (d.value / max) * 100 + "%",
                background: c[0],
                opacity: 0.22 + (i / spark.length) * 0.6,
                borderRadius: 1.5,
                cursor: "default",
                minHeight: 3,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
