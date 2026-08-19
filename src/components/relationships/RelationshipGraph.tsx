"use client";

import { Dataset, Relationship } from "@/lib/types";

/**
 * Hand-drawn SVG schema diagram: one node per imported sheet, one edge per
 * relationship. No chart library, matching the rest of the app.
 *
 * Sheets that aren't part of any relationship are pulled out into a muted row of
 * their own rather than floating in the graph, so "this sheet is an island" reads
 * as clearly as "these two sheets join".
 */

const VB_W = 760;
const NODE_W = 138;
const NODE_H = 46;
const ISLAND_ROW_H = 86;

interface Props {
  datasets: Dataset[];
  relationships: Relationship[];
  confirmedIds?: Set<string>;
  highlightId?: string | null;
  onHighlight?: (id: string | null) => void;
}

interface Point {
  x: number;
  y: number;
}

function layoutConnected(count: number, height: number): Point[] {
  const cy = height / 2;
  if (count === 0) return [];
  if (count === 1) return [{ x: VB_W / 2, y: cy }];
  if (count === 2) {
    return [
      { x: VB_W / 2 - 190, y: cy },
      { x: VB_W / 2 + 190, y: cy },
    ];
  }
  if (count === 3) {
    return [
      { x: VB_W / 2, y: cy - 62 },
      { x: VB_W / 2 - 210, y: cy + 58 },
      { x: VB_W / 2 + 210, y: cy + 58 },
    ];
  }
  const rx = count > 5 ? 285 : 255;
  const ry = Math.min(92, cy - NODE_H / 2 - 12);
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return { x: VB_W / 2 + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

function layoutIslands(count: number, y: number): Point[] {
  const gap = 16;
  const perRow = Math.max(1, Math.floor((VB_W - 40) / (NODE_W + gap)));
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const rowWidth = inRow * NODE_W + (inRow - 1) * gap;
    const startX = (VB_W - rowWidth) / 2 + NODE_W / 2;
    return { x: startX + (i % perRow) * (NODE_W + gap), y: y + row * (NODE_H + 14) };
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export default function RelationshipGraph({
  datasets,
  relationships,
  confirmedIds,
  highlightId = null,
  onHighlight,
}: Props) {
  const linked = new Set<string>();
  for (const rel of relationships) {
    linked.add(rel.fromDatasetId);
    linked.add(rel.toDatasetId);
  }
  const connected = datasets.filter((d) => linked.has(d.id));
  const islands = datasets.filter((d) => !linked.has(d.id));

  const connectedHeight = connected.length === 0 ? 0 : connected.length <= 2 ? 120 : 236;
  const islandRows = islands.length === 0 ? 0 : Math.ceil(islands.length / Math.floor((VB_W - 40) / (NODE_W + 16)));
  const vbH = connectedHeight + (islands.length ? ISLAND_ROW_H + (islandRows - 1) * (NODE_H + 14) : 0);

  const positions = new Map<string, Point>();
  layoutConnected(connected.length, connectedHeight).forEach((p, i) => positions.set(connected[i].id, p));
  layoutIslands(islands.length, connectedHeight + 40).forEach((p, i) => positions.set(islands[i].id, p));

  const edges = relationships
    .map((rel) => {
      const a = positions.get(rel.fromDatasetId);
      const b = positions.get(rel.toDatasetId);
      return a && b ? { rel, a, b } : null;
    })
    .filter((e): e is { rel: Relationship; a: Point; b: Point } => !!e);

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${Math.max(vbH, 120)}`}
      role="img"
      aria-label={`Schema diagram: ${datasets.length} sheets, ${relationships.length} connections`}
      className="w-full"
      style={{ display: "block", height: "auto", aspectRatio: `${VB_W} / ${Math.max(vbH, 120)}` }}
    >
      <defs>
        <marker id="rel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2b4bff" />
        </marker>
        <marker id="rel-arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#a3a2a9" />
        </marker>
      </defs>

      {edges.map(({ rel, a, b }) => {
        const active = highlightId === rel.id;
        const dim = highlightId !== null && !active;
        const strong = rel.confidence >= 0.65 || confirmedIds?.has(rel.id);
        const color = active ? "#2b4bff" : strong ? "#5f76ff" : "#a3a2a9";
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const label = truncate(rel.fromColumn, 18);
        const labelW = label.length * 6.6 + 14;

        return (
          <g
            key={rel.id}
            opacity={dim ? 0.26 : 1}
            onMouseEnter={() => onHighlight?.(rel.id)}
            onMouseLeave={() => onHighlight?.(null)}
            style={{ cursor: onHighlight ? "pointer" : "default" }}
          >
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={color}
              strokeWidth={active ? 2.6 : strong ? 1.8 : 1.2}
              strokeDasharray={strong ? undefined : "5 4"}
              markerEnd={strong ? "url(#rel-arrow)" : "url(#rel-arrow-muted)"}
            />
            <rect
              x={mx - labelW / 2}
              y={my - 10}
              width={labelW}
              height={20}
              rx={6}
              fill="#fdfcfa"
              stroke={active ? "#2b4bff" : "rgba(23,22,26,0.14)"}
            />
            <text
              x={mx}
              y={my + 4}
              textAnchor="middle"
              fill={active ? "#1a2fb8" : "#55545c"}
              style={{ fontSize: 11, fontFamily: "var(--font-plex-mono), monospace" }}
            >
              {label}
            </text>
          </g>
        );
      })}

      {islands.length > 0 && (
        <text
          x={VB_W / 2}
          y={connectedHeight + 14}
          textAnchor="middle"
          fill="#a3a2a9"
          style={{ fontSize: 10.5, letterSpacing: "0.06em", fontFamily: "var(--font-plex-mono), monospace" }}
        >
          NO CONNECTIONS FOUND
        </text>
      )}

      {datasets.map((d) => {
        const p = positions.get(d.id);
        if (!p) return null;
        const isIsland = !linked.has(d.id);
        const touched = edges.some(
          ({ rel }) => rel.id === highlightId && (rel.fromDatasetId === d.id || rel.toDatasetId === d.id)
        );
        const dim = highlightId !== null && !touched;
        return (
          <g key={d.id} opacity={dim ? 0.36 : isIsland ? 0.7 : 1}>
            <rect
              x={p.x - NODE_W / 2}
              y={p.y - NODE_H / 2}
              width={NODE_W}
              height={NODE_H}
              rx={11}
              fill={isIsland ? "#f7f5f1" : "#fdfcfa"}
              stroke={touched ? "#2b4bff" : isIsland ? "rgba(23,22,26,0.14)" : "rgba(23,22,26,0.2)"}
              strokeWidth={touched ? 1.8 : 1}
              strokeDasharray={isIsland ? "4 3" : undefined}
            />
            <text
              x={p.x}
              y={p.y - 3}
              textAnchor="middle"
              fill={isIsland ? "#6b6a71" : "#17161a"}
              style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-space-grotesk), sans-serif" }}
            >
              {truncate(d.label, 17)}
            </text>
            <text
              x={p.x}
              y={p.y + 13}
              textAnchor="middle"
              fill="#8a8990"
              style={{ fontSize: 10.5, fontFamily: "var(--font-plex-mono), monospace" }}
            >
              {d.rows.length.toLocaleString("en-US")} rows · {d.columns.length} cols
            </text>
          </g>
        );
      })}
    </svg>
  );
}
