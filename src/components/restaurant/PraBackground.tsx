"use client";

import { useEffect } from "react";
import { pra, isRestaurantSession, praServerManaged } from "@/lib/restaurant";
import { serverJson } from "@/lib/serverMode";
import { isTauriShell } from "@/lib/platform";

/** Restaurant sessions only: sends pending PRA submissions on start (which
 * also recovers ones stuck by a crash) and then every minute. */
export function PraBackground() {
  useEffect(() => {
    if (!isRestaurantSession()) return;
    let running = false;
    // Server-managed: every minute while bills were being sent, every 5 minutes while nothing was due.
    let lastServerRun = 0;
    let quiet = false;
    const tick = async (force = false) => {
      if (running || !isRestaurantSession()) return;
      // A tab in the background does not ask (the server's own daily sweep and the next open tab catch up).
      if (!force && typeof document !== "undefined" && document.hidden) return;
      running = true;
      try {
        if (await praServerManaged()) {
          if (!force && quiet && Date.now() - lastServerRun < 5 * 60_000) return;
          lastServerRun = Date.now();
          const r = await serverJson<{ result?: Record<string, number> }>("/api/pra/", { action: "process" });
          quiet = Object.keys(r?.result ?? {}).length === 0;
        } else if (isTauriShell()) await pra.processQueue();
      } catch (e) {
        console.warn("[pra] queue", e);
      } finally {
        running = false;
      }
    };
    void tick(true);
    const t = setInterval(() => void tick(), 60_000);
    // Back to the tab: anything waiting is sent at once.
    const onVisible = () => { if (!document.hidden) { quiet = false; void tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return null;
}
