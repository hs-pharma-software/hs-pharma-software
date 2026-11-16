/** Super Admin > Queries: calls to /api/queries and the unread badge. */
import { useEffect, useState } from "react";
import { subSupersAvailable } from "./subSupersClient";
import { serverJson } from "./serverMode";

export interface SiteQuery {
  id: string; kind: "contact" | "demo"; name: string; business_name: string | null; business_type: string | null; branches: string | null;
  phone: string | null; email: string | null; message: string | null; topic: string | null; status: "unread" | "read"; read_at: string | null; created_at: string;
}

/** Fired with the new unread count after a query is opened, so the badge updates at once. */
export const UNREAD_EVENT = "mavin-queries-unread";
const POLL_MS = 5 * 60_000;

export async function queriesCall<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return (await serverJson<{ result: T }>("/api/queries/", { action, ...body })).result;
}

export function announceUnread(n: number) {
  window.dispatchEvent(new CustomEvent<number>(UNREAD_EVENT, { detail: n }));
}

/** Unread count for the sidebar badge: refreshed every five minutes while visible, when the
 * window regains focus, and at once when a query is opened. Null when unknown. */
export function useUnreadQueries(enabled: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !subSupersAvailable()) return;
    let alive = true;
    let running = false;
    let failures = 0;
    let retryAt = 0;
    const refresh = async () => {
      if (!alive || running || document.hidden || Date.now() < retryAt) return;
      running = true;
      try {
        const r = await queriesCall<{ unread: number }>("unread");
        if (alive) setN(r.unread);
        failures = 0;
        retryAt = 0;
      } catch {
        retryAt = Date.now() + Math.min(3_600_000, POLL_MS * 2 ** Math.min(failures++, 4));
      } finally { running = false; }
    };
    const onAnnounce = (e: Event) => setN((e as CustomEvent<number>).detail);
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener(UNREAD_EVENT, onAnnounce);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(UNREAD_EVENT, onAnnounce);
    };
  }, [enabled]);
  return n;
}
