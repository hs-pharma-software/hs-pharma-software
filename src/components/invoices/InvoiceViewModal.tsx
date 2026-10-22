"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { listItemsForInvoice, invoicesRepo, type InvoiceItemWithProduct } from "@/lib/repo/invoices";
import { useAuthStore } from "@/store/authStore";
import { isTauri } from "@/lib/platform";
import { tenantsRepo } from "@/lib/repo/tenants";
import type { Invoice, Tenant } from "@/lib/types2";

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
  const [tenantInfo, setTenantInfo] = useState<Tenant | null>(null);
  const [template, setTemplate] = useState<"invoice" | "receipt">("invoice");
  const sessionTenant = useAuthStore((s) => s.currentTenant);

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
    if (isTauri() && sessionTenant?.id) {
      void tenantsRepo.get(sessionTenant.id).then(setTenantInfo);
    }
  }, [row.invoice.id, row.invoice.original_invoice_id, sessionTenant?.id]);

  const inv = row.invoice;

  return (
    <Modal
      title={`-:${inv.is_return ? "Return" : "Invoice"} #${inv.invoice_no ?? "—"}:-`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="flex items-center justify-between pb-3">
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTemplate("invoice")}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${template === "invoice" ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
          >
            Invoice (A4)
          </button>
          <button
            type="button"
            onClick={() => setTemplate("receipt")}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${template === "receipt" ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
          >
            Receipt (Thermal)
          </button>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => window.print()}>Print</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-neutral-400">Loading...</p>
      ) : (
        <div
          id="invoice-print-area"
          className={`print-area rounded-lg border border-neutral-200 p-5 text-sm ${template === "receipt" ? "mx-auto max-w-xs" : ""}`}
        >
          {/* ── Header ── */}
          <div className={`mb-4 border-b border-neutral-200 pb-3 ${template === "receipt" ? "text-center" : "flex items-start justify-between"}`}>
            <div>
              <h3 className={`font-serif font-bold text-neutral-900 ${template === "receipt" ? "text-base" : "text-xl"}`}>
                {tenantInfo?.name ?? sessionTenant?.name ?? "Pharmacy"}
              </h3>
              {tenantInfo?.address && <p className="text-xs text-neutral-500">{tenantInfo.address}</p>}
              {tenantInfo?.phone && <p className="text-xs text-neutral-500">Ph: {tenantInfo.phone}</p>}
              {template !== "receipt" && (
                <p className="mt-1 text-neutral-500">
                  {!!inv.is_return ? "Return" : "Invoice"} #{inv.invoice_no ?? "—"}
                  {!!inv.is_return && (
                    <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                      Return{originalInvoiceNo ? ` of Bill #${originalInvoiceNo}` : ""}
                    </span>
                  )}
                </p>
              )}
            </div>
            {template === "receipt" ? (
              <div className="mt-1 text-center text-xs text-neutral-500">
                <p className="font-semibold">{!!inv.is_return ? "RETURN" : "RECEIPT"} #{inv.invoice_no ?? "—"}</p>
                <p>{inv.date} · {inv.inv_on === "credit" ? "Credit" : "Cash"}</p>
                {!!inv.is_return && originalInvoiceNo && <p className="text-rose-600">of Bill #{originalInvoiceNo}</p>}
              </div>
            ) : (
              <div className="text-right text-neutral-600">
                <p>Date: {inv.date}</p>
                <p>{inv.inv_on === "credit" ? "Credit" : "Cash"} · {inv.invoice_type}</p>
              </div>
            )}
          </div>

          {/* ── Customer / Salesman ── */}
          {template === "receipt" ? (
            <div className="mb-3 text-xs text-neutral-600">
              <p><span className="font-medium text-neutral-800">Customer:</span> {row.customerName}</p>
              {row.salesmanName && <p><span className="font-medium text-neutral-800">Salesman:</span> {row.salesmanName}</p>}
            </div>
          ) : (
            <div className="mb-4 grid grid-cols-2 gap-3 text-neutral-600">
              <p><span className="font-medium text-neutral-800">Customer:</span> {row.customerName}</p>
              <p><span className="font-medium text-neutral-800">Salesman:</span> {row.salesmanName ?? "—"}</p>
            </div>
          )}

          {/* ── Line items ── */}
          {template === "receipt" ? (
            /* Thermal receipt: two-line layout fits the narrow width */
            <div className="mb-3 border-t border-neutral-300">
              {items.map((item) => {
                const packing = item.packing || 1;
                const hasSecondary = !!item.secondary_unit_id && packing > 1;
                const dispQty = hasSecondary ? item.qty * packing : item.qty;
                const dispBonus = hasSecondary ? item.bonus_qty * packing : item.bonus_qty;
                const dispPrice = hasSecondary ? item.sale_price / packing : item.sale_price;
                const unitLabel = hasSecondary ? (item.secondary_unit_name ?? "") : "";
                return (
                  <div key={item.id} className="border-b border-neutral-100 py-1.5">
                    <p className="font-medium text-neutral-900 leading-tight">{item.product_name}</p>
                    <div className="flex justify-between text-xs text-neutral-600 mt-0.5">
                      <span>
                        {dispQty % 1 === 0 ? dispQty : dispQty.toFixed(2)}{unitLabel ? ` ${unitLabel}` : ""}
                        {dispBonus > 0 && <span className="ml-1 text-emerald-600">+{dispBonus % 1 === 0 ? dispBonus : dispBonus.toFixed(2)} free</span>}
                        {item.batch_no && <span className="ml-1 text-neutral-400">({item.batch_no})</span>}
                      </span>
                      <span>
                        {dispPrice.toFixed(2)} × {dispQty % 1 === 0 ? dispQty : dispQty.toFixed(2)} ={" "}
                        <span className="font-semibold text-neutral-800">{item.total.toFixed(2)}</span>
                      </span>
                    </div>
                    {item.discount_pct > 0 && (
                      <p className="text-xs text-rose-600">Disc: {item.discount_pct}%</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* A4 invoice: full table */
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
                {items.map((item) => {
                  const packing = item.packing || 1;
                  const hasSecondary = !!item.secondary_unit_id && packing > 1;
                  const dispQty = hasSecondary ? item.qty * packing : item.qty;
                  const dispBonus = hasSecondary ? item.bonus_qty * packing : item.bonus_qty;
                  const dispPrice = hasSecondary ? item.sale_price / packing : item.sale_price;
                  const unitLabel = hasSecondary ? (item.secondary_unit_name ?? "") : "";
                  return (
                    <tr key={item.id} className="border-b border-neutral-100">
                      <td className="py-1.5 pr-2">{item.product_name}</td>
                      <td className="py-1.5 pr-2">{item.batch_no ?? "—"}</td>
                      <td className="py-1.5 pr-2 text-right">
                        {dispQty % 1 === 0 ? dispQty : dispQty.toFixed(2)}{unitLabel ? ` ${unitLabel}` : ""}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        {dispBonus > 0 ? `${dispBonus % 1 === 0 ? dispBonus : dispBonus.toFixed(2)}${unitLabel ? ` ${unitLabel}` : ""}` : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{dispPrice.toFixed(2)}</td>
                      <td className="py-1.5 pr-2 text-right">{item.discount_pct ? `${item.discount_pct}%` : "—"}</td>
                      <td className="py-1.5 text-right">{item.total.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ── Totals ── */}
          <div className={`flex flex-col gap-1 text-neutral-700 ${template === "receipt" ? "text-xs border-t border-neutral-300 pt-2" : "ml-auto w-56"}`}>
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
            <div className="flex justify-between font-semibold text-neutral-900">
              <span>Balance</span>
              <span>{inv.balance.toFixed(2)}</span>
            </div>
          </div>

          {inv.description && <p className="mt-3 text-xs text-neutral-500">Note: {inv.description}</p>}
          {template === "receipt" && (
            <p className="mt-3 border-t border-dashed border-neutral-300 pt-2 text-center text-xs text-neutral-400">
              Thank you for your visit!
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
