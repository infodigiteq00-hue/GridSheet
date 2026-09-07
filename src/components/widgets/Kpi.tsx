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
  // A sparkline is a compact sequence, not a ranked categorical chart. Keep
  // enough points to reveal a longer run, then let its plot strip widen rather
  // than dropping later values or turning every mark into an unreadable blob.
  const spark = widget.dim ? aggregate(rows, widget.dim, widget.measure, "natural", 48) : [];
  const max = Math.max(...spark.map((d) => d.value), 1);
  const sparkMinWidth = spark.length > 14 ? spark.length * 16 : undefined;
  // null means half the comparison period has no real data yet — showing a
  // manufactured -100%/+100% there would read as a business event that never
  // happened, so the badge is omitted entirely rather than guessed at.
  const deltaLabel = delta === null ? null : (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%";
  const tooltip = useChartTooltip();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontFamily: "var(--font-space-grotesk), sans-serif", fontSize: 34 * s, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1 }}>
          {fmtValue(v, widget.measure)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, minWidth: 0 }}>
          {deltaLabel !== null && (
            <span
              style={{
                flex: "none",
                fontSize: 11.5 * s,
                color: "#fff",
                background: delta !== null && delta >= 0 ? c[0] : "#c0341c",
                padding: "2px 6px",
                borderRadius: 5,
                fontWeight: 600,
              }}
            >
              {deltaLabel}
            </span>
          )}
          {/* A wrapped second line here steals the height the sparkline
              needs below it, pushing it past the tile's clipped bottom
              edge — keep this to one line and ellipsize instead. */}
          <span
            title={deltaLabel === null ? widget.measure || "value" : `${widget.measure || "value"} · vs earlier period`}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              fontSize: 12 * s,
              color: "#7a7981",
            }}
          >
            {deltaLabel === null ? widget.measure || "value" : `${widget.measure || "value"} · vs earlier period`}
          </span>
        </div>
      </div>
      {spark.length > 1 && (
        <div style={{ overflowX: sparkMinWidth ? "auto" : "hidden", paddingBottom: sparkMinWidth ? 2 : 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 26, minWidth: sparkMinWidth }}>
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
                  minWidth: sparkMinWidth ? 8 : undefined,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
