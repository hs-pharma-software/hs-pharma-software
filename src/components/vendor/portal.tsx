/** Shared pieces of the purchase-order screens: the vendor portal and the Purchase Cell. */
import { PageHeader } from "@/components/ui/PageHeader";

/** Shown on the eProcurement pages of a hospital whose service is not switched on (Super Admin). */
export function EprocurementInactive({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <p role="status" className="rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-sky-200">
        <b>eProcurement is a special service.</b> Quotations and purchase orders with a vendor portal (vendors quote their rates, receive orders and submit invoices online).
        Contact MAVIN.pk to switch it on for your hospital.
      </p>
    </div>
  );
}

/** Petty purchase (one vendor asked) or quotation (several). */
export const KIND_CLS: Record<string, string> = { petty: "bg-violet-100 text-violet-800", quotation: "bg-indigo-100 text-indigo-800" };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const rs = (n: number) => Number(n).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PrintablePo {
  poNo: string; kindLabel: string; rfqNo: string | null; issuedAt: string; issuedBy: string | null; hospitalName: string; vendorName: string; vendorNo: string | null;
  deliveryDays: number | null; note: string | null; total: number;
  items: { productName: string; specification: string | null; qty: number; uom: string | null; rate: number }[];
}

/** A purchase order on A4, in a window of its own (print or save as PDF). */
export function printPurchaseOrder(po: PrintablePo): void {
  // A blank window of our own (no URL loaded), so the page can write the order into it.
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return;
  const rows = po.items.map((it, i) => `<tr><td>${i + 1}</td><td><b>${esc(it.productName)}</b>${it.specification ? `<div class="spec">${esc(it.specification)}</div>` : ""}</td>
    <td class="n">${esc(it.qty)} ${esc(it.uom ?? "")}</td><td class="n">${rs(it.rate)}</td><td class="n">${rs(it.qty * it.rate)}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(po.poNo)}</title><style>
    @page { size: A4; margin: 14mm; } body { font: 12px/1.45 system-ui, sans-serif; color: #111; }
    h1 { font-size: 20px; margin: 0; } .muted { color: #555; } .row { display: flex; justify-content: space-between; gap: 16px; margin: 14px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border: 1px solid #bbb; padding: 6px 8px; vertical-align: top; text-align: left; }
    th { background: #f2f2f2; } .n { text-align: right; white-space: nowrap; } .spec { color: #555; font-size: 11px; white-space: pre-line; }
    .total td { font-weight: 700; } .sign { margin-top: 56px; display: flex; justify-content: space-between; } .sign div { border-top: 1px solid #333; padding-top: 4px; width: 40%; text-align: center; }
  </style></head><body>
    <div class="row"><div><h1>${esc(po.hospitalName)}</h1><div class="muted">Purchase Order</div></div>
      <div style="text-align:right"><b style="font-size:16px">${esc(po.poNo)}</b><div class="muted">${esc(po.kindLabel)}${po.rfqNo ? ` · against ${esc(po.rfqNo)}` : ""}</div><div>Date ${esc(po.issuedAt)}</div></div></div>
    <div class="row"><div><span class="muted">To</span><br><b>${esc(po.vendorName)}</b>${po.vendorNo ? ` (${esc(po.vendorNo)})` : ""}</div>
      <div style="text-align:right">${po.deliveryDays != null ? `Delivery within ${esc(po.deliveryDays)} day(s)` : ""}</div></div>
    <table><thead><tr><th>#</th><th>Item and specification</th><th class="n">Quantity</th><th class="n">Rate (Rs)</th><th class="n">Amount (Rs)</th></tr></thead>
      <tbody>${rows}<tr class="total"><td colspan="4">Total</td><td class="n">${rs(po.total)}</td></tr></tbody></table>
    ${po.note ? `<p style="white-space:pre-line"><b>Note:</b> ${esc(po.note)}</p>` : ""}
    <div class="sign"><div>Purchase Officer${po.issuedBy ? `<br>${esc(po.issuedBy)}` : ""}</div><div>Vendor's acceptance</div></div>
    <script>window.onload = function () { window.print(); };</script>
  </body></html>`);
  w.document.close();
}
