/** The web version reaches the database through the server (/api/db) instead
 * of holding a database token in the page. Set NEXT_PUBLIC_DB_MODE=server in
 * Vercel to switch it on (see docs/server-layer.md). The desktop app always
 * uses its local database. */
export const SERVER_DB = process.env.NEXT_PUBLIC_DB_MODE === "server";

/** Fired on window when the server says the session has ended; AuthGate logs out. */
export const SESSION_EXPIRED_EVENT = "hs-session-expired";

export class ServerRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A JSON call to the app's own server, with the session cookie. */
export async function serverJson<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ServerRequestError(res.status, data.error ?? `Server error ${res.status}`);
  }
  return data;
}
