import { BRANCH_TAB_KEY, BRANCH_UNAVAILABLE } from "@/config/branchTables";
import { desktopBridge } from "./desktopBridge";
/** The web version reaches the database through the server (/api/db) instead
 * of holding a database token in the page. Set NEXT_PUBLIC_DB_MODE=server in
 * Vercel to switch it on (see docs/server-layer.md). The desktop app keeps its
 * local database and syncs it through the same server (desktopViaServer). */
export const SERVER_DB = process.env.NEXT_PUBLIC_DB_MODE === "server";

/** The web server the desktop app syncs through, e.g. https://mavin.pk. */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

const inDesktopShell = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The desktop app with a server address: logins, accounts and sync go through
 * the server with the login's session; the app holds no database token. */
export function desktopViaServer(): boolean {
  return inDesktopShell() && Boolean(API_BASE);
}

/** Fired on window when the server says the session has ended; AuthGate logs out. */
export const SESSION_EXPIRED_EVENT = "hs-session-expired";

export class ServerRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ── Desktop session ────────────────────────────────────────────────────
// The desktop's pages are not served by the server, so the httpOnly cookie
// cannot reach it; the server hands the desktop the token at login and the
// app sends it as a Bearer header. It is only a session (it expires), never a
// database credential.
const DESKTOP_SESSION_KEY = "hs-desktop-session";

export function setDesktopSession(token: string | null, expiresInHours = 12): void {
  try {
    if (token) localStorage.setItem(DESKTOP_SESSION_KEY, JSON.stringify({ token, exp: Date.now() + expiresInHours * 3600_000 }));
    else localStorage.removeItem(DESKTOP_SESSION_KEY);
  } catch {
    // storage unavailable: the app works offline until the next login
  }
}

/** The desktop's unexpired session token, if any. */
export function desktopToken(): string | null {
  try {
    const s = JSON.parse(localStorage.getItem(DESKTOP_SESSION_KEY) ?? "null") as { token?: string; exp?: number } | null;
    return s?.token && (s.exp ?? 0) > Date.now() ? s.token : null;
  } catch {
    return null;
  }
}

/** A JSON call to the app's own server: with the session cookie on the web,
 * with the desktop's session token from the desktop app. */
/** This tab's branch (multi-branch businesses), sent with every request; the server checks it. */
function tabBranch(): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(BRANCH_TAB_KEY);
  } catch {
    return null;
  }
}

export async function serverJson<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const desktop = desktopViaServer();
  const headers: Record<string, string> = body === undefined ? {} : { "Content-Type": "application/json" };
  const branch = tabBranch();
  if (branch) headers["X-Branch"] = branch;
  const token = desktop ? desktopToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  // The MAVIN desktop app (Electron): through the desktop, which keeps the session.
  const bridge = desktopBridge();
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  if (bridge) {
    const r = await bridge.request({ path, method, body: init.body as string | undefined, headers });
    if (!r.ok) throw new ServerRequestError(0, r.error);
    if (r.value.status === 0) throw new ServerRequestError(0, "No connection to MAVIN.pk.");
    const text = r.value.body;
    res = { ok: r.value.status >= 200 && r.value.status < 300, status: r.value.status, json: async () => JSON.parse(text) };
  } else {
    // The desktop calls the server through the HTTP plugin (outside the webview, so no CORS).
    res = desktop
      ? await (await import("@tauri-apps/plugin-http")).fetch(`${API_BASE}${path}`, init)
      : await fetch(path, { ...init, credentials: "same-origin" });
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    // The tab's branch was closed or unassigned: back to the login's default branch, with fresh data.
    if (res.status === 409 && data.error === BRANCH_UNAVAILABLE && typeof window !== "undefined") {
      try { window.sessionStorage.removeItem(BRANCH_TAB_KEY); } catch { /* storage off */ }
      window.location.reload();
    }
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) {
      if (desktop) setDesktopSession(null); // keep working offline; the next login resumes sync
      else window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ServerRequestError(res.status, data.error ?? `Server error ${res.status}`);
  }
  return data;
}
