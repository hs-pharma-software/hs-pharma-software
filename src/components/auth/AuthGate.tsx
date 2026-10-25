"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { anyUserExists } from "@/lib/repo/users";
import { useAuthStore } from "@/store/authStore";
import { isTauriShell } from "@/lib/platform";
import { isTursoConfigured, pullAuthData } from "@/lib/sync/engine";
import { Button } from "@/components/ui/Button";
import { SetupSuperAdmin } from "./SetupSuperAdmin";
import { LoginScreen } from "./LoginScreen";
import { isPublicPath } from "@/lib/publicPaths";

type GateState = "checking" | "setup" | "login" | "offline";

/** Root gate mounted in the app layout, outside `SyncProvider`/`AppShell`.
 * Works in both Tauri (desktop) and browser (Vercel web).
 * Shows, in order:
 *   1. Loading spinner while checking DB (desktop: first downloads plans,
 *      tenants and users from Turso, since sync only runs after login)
 *   2. First-run Setup screen (only when no users exist anywhere)
 *   3. "Connect to the internet" when a fresh install can't reach Turso
 *   4. Login screen (when no session)
 *   5. The real app (when logged in) */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [state, setState] = useState<GateState>("checking");
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setState("checking");
    setError(null);
    const synced = isTauriShell() && isTursoConfigured();
    if (synced) {
      try {
        await pullAuthData();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    const exists = await anyUserExists();
    // A synced install with no local users must reach Turso first: creating
    // a new Super Admin here would add a stray admin to the shared database.
    if (!exists) setState(synced ? "offline" : "setup");
    else setState("login");
  }, []);

  useEffect(() => {
    // Landing page and already-logged-in: skip DB check
    if (isPublicPath(pathname) || currentUser) return;
    void check();
  }, [pathname, currentUser, check]);

  // Landing page and online lab reports are public — no auth needed
  if (isPublicPath(pathname)) return <>{children}</>;

  // Already logged in — show the app
  if (currentUser) {
    return <>{children}</>;
  }

  if (state === "checking") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-neutral-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
        <p className="text-xs text-neutral-400">Loading accounts...</p>
      </div>
    );
  }

  if (state === "offline") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl ring-1 ring-black/5">
          <h1 className="font-serif text-xl text-neutral-800">Connect to the internet</h1>
          <p className="mt-2 text-sm text-neutral-500">
            This is the first sign-in on this computer. Billora needs an internet connection once to download your
            accounts.
          </p>
          {error && <p className="mt-3 break-words rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <Button variant="primary" className="mt-4 justify-center" onClick={() => void check()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // No users anywhere (no cloud database configured) — first-run setup
  if (state === "setup") {
    return <SetupSuperAdmin onDone={() => setState("login")} />;
  }

  // Users exist but not logged in — show login
  return <LoginScreen />;
}
