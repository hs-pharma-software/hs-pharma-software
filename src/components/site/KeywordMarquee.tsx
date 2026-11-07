"use client";

import { useEffect, useState } from "react";
import { isSiteHost } from "@/config/site";

/** "Popular searches": a small, slowly moving strip at the very bottom of the
 * page with the keywords from the weekly SEO research, each linking to its
 * page. Pauses on hover or keyboard focus; stands still for people who prefer
 * reduced motion. The page HTML holds each keyword once: the copy that makes
 * the loop seamless is added in the browser only. `items` comes from the
 * server where it can (site pages); the home page loads them here. */
export interface PopularSearch { keyword: string; href: string }

export function KeywordMarquee({ items: initial, base }: { items?: PopularSearch[]; base?: string }) {
  const [items, setItems] = useState<PopularSearch[]>(initial ?? []);
  const [prefix, setPrefix] = useState(base ?? "");
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (base === undefined) setPrefix(isSiteHost(window.location.host) ? "" : "/site");
    setMoving(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (initial) return;
    fetch("/api/public/keywords/").then((r) => (r.ok ? r.json() : { items: [] })).then((j: { items?: PopularSearch[] }) => setItems(j.items ?? [])).catch(() => setItems([]));
  }, [initial, base]);
  if (!items.length) return null;
  const link = (it: PopularSearch, i: number, copy: boolean) => (
    <a key={`${copy ? "b" : "a"}${i}`} href={`${prefix}${it.href}`} tabIndex={copy ? -1 : undefined} aria-hidden={copy || undefined}
      className="shrink-0 whitespace-nowrap text-[11px] leading-5 text-white/70 hover:text-white hover:underline focus:outline-none focus-visible:text-white focus-visible:underline">
      {it.keyword}
    </a>
  );
  const dot = (k: string) => <span key={k} aria-hidden className="shrink-0 text-[11px] leading-5 text-white/30">·</span>;
  const row = (copy: boolean) => items.flatMap((it, i) => [link(it, i, copy), dot(`${copy ? "b" : "a"}d${i}`)]);
  return (
    <section aria-label="Popular searches" className="kw-marquee overflow-hidden border-t border-white/10 bg-[#071640] py-1 text-white">
      <style>{`
        .kw-track { animation: kw-move ${Math.max(45, items.length * 6)}s linear infinite; }
        .kw-marquee:hover .kw-track, .kw-marquee:focus-within .kw-track { animation-play-state: paused; }
        @keyframes kw-move { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .kw-track { animation: none; } }
      `}</style>
      <div className="mx-auto flex items-center gap-2 px-4">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#5ec8ff]">Popular searches</span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className={`flex gap-2 ${moving ? "kw-track w-max" : "flex-wrap"}`}>
            {row(false)}
            {moving && row(true)}
          </div>
        </div>
      </div>
    </section>
  );
}
