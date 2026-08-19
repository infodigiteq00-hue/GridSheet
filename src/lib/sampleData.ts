import { ColumnMeta, DatasetInput, Row } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REGIONS = ["North", "South", "East", "West"];
const REPS = ["Ada L.", "Ben O.", "Cleo R.", "Dara S."];

export function buildSampleRows(): Row[] {
  const rows: Row[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  MONTHS.forEach((m, mi) => {
    REGIONS.forEach((r, ri) => {
      const base = 38000 + ri * 9000 + mi * 2100 + rnd() * 16000;
      const units = Math.round(base / (120 + ri * 14));
      rows.push({
        Month: m,
        Quarter: "Q" + (Math.floor(mi / 3) + 1),
        Region: r,
        Rep: REPS[(mi + ri) % 4],
        Revenue: Math.round(base),
        Units: units,
        Orders: Math.round(units / (2.4 + rnd())),
        "Ad Spend": Math.round(base * (0.11 + rnd() * 0.07)),
      });
    });
  });
  return rows;
}

export function sampleColumns(): ColumnMeta[] {
  return [
    { name: "Month", type: "text", role: "dimension", sampleValues: ["Jan", "Feb", "Mar"], cardinality: 12 },
    { name: "Quarter", type: "text", role: "dimension", sampleValues: ["Q1", "Q2", "Q3"], cardinality: 4 },
    { name: "Region", type: "text", role: "dimension", sampleValues: ["North", "South", "East"], cardinality: 4 },
    { name: "Rep", type: "text", role: "dimension", sampleValues: ["Ada L.", "Ben O."], cardinality: 4 },
    { name: "Revenue", type: "number", role: "measure", sampleValues: ["41,208", "52,940"], cardinality: 48 },
    { name: "Units", type: "number", role: "measure", sampleValues: ["342", "411"], cardinality: 48 },
    { name: "Orders", type: "number", role: "measure", sampleValues: ["142", "168"], cardinality: 48 },
    { name: "Ad Spend", type: "number", role: "measure", sampleValues: ["5,190", "6,402"], cardinality: 48 },
  ];
}

export function buildSampleDataset(): DatasetInput {
  return {
    fileName: "q3-regional-performance.xlsx",
    sheetName: "Sheet1",
    label: "Regional sales",
    rows: buildSampleRows(),
    columns: sampleColumns(),
    isSample: true,
  };
}
