"use client";

import DataPanel from "@/components/builder/DataPanel";

export default function Palette() {
  return (
    <aside className="min-h-0 border-r border-[rgba(23,22,26,0.09)] px-3.5 py-[18px] bg-[#f0eee8] flex flex-col gap-1.5 overflow-y-auto">
      <DataPanel />
    </aside>
  );
}
