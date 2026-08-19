export interface NormalizedLink {
  fetchUrl: string;
  suggestedName: string;
  kind: "google-sheets" | "dropbox" | "direct";
}

const GOOGLE_SHEETS_RE = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

export function normalizeSpreadsheetLink(rawUrl: string): NormalizedLink {
  const url = rawUrl.trim();
  const parsed = new URL(url);

  const googleMatch = url.match(GOOGLE_SHEETS_RE);
  if (googleMatch) {
    const id = googleMatch[1];
    const gidMatch = url.match(/[?#&]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : "0";
    return {
      fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,
      suggestedName: "Google Sheet",
      kind: "google-sheets",
    };
  }

  if (parsed.hostname.includes("dropbox.com")) {
    parsed.searchParams.set("dl", "1");
    return { fetchUrl: parsed.toString(), suggestedName: fileNameFromUrl(parsed), kind: "dropbox" };
  }

  return { fetchUrl: parsed.toString(), suggestedName: fileNameFromUrl(parsed), kind: "direct" };
}

function fileNameFromUrl(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop();
  return last && last.length > 0 ? decodeURIComponent(last) : "linked-spreadsheet";
}
