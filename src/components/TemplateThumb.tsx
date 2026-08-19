const SPECS: Record<string, number[]> = {
  overview: [3, 3, 3, 3, 8, 4],
  kpi: [3, 3, 3, 3, 12],
  table: [7, 5, 6, 6],
  exec: [5, 7, 4, 4, 4],
};

const COLORS = ["#2b4bff", "#00a6a6", "#ffb020", "#ff5c46", "#7b5cff", "#17161a"];

export default function TemplateThumb({ kind }: { kind: string }) {
  const spec = SPECS[kind] || SPECS.overview;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 5, alignContent: "start" }}>
      {spec.map((sp, i) => (
        <div
          key={i}
          style={{
            gridColumn: `span ${sp}`,
            height: i < 4 ? 28 : 48,
            borderRadius: 5,
            background: COLORS[i % COLORS.length],
            opacity: 0.16 + (i % 3) * 0.1,
            border: "1px solid rgba(23,22,26,0.09)",
          }}
        />
      ))}
    </div>
  );
}
