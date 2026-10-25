import { useEffect, useState } from "react";
import { SERVER_DB } from "./serverMode";

/** True ONLY when running inside the Tauri desktop shell.
 * Used internally by db.ts (pick SQLite vs Turso) and outbox.ts.
 * Don't use this in pages \u2014 use isTauri() / useIsTauri() instead. */
export function isTauriShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when the database is available \u2014 either:
 *  - Running inside the Tauri desktop shell (local SQLite), OR
 *  - Running in a browser / Vercel with Turso credentials configured.
 *
 * All 40+ pages use this (as `isTauri()`) to guard their data-load calls.
 * Renamed so that existing code needs zero changes. */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  if (isTauriShell()) return true;
  // Web version through the server: no token in the page, the database is still available.
  if (SERVER_DB) return true;
  return Boolean(
    process.env.NEXT_PUBLIC_TURSO_DATABASE_URL &&
    process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN
  );
}

/** Reactive, hydration-safe hook. Starts false (SSR), flips to real value
 * after mount. Used in JSX to conditionally render data tables vs placeholders. */
export function useIsTauri(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(isTauri());
  }, []);
  return ready;
}

/** @deprecated use isTauri() \u2014 kept for any import that used isDbReady() */
export const isDbReady = isTauri;
