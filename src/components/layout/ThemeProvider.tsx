"use client";

import { useEffect } from "react";
import { isTauri } from "@/lib/platform";
import { getSetting } from "@/lib/repo/settings";
import { applyTheme, DEFAULT_THEME, type AppTheme } from "@/lib/theme";

/** Loads the saved theme from settings (DB + localStorage cache) and applies
 * it to document.documentElement as CSS custom properties. Runs once on
 * mount; the Settings page calls applyTheme() directly on every change so
 * the UI updates instantly without a re-render here. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Instant apply from localStorage to avoid flash of unstyled content
    const cached = localStorage.getItem("app-theme");
    if (cached) {
      try { applyTheme(JSON.parse(cached) as AppTheme); } catch { applyTheme(DEFAULT_THEME); }
    } else {
      applyTheme(DEFAULT_THEME);
    }

    // Then sync from DB (may be more up-to-date after a Turso sync)
    if (isTauri()) {
      void getSetting("app_theme").then((v) => {
        if (!v) return;
        try {
          const theme = JSON.parse(v) as AppTheme;
          applyTheme(theme);
          localStorage.setItem("app-theme", v);
        } catch {}
      });
    }
  }, []);

  return <>{children}</>;
}
