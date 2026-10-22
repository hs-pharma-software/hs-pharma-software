"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { PurchasePicker } from "@/components/purchases/PurchasePicker";
import {
  purchasesRepo,
  purchaseItemsRepo,
  listItemsForPurchase,
  getReturnedQtyByProduct,
  type PurchaseListRow,
  type PurchaseItemWithProduct,
} from "@/lib/repo/purchases";
import { deductStock, listAvailableBatches } from "@/lib/repo/stock";
import type { Purchase } from "@/lib/types2";

interface ReturnLine {
  item: PurchaseItemWithProduct;
  alreadyReturned: number;
  remaining: number;
  returnQty: number;
}

/** Item-wise return: pick the original purchase first, then choose specific
 * lines/quantities to send back to the supplier â€” for a partial return.
 * See PurchaseWholeReturnModal for the one-click "return everything" case. */
export function PurchaseItemReturnModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<PurchaseListRow | null>(null);
  const [originalPurchase, setOriginalPurchase] = useState<Purchase | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [paid, setPaid] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectPurchase(row: PurchaseListRow) {
    setSelected(row);
    setLoadingLines(true);
    setError(null);
    try {
      const [full, items, returnedMap] = await Promise.all([
        purchasesRepo.get(row.id),
        listItemsForPurchase(row.id),
        getReturnedQtyByProduct(row.id),
      ]);
      setOriginalPurchase(full);
      setLines(
        items.map((item) => {
          const alreadyReturned = returnedMap.get(item.product_id) ?? 0;
          const remaining = Math.max(0, item.received_qty - alreadyReturned);
          return { item, alreadyReturned, remaining, returnQty: 0 };
        })
      );
    } finally {
      setLoadingLines(false);
    }
  }

  function updateQty(idx: number, qty: number) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, returnQty: Math.max(0, Math.min(qty, l.remaining)) } : l))
    );
  }

  function changePurchase() {
    setSelected(null);
    setOriginalPurchase(null);
    setLines([]);
  }

  const activeLines = lines.filter((l) => l.returnQty > 0);
  const total = activeLines.reduce((s, l) => s + l.item.purchase_price * l.returnQty, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!originalPurchase || activeLines.length === 0) {
      setError("Select at least one item and a return quantity.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const returnPurchase = await purchasesRepo.create({
        purchase_no: null,
        date: new Date().toISOString().slice(0, 10),
        order_id: null,
        supplier_id: originalPurchase.supplier_id,
        supplier_invoice_no: originalPurchase.supplier_invoice_no,
        discount_rs: 0,
        discount_pct: 0,
        tax: 0,
        payable: total,
        paid_amount: Number(paid) || 0,
        balance: total - (Number(paid) || 0),
        description: `Return against Purchase #${originalPurchase.purchase_no ?? ""}`,
        payment_method: originalPurchase.payment_method,
        bank_id: null,
        slip_no: null,
        advance_payment: 0,
        is_return: 1,
        original_purchase_id: originalPurchase.id,
      });

      for (const l of activeLines) {
        const batches = await listAvailableBatches(l.item.product_id);
        const match = batches.find((b) => b.batch_no === l.item.batch_no) ?? batches[0];
        if (!match || match.qty < l.returnQty) {
          throw new Error(`Not enough stock of ${l.item.product_name} on hand to return (need ${l.returnQty}).`);
        }
        await deductStock(match.id, l.returnQty);
        await purchaseItemsRepo.create({
          purchase_id: returnPurchase.id,
          product_id: l.item.product_id,
          location: l.item.location,
          batch_no: l.item.batch_no,
          expiry_date: l.item.expiry_date,
          uom_id: l.item.uom_id,
          purchase_price: l.item.purchase_price,
          booked_qty: l.returnQty,
          received_qty: l.returnQty,
          avail_qty: match.qty - l.returnQty,
          amount: l.item.purchase_price * l.returnQty,
          st_pct: l.item.st_pct,
          wht_pct: l.item.wht_pct,
          total: l.item.purchase_price * l.returnQty,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="-:Purchase Item Return:-" onClose={onClose} width="max-w-4xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {!selected ? (
          <Field label="Search P.ID or Supplier" required>
            <PurchasePicker onSelect={(row) => void selectPurchase(row)} autoFocus />
          </Field>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
            <span>
              Returning against <span className="font-medium">Purchase #{selected.purchase_no}</span> â€”{" "}
              {selected.supplier_name} ({selected.date})
            </span>
            <Button type="button" onClick={changePurchase}>
              Change Purchase
            </Button>
          </div>
        )}

        {loadingLines && <p className="py-6 text-center text-sm text-neutral-400">Loading purchase items...</p>}

        {selected && !loadingLines && (
          <>
            <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="bg-neutral-900 text-left text-white">
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2">Batch</th>
                    <th className="px-2 py-2">Received Qty</th>
                    <th className="px-2 py-2">Already Returned</th>
                    <th className="px-2 py-2">Returnable</th>
                    <th className="px-2 py-2">Return Qty</th>
                    <th className="px-2 py-2">Price</th>
                    <th className="px-2 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-2 py-6 text-center text-neutral-400">
                        This purchase has no items.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => (
                      <tr key={l.item.id} className="border-b border-neutral-100 last:border-0">
                        <td className="px-2 py-1.5">{l.item.product_name}</td>
                        <td className="px-2 py-1.5">{l.item.batch_no ?? "â€”"}</td>
                        <td className="px-2 py-1.5">{l.item.received_qty}</td>
                        <td className="px-2 py-1.5">{l.alreadyReturned || "â€”"}</td>
                        <td className="px-2 py-1.5">{l.remaining}</td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            max={l.remaining}
                            step="any"
                            value={l.returnQty}
                            disabled={l.remaining === 0}
                            onChange={(e) => updateQty(idx, Number(e.target.value))}
                            className="w-20 rounded border border-neutral-300 px-1.5 py-1 disabled:bg-neutral-100"
                          />
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
          <Button type="submit" variant="primary" disabled={saving || activeLines.length === 0}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

