import { ColumnMeta, Row, Widget } from "@/lib/types";

export interface WidgetBodyProps {
  widget: Widget;
  rows: Row[];
  columns: ColumnMeta[];
  scale?: number;
}

export function AxisLabels({ data, s }: { data: { key: string }[]; s: number }) {
  return (
    <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
      {data.map((d, i) => (
        <div
          key={i}
          title={String(d.key)}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "center",
            fontSize: 10 * s,
            color: "#8a8990",
            fontFamily: "var(--font-plex-mono), monospace",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {String(d.key)}
        </div>
      ))}
    </div>
  );
}
