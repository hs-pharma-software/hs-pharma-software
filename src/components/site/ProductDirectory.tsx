"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface DirectoryItem {
  slug: string;
  name: string;
  group: string;
  headline: string;
  pilot: boolean;
}

/** Products page: search and filter by group. Works as a plain list without JavaScript. */
export function ProductDirectory({ items, groups, base }: { items: DirectoryItem[]; groups: string[]; base: string }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("All");
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((p) => (group === "All" || p.group === group) && (!term || `${p.name} ${p.headline} ${p.group}`.toLowerCase().includes(term)));
  }, [items, q, group]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="pd-search" className="sr-only">Search products</label>
        <input
          id="pd-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search, e.g. pharmacy, IMEI, restaurant"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1565c0] focus:ring-2 focus:ring-[#1565c0]/20 sm:max-w-xs"
        />
        <div role="group" aria-label="Filter by sector" className="flex flex-wrap gap-2">
          {["All", ...groups].map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${group === g ? "bg-[#0b2a6b] text-white ring-[#0b2a6b]" : "bg-white text-slate-700 ring-slate-300 hover:ring-[#1565c0]"}`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500" aria-live="polite">{shown.length} of {items.length} products</p>
      {shown.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No product matches that search. Try another word or choose All.
        </p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <li key={p.slug}>
              <Link href={`${base}/products/${p.slug}`} className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#1565c0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]">
                <span className="text-xs font-medium text-[#1565c0]">{p.group}</span>
                <span className="mt-1 font-semibold text-[#0b2a6b]">{p.name}</span>
                <span className="mt-2 text-sm text-slate-600">{p.headline}</span>
                {p.pilot && <span className="mt-3 self-start rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">Offered as a pilot</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
