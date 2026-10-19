import { useEffect, useState } from "react";

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when the database is available — either:
 *  - Running inside the Tauri desktop shell (local SQLite), OR
 *  - Running in a browser/Vercel with Turso credentials configured.
 *
 * All pages use this to decide whether to show data or a "not available" msg.
 * Since db.ts now routes to Turso on web, both environments are fully capable. */
export function isDbReady(): boolean {
  if (typeof window === "undefined") return false;
  if (isTauri()) return true;
  // On web: DB is ready when Turso is configured
  return Boolean(
    process.env.NEXT_PUBLIC_TURSO_DATABASE_URL &&
    process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN
  );
}

/** Reactive, hydration-safe hook for use in JSX.
 * Starts false (SSR/first render) then flips to the real value after mount. */
export function useIsTauri(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(isDbReady());
  }, []);
  return ready;
}
