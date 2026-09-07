/**
 * Single-admin-credential session auth — appropriate for this app's actual
 * data model (everything lives in the browser's own localStorage; there is
 * no per-user database to authenticate against). The session cookie's value
 * is an HMAC of the logged-in email under a server-only secret, so it can't
 * be forged by setting a cookie by hand in devtools, without needing a
 * session store. Not a substitute for real multi-user auth if this app ever
 * grows a backend with per-user data.
 */

export const SESSION_COOKIE = "gridsheet_session";

const DEFAULT_EMAIL = "demo@gridsheet.app";
const DEFAULT_PASSWORD = "gridsheet2026";
// Only a fallback for local/demo use. Set AUTH_SESSION_SECRET in any shared
// or deployed environment — anyone who can read this source can otherwise
// forge session cookies.
const DEFAULT_SECRET = "gridsheet-demo-secret-change-me";

export function configuredEmail(): string {
  return process.env.AUTH_EMAIL?.trim() || DEFAULT_EMAIL;
}

function configuredPassword(): string {
  return process.env.AUTH_PASSWORD || DEFAULT_PASSWORD;
}

function sessionSecret(): string {
  return process.env.AUTH_SESSION_SECRET || DEFAULT_SECRET;
}

export function checkCredentials(email: string, password: string): boolean {
  return email.trim().toLowerCase() === configuredEmail().toLowerCase() && password === configuredPassword();
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(sessionSecret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cookie value proving a successful login. There's only one valid identity
 * in this single-admin-credential model, so the token doesn't need to encode
 * *which* email logged in — it's just proof of having passed checkCredentials
 * against the server's own configured email, verified by recomputing and
 * comparing directly (no delimiter/decoding step to get wrong). An earlier
 * version embedded the email in the token separated by ".", which broke for
 * any real email address — encodeURIComponent doesn't escape "." (it's an
 * RFC 3986 unreserved character), so "demo@gridsheet.app" splits into three
 * parts instead of the expected two.
 */
export async function makeSessionToken(): Promise<string> {
  return hmac(configuredEmail().toLowerCase());
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const expected = await hmac(configuredEmail().toLowerCase());
  return expected === token;
}
