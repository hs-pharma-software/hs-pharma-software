/** Google APIs with a service account (Search Console, Analytics). The key is
 * read from the environment (GOOGLE_SERVICE_ACCOUNT_JSON) and used only on the
 * server; scopes are read-only. Nothing here is ever logged or returned. */
import { createSign } from "node:crypto";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const SCOPES = {
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
};

export interface ServiceAccount { client_email: string; private_key: string; token_uri: string }

/** An HTTP call the Google code makes (injectable for tests). */
export type Http = (url: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; json: unknown }>;

export const defaultHttp: Http = async (url, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
};

/** Reads the service account from its JSON (plain or base64). Throws a plain message, never the key. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw?.trim()) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  let text = raw.trim();
  if (!text.startsWith("{")) {
    try { text = Buffer.from(text, "base64").toString("utf8"); } catch { /* not base64 */ }
  }
  let j: Partial<ServiceAccount> & { type?: string };
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!j.client_email || !j.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n"), token_uri: j.token_uri || "https://oauth2.googleapis.com/token" };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** The signed assertion exchanged for an access token (RS256, one hour). */
export function signedAssertion(sa: ServiceAccount, scope: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: sa.token_uri, iat, exp: iat + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(sa.private_key);
  return `${head}.${body}.${b64url(sig)}`;
}

const tokens = new Map<string, { token: string; until: number }>();

export async function accessToken(sa: ServiceAccount, scope: string, http: Http = defaultHttp): Promise<string> {
  const key = `${sa.client_email}|${scope}`;
  const hit = tokens.get(key);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const res = await http(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(sa, scope) }).toString(),
  });
  const j = res.json as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (res.status !== 200 || !j.access_token) throw new Error(`Google sign-in failed (${res.status}): ${j.error_description ?? j.error ?? "no token"}`);
  tokens.set(key, { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

/** Clears cached tokens (tests). */
export const clearTokens = () => tokens.clear();

/** A Google API call with a bearer token; a clear message on failure (no secrets in it). */
export async function googleCall<T>(http: Http, token: string, url: string, body?: unknown): Promise<T> {
  const res = await http(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status !== 200) {
    const e = (res.json as { error?: { message?: string; status?: string } }).error;
    const hint = res.status === 403 ? " Check that the service account is added to the property with read access." : "";
    throw new Error(`Google answered ${res.status}: ${e?.message ?? e?.status ?? "no details"}.${hint}`);
  }
  return res.json as T;
}

/** YYYY-MM-DD of a date offset by `days` (UTC). */
export const isoDay = (d: Date, days = 0) => new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
