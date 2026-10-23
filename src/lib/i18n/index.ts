"use client";

import { create } from "zustand";
import { DICT, translate, translateError, type Lang } from "./dict";

export { DICT, translate, translateError, type Lang };

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

/** Current interface language. Loaded per user/tenant by LanguageSync; only
 * the Electric / Electronics / Solar store uses Urdu today. */
export const useLang = create<LangState>()((set) => ({
  lang: "en",
  setLang: (lang) => set({ lang }),
}));

/** Applies language and direction to the whole document (RTL for Urdu). */
export function applyDocumentLang(lang: Lang) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === "ur" ? "rtl" : "ltr";
}

export function useT() {
  const lang = useLang((s) => s.lang);
  const t = (key: string, vars?: Record<string, string | number>) => translate(key, lang, vars);
  return Object.assign(t, { lang, err: (m: string) => translateError(m, lang) });
}

/** Picks the Urdu or English version of user-entered text. */
export const pick = (lang: Lang, en: string | null | undefined, ur: string | null | undefined) => (lang === "ur" && ur ? ur : en ?? ur ?? "");
