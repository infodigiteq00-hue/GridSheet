import { fmtValueFull } from "./format";
import { StatsDigest } from "./statsDigest";

/**
 * Nice-to-have, no-API-key fallback for a handful of very common question
 * shapes ("total revenue", "best performing region", "average orders"...).
 * Returns null when the question doesn't confidently match a known pattern
 * — callers should show a friendly "needs an API key" message in that case
 * rather than guessing.
 */
export function heuristicChatAnswer(question: string, digest: StatsDigest): string | null {
  const q = question.toLowerCase();
  if (!digest.measures.length) return null;

  const namedDim = digest.dimensions.find((d) => q.includes(d.name.toLowerCase()));
  const namedMeasure = digest.measures.find((m) => q.includes(m.name.toLowerCase()));
  const measure = namedMeasure || digest.measures[0];

  if (/\b(best|top|highest|leading|most|biggest)\b/.test(q)) {
    const target = namedDim || digest.dimensions[0];
    if (target?.top.length) {
      return `${target.top[0].key} leads by ${target.leadMeasure || measure.name}, at ${fmtValueFull(target.top[0].value, target.leadMeasure || measure.name)}.`;
    }
  }

  if (/\btotal\b|\bsum\b/.test(q)) {
    return `Total ${measure.name} is ${fmtValueFull(measure.total, measure.name)} across ${digest.rowCount} records.`;
  }

  if (/\baverage\b|\bmean\b/.test(q)) {
    return `Average ${measure.name} is ${fmtValueFull(measure.average, measure.name)} per record.`;
  }

  if (/\bhow many\b|\brecord count\b|\bnumber of rows\b/.test(q)) {
    return `There are ${digest.rowCount} records in the current dataset.`;
  }

  if (digest.trend && /\btrend\b|\bgrowth\b|\bdeclin\w*\b|\bdrop\w*\b|\bincreas\w*\b/.test(q)) {
    const t = digest.trend;
    const verb = t.direction === "up" ? "increased" : t.direction === "down" ? "decreased" : "stayed roughly flat";
    return `${t.measure} has ${verb}${t.direction !== "flat" ? ` about ${Math.abs(t.pctChange)}%` : ""} from the first half of the period to the second.`;
  }

  return null;
}
