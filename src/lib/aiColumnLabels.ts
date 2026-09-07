import "server-only";

import { isPlaceholderColumnName } from "./columnNames";
import { getOpenAIClient, parseJsonContent } from "./openaiClient";
import { ColumnMeta } from "./types";

export interface ColumnLabelSheet {
  sheetName: string;
  columns: ColumnMeta[];
}

type AiResponse = { sheets?: Array<{ sheetName?: string; labels?: Record<string, unknown> }> };

function fallbackLabels(columns: ColumnMeta[]): Record<string, string> {
  const labels: Record<string, string> = {};
  columns.forEach((column, index) => {
    if (!isPlaceholderColumnName(column.name)) return;
    const suffix = column.name.match(/_(\d+)$/)?.[1];
    labels[column.name] = `Unlabeled field ${suffix ? Number(suffix) + 1 : index + 1}`;
  });
  return labels;
}

function usableLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.replace(/\s+/g, " ").trim().slice(0, 72);
  return label && !isPlaceholderColumnName(label) ? label : null;
}

/** Uses samples to replace only blank spreadsheet header placeholders. */
export async function suggestColumnLabels(sheets: ColumnLabelSheet[]): Promise<Record<string, Record<string, string>>> {
  const fallback = Object.fromEntries(sheets.map((sheet) => [sheet.sheetName, fallbackLabels(sheet.columns)]));
  const candidates = sheets
    .map((sheet) => ({
      sheetName: sheet.sheetName,
      columns: sheet.columns
        .filter((column) => isPlaceholderColumnName(column.name))
        .map((column) => ({ key: column.name, type: column.type, examples: column.sampleValues })),
    }))
    .filter((sheet) => sheet.columns.length > 0);
  if (candidates.length === 0) return fallback;

  const ai = await getOpenAIClient();
  if (!ai) return fallback;

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: Math.min(ai.maxTokens, 2_000),
      messages: [
        {
          role: "system",
          content:
            "You repair blank spreadsheet headers. For every supplied key, suggest one short, readable column label from its examples and type. " +
            "Never invent business meaning when the examples are ambiguous: use neutral labels such as Date, Text detail, Numeric value, or Identifier. " +
            'Return only JSON: {"sheets":[{"sheetName":"...","labels":{"__EMPTY":"Label"}}]}. Keep every supplied placeholder key unchanged as a mapping key.',
        },
        { role: "user", content: JSON.stringify({ sheets: candidates }) },
      ],
    });

    const parsed = parseJsonContent(completion.choices[0]?.message?.content) as AiResponse | null;
    if (!parsed?.sheets) return fallback;
    const bySheet = new Map(parsed.sheets.map((sheet) => [sheet.sheetName, sheet.labels]));

    return Object.fromEntries(
      sheets.map((sheet) => {
        const accepted = { ...fallback[sheet.sheetName] };
        const proposed = bySheet.get(sheet.sheetName);
        for (const column of sheet.columns) {
          if (!isPlaceholderColumnName(column.name)) continue;
          const label = usableLabel(proposed?.[column.name]);
          if (label) accepted[column.name] = label;
        }
        return [sheet.sheetName, accepted];
      })
    );
  } catch {
    return fallback;
  }
}
