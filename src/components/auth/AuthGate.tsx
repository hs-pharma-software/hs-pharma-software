"use client";

import { useEffect, useState } from "react";
import { useIsTauri } from "@/lib/platform";
import { anyUserExists } from "@/lib/repo/users";
import { useAuthStore } from "@/store/authStore";
import { SetupSuperAdmin } from "./SetupSuperAdmin";
import { LoginScreen } from "./LoginScreen";

/** Root gate mounted in the app layout, outside `SyncProvider`/`AppShell` —
 * sync shouldn't start before a tenant is known (it needs `currentTenant.id`
 * to scope its pulls), and the app shell has nothing useful to show before
 * login anyway. Shows, in order: a first-run Setup screen (only when the
 * local `users` table is completely empty), a Login screen, or the real app. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const tauriReady = useIsTauri();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tauriReady || currentUser) return;
    void anyUserExists().then((exists) => setNeedsSetup(!exists));
  }, [tauriReady, currentUser]);

  if (!tauriReady) {
    // In a plain browser tab (no Tauri), render the app in preview/read-only
    // mode so the UI is visible — DB calls will silently return empty results.
    return <>{children}</>;
  }

  if (currentUser) {
    return <>{children}</>;
  }

  if (needsSetup === null) {
    return null;
  }

  if (needsSetup) {
    return <SetupSuperAdmin onDone={() => setNeedsSetup(false)} />;
  }

  return <LoginScreen />;
}
