"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { editSaleReturn, invoicesRepo, listItemsForInvoice, type InvoiceItemWithProduct } from "@/lib/repo/invoices";
import type { Invoice } from "@/lib/types2";

/** Changes a sale return: date, paid back, description, quantities returned. */
export function SaleReturnEditModal({ returnId, onClose, onSaved }: { returnId: string; onClose: () => void; onSaved: () => void }) {
  const [ret, setRet] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItemWithProduct[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [date, setDate] = useState("");
  const [paid, setPaid] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([invoicesRepo.get(returnId), listItemsForInvoice(returnId)]).then(([r, its]) => {
      if (!r) return;
      setRet(r);
      setItems(its);
      setQty(Object.fromEntries(its.map((i) => [i.id, String(i.qty)])));
      setDate(r.date);
      setPaid(String(r.paid));
      setDescription(r.description ?? "");
    });
  }, [returnId]);

  const total = items.reduce((t, i) => t + (Number(qty[i.id]) || 0) * Number(i.sale_price), 0);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await editSaleReturn(returnId, { date, paid: Number(paid) || 0, description, lines: items.map((i) => ({ itemId: i.id, qty: Number(qty[i.id]) || 0 })) });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={ret ? `Edit return #${ret.invoice_no ?? ""}` : "Edit return"} onClose={onClose} width="max-w-3xl">
      {!ret ? <p className="p-6 text-sm text-neutral-400">Loading…</p> : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Date" required><Input id="sre-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Paid back"><Input id="sre-paid" type="number" min="0" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
            <Field label="Total refund"><Input value={total.toFixed(2)} disabled /></Field>
          </div>
          <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="bg-neutral-900 text-left text-white">
                  <th className="px-2 py-2">Product</th><th className="px-2 py-2">Batch</th><th className="px-2 py-2">Return Qty</th><th className="px-2 py-2">Price</th><th className="px-2 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-2 py-1.5">{i.product_name}</td>
                    <td className="px-2 py-1.5">{i.batch_no ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Return quantity of ${i.product_name}`} type="number" min="0" step="any" value={qty[i.id] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} className="w-20 rounded border border-neutral-300 px-1.5 py-1" />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{Number(i.sale_price).toFixed(2)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{((Number(qty[i.id]) || 0) * Number(i.sale_price)).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label="Description"><Input id="sre-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <p className="text-xs text-neutral-500">Stock follows the change: a larger quantity goes back into stock, a smaller one comes out again. 0 removes the line.</p>
          {error && <p className="whitespace-pre-line text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
