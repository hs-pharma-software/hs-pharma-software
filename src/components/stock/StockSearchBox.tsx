"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/Field";
import { SEARCH_KINDS, formatStockQty, suggestStock, type SearchItem, type SearchKind, type Suggestion } from "@/lib/stockLedger";

export interface StockPick { kind: SearchKind | "text"; value: string; label: string }

const KIND_ONE: Record<SearchKind, string> = { product: "Product", company: "Company", distributor: "Distributor", generic: "Generic name" };

/** A stock register's search: as one types, a list of products (in stock or
 * finished), companies, distributors and generic names. Arrows move, Enter
 * picks; Enter with nothing highlighted searches the words typed. */
export function StockSearchBox({ items, picked, onPick, label = "Search stock", placeholder = "Product, company, distributor or generic name" }: {
  items: SearchItem[];
  picked: StockPick | null;
  onPick: (pick: StockPick | null) => void;
  label?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const found = useMemo(() => (open ? suggestStock(items, query) : { list: [], more: 0 }), [items, query, open]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  function choose(pick: StockPick | null) {
    setQuery("");
    setOpen(false);
    setActive(-1);
    onPick(pick);
  }
  const take = (s: Suggestion) => choose({ kind: s.kind, value: s.value, label: s.label });

  function move(step: number) {
    setOpen(true);
    const n = found.list.length;
    if (!n) return;
    const next = (active + step + n) % n;
    setActive(next);
    list.current?.querySelector(`[data-n="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="relative w-full max-w-md min-w-[16rem] flex-1">
      {/* What is shown sits beside the label, so the fields next to the box stay in line. */}
      <div className="mb-1 flex h-5 items-center justify-between gap-2">
        <label htmlFor={`${id}-q`} className="shrink-0 text-xs font-medium text-neutral-600">{label}</label>
        {picked && (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-neutral-900 pl-2.5 pr-0.5 text-[11px] font-medium text-white">
            <span className="truncate">{picked.kind === "text" ? `“${picked.label}”` : `${KIND_ONE[picked.kind]}: ${picked.label}`}</span>
            <button type="button" onClick={() => choose(null)} aria-label="Clear the search" className="rounded-full p-1 hover:bg-white/20"><X size={11} aria-hidden="true" /></button>
          </span>
        )}
      </div>
      <div className="relative">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <Input
          id={`${id}-q`}
          className="!pl-8"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setActive(-1); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(active < 0 ? 0 : -1); }
            else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
            else if (e.key === "Enter") {
              e.preventDefault();
              const s = open ? found.list[active] : undefined;
              if (s) take(s);
              else choose(query.trim() ? { kind: "text", value: query.trim(), label: query.trim() } : null);
            }
          }}
        />
      </div>
      {open && (
        <div ref={list} id={`${id}-list`} role="listbox" aria-label="Suggestions" onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
          {found.list.length === 0 && <p className="px-3 py-2 text-sm text-neutral-500">{items.length ? "Nothing in stock or purchased matches." : "No stock or purchases yet."}</p>}
          {found.list.map((s, n) => {
            const item = s.kind === "product" ? byId.get(s.value) : undefined;
            return (
              <div key={`${s.kind}-${s.value}`}>
                {(n === 0 || found.list[n - 1].kind !== s.kind) && <p aria-hidden="true" className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{SEARCH_KINDS[s.kind]}</p>}
                <button type="button" tabIndex={-1} role="option" id={`${id}-${n}`} data-n={n} aria-selected={active === n}
                  onClick={() => take(s)} onMouseMove={() => setActive(n)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${active === n ? "bg-amber-50" : ""}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-neutral-800">{s.label}</span>
                    {s.hint && <span className="block truncate text-[11px] text-neutral-500">{s.hint}</span>}
                  </span>
                  {item && (s.inStock
                    ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">{formatStockQty(item.stock, item.units ?? {})}</span>
                    : <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Out of stock</span>)}
                </button>
              </div>
            );
          })}
          {found.more > 0 && <p className="px-3 py-1.5 text-[11px] text-neutral-500">{found.more} more. Type more to narrow the list.</p>}
        </div>
      )}
    </div>
  );
}
