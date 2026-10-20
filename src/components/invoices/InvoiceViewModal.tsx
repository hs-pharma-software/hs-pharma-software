"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { listItemsForInvoice, invoicesRepo, type InvoiceItemWithProduct } from "@/lib/repo/invoices";
import type { Invoice } from "@/lib/types2";

interface InvoiceViewRow {
  invoice: Invoice;
  customerName: string;
  salesmanName: string | null;
}

/** Read-only invoice detail + print. The printable area is isolated by id
 * so `window.print()` (wired to the Print button) only outputs this content
 * — see the `@media print` rule in globals.css scoped to #invoice-print-area. */
export function InvoiceViewModal({
  row,
  onClose,
}: {
  row: InvoiceViewRow;
  onClose: () => void;
}) {
  const [items, setItems] = useState<InvoiceItemWithProduct[]>([]);
  const [originalInvoiceNo, setOriginalInvoiceNo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listItemsForInvoice(row.invoice.id).then((rows) => {
      setItems(rows);
      setLoading(false);
    });
    if (row.invoice.original_invoice_id) {
      void invoicesRepo.get(row.invoice.original_invoice_id).then((orig) => {
        setOriginalInvoiceNo(orig?.invoice_no ?? null);
      });
    }
  }, [row.invoice.id, row.invoice.original_invoice_id]);

  const inv = row.invoice;

  return (
    <Modal
      title={`-:${inv.is_return ? "Return" : "Invoice"} #${inv.invoice_no ?? "—"}:-`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="flex justify-end gap-2 pb-3">
        <Button onClick={() => window.print()}>Print</Button>
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-neutral-400">Loading...</p>
      ) : (
        <div id="invoice-print-area" className="print-area rounded-lg border border-neutral-200 p-5 text-sm">
          <div className="mb-4 flex items-start justify-between border-b border-neutral-200 pb-3">
            <div>
              <h3 className="font-serif text-lg text-neutral-800">Billora</h3>
              <p className="text-neutral-500">
                {inv.is_return ? "Return" : "Invoice"} #{inv.invoice_no ?? "—"}
                {inv.is_return ? (
                  <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                    Return{originalInvoiceNo ? ` of Bill #${originalInvoiceNo}` : ""}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="text-right text-neutral-600">
              <p>Date: {inv.date}</p>
              <p>{inv.inv_on === "credit" ? "Credit" : "Cash"} · {inv.invoice_type}</p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 text-neutral-600">
            <p>
              <span className="font-medium text-neutral-800">Customer:</span> {row.customerName}
            </p>
            <p>
              <span className="font-medium text-neutral-800">Salesman:</span> {row.salesmanName ?? "—"}
            </p>
          </div>

          <table className="mb-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-300 text-neutral-500">
                <th className="py-1.5 pr-2">Product</th>
                <th className="py-1.5 pr-2">Batch</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2 text-right">Bonus</th>
                <th className="py-1.5 pr-2 text-right">Price</th>
                <th className="py-1.5 pr-2 text-right">Disc</th>
                <th className="py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-neutral-100">
                  <td className="py-1.5 pr-2">{item.product_name}</td>
                  <td className="py-1.5 pr-2">{item.batch_no ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{item.qty}</td>
                  <td className="py-1.5 pr-2 text-right">{item.bonus_qty || "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{item.sale_price.toFixed(2)}</td>
                  <td className="py-1.5 pr-2 text-right">{item.discount_pct ? `${item.discount_pct}%` : "—"}</td>
                  <td className="py-1.5 text-right">{item.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ml-auto flex w-56 flex-col gap-1 text-neutral-700">
            <div className="flex justify-between">
              <span>Total</span>
              <span>{inv.total.toFixed(2)}</span>
            </div>
            {inv.charges > 0 && (
              <div className="flex justify-between">
                <span>Charges</span>
                <span>{inv.charges.toFixed(2)}</span>
              </div>
            )}
            {inv.discount_rs > 0 && (
              <div className="flex justify-between">
                <span>Discount</span>
                <span>-{inv.discount_rs.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-medium text-neutral-900">
              <span>Payable</span>
              <span>{inv.payable.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Paid</span>
              <span>{inv.paid.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-medium text-neutral-900">
              <span>Balance</span>
              <span>{inv.balance.toFixed(2)}</span>
            </div>
          </div>

          {inv.description && <p className="mt-4 text-neutral-500">Note: {inv.description}</p>}
        </div>
      )}
    </Modal>
  );
}
