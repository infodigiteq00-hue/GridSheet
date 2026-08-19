"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { buildSampleDataset } from "@/lib/sampleData";
import { generateHeuristicLayout } from "@/lib/heuristicLayout";
import Palette from "@/components/builder/Palette";
import Canvas from "@/components/builder/Canvas";
import Inspector from "@/components/builder/Inspector";
import ChatPanel from "@/components/builder/ChatPanel";

export default function BuilderPage() {
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const datasetCount = useAppStore((s) => s.datasets.length);
  const addDatasets = useAppStore((s) => s.addDatasets);
  const setDashboard = useAppStore((s) => s.setDashboard);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if (hasHydrated && datasetCount === 0) {
      const sample = buildSampleDataset();
      const [id] = addDatasets([sample]);
      setDashboard(generateHeuristicLayout(sample.columns, "overview", "Q3 Regional Performance"), null, id);
    }
  }, [hasHydrated, datasetCount, addDatasets, setDashboard]);

  return (
    <>
      <main className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "208px minmax(0, 1fr) 296px" }}>
        <Palette />
        <Canvas chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} />
        <Inspector />
      </main>
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </>
  );
}
