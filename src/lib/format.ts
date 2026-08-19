export function fmtShort(n: number): string {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return Math.round(n / 1000) + "k";
  return String(Math.round(n));
}

export function fmtFull(n: number): string {
  if (!isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

export function isMoneyLike(name: string): boolean {
  return /revenue|spend|sales|price|cost|profit|income|budget|amount|\$/i.test(name);
}

export function fmtValue(n: number, measureName: string): string {
  return isMoneyLike(measureName) ? "$" + fmtShort(n) : fmtFull(n);
}

/** Full, unrounded-looking precision counterpart to fmtValue — used in tooltips
 * where the abbreviated axis/label value ("$12k") isn't precise enough. */
export function fmtValueFull(n: number, measureName: string): string {
  return isMoneyLike(measureName) ? "$" + fmtFull(n) : fmtFull(n);
}

export function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "dashboard";
}
