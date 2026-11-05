"use client";

import { useEffect } from "react";
import { isSiteHost } from "@/config/site";

/** Google Analytics 4 on the public website only (www.mavin.pk), so the SEO
 * Manager can report visits from search. Off unless NEXT_PUBLIC_GA_MEASUREMENT_ID
 * is set; never loads on the app's address, so no business screen is tracked.
 * IP addresses are not stored by GA4, and no user or tenant data is sent. */
const ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() ?? "";

type W = Window & { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };

export function SiteAnalytics() {
  useEffect(() => {
    if (!/^G-[A-Z0-9]+$/.test(ID) || !isSiteHost(window.location.host)) return;
    const w = window as W;
    if (w.gtag) return;
    w.dataLayer = w.dataLayer ?? [];
    w.gtag = function gtag() {
      // gtag queues the `arguments` object itself.
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
    w.gtag("js", new Date());
    w.gtag("config", ID);
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
    document.head.appendChild(s);
  }, []);
  return null;
}
