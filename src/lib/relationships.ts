import { CellValue, ColumnMeta, Dataset, Relationship, RelationshipKind } from "./types";

/**
 * Detects foreign-key-like links between separately imported sheets.
 *
 * Three independent signals are combined, because any one of them alone
 * produces obvious false positives:
 *
 *  - value overlap ("containment"): what share of the child column's distinct
 *    values actually exist in the parent column. This is the strongest signal.
 *  - column-name affinity: exact matches, `customer_id` ↔ `Customers.id`
 *    conventions, shared stems after stripping key suffixes.
 *  - structure: whether exactly one side is unique, which is what makes a pair
 *    look like (foreign key → primary key) rather than a coincidence.
 *
 * Numeric ids are the classic trap: `Orders.order_id` 5001–5500 fully contains
 * `Suppliers.supplier_id` 1–30's range neighbours purely by accident. Dense
 * integer sequences are therefore treated as non-distinctive and need a real
 * name match before they can be linked.
 */

const MAX_ROWS_SCANNED = 20000;
const MAX_DISTINCT_TRACKED = 50000;
const UNIQUE_RATIO = 0.98;
const MIN_CONFIDENCE = 0.45;
/** Without a unique side there is no key, so a link needs real variety to be meaningful. */
const MIN_MANY_TO_MANY_DISTINCT = 8;

const KEY_SUFFIX_TOKENS = new Set(["id", "ids", "key", "keys", "code", "codes", "no", "num", "number", "ref", "fk", "pk"]);

export interface DetectionSummary {
  relationships: Relationship[];
  comparedPairs: number;
}

interface ColumnProfile {
  datasetId: string;
  datasetLabel: string;
  name: string;
  type: ColumnMeta["type"];
  values: Set<string>;
  nonEmptyCount: number;
  distinct: number;
  unique: boolean;
  distinctive: boolean;
  stemTokens: string[];
  normalizedName: string;
}

/* ------------------------------------------------------------------ naming */

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenize(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function singularize(s: string): string {
  if (s.length < 4) return s;
  if (s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (/(sses|shes|ches|xes|ses)$/.test(s)) return s.slice(0, -2);
  if (s.endsWith("ss")) return s;
  if (s.endsWith("s")) return s.slice(0, -1);
  return s;
}

/** Tokens with key suffixes ("id", "code", …) removed — the semantic stem of a column name. */
function stemTokens(name: string): string[] {
  const tokens = tokenize(name).map(singularize);
  const stripped = tokens.filter((t) => !KEY_SUFFIX_TOKENS.has(t));
  return stripped.length ? stripped : [];
}

function isBareKeyName(name: string): boolean {
  const tokens = tokenize(name).map(singularize);
  return tokens.length > 0 && tokens.every((t) => KEY_SUFFIX_TOKENS.has(t));
}

/** True for "id", "customer_id", "account code", "orderNo" — names that announce a key. */
function isKeyLikeName(name: string): boolean {
  return tokenize(name).map(singularize).some((t) => KEY_SUFFIX_TOKENS.has(t));
}

/** Strips a file extension and sheet decoration so "Customers (2024).csv" reads as "customer". */
function tableStem(label: string): string {
  const tokens = tokenize(label.replace(/\.[a-z0-9]+$/i, "")).map(singularize);
  return tokens.filter((t) => !KEY_SUFFIX_TOKENS.has(t)).join("");
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  const unionSize = new Set([...sa, ...sb]).size;
  return unionSize === 0 ? 0 : shared / unionSize;
}

export function scoreColumnNames(a: ColumnProfile, b: ColumnProfile): { score: number; reason: string | null } {
  if (a.normalizedName === b.normalizedName) {
    return { score: 1, reason: `Both columns are named “${a.name}”` };
  }

  const aStem = a.stemTokens.join("");
  const bStem = b.stemTokens.join("");

  // customer_id ↔ Customers.id
  const aTable = tableStem(a.datasetLabel);
  const bTable = tableStem(b.datasetLabel);
  if (aStem && isBareKeyName(b.name) && aStem === bTable) {
    return { score: 0.93, reason: `“${a.name}” matches the ${b.datasetLabel} sheet’s own key` };
  }
  if (bStem && isBareKeyName(a.name) && bStem === aTable) {
    return { score: 0.93, reason: `“${b.name}” matches the ${a.datasetLabel} sheet’s own key` };
  }

  if (aStem && aStem === bStem) {
    return { score: 0.88, reason: `“${a.name}” and “${b.name}” share the key stem “${aStem}”` };
  }

  if (aStem && bStem && (aStem.includes(bStem) || bStem.includes(aStem))) {
    return { score: 0.66, reason: `“${a.name}” and “${b.name}” have overlapping names` };
  }

  const j = jaccard(a.stemTokens, b.stemTokens);
  if (j > 0) return { score: 0.6 * j, reason: `Partial name overlap between “${a.name}” and “${b.name}”` };

  return { score: 0, reason: null };
}

/* ----------------------------------------------------------------- values */

function normalizeValue(v: CellValue | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    return isFinite(v) ? String(v) : null;
  }
  const s = String(v).trim();
  if (s === "") return null;
  // "1001" and 1001 must be treated as the same key.
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (isFinite(n)) return String(n);
  }
  return s.toLowerCase();
}

/**
 * Dense integer sequences (1,2,3,…n) collide across unrelated sheets constantly,
 * so they only count as evidence when the column names also agree.
 */
function isDistinctive(values: Set<string>): boolean {
  if (values.size < 2) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!/^-?\d+$/.test(v)) return true; // any non-integer token makes the set distinctive
    const n = Number(v);
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const span = max - min + 1;
  if (span <= 0) return false;
  return values.size / span < 0.9;
}

function profileColumn(dataset: Dataset, column: ColumnMeta): ColumnProfile | null {
  const rows = dataset.rows.length > MAX_ROWS_SCANNED ? dataset.rows.slice(0, MAX_ROWS_SCANNED) : dataset.rows;
  const values = new Set<string>();
  let nonEmptyCount = 0;
  let lengthSum = 0;
  let decimalCount = 0;

  for (const row of rows) {
    const norm = normalizeValue(row[column.name]);
    if (norm === null) continue;
    nonEmptyCount += 1;
    lengthSum += norm.length;
    if (/\.\d/.test(norm)) decimalCount += 1;
    if (values.size < MAX_DISTINCT_TRACKED) values.add(norm);
  }

  if (nonEmptyCount < 2 || values.size < 2) return null;

  // Free-text columns (notes, addresses) and continuous numerics (prices,
  // amounts) are never join keys.
  const avgLength = lengthSum / nonEmptyCount;
  if (avgLength > 40) return null;
  if (decimalCount / nonEmptyCount > 0.3) return null;

  return {
    datasetId: dataset.id,
    datasetLabel: dataset.label,
    name: column.name,
    type: column.type,
    values,
    nonEmptyCount,
    distinct: values.size,
    unique: values.size / nonEmptyCount >= UNIQUE_RATIO,
    distinctive: isDistinctive(values),
    stemTokens: stemTokens(column.name),
    normalizedName: normalizeName(column.name),
  };
}

function typesCompatible(a: ColumnProfile, b: ColumnProfile): boolean {
  if (a.type === b.type) return true;
  // Ids frequently come back as text from one source and numbers from another.
  const loose = (t: ColumnMeta["type"]) => t === "text" || t === "number";
  return loose(a.type) && loose(b.type);
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const v of small) if (large.has(v)) n += 1;
  return n;
}

/* ------------------------------------------------------------------ scoring */

function structureScore(aUnique: boolean, bUnique: boolean): number {
  if (aUnique !== bUnique) return 1;
  if (aUnique && bUnique) return 0.7;
  return 0.25;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Direction-independent so a Confirm/Dismiss survives re-detection flipping the sides. */
export function relationshipId(aId: string, aCol: string, bId: string, bCol: string): string {
  const left = `${aId}::${aCol}`;
  const right = `${bId}::${bCol}`;
  return left <= right ? `${left}~${right}` : `${right}~${left}`;
}

function evaluatePair(a: ColumnProfile, b: ColumnProfile): Relationship | null {
  if (!typesCompatible(a, b)) return null;

  const matched = intersectionSize(a.values, b.values);
  if (matched < 2) return null;

  const overlapA = matched / a.distinct;
  const overlapB = matched / b.distinct;
  const bestOverlap = Math.max(overlapA, overlapB);

  const { score: nameScore, reason: nameReason } = scoreColumnNames(a, b);
  const distinctive = a.distinctive && b.distinctive;
  const oneSideUnique = a.unique !== b.unique;

  // A numeric column that doesn't announce itself as a key ("amount", "year", a
  // row counter) is only plausible when its values look like identifiers rather
  // than a counter. Names like `customer_id` are exempt.
  const counterish = (p: ColumnProfile) => p.type === "number" && !isKeyLikeName(p.name);
  if ((counterish(a) || counterish(b)) && !distinctive) return null;

  // With no unique side there's no parent table, so yes/no flags and 3-value
  // status columns would otherwise link every sheet to every other sheet.
  if (!a.unique && !b.unique) {
    if (a.distinct < MIN_MANY_TO_MANY_DISTINCT || b.distinct < MIN_MANY_TO_MANY_DISTINCT) return null;
  }

  // Low-cardinality categoricals ("region" vs "segment") and dense integer id
  // ranges both need a genuine name match before they count.
  const lowCardinality = a.distinct <= 3 || b.distinct <= 3;
  if (nameScore < 0.45) {
    if (!distinctive) return null;
    if (!oneSideUnique) return null;
    if (bestOverlap < 0.9) return null;
    if (lowCardinality) return null;
  } else if (nameScore < 0.85) {
    if (bestOverlap < 0.5) return null;
    if (lowCardinality && !distinctive) return null;
  } else if (bestOverlap < 0.2) {
    return null;
  }

  // Orient the link as (many → one) whenever one side looks like a primary key.
  let from = a;
  let to = b;
  if (a.unique && !b.unique) {
    from = b;
    to = a;
  }

  const kind: RelationshipKind =
    a.unique && b.unique ? "one-to-one" : a.unique || b.unique ? "one-to-many" : "many-to-many";

  const overlapFrom = from === a ? overlapA : overlapB;
  const overlapTo = from === a ? overlapB : overlapA;

  // Score on the child → parent direction when there is one: "how many of the
  // child's keys actually resolve" is what referential integrity means. With no
  // clear parent, direction is arbitrary, so take the better of the two.
  const containment = oneSideUnique ? overlapFrom : bestOverlap;

  const confidence = Math.min(
    1,
    0.62 * containment + 0.2 * nameScore + 0.18 * structureScore(a.unique, b.unique)
  );
  if (confidence < MIN_CONFIDENCE) return null;

  const evidence: string[] = [
    `${matched.toLocaleString("en-US")} of ${from.distinct.toLocaleString("en-US")} distinct ${from.datasetLabel}.${from.name} values matched (${pct(overlapFrom)})`,
  ];
  if (to.unique) {
    evidence.push(`${to.datasetLabel}.${to.name} is unique across ${to.nonEmptyCount.toLocaleString("en-US")} rows — it reads as a primary key`);
  } else if (kind === "many-to-many") {
    evidence.push("Neither side is unique, so this reads as a many-to-many bridge");
  }
  if (nameReason) evidence.push(nameReason);
  if (from.type !== to.type) evidence.push(`Types differ (${from.type} vs ${to.type}) but values still line up`);

  return {
    id: relationshipId(a.datasetId, a.name, b.datasetId, b.name),
    fromDatasetId: from.datasetId,
    fromColumn: from.name,
    toDatasetId: to.datasetId,
    toColumn: to.name,
    kind,
    confidence,
    matchedValues: matched,
    fromDistinct: from.distinct,
    toDistinct: to.distinct,
    overlapFrom,
    overlapTo,
    nameScore,
    evidence,
    origin: "detected",
  };
}

/* -------------------------------------------------------------------- entry */

export function detectRelationships(datasets: Dataset[]): Relationship[] {
  if (datasets.length < 2) return [];

  const profiles = new Map<string, ColumnProfile[]>();
  for (const ds of datasets) {
    const list: ColumnProfile[] = [];
    for (const col of ds.columns) {
      const p = profileColumn(ds, col);
      if (p) list.push(p);
    }
    profiles.set(ds.id, list);
  }

  const found = new Map<string, Relationship>();

  for (let i = 0; i < datasets.length; i += 1) {
    for (let j = i + 1; j < datasets.length; j += 1) {
      const left = profiles.get(datasets[i].id) || [];
      const right = profiles.get(datasets[j].id) || [];
      for (const a of left) {
        for (const b of right) {
          const rel = evaluatePair(a, b);
          if (!rel) continue;
          const existing = found.get(rel.id);
          if (!existing || rel.confidence > existing.confidence) found.set(rel.id, rel);
        }
      }
    }
  }

  // One sheet pair can legitimately share several keys, but a single column
  // shouldn't be reported against five different columns of the same sheet —
  // keep only its best link per target sheet.
  const bestPerColumnPair = new Map<string, Relationship>();
  for (const rel of found.values()) {
    const key = `${rel.fromDatasetId}::${rel.fromColumn}->${rel.toDatasetId}`;
    const existing = bestPerColumnPair.get(key);
    if (!existing || rel.confidence > existing.confidence) bestPerColumnPair.set(key, rel);
  }

  return [...bestPerColumnPair.values()].sort((x, y) => y.confidence - x.confidence);
}

/* ------------------------------------------------------------------ helpers */

export function relationshipsForDataset(relationships: Relationship[], datasetId: string | null): Relationship[] {
  if (!datasetId) return [];
  return relationships.filter((r) => r.fromDatasetId === datasetId || r.toDatasetId === datasetId);
}

/** From the perspective of `datasetId`: which column joins out, and to where. */
export function relationshipEndpoints(rel: Relationship, datasetId: string) {
  if (rel.fromDatasetId === datasetId) {
    return { localColumn: rel.fromColumn, otherDatasetId: rel.toDatasetId, otherColumn: rel.toColumn };
  }
  return { localColumn: rel.toColumn, otherDatasetId: rel.fromDatasetId, otherColumn: rel.fromColumn };
}

export const KIND_LABEL: Record<RelationshipKind, string> = {
  "one-to-one": "One-to-one",
  "one-to-many": "One-to-many",
  "many-to-many": "Many-to-many",
};

export function confidenceLabel(confidence: number): "Strong" | "Likely" | "Possible" {
  if (confidence >= 0.85) return "Strong";
  if (confidence >= 0.65) return "Likely";
  return "Possible";
}

export function buildManualRelationship(opts: {
  datasets: Dataset[];
  fromDatasetId: string;
  fromColumn: string;
  toDatasetId: string;
  toColumn: string;
}): Relationship | null {
  const from = opts.datasets.find((d) => d.id === opts.fromDatasetId);
  const to = opts.datasets.find((d) => d.id === opts.toDatasetId);
  if (!from || !to || from.id === to.id) return null;
  const fromCol = from.columns.find((c) => c.name === opts.fromColumn);
  const toCol = to.columns.find((c) => c.name === opts.toColumn);
  if (!fromCol || !toCol) return null;

  const fromProfile = profileColumn(from, fromCol);
  const toProfile = profileColumn(to, toCol);
  const matched = fromProfile && toProfile ? intersectionSize(fromProfile.values, toProfile.values) : 0;
  const fromDistinct = fromProfile?.distinct ?? 0;
  const toDistinct = toProfile?.distinct ?? 0;

  return {
    id: relationshipId(from.id, fromCol.name, to.id, toCol.name),
    fromDatasetId: from.id,
    fromColumn: fromCol.name,
    toDatasetId: to.id,
    toColumn: toCol.name,
    kind: toProfile?.unique ? (fromProfile?.unique ? "one-to-one" : "one-to-many") : "many-to-many",
    confidence: 1,
    matchedValues: matched,
    fromDistinct,
    toDistinct,
    overlapFrom: fromDistinct ? matched / fromDistinct : 0,
    overlapTo: toDistinct ? matched / toDistinct : 0,
    nameScore: 0,
    evidence: [
      "Added by hand",
      fromDistinct
        ? `${matched.toLocaleString("en-US")} of ${fromDistinct.toLocaleString("en-US")} distinct ${from.label}.${fromCol.name} values matched`
        : "No comparable values found — the join may return blanks",
    ],
    origin: "manual",
  };
}
