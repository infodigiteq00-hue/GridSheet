import Link from "next/link";
import { generateHeuristicLayout } from "@/lib/heuristicLayout";
import { asBox, boardGridStyle, gridPlacementStyle } from "@/lib/gridLayout";
import { buildSampleRows, sampleColumns } from "@/lib/sampleData";
import WidgetBody from "@/components/widgets/WidgetBody";

const FEATURES = [
  {
    tag: "01 / READ",
    title: "It reads the sheet, not just the cells",
    body: "Column types, date columns, and measures are detected on import — so the first draft already groups by the right dimension and sums the right numbers.",
  },
  {
    tag: "02 / SHAPE",
    title: "Any number, any shape",
    body: "Swap a bar for a donut, a pivot table, a heatmap, or a plain sentence. Same data, twelve ways to show it, one click apart.",
  },
  {
    tag: "03 / OWN",
    title: "Every tile is yours to tune",
    body: "Width, height, palette, type size, sort order, top-N. Drag a tile into empty space, snap it so it never covers another, drag the corner to resize. No template lock-in.",
  },
];

export default function LandingPage() {
  const columns = sampleColumns();
  const rows = buildSampleRows();
  const preview = generateHeuristicLayout(columns, "kpi", "Q3 Regional Performance");

  return (
    <main className="flex-1 flex flex-col items-center">
      <section className="w-full max-w-[1080px] px-8 pt-[92px] pb-16 text-center">
        <div className="inline-flex items-center gap-2 pl-2 pr-3.5 py-1.5 rounded-full bg-[#e7e4dc] text-[12.5px] text-[#4a4952] mb-[30px]">
          <span className="inline-grid place-items-center w-[19px] h-[19px] rounded-full bg-[#2b4bff] text-white text-[11px] font-semibold">1</span>
          One spreadsheet in. A dashboard you actually own out.
        </div>
        <h1
          className="font-display font-bold mb-6"
          style={{
            fontSize: "clamp(44px, 7vw, 82px)",
            lineHeight: 0.98,
            letterSpacing: "-0.035em",
            textWrap: "balance",
          }}
        >
          Your Excel file,
          <br />
          rebuilt as something
          <br />
          worth looking at.
        </h1>
        <p className="max-w-[560px] mx-auto mb-[38px] text-[18px] leading-[1.55] text-[#55545c]" style={{ textWrap: "pretty" }}>
          Drop in a sheet. Gridsheet reads your columns, lays out a first AI-drafted dashboard, then hands you the
          controls — every tile can change shape, chart type, palette, and type size until it looks like yours.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/upload"
            className="border-0 bg-[#17161a] text-[#f8f7f4] px-[26px] py-[15px] rounded-[11px] text-[15px] font-semibold tracking-[-0.01em] transition-transform active:scale-[0.975] inline-block"
          >
            Upload a spreadsheet
          </Link>
          <Link
            href="/templates"
            className="bg-transparent text-[#17161a] px-6 py-[15px] rounded-[11px] border border-[rgba(23,22,26,0.22)] text-[15px] font-medium transition-transform hover:bg-[rgba(23,22,26,0.045)] active:scale-[0.975] inline-block"
          >
            Browse templates
          </Link>
        </div>
      </section>

      <section className="w-full max-w-[1160px] px-8 pb-10">
        <div className="rounded-[20px] bg-[#fdfcfa] border border-[rgba(23,22,26,0.1)] shadow-[0_30px_70px_-40px_rgba(23,22,26,0.45)] overflow-hidden">
          <div className="flex items-center gap-[7px] px-4 py-3 border-b border-[rgba(23,22,26,0.08)] bg-[#f7f5f1]">
            <div className="w-[9px] h-[9px] rounded-full bg-[#ff5c46]" />
            <div className="w-[9px] h-[9px] rounded-full bg-[#ffb020]" />
            <div className="w-[9px] h-[9px] rounded-full bg-[#00a6a6]" />
            <div className="ml-3 text-xs text-[#7a7981] font-mono-plex">q3-regional-performance.xlsx → dashboard</div>
          </div>
          <div className="p-[22px]">
            <div className="relative" style={boardGridStyle()}>
              {preview.widgets.map((w, i) => (
                <div
                  key={w.id}
                  className="bg-[#fdfcfa] border border-[rgba(23,22,26,0.09)] rounded-xl flex flex-col"
                  style={{
                    ...gridPlacementStyle({ ...asBox(w), height: Math.round(w.height * 0.78) }),
                    padding: "11px 13px",
                    animation: `gsRise 520ms cubic-bezier(0.22,1,0.36,1) ${i * 55}ms both`,
                  }}
                >
                  <div className="font-display font-semibold text-[12.5px] mb-1.5 tracking-[-0.01em]">{w.title}</div>
                  <div className="flex-1 min-h-0">
                    <WidgetBody widget={w} rows={rows} columns={columns} scale={0.86} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="w-full max-w-[1160px] px-8 pt-[46px] pb-24 grid gap-[18px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
        {FEATURES.map((f) => (
          <div key={f.tag} className="bg-[#fdfcfa] border border-[rgba(23,22,26,0.09)] rounded-[15px] p-[22px]">
            <div className="font-mono-plex text-[11.5px] text-[#2b4bff] mb-3.5">{f.tag}</div>
            <div className="font-display text-[19px] font-semibold tracking-[-0.02em] mb-2">{f.title}</div>
            <div className="text-[14.5px] leading-[1.55] text-[#5c5b63]" style={{ textWrap: "pretty" }}>
              {f.body}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
