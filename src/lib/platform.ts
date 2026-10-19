import { useEffect, useState } from "react";

/** True when running inside the Tauri desktop shell (where the SQL/fs/dialog
 * plugins are actually available). False when the Next.js dev server is
 * previewed directly in an ordinary browser tab.
 *
 * Safe to call inside effects/event handlers/async functions (e.g. a
 * `reload()` guard) — anywhere that only ever runs client-side, after mount.
 * Do NOT call this directly in JSX render output; use `useIsTauri()` there
 * instead (see below) or you'll get a hydration mismatch. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Reactive, hydration-safe version of `isTauri()` for use in JSX render
 * output. The static export is always built outside Tauri, so the
 * server-rendered HTML (and the very first client render, before React has
 * hydrated) must say "false" to match — this hook starts at `false` on every
 * render pass and flips to the real value in an effect once mounted, which
 * is the standard fix for reading browser/host-only globals without a
 * server/client mismatch. */
export function useIsTauri(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(isTauri());
  }, []);
  return ready;
}
