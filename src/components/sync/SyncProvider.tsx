"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import { syncNow, canSyncNow, isTursoConfigured } from "@/lib/sync/engine";
import { countPendingOutbox } from "@/lib/sync/outbox";
import { nowIso } from "@/lib/id";
import { isTauriShell } from "@/lib/platform";

const SYNC_INTERVAL_MS = 60_000;

/** Mounted once in the root layout. Drives the whole sync lifecycle:
 * - refreshes the "pending changes" badge on every local write pattern tick
 * - runs a sync pass on startup, on `online` events, and every 60s while online
 * - exposes nothing itself; screens trigger a manual sync via `useSync()` */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const setOnline = useAppStore((s) => s.setOnline);
  const setSyncStatus = useAppStore((s) => s.setSyncStatus);
  const setLastSyncedAt = useAppStore((s) => s.setLastSyncedAt);
  const setPendingCount = useAppStore((s) => s.setPendingCount);
  const setLastError = useAppStore((s) => s.setLastError);
  const runningRef = useRef(false);

  // Only the desktop app keeps a local copy to sync; the web version works on
  // the server database directly and has nothing to sync.
  const refreshPendingCount = useCallback(async () => {
    if (!isTauriShell()) return;
    try {
      setPendingCount(await countPendingOutbox());
    } catch {
      // local DB not ready yet (e.g. first paint before Tauri SQL plugin loads)
    }
  }, [setPendingCount]);

  const runSync = useCallback(async () => {
    if (runningRef.current) return;
    if (!isTauriShell()) return;
    if (!canSyncNow()) return; // through the server: waits for an online sign-in
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    runningRef.current = true;
    setSyncStatus("syncing");
    let failed = false;
    try {
      await syncNow();
      setLastSyncedAt(nowIso());
      setLastError(null);
    } catch (err) {
      failed = true;
      console.error("[sync] failed", err);
      setLastError(err instanceof Error ? err.message : String(err));
      setSyncStatus("error");
    } finally {
      await refreshPendingCount();
      if (!failed) setSyncStatus("idle");
      runningRef.current = false;
    }
  }, [refreshPendingCount, setLastError, setLastSyncedAt, setSyncStatus]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void runSync();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Apply the real browser online/offline state post-mount (the store
    // starts as `true` on both server and client to avoid a hydration
    // mismatch \u2014 see appStore.ts).
    setOnline(navigator.onLine);

    void refreshPendingCount();
    void runSync();

    const interval = setInterval(() => {
      void runSync();
      void refreshPendingCount();
    }, SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [refreshPendingCount, runSync, setOnline]);

  return <>{children}</>;
}

/** Manual "Sync Now" trigger for the topbar button. */
export async function triggerManualSync() {
  const store = useAppStore.getState();
  if (!isTauriShell()) return;
  if (!canSyncNow()) {
    store.setLastError(isTursoConfigured() ? "Sign in again while online to sync." : "Sync is not set up in this build.");
    return;
  }
  store.setSyncStatus("syncing");
  try {
    await syncNow();
    store.setLastSyncedAt(nowIso());
    store.setLastError(null);
    store.setPendingCount(await countPendingOutbox());
    store.setSyncStatus("idle");
  } catch (err) {
    store.setLastError(err instanceof Error ? err.message : String(err));
    store.setSyncStatus("error");
  }
}
