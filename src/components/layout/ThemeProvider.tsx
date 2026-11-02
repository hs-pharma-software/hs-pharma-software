"use client";

import { useEffect } from "react";
import { isTauri } from "@/lib/platform";
import { getSetting } from "@/lib/repo/settings";
import { applyTheme, DEFAULT_THEME, type AppTheme } from "@/lib/theme";
import { useAuthStore } from "@/store/authStore";

/** Loads the saved theme from settings (DB + localStorage cache) and applies
 * it to document.documentElement as CSS custom properties. Runs once on
 * mount, then the business's saved theme once someone is signed in (and
 * again when the business changes). The Settings page calls applyTheme()
 * directly on every change so the UI updates instantly. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const signedIn = useAuthStore((s) => Boolean(s.currentUser));
  useEffect(() => {
    // Instant apply from localStorage to avoid flash of unstyled content
    const cached = localStorage.getItem("app-theme");
    if (cached) {
      try { applyTheme(JSON.parse(cached) as AppTheme); } catch { applyTheme(DEFAULT_THEME); }
    } else {
      applyTheme(DEFAULT_THEME);
    }

  }, []);

  // Then the business's saved theme (only once signed in: the server refuses
  // reads before that).
  useEffect(() => {
    if (!signedIn || !isTauri()) return;
    void getSetting("app_theme").then((v) => {
      if (!v) return;
      try {
        const theme = JSON.parse(v) as AppTheme;
        applyTheme(theme);
        localStorage.setItem("app-theme", v);
      } catch {}
    }).catch(() => undefined);
  }, [signedIn, tenantId]);

  return <>{children}</>;
}
