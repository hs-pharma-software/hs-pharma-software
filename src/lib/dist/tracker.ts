/** Salesman location sharing in the open app (foreground). Starts only when
 * the salesman presses Start; sends a fix at most every `minIntervalMs`
 * (or when moved > 50 m). Browsers pause this when the page is closed or the
 * phone sleeps, so the administrator then sees the location as stale. */
import { create } from "zustand";
import { useAuthStore } from "@/store/authStore";
import { dist, errorText, geoErrorText } from "./index";
import { distanceKm } from "./engine";

interface TrackerState {
  status: "off" | "starting" | "on" | "error";
  error: string | null;
  lastSentAt: string | null;
  lastAccuracy: number | null;
  rejected: string | null;
}
export const useTracker = create<TrackerState>()(() => ({ status: "off", error: null, lastSentAt: null, lastAccuracy: null, rejected: null }));

let watchId: number | null = null;
let last: { lat: number; lng: number; t: number } | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;
const minIntervalMs = 30000;

export async function startTracking() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    useTracker.setState({ status: "error", error: "This device / browser has no location service." });
    return;
  }
  if (!window.isSecureContext) {
    useTracker.setState({ status: "error", error: "Location needs a secure (https) page." });
    return;
  }
  useTracker.setState({ status: "starting", error: null, rejected: null });
  try {
    await dist.startSharing(navigator.userAgent);
  } catch (e) {
    useTracker.setState({ status: "error", error: errorText(e) });
    return;
  }
  last = null;
  watchId = navigator.geolocation.watchPosition(
    async (p) => {
      const now = Date.now();
      const here = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (last && now - last.t < minIntervalMs && distanceKm(last, here) < 0.05) return;
      last = { ...here, t: now };
      try {
        const r = await dist.reportLocation({ ...here, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null, deviceAt: new Date(p.timestamp).toISOString() });
        useTracker.setState({ status: "on", error: null, lastSentAt: r.recorded_at, lastAccuracy: p.coords.accuracy ?? null, rejected: r.flag });
      } catch (e) {
        useTracker.setState({ error: errorText(e) });
      }
    },
    (e) => useTracker.setState({ status: e.code === 1 ? "error" : useTracker.getState().status, error: geoErrorText(e) }),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
  );
  useTracker.setState({ status: "on" });
  // Keeps the screen on while sharing, where supported (saves nothing if refused).
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    wakeLock = (await nav.wakeLock?.request("screen")) ?? null;
  } catch {
    wakeLock = null;
  }
}

export async function stopTracking(reason = "stopped by salesman") {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  last = null;
  await wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  useTracker.setState({ status: "off" });
  try {
    await dist.stopSharing(reason);
  } catch (e) {
    useTracker.setState({ error: errorText(e) });
  }
}

// Signing out or switching account ends local tracking (the server shows it stale).
useAuthStore.subscribe((s, prev) => {
  if (watchId != null && s.currentUser?.id !== prev.currentUser?.id) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    useTracker.setState({ status: "off" });
  }
});
