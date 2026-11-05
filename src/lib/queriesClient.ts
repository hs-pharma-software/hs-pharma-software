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
const POLL_MS = 30_000;

export async function queriesCall<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return (await serverJson<{ result: T }>("/api/queries/", { action, ...body })).result;
}

export function announceUnread(n: number) {
  window.dispatchEvent(new CustomEvent<number>(UNREAD_EVENT, { detail: n }));
}

/** Unread count for the sidebar badge: refreshed every 30 seconds, when the
 * window regains focus, and at once when a query is opened. Null when unknown. */
export function useUnreadQueries(enabled: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !subSupersAvailable()) return;
    let alive = true;
    const refresh = () => void queriesCall<{ unread: number }>("unread").then((r) => alive && setN(r.unread)).catch(() => undefined);
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
