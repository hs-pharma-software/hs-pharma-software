"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import { StockSearchBox, type StockPick } from "@/components/stock/StockSearchBox";
import { ProductLedgerModal } from "@/components/stock/ProductLedger";
import { formatStockQty, matchingItems, type LedgerView, type SearchItem } from "@/lib/stockLedger";

/** A stock register for the businesses that keep one quantity per item
 * (distributor, electronics, restaurant ingredients): search with
 * suggestions, the items with what is available, and each item's history. */
export function StockItemsRegister({ loadItems, loadLedger, onlyWhenSearched = false }: {
  /** Both stable functions (useCallback), so they are read once. */
  loadItems: () => Promise<SearchItem[]>;
  loadLedger: (id: string) => Promise<LedgerView>;
  /** The page already lists the stock: show items here only for a search. */
  onlyWhenSearched?: boolean;
}) {
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<StockPick | null>(null);
  const [open, setOpen] = useState<SearchItem | null>(null);

  useEffect(() => {
    let current = true;
    void loadItems().then((r) => { if (current) { setItems(r); setError(null); } }).catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : String(e)); });
    return () => { current = false; };
  }, [loadItems]);

  const shown = useMemo(() => (pick ? matchingItems(items ?? [], pick) : onlyWhenSearched ? [] : items ?? []), [items, pick, onlyWhenSearched]);
  const loadOpen = useCallback(() => loadLedger(open!.id), [loadLedger, open]);
  const hasCompany = (items ?? []).some((i) => i.company);
  const hasDistributor = (items ?? []).some((i) => i.distributors?.length);

  function choose(next: StockPick | null) {
    setPick(next);
    if (next?.kind === "product") setOpen((items ?? []).find((i) => i.id === next.value) ?? null);
  }

  return (
    <div className="space-y-2">
      <StockSearchBox items={items ?? []} picked={pick} onPick={choose}
        placeholder={hasCompany || hasDistributor ? "Product, company or supplier" : "Item name"} />
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not load the stock: {error}</p>}
      {items === null ? (!error && <p className="text-sm text-neutral-500">Loading…</p>)
        : shown.length === 0 ? <p className="text-sm text-neutral-500">{pick ? "No stock or purchases match the search." : onlyWhenSearched ? "Search an item to see every stock in and out of it." : "No stock yet."}</p>
        : (
          <div className="max-h-[28rem] overflow-auto rounded-xl bg-white ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-start">Item</th>
                  {hasCompany && <th className="px-3 py-2 text-start">Company</th>}
                  {hasDistributor && <th className="px-3 py-2 text-start">Supplier</th>}
                  <th className="px-3 py-2 text-end">Available</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setOpen(i)} title="Show this item's history" className="inline-flex items-center gap-1.5 text-start font-medium text-sky-800 hover:underline">
                        {i.name}<History size={12} aria-hidden="true" className="shrink-0" />
                      </button>
                    </td>
                    {hasCompany && <td className="px-3 py-2 text-neutral-600">{i.company ?? "—"}</td>}
                    {hasDistributor && <td className="px-3 py-2 text-neutral-600">{i.distributors?.[i.distributors.length - 1] ?? "—"}</td>}
                    <td className={`px-3 py-2 text-end font-bold tabular-nums ${i.stock > 0 ? "text-emerald-800" : "text-rose-700"}`}>{i.stock > 0 ? formatStockQty(i.stock, i.units ?? {}) : "Out of stock"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {open && <ProductLedgerModal title={open.name} load={loadOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
