"use client";

/** Whether Billori (the AI assistant) is on for the signed-in business, from
 * its Settings switch (`billori_enabled`, the same setting the server checks:
 * anything but "false" is on). Unknown until loaded, so the chat button never
 * flashes for a business that has it off. Changes reach this tab at once,
 * other tabs through a broadcast, and every tab again on focus or navigation. */
import { create } from "zustand";
import { getSetting } from "./repo/settings";
import { BILLORI_ENABLED_SETTING } from "./gemini";

interface State {
  tenantId: string | null;
  enabled: boolean | null;
  load: (tenantId: string | null) => Promise<void>;
  set: (tenantId: string, enabled: boolean) => void;
}

const CHANNEL = "mavin-billori";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
// Outside a browser (tests) the channel must not keep the process running.
(channel as unknown as { unref?: () => void } | null)?.unref?.();

export const useBillori = create<State>((set, get) => ({
  tenantId: null,
  enabled: null,
  async load(tenantId) {
    if (!tenantId) return set({ tenantId: null, enabled: null });
    // Another business: unknown until read (no carry-over from the previous login).
    if (get().tenantId !== tenantId) set({ tenantId, enabled: null });
    try {
      const v = await getSetting(BILLORI_ENABLED_SETTING, tenantId);
      if (get().tenantId === tenantId) set({ enabled: v !== "false" });
    } catch {
      // Unreadable: keep what we had (off when nothing is known yet).
      if (get().tenantId === tenantId && get().enabled === null) set({ enabled: false });
    }
  },
  set(tenantId, enabled) {
    if (get().tenantId === tenantId) set({ enabled });
    channel?.postMessage({ tenantId, enabled });
  },
}));

channel?.addEventListener("message", (e: MessageEvent<{ tenantId: string; enabled: boolean }>) => {
  const s = useBillori.getState();
  if (e.data && s.tenantId === e.data.tenantId) useBillori.setState({ enabled: Boolean(e.data.enabled) });
});
