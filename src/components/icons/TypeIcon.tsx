import { WidgetType } from "@/lib/types";

interface Props {
  type: WidgetType;
  color?: string;
  className?: string;
}

export default function TypeIcon({ type, color = "#4a4952", className }: Props) {
  const c = color;
  const style: React.CSSProperties = { width: 18, height: 14, display: "block" };

  switch (type) {
    case "bar":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          {[4, 8, 6, 12].map((v, i) => (
            <rect key={i} x={i * 4.4} y={14 - v} width={3} height={v} fill={c} rx={0.8} />
          ))}
        </svg>
      );
    case "line":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          <path d="M1 11 L6 5 L10 8 L17 2" fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      );
    case "area":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          <path d="M1 11 L6 5 L10 8 L17 2 L17 13 L1 13 Z" fill={c} fillOpacity={0.3} stroke={c} strokeWidth={1.4} />
        </svg>
      );
    case "pie":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          <circle cx={9} cy={7} r={5.4} fill="none" stroke={c} strokeWidth={3} strokeDasharray="20 14" />
        </svg>
      );
    case "kpi":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          <text x={9} y={11} textAnchor="middle" fontSize={11} fontWeight={700} fill={c} fontFamily="monospace">
            42
          </text>
        </svg>
      );
    case "table":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          {[1, 5, 9].map((y) => (
            <rect key={y} x={1} y={y} width={16} height={3} fill={c} fillOpacity={y === 1 ? 0.9 : 0.35} rx={0.6} />
          ))}
        </svg>
      );
    case "pivot":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((cc) => (
              <rect
                key={r + "-" + cc}
                x={1 + cc * 5.6}
                y={1 + r * 4.4}
                width={4.6}
                height={3.4}
                fill={c}
                fillOpacity={r === 0 || cc === 0 ? 0.85 : 0.3}
                rx={0.6}
              />
            ))
          )}
        </svg>
      );
    case "text":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          {[2, 5.5, 9, 12].map((y, i) => (
            <rect key={y} x={1} y={y} width={i === 3 ? 9 : 16} height={1.6} fill={c} fillOpacity={0.6} rx={0.8} />
          ))}
        </svg>
      );
    case "heatmap":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2, 3].map((cc) => (
              <rect
                key={r + "-" + cc}
                x={1 + cc * 4.2}
                y={1 + r * 3.3}
                width={3.4}
                height={2.6}
                fill={c}
                fillOpacity={0.16 + ((r * 4 + cc) % 6) * 0.14}
                rx={0.5}
              />
            ))
          )}
        </svg>
      );
    case "scatter":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          {[[3, 10], [6, 6], [9, 8], [12, 3], [15, 5], [7, 11]].map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={1.3} fill={c} fillOpacity={0.75} />
          ))}
        </svg>
      );
    case "gauge":
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          <path d="M2 11 A7 7 0 0 1 16 11" fill="none" stroke={c} strokeWidth={2.2} strokeLinecap="round" strokeDasharray="14 30" />
        </svg>
      );
    case "map":
    default:
      return (
        <svg viewBox="0 0 18 14" style={style} className={className}>
          {[0, 1].map((r) =>
            [0, 1].map((cc) => (
              <rect
                key={r + "-" + cc}
                x={1.5 + cc * 8}
                y={1 + r * 6.5}
                width={7}
                height={5.5}
                fill={c}
                fillOpacity={0.3 + (r + cc) * 0.22}
                rx={1.2}
              />
            ))
          )}
        </svg>
      );
  }
}
