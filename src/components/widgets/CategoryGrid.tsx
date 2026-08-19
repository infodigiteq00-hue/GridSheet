"use client";

import { aggregate, total as sumTotal } from "@/lib/aggregate";
import { fmtShort, fmtValueFull } from "@/lib/format";
import { colorsFor } from "@/lib/palettes";
import { useChartTooltip } from "@/components/ChartTooltip";
import { WidgetBodyProps } from "./types";

export default function CategoryGrid({ widget, rows, scale = 1 }: WidgetBodyProps) {
  const c = colorsFor(widget.palette);
  const s = (widget.fontScale || 1) * scale;
  const data = aggregate(rows, widget.dim, widget.measure, "desc", 4);
  const max = Math.max(...data.map((d) => d.value), 1);
  const grandTotal = sumTotal(rows, widget.measure);
  const tooltip = useChartTooltip();

  if (data.length === 0) {
    return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#a3a2a9", fontSize: 13 }}>No data</div>;
  }

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 6 }}>
      {data.map((d, i) => {
        const intensity = 0.2 + (d.value / max) * 0.8;
        return (
          <div
            key={i}
            {...tooltip.handlers(() => ({
              title: d.key,
              rows: [
                { label: widget.measure || "Value", value: fmtValueFull(d.value, widget.measure), color: c[0] },
                ...(grandTotal > 0 ? [{ label: "Share of total", value: Math.round((d.value / grandTotal) * 100) + "%" }] : []),
              ],
            }))}
            style={{
              borderRadius: 9,
              background: c[0],
              opacity: intensity,
              padding: "9px 11px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              color: intensity > 0.7 ? "#fff" : "#17161a",
              cursor: "default",
            }}
          >
            <div style={{ fontSize: 12 * s, fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{d.key}</div>
            <div style={{ fontFamily: "var(--font-plex-mono), monospace", fontSize: 13 * s }}>{fmtShort(d.value)}</div>
          </div>
        );
      })}
    </div>
  );
}
