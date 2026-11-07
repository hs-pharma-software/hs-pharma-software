"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { BottomItem } from "@/config/bottomNav";

const norm = (p: string) => p.replace(/\/+$/, "") || "/";

/** Phones only: four main sections and "More" (the full menu drawer). Plain
 * links, so Back, history and "open in new tab" work as usual. */
export function MobileBottomNav({ items, onMore, moreOpen, badges = {} }: {
  items: BottomItem[];
  onMore: () => void;
  moreOpen: boolean;
  badges?: Record<string, number>;
}) {
  const path = norm(usePathname());
  // The longest matching link is the current section (so /invoices/returns lights "Sale", not "Home").
  const match = items
    .map((i) => norm(i.href))
    .filter((h) => path === h || (h !== "/" && path.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav
      aria-label="Main sections"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.08] bg-white/95 backdrop-blur-xl md:hidden print:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
        {items.map((i) => {
          const active = norm(i.href) === match && !moreOpen;
          const Icon = i.icon;
          const badge = badges[i.href];
          return (
            <li key={i.href} className="min-w-0">
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium ${active ? "text-[var(--accent)]" : "text-neutral-500"}`}
              >
                {active && <span className="absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-[var(--accent)]" aria-hidden />}
                <span className="relative">
                  <Icon size={21} strokeWidth={active ? 2.4 : 1.9} />
                  {badge ? <span className="absolute -right-2.5 -top-1.5 min-w-[1.1rem] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{badge > 99 ? "99+" : badge}</span> : null}
                </span>
                <span className="w-full truncate text-center">{i.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <button
            type="button"
            onClick={onMore}
            aria-expanded={moreOpen}
            className={`flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${moreOpen || !match ? "text-[var(--accent)]" : "text-neutral-500"}`}
          >
            <Menu size={21} />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
