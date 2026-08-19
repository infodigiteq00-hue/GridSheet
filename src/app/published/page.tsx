"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveDataset, useAppStore } from "@/lib/store";
import { slugify } from "@/lib/format";
import { boardGridStyle, gridPlacementStyle, asBox } from "@/lib/gridLayout";
import { useWidgetDataResolver } from "@/lib/useWidgetData";
import WidgetBody from "@/components/widgets/WidgetBody";
import SyncStatus from "@/components/SyncStatus";

export default function PublishedPage() {
  const router = useRouter();
  const dataset = useActiveDataset();
  const datasets = useAppStore((s) => s.datasets);
  const dashboard = useAppStore((s) => s.dashboard);
  const resolveWidget = useWidgetDataResolver();

  const rows = dataset?.rows ?? [];
  const slug = slugify(dashboard.boardTitle);

  if (dashboard.widgets.length === 0) {
    return (
      <main className="flex-1 grid place-items-center px-8 py-24 text-center">
        <div>
          <div className="font-display text-2xl font-bold mb-2">Nothing published yet</div>
          <p className="text-[#5c5b63] mb-6">Build a dashboard first, then publish it to see it here.</p>
          <Link href="/builder" className="inline-block border-0 bg-[#17161a] text-[#f8f7f4] px-6 py-3 rounded-[11px] text-[15px] font-semibold">
            Go to builder
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 bg-[#eeece6]">
      <div className="flex items-center gap-3.5 px-[30px] py-[13px] bg-[#fdfcfa]/[0.72] backdrop-blur-lg border-b border-[rgba(23,22,26,0.08)] flex-wrap">
        <div className="flex items-center gap-2 text-[13px] text-[#00806f] font-medium">
          <span className="w-[7px] h-[7px] rounded-full bg-[#00a6a6]" />
          Live · shared link
        </div>
        <div className="font-mono-plex text-[12.5px] text-[#7a7981] bg-[#f0eee8] px-[11px] py-1.5 rounded-[7px] truncate max-w-[280px]">
          gridsheet.app/d/{slug}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => router.push("/builder")}
          className="border border-[rgba(23,22,26,0.2)] bg-transparent px-[15px] py-2 rounded-[9px] text-[13.5px] cursor-pointer hover:bg-[rgba(23,22,26,0.05)]"
        >
          Edit dashboard
        </button>
      </div>
      <div className="max-w-[1240px] mx-auto px-[30px] pt-[34px] pb-20">
        <h2 className="font-display text-[34px] font-bold tracking-[-0.03em] mb-1.5">{dashboard.boardTitle}</h2>
        <div className="text-sm text-[#6b6a71] mb-[26px] flex items-center gap-3 flex-wrap">
          <span>
            Source: {dataset?.fileName ?? "sample data"} ·{" "}
            {datasets.length > 1
              ? `${datasets.length} sheets · ${datasets.reduce((n, d) => n + d.rows.length, 0).toLocaleString("en-US")} rows`
              : `${rows.length} rows`}
          </span>
          {dataset?.sourceUrl ? <SyncStatus compact /> : <span>· updated moments ago</span>}
        </div>
        <div className="relative" style={boardGridStyle()}>
          {dashboard.widgets.map((w) => {
            const data = resolveWidget(w);
            return (
            <div
              key={w.id}
              className="bg-[#fdfcfa] border border-[rgba(23,22,26,0.08)] rounded-[14px] shadow-[0_12px_28px_-24px_rgba(23,22,26,0.5)] flex flex-col overflow-hidden"
              style={gridPlacementStyle(asBox(w))}
            >
              <div className="px-[15px] pt-3 pb-1.5 font-display font-semibold tracking-[-0.015em]" style={{ fontSize: 14 * (w.fontScale || 1) }}>
                {w.title}
              </div>
              <div className="flex-1 min-h-0 px-[15px] pb-3.5 pt-0.5">
                <WidgetBody widget={w} rows={data.rows} columns={data.columns} />
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
