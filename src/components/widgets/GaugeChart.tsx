"use client";

import { total } from "@/lib/aggregate";
import { fmtShort, fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { WidgetBodyProps } from "./types";

export default function GaugeChart({ widget, rows, scale = 1 }: WidgetBodyProps) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const v = total(rows, widget.measure);
  const target = widget.target > 0 ? widget.target : Math.max(v * 1.25, 1);
  const pct = Math.min(1, v / target);
  const R = 40;
  const circ = Math.PI * R;
  const tooltip = useChartTooltip();

  const gaugeTooltip = tooltip.handlers(() => ({
    title: widget.measure || "Value",
    rows: [
      { label: "Current", value: fmtValueFull(v, widget.measure), color: c[0] },
      { label: "Target", value: fmtValueFull(target, widget.measure) },
      { label: "% of target", value: Math.round(pct * 100) + "%" },
    ],
  }));

  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: "none", width: "50%", maxWidth: 120 }}>
        <svg viewBox="0 0 100 56" style={{ width: "100%", cursor: "default" }} {...gaugeTooltip}>
          <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="rgba(23,22,26,0.1)" strokeWidth={9} strokeLinecap="round" />
          <path
            d="M10 50 A40 40 0 0 1 90 50"
            fill="none"
            stroke={c[0]}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={`${(pct * circ).toFixed(1)} ${circ.toFixed(1)}`}
          />
        </svg>
      </div>
      <div>
        <div style={{ fontFamily: "var(--font-space-grotesk), sans-serif", fontSize: 26 * s, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>
          {Math.round(pct * 100)}%
        </div>
        <div style={{ fontSize: 12 * s, color: "#7a7981", marginTop: 5 }}>of {fmtShort(target)} goal</div>
      </div>
    </div>
  );
}
