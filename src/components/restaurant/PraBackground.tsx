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
    const tick = async () => {
      if (running || !isRestaurantSession()) return;
      running = true;
      try {
        if (await praServerManaged()) await serverJson("/api/pra/", { action: "process" });
        else if (isTauriShell()) await pra.processQueue();
      } catch (e) {
        console.warn("[pra] queue", e);
      } finally {
        running = false;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 60_000);
    return () => clearInterval(t);
  }, []);
  return null;
}
