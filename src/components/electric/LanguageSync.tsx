"use client";

import { useEffect } from "react";
import { Languages } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { applyDocumentLang, useLang, type Lang } from "@/lib/i18n";
import { ELECTRIC_TYPE, electric, loadUrduFont } from "@/lib/electric";
import { isTauri } from "@/lib/platform";

const cacheKey = (tenantId: string, userId: string) => `ui_lang:${tenantId}:${userId}`;

function setEverywhere(lang: Lang, tenantId?: string, userId?: string) {
  useLang.getState().setLang(lang);
  applyDocumentLang(lang);
  if (tenantId && userId) {
    try {
      localStorage.setItem(cacheKey(tenantId, userId), lang);
    } catch {
      // storage blocked: the database copy still applies after reload
    }
  }
}

/** Applies the signed-in user's language (Electric / Electronics / Solar
 * store only; everyone else stays English, left-to-right). The choice is
 * stored per user and tenant, so other users and tenants are unaffected. */
export function LanguageSync() {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const userId = useAuthStore((s) => s.currentUser?.id ?? null);
  const typeId = useAuthStore((s) => businessType(s.currentTenant?.businessType).id);

  useEffect(() => {
    if (!tenantId || !userId || typeId !== ELECTRIC_TYPE) {
      setEverywhere("en");
      return;
    }
    // Cached copy first (no flash of English), then the stored preference.
    try {
      const cached = localStorage.getItem(cacheKey(tenantId, userId));
      if (cached === "ur" || cached === "en") setEverywhere(cached);
    } catch {
      // ignore
    }
    if (!isTauri()) return;
    void electric.settings
      .getUserLang()
      .then((l) => setEverywhere(l, tenantId, userId))
      .catch(() => undefined);
    void loadUrduFont();
  }, [tenantId, userId, typeId]);

  return null;
}

export async function changeLanguage(lang: Lang) {
  const { currentTenant, currentUser } = useAuthStore.getState();
  await electric.settings.setUserLang(lang);
  setEverywhere(lang, currentTenant?.id, currentUser?.id);
}

/** Header switch (store users only). */
export function LanguageToggle() {
  const typeId = useAuthStore((s) => businessType(s.currentTenant?.businessType).id);
  const lang = useLang((s) => s.lang);
  if (typeId !== ELECTRIC_TYPE) return null;
  const next: Lang = lang === "ur" ? "en" : "ur";
  return (
    <button
      type="button"
      onClick={() => void changeLanguage(next)}
      title={lang === "ur" ? "Switch to English" : "اردو میں تبدیل کریں"}
      className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
    >
      <Languages size={14} />
      <span className={next === "ur" ? "font-urdu" : ""}>{next === "ur" ? "اردو" : "English"}</span>
    </button>
  );
}
