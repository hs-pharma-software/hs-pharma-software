"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getLowStockForOrder, type LowStockOrderRow } from "@/lib/repo/orders";
import { productsRepo } from "@/lib/repo/products";
import type { Product } from "@/lib/types";

/** Reorder list: every product at/below the low-stock threshold, with a
 * per-row "Add to Purchase" button and a bulk "Add Selected" action â€” both
 * open the Purchase form pre-loaded with those products so the user only
 * has to fill in batch/expiry/price/qty against the supplier invoice. */
export function LowStockPanel({
  onAddToPurchase,
  refreshSignal,
}: {
  onAddToPurchase: (products: Product[]) => void;
  /** Bump this (e.g. after a Purchase saves) to re-fetch â€” a restocked
   * product should drop off the list once it's above threshold again. */
  refreshSignal?: number;
}) {
  const [rows, setRows] = useState<LowStockOrderRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setRows(await getLowStockForOrder());
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [refreshSignal]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function addOne(row: LowStockOrderRow) {
    setResolvingId(row.id);
    try {
      const product = await productsRepo.get(row.id);
      if (product) onAddToPurchase([product]);
    } finally {
      setResolvingId(null);
    }
  }

  async function addSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const products = (await Promise.all(ids.map((id) => productsRepo.get(id)))).filter(
      (p): p is Product => p !== null
    );
    if (products.length > 0) onAddToPurchase(products);
  }

  return (
    <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={17} className="text-amber-600" />
          <h2 className="font-serif text-base text-neutral-800">Low Stock â€” Needs Reorder</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void addSelected()} disabled={selected.size === 0}>
            <ShoppingCart size={14} /> Add Selected To Purchase ({selected.size})
          </Button>
          <Button onClick={() => void reload()}>Refresh</Button>
        </div>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-400">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-400">
          Nothing low on stock right now â€” every product is above its reorder threshold.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-neutral-900 to-neutral-800 text-left text-white">
                <th className="px-3 py-2">
                  <input type="checkbox" checked={selected.size === rows.length} onChange={toggleAll} />
                </th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Barcode</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Avail Qty</th>
                <th className="px-3 py-2">Max Stock</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="px-3 py-2 font-medium text-neutral-800">{r.name}</td>
                  <td className="px-3 py-2 text-neutral-500">{r.barcode ?? "â€”"}</td>
                  <td className="px-3 py-2 text-neutral-500">{r.company_name ?? "â€”"}</td>
                  <td className="px-3 py-2 text-rose-600 font-medium">{r.avail_qty}</td>
                  <td className="px-3 py-2 text-neutral-500">{r.max_stock_qty ?? "â€”"}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={resolvingId === r.id}
                      onClick={() => void addOne(r)}
                      className="text-amber-700 hover:underline disabled:opacity-40"
                    >
                      {resolvingId === r.id ? "Adding..." : "Add to Purchase"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

