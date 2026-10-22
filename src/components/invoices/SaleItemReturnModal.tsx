"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { InvoicePicker } from "@/components/invoices/InvoicePicker";
import {
  invoicesRepo,
  invoiceItemsRepo,
  nextInvoiceNo,
  listItemsForInvoice,
  getReturnedQtyByProduct,
  type InvoiceListRow,
  type InvoiceItemWithProduct,
} from "@/lib/repo/invoices";
import { receiveStock } from "@/lib/repo/stock";
import type { Invoice } from "@/lib/types2";

interface ReturnLine {
  item: InvoiceItemWithProduct;
  alreadyReturned: number;
  remaining: number;
  returnQty: number;
}

export function SaleItemReturnModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<InvoiceListRow | null>(null);
  const [originalInvoice, setOriginalInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [paid, setPaid] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectInvoice(row: InvoiceListRow) {
    setSelected(row);
    setLoadingLines(true);
    setError(null);
    try {
      const [full, items, returnedMap] = await Promise.all([
        invoicesRepo.get(row.id),
        listItemsForInvoice(row.id),
        getReturnedQtyByProduct(row.id),
      ]);
      setOriginalInvoice(full);
      setLines(
        items.map((item) => {
          const alreadyReturned = returnedMap.get(item.product_id) ?? 0;
          const remaining = Math.max(0, item.qty - alreadyReturned);
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

  function changeInvoice() {
    setSelected(null);
    setOriginalInvoice(null);
    setLines([]);
  }

  const activeLines = lines.filter((l) => l.returnQty > 0);
  const total = activeLines.reduce((s, l) => s + l.item.sale_price * l.returnQty, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!originalInvoice || activeLines.length === 0) {
      setError("Select at least one item and a return quantity.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const invoiceNo = await nextInvoiceNo();
      const returnInvoice = await invoicesRepo.create({
        invoice_no: invoiceNo,
        date: new Date().toISOString().slice(0, 10),
        inv_on: originalInvoice.inv_on,
        invoice_type: originalInvoice.invoice_type,
        description: `Return against Bill #${originalInvoice.invoice_no}`,
        salesman_id: originalInvoice.salesman_id,
        customer_id: originalInvoice.customer_id,
        total,
        charges: 0,
        discount_pct: 0,
        discount_rs: 0,
        tax_pct: 0,
        payable: total,
        paid: Number(paid) || 0,
        balance: total - (Number(paid) || 0),
        is_return: 1,
        is_memorized: 0,
        converted_invoice_id: null,
        original_invoice_id: originalInvoice.id,
      });

      for (const l of activeLines) {
        await receiveStock({
          productId: l.item.product_id,
          batchNo: l.item.batch_no,
          qty: l.returnQty,
          purchasePrice: l.item.purchase_price,
          expiryDate: null,
          location: null,
        });
        await invoiceItemsRepo.create({
          invoice_id: returnInvoice.id,
          product_id: l.item.product_id,
          batch_no: l.item.batch_no,
          packing: l.item.packing,
          uom_id: l.item.uom_id,
          avail_qty: null,
          qty: l.returnQty,
          bonus_qty: 0,
          purchase_price: l.item.purchase_price,
          sale_price: l.item.sale_price,
          tax_pct: 0,
          further_tax_pct: 0,
          tax_rs: 0,
          discount_pct: 0,
          discount_rs: 0,
          total: l.item.sale_price * l.returnQty,
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
    <Modal title="-:Sale Item Return:-" onClose={onClose} width="max-w-4xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {!selected ? (
          <Field label="Search Bill # or Customer" required>
            <InvoicePicker onSelect={(row) => void selectInvoice(row)} autoFocus />
          </Field>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
            <span>
              Returning against <span className="font-medium">Bill #{selected.invoice_no}</span> -{" "}
              {selected.customer_name} ({selected.date})
            </span>
            <Button type="button" onClick={changeInvoice}>
              Change Bill
            </Button>
          </div>
        )}

        {loadingLines && <p className="py-6 text-center text-sm text-neutral-400">Loading bill items...</p>}

        {selected && !loadingLines && (
          <>
            <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="bg-neutral-900 text-left text-white">
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2">Batch</th>
                    <th className="px-2 py-2">Sold Qty</th>
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
                        This bill has no items.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => (
                      <tr key={l.item.id} className="border-b border-neutral-100 last:border-0">
                        <td className="px-2 py-1.5">{l.item.product_name}</td>
                        <td className="px-2 py-1.5">{l.item.batch_no ?? "\u2014"}</td>
                        <td className="px-2 py-1.5">{l.item.qty}</td>
                        <td className="px-2 py-1.5">{l.alreadyReturned || "\u2014"}</td>
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
                        <td className="px-2 py-1.5">{l.item.sale_price.toFixed(2)}</td>
                        <td className="px-2 py-1.5">{(l.item.sale_price * l.returnQty).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Total Refund">
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

