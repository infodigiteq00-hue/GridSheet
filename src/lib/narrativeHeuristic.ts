import { fmtValueFull } from "./format";
import { StatsDigest } from "./statsDigest";

/**
 * Template-based narrative used whenever OPENAI_API_KEY isn't configured.
 * Reads directly off the same stats digest the AI path would send to
 * OpenAI, so the fallback stays genuinely informative rather than a stub.
 */
export function generateHeuristicNarrative(digest: StatsDigest): string {
  if (!digest.measures.length || !digest.rowCount) {
    return "Not enough numeric data to summarize yet — add a measure column or more rows to generate an insight.";
  }

  const lead = digest.measures[0];
  const dim = digest.dimensions[0];
  const sentences: string[] = [];

  if (dim && dim.top.length) {
    const top = dim.top[0];
    const share = lead.total ? Math.round((top.value / lead.total) * 100) : 0;
    sentences.push(
      `Total ${lead.name} is ${fmtValueFull(lead.total, lead.name)} across ${dim.distinctCount || dim.top.length} ${pluralize(dim.name)}, led by ${top.key} at ${fmtValueFull(top.value, lead.name)}${share ? ` (${share}% of the total)` : ""}.`
    );
  } else {
    sentences.push(`Total ${lead.name} is ${fmtValueFull(lead.total, lead.name)} across ${digest.rowCount} records.`);
  }

  if (digest.trend) {
    const verb = digest.trend.direction === "up" ? "climbed" : digest.trend.direction === "down" ? "declined" : "held roughly flat";
    sentences.push(
      `${digest.trend.measure} has ${verb}${digest.trend.direction !== "flat" ? ` ${Math.abs(digest.trend.pctChange)}%` : ""} from the first half of the period to the second.`
    );
  }

  const second = digest.measures[1];
  if (second) {
    sentences.push(`${second.name} averages ${fmtValueFull(second.average, second.name)} per record, for a total of ${fmtValueFull(second.total, second.name)}.`);
  }

  const dim2 = digest.dimensions[1];
  if (dim2 && dim2.top.length && sentences.length < 4) {
    sentences.push(`By ${dim2.name.toLowerCase()}, ${dim2.top[0].key} leads with ${fmtValueFull(dim2.top[0].value, lead.name)}.`);
  }

  return sentences.slice(0, 4).join(" ");
}

function pluralize(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith("s") ? lower : lower + "s";
}
