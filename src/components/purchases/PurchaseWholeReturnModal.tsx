"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { PurchasePicker } from "@/components/purchases/PurchasePicker";
import {
  listItemsForPurchase,
  getReturnedQtyByProduct,
  returnWholePurchase,
  type PurchaseListRow,
  type PurchaseItemWithProduct,
} from "@/lib/repo/purchases";

interface PreviewLine {
  item: PurchaseItemWithProduct;
  alreadyReturned: number;
  returnQty: number;
}

/** Invoice-wise return: pick the original purchase and send everything
 * still on hand from it back to the supplier in one action - no picking
 * individual lines/quantities. See PurchaseItemReturnModal for a partial,
 * item-by-item return instead. */
export function PurchaseWholeReturnModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<PurchaseListRow | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [paid, setPaid] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectPurchase(row: PurchaseListRow) {
    setSelected(row);
    setLoadingLines(true);
    setError(null);
    try {
      const [items, returnedMap] = await Promise.all([
        listItemsForPurchase(row.id),
        getReturnedQtyByProduct(row.id),
      ]);
      setLines(
        items.map((item) => {
          const alreadyReturned = returnedMap.get(item.product_id) ?? 0;
          return { item, alreadyReturned, returnQty: Math.max(0, item.received_qty - alreadyReturned) };
        })
      );
    } finally {
      setLoadingLines(false);
    }
  }

  function changePurchase() {
    setSelected(null);
    setLines([]);
  }

  const returnableLines = lines.filter((l) => l.returnQty > 0);
  const total = returnableLines.reduce((s, l) => s + l.item.purchase_price * l.returnQty, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || returnableLines.length === 0) {
      setError("Nothing left to return on this purchase.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await returnWholePurchase(selected.id, Number(paid) || 0);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Return Whole Purchase Invoice" onClose={onClose} width="max-w-4xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {!selected ? (
          <Field label="Search P.ID or Supplier" required>
            <PurchasePicker onSelect={(row) => void selectPurchase(row)} autoFocus />
          </Field>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
            <span>
              Returning <span className="font-medium">everything</span> from{" "}
              <span className="font-medium">Purchase #{selected.purchase_no}</span> - {selected.supplier_name} (
              {selected.date})
            </span>
            <Button type="button" onClick={changePurchase}>
              Change Purchase
            </Button>
          </div>
        )}

        {loadingLines && <p className="py-6 text-center text-sm text-neutral-400">Loading purchase items...</p>}

        {selected && !loadingLines && (
          <>
            <p className="text-xs text-neutral-500">
              Every line still on hand from this purchase will be returned at full remaining quantity. Use Purchase
              Item Return instead if you only want to return specific items.
            </p>
            <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="bg-neutral-900 text-left text-white">
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2">Batch</th>
                    <th className="px-2 py-2">Received Qty</th>
                    <th className="px-2 py-2">Already Returned</th>
                    <th className="px-2 py-2">Returning</th>
                    <th className="px-2 py-2">Price</th>
                    <th className="px-2 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-6 text-center text-neutral-400">
                        This purchase has no items.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l) => (
                      <tr
                        key={l.item.id}
                        className={`border-b border-neutral-100 last:border-0 ${l.returnQty === 0 ? "text-neutral-300" : ""}`}
                      >
                        <td className="px-2 py-1.5">{l.item.product_name}</td>
                        <td className="px-2 py-1.5">{l.item.batch_no ?? "\u2014"}</td>
                        <td className="px-2 py-1.5">{l.item.received_qty}</td>
                        <td className="px-2 py-1.5">{l.alreadyReturned || "\u2014"}</td>
                        <td className="px-2 py-1.5 font-medium text-neutral-800">
                          {l.returnQty === 0 ? "Fully returned" : l.returnQty}
                        </td>
                        <td className="px-2 py-1.5">{l.item.purchase_price.toFixed(2)}</td>
                        <td className="px-2 py-1.5">{(l.item.purchase_price * l.returnQty).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Total Return Value">
                <Input value={total.toFixed(2)} disabled />
              </Field>
              <Field label="Paid Back (F8)">
                <Input type="number" min="0" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || returnableLines.length === 0}>
            {saving ? "Returning..." : "Return Whole Invoice"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

