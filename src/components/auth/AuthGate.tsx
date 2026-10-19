"use client";

import { useEffect, useState } from "react";
import { anyUserExists } from "@/lib/repo/users";
import { useAuthStore } from "@/store/authStore";
import { SetupSuperAdmin } from "./SetupSuperAdmin";
import { LoginScreen } from "./LoginScreen";

/** Root gate mounted in the app layout, outside `SyncProvider`/`AppShell` —
 * Works in both Tauri (desktop) and browser (Vercel web).
 * Shows, in order:
 *   1. Loading spinner while checking DB
 *   2. First-run Setup screen (only when the users table is empty)
 *   3. Login screen (when no session)
 *   4. The real app (when logged in) */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    // If already logged in, skip the DB check
    if (currentUser) return;
    void anyUserExists().then((exists) => setNeedsSetup(!exists));
  }, [currentUser]);

  // Already logged in — show the app
  if (currentUser) {
    return <>{children}</>;
  }

  // Still checking the DB — show a minimal loading state
  if (needsSetup === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  // No users in DB yet — first-run setup
  if (needsSetup) {
    return <SetupSuperAdmin onDone={() => setNeedsSetup(false)} />;
  }

  // Users exist but not logged in — show login
  return <LoginScreen />;
}
