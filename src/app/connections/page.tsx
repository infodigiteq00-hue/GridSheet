"use client";

import Link from "next/link";
import { useAppStore } from "@/lib/store";
import DatasetList from "@/components/datasets/DatasetList";
import RelationshipsPanel from "@/components/relationships/RelationshipsPanel";

export default function ConnectionsPage() {
  const datasets = useAppStore((s) => s.datasets);

  return (
    <main className="flex-1 w-full max-w-[1000px] mx-auto px-8 pt-[46px] pb-[90px]">
      <div className="font-mono-plex text-xs text-[#8a8990] mb-2.5">HOW YOUR SHEETS FIT TOGETHER</div>
      <h2 className="font-display text-[38px] font-bold tracking-[-0.03em] mb-2">Connections</h2>
      <p className="text-base text-[#5c5b63] mb-8 max-w-[620px] leading-[1.55]">
        Every pair of columns across your sheets is compared on shared values, naming conventions and uniqueness.
        Anything that looks like a shared key shows up here — confirm the ones that are real, dismiss the ones that
        aren&apos;t, and then group any tile by a field from a connected sheet in the{" "}
        <Link href="/builder" className="text-[#2b4bff] hover:text-[#1a2fb8]">
          builder
        </Link>
        .
      </p>

      {datasets.length > 0 && (
        <div className="mb-8">
          <DatasetList />
        </div>
      )}

      <RelationshipsPanel variant="full" showHeader={datasets.length >= 2} />
    </main>
  );
}
