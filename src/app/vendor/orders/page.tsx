"use client";

import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { useVendorMe } from "@/components/layout/VendorShell";
import { KIND_CLS, printPurchaseOrder } from "@/components/vendor/portal";
import { errText, pkr, portalOrders, type PortalOrder } from "@/lib/vendorPortalClient";

const STATUS: Record<PortalOrder["status"], { label: string; cls: string }> = {
  issued: { label: "To supply · invoice not sent", cls: "bg-amber-100 text-amber-800" },
  invoiced: { label: "Invoice sent", cls: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "Cancelled", cls: "bg-neutral-100 text-neutral-500" },
};

/** Vendor portal > Purchase Orders: the orders the hospital issued to this vendor. */
export default function VendorOrdersPage() {
  const me = useVendorMe();
  const [rows, setRows] = useState<PortalOrder[] | null>(null);
  const [opened, setOpened] = useState<PortalOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await portalOrders()); setError(null); } catch (e) { setRows([]); setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const print = (o: PortalOrder) => printPurchaseOrder({
    ...o, hospitalName: me?.hospitalName ?? "Hospital", vendorName: me?.vendorName ?? "", vendorNo: me?.vendorNo ?? null,
  });

  return (
    <div>
      <PageHeader title="Purchase Orders" />
      <p className="mb-3 text-sm text-neutral-600">Orders the purchase officer issued to you after comparing rates. Supply the items, then submit your invoice under Payments.</p>
      <FormError message={error} className="mb-3" />
      {rows === null ? (
        <div className="grid gap-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white" />)}</div>
      ) : rows.length === 0 ? (
        <p className="fade-in rounded-2xl bg-white p-8 text-center text-sm text-neutral-500 ring-1 ring-black/[0.04]">No purchase orders yet.</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((o, i) => (
            <li key={o.id} className="row-in" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button type="button" onClick={() => setOpened(o)}
                className="w-full rounded-2xl bg-white p-4 text-left shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.08)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{o.poNo}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_CLS[o.kind]}`}>{o.kindLabel}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                  <span className="ml-auto text-sm font-semibold tabular-nums">{pkr(o.total)}</span>
                </div>
                <p className="mt-1 text-sm text-neutral-600">{o.issuedAt}{o.rfqNo ? ` · against ${o.rfqNo}` : ""} · {o.items.length} item{o.items.length === 1 ? "" : "s"}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {opened && (
        <Modal title={`Purchase order ${opened.poNo}`} onClose={() => setOpened(null)} width="max-w-3xl">
          <p className="mb-2 text-sm text-neutral-600">{opened.kindLabel} · issued {opened.issuedAt}{opened.issuedBy ? ` by ${opened.issuedBy}` : ""}{opened.deliveryDays != null ? ` · deliver within ${opened.deliveryDays} day(s)` : ""}</p>
          {opened.status === "cancelled" && <p role="status" className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">Cancelled by the hospital{opened.cancelReason ? `: ${opened.cancelReason}` : ""}.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 pr-2 font-medium">Item</th><th className="pb-1.5 pr-2 text-right font-medium">Qty</th><th className="pb-1.5 pr-2 text-right font-medium">Rate</th><th className="pb-1.5 text-right font-medium">Amount</th></tr></thead>
              <tbody>
                {opened.items.map((it, i) => (
                  <tr key={i} className="border-t border-neutral-100 align-top">
                    <td className="py-1.5 pr-2">{it.productName}{it.specification && <span className="block whitespace-pre-line text-xs text-neutral-500">{it.specification}</span>}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{it.qty}{it.uom ? ` ${it.uom}` : ""}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{pkr(it.rate)}</td>
                    <td className="py-1.5 text-right tabular-nums">{pkr(it.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-neutral-300 font-semibold"><td className="py-1.5" colSpan={3}>Total</td><td className="py-1.5 text-right tabular-nums">{pkr(opened.total)}</td></tr>
              </tbody>
            </table>
          </div>
          {opened.note && <p className="mt-2 whitespace-pre-line text-sm text-neutral-700"><b>Note:</b> {opened.note}</p>}
          <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
            <Button onClick={() => setOpened(null)}>Close</Button>
            <Button variant="primary" onClick={() => print(opened)}><Printer size={14} className="mr-1" />Print</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
