"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useActiveDataset, useAppStore } from "@/lib/store";
import { generateHeuristicLayout, TemplateKind } from "@/lib/heuristicLayout";
import { buildSampleDataset } from "@/lib/sampleData";
import TemplateThumb from "@/components/TemplateThumb";

const TEMPLATES: { key: TemplateKind; name: string; desc: string }[] = [
  { key: "overview", name: "Full overview", desc: "KPI row, trend, share, and a pivot — the safe default for any sheet." },
  { key: "kpi", name: "KPI wall", desc: "Four headline numbers up top, one trend line and a share donut beneath." },
  { key: "table", name: "Tables first", desc: "For sheets people still want to read row by row, with a heatmap for context." },
  { key: "exec", name: "Exec one-pager", desc: "A written summary next to one trend, then three numbers. Nothing else." },
];

export default function TemplatesPage() {
  const router = useRouter();
  const dataset = useActiveDataset();
  const addDatasets = useAppStore((s) => s.addDatasets);
  const setDashboard = useAppStore((s) => s.setDashboard);

  function applyTemplate(kind: TemplateKind) {
    const ds = dataset || buildSampleDataset();
    let datasetId = dataset?.id;
    if (!dataset) [datasetId] = addDatasets([ds]);
    const layout = generateHeuristicLayout(
      ds.columns,
      kind,
      ds.fileName === "q3-regional-performance.xlsx" ? "Q3 Regional Performance" : undefined
    );
    setDashboard(layout, "heuristic", datasetId);
    router.push("/builder");
  }

  return (
    <main className="flex-1 w-full max-w-[1160px] mx-auto px-8 pt-[46px] pb-[90px]">
      <h2 className="font-display text-[38px] font-bold tracking-[-0.03em] mb-2">Start from a layout</h2>
      <p className="text-base text-[#5c5b63] mb-7">
        Each template is just a starting arrangement — every tile stays fully editable after.
        {!dataset && (
          <>
            {" "}
            No file loaded yet, so these use sample data.{" "}
            <Link href="/upload" className="text-[#2b4bff] hover:text-[#1a2fb8]">
              Upload your own
            </Link>
            .
          </>
        )}
      </p>
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {TEMPLATES.map((t) => (
          <div
            key={t.key}
            onClick={() => applyTemplate(t.key)}
            className="bg-[#fdfcfa] border border-[rgba(23,22,26,0.1)] rounded-2xl overflow-hidden cursor-pointer transition-transform hover:-translate-y-[3px] hover:shadow-[0_18px_40px_-26px_rgba(23,22,26,0.5)]"
          >
            <div className="h-[132px] bg-[#f2efe9] p-3.5 grid gap-1.5">
              <TemplateThumb kind={t.key} />
            </div>
            <div className="px-[18px] pt-4 pb-[18px]">
              <div className="font-display text-[17px] font-semibold tracking-[-0.02em] mb-1.5">{t.name}</div>
              <div className="text-[13.5px] text-[#6b6a71] leading-[1.5]">{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
