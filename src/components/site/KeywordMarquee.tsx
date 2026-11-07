"use client";

import { useEffect, useState } from "react";
import { isSiteHost } from "@/config/site";

/** "Popular searches": a slowly moving strip of the keywords from the weekly
 * SEO research, each linking to its page. Pauses on hover or keyboard focus;
 * stands still for people who prefer reduced motion. `items` comes from the
 * server where it can (site pages); the home page loads them here. */
export interface PopularSearch { keyword: string; href: string }

export function KeywordMarquee({ items: initial, base }: { items?: PopularSearch[]; base?: string }) {
  const [items, setItems] = useState<PopularSearch[]>(initial ?? []);
  const [prefix, setPrefix] = useState(base ?? "");
  useEffect(() => {
    if (base === undefined) setPrefix(isSiteHost(window.location.host) ? "" : "/site");
    if (initial) return;
    fetch("/api/public/keywords/").then((r) => (r.ok ? r.json() : { items: [] })).then((j: { items?: PopularSearch[] }) => setItems(j.items ?? [])).catch(() => setItems([]));
  }, [initial, base]);
  if (!items.length) return null;
  const link = (it: PopularSearch, i: number, hidden: boolean) => (
    <a key={`${hidden ? "b" : "a"}${i}`} href={`${prefix}${it.href}`} tabIndex={hidden ? -1 : undefined} aria-hidden={hidden || undefined}
      className="shrink-0 whitespace-nowrap rounded-full border border-white/15 px-3 py-1 text-sm text-white/90 hover:border-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
      {it.keyword}
    </a>
  );
  return (
    <section aria-label="Popular searches" className="kw-marquee overflow-hidden bg-[#0b2a6b] py-3 text-white">
      <style>{`
        .kw-track { animation: kw-move ${Math.max(40, items.length * 5)}s linear infinite; }
        .kw-marquee:hover .kw-track, .kw-marquee:focus-within .kw-track { animation-play-state: paused; }
        @keyframes kw-move { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .kw-track { animation: none; flex-wrap: wrap; width: auto !important; } .kw-copy { display: none !important; } }
      `}</style>
      <div className="mx-auto flex max-w-[100vw] items-center gap-3 px-4">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-[#5ec8ff]">Popular searches</span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="kw-track flex w-max gap-2">
            {items.map((it, i) => link(it, i, false))}
            <span className="kw-copy flex gap-2">{items.map((it, i) => link(it, i, true))}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
