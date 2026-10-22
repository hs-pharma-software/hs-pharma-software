"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { listItemsForInvoice, invoicesRepo, type InvoiceItemWithProduct } from "@/lib/repo/invoices";
import { useAuthStore } from "@/store/authStore";
import { isTauri } from "@/lib/platform";
import { tenantsRepo } from "@/lib/repo/tenants";
import { loadFbrSettings, type FbrSettings } from "@/lib/fbr";
import { submitInvoiceToFbrById } from "@/lib/fbrSubmit";
import { can, useCan, NO_PERMISSION_MESSAGE } from "@/lib/actionPermissions";
import type { Invoice, Tenant } from "@/lib/types2";
import { InvoicePrintLayout, type PrintData } from "@/components/print/InvoicePrintLayout";
import {
  DEFAULT_TEMPLATES,
  PAPERS,
  lastPaper,
  loadLogo,
  loadTemplate,
  rememberPaper,
  type PaperSize,
  type PrintTemplate,
} from "@/lib/printTemplates";

interface InvoiceViewRow {
  invoice: Invoice;
  customerName: string;
  salesmanName: string | null;
}

/** Read-only invoice detail + print. The printable area is isolated by id
 * so `window.print()` (wired to the Print button) only outputs this content
 * \u2014 see the `@media print` rule in globals.css scoped to #invoice-print-area. */
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
  const [paper, setPaper] = useState<PaperSize>(lastPaper);
  const [templates, setTemplates] = useState<Partial<Record<PaperSize, PrintTemplate>>>({});
  const [logo, setLogo] = useState<string | null>(null);
  const [sellerNtn, setSellerNtn] = useState<string | null>(null);
  const [fbrSettings, setFbrSettings] = useState<FbrSettings | null>(null);
  const [fbrInvoiceNo, setFbrInvoiceNo] = useState<string | null>(row.invoice.fbr_invoice_no ?? null);
  const [fbrSubmitting, setFbrSubmitting] = useState(false);
  const [fbrError, setFbrError] = useState<string | null>(null);
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
    if (isTauri()) {
      void loadFbrSettings().then((s) => {
        if (s.enabled) setFbrSettings(s);
        setSellerNtn(s.sellerNtn || null);
      });
      void Promise.all(PAPERS.map((p) => loadTemplate(p.id))).then((list) =>
        setTemplates(Object.fromEntries(list.map((t) => [t.paper, t])))
      );
      void loadLogo().then(setLogo);
    } else {
      setTemplates({ ...DEFAULT_TEMPLATES });
    }
  }, [row.invoice.id, row.invoice.original_invoice_id, sessionTenant?.id]);

  const canFbr = useCan("invoice.fbr_submit");

  async function handleFbrSubmit() {
    if (!fbrSettings || items.length === 0) return;
    if (!can("invoice.fbr_submit")) return setFbrError(NO_PERMISSION_MESSAGE);
    setFbrSubmitting(true);
    setFbrError(null);
    const result = await submitInvoiceToFbrById(inv.id, fbrSettings);
    setFbrSubmitting(false);
    if (result.success && result.fbrInvoiceNo) {
      setFbrInvoiceNo(result.fbrInvoiceNo);
    } else {
      setFbrError(result.error ?? "Unknown error");
    }
  }

  const inv = row.invoice;
  const template = templates[paper];

  const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));
  const printData: PrintData = {
    business: {
      name: tenantInfo?.name ?? sessionTenant?.name ?? "Pharmacy",
      address: tenantInfo?.address ?? null,
      phone: tenantInfo?.phone ?? null,
      ntn: sellerNtn,
    },
    logo,
    title: inv.is_return ? "RETURN" : paper === "thermal" ? "RECEIPT" : "INVOICE",
    number: `#${inv.invoice_no ?? "-"}`,
    returnOf: inv.is_return && originalInvoiceNo ? `#${originalInvoiceNo}` : null,
    date: inv.date,
    payment: inv.inv_on === "credit" ? "Credit" : "Cash",
    invoiceType: inv.invoice_type ?? null,
    salesman: row.salesmanName,
    customer: {
      name: inv.customer_name || row.customerName,
      phone: inv.customer_phone ?? null,
      ntn: inv.buyer_ntn_cnic ?? null,
      address: inv.buyer_address ? `${inv.buyer_address}${inv.buyer_province ? `, ${inv.buyer_province}` : ""}` : null,
    },
    // Lines sold in the secondary unit are shown in that unit.
    items: items.map((item) => {
      const packing = item.packing || 1;
      const hasSecondary = !!item.secondary_unit_id && packing > 1;
      const unit = hasSecondary && item.secondary_unit_name ? ` ${item.secondary_unit_name}` : "";
      const qty = hasSecondary ? item.qty * packing : item.qty;
      const bonus = hasSecondary ? item.bonus_qty * packing : item.bonus_qty;
      return {
        id: item.id,
        name: item.product_name,
        batch: item.batch_no ?? null,
        qty: `${fmtQty(qty)}${unit}`,
        bonus: bonus > 0 ? `${fmtQty(bonus)}${unit}` : null,
        price: hasSecondary ? item.sale_price / packing : item.sale_price,
        discountPct: item.discount_pct,
        total: item.total,
      };
    }),
    totals: {
      total: inv.total,
      charges: inv.charges,
      discount: inv.discount_rs,
      payable: inv.payable,
      paid: inv.paid,
      balance: inv.balance,
    },
    note: inv.description || null,
    fbrInvoiceNo,
  };

  return (
    <Modal
      title={`${inv.is_return ? "Return" : "Invoice"} #${inv.invoice_no ?? "\u2014"}`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="flex items-center justify-between pb-3">
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
          {PAPERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPaper(p.id);
                rememberPaper(p.id);
              }}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${paper === p.id ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {fbrSettings && !fbrInvoiceNo && !inv.is_return && canFbr && (
            <Button
              variant="secondary"
              disabled={fbrSubmitting}
              onClick={() => void handleFbrSubmit()}
              className="border border-[#006633]/30 bg-[#006633]/5 text-[#006633] hover:bg-[#006633]/10"
            >
              {fbrSubmitting ? "Submitting…" : "Submit to FBR"}
            </Button>
          )}
          <Button onClick={() => window.print()}>Print</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>

      {fbrError && (
        <div className="mb-3 whitespace-pre-line break-words rounded-xl bg-rose-50 px-4 py-2.5 text-xs leading-relaxed text-rose-700 ring-1 ring-rose-200">
          <p className="font-semibold">FBR Error</p>
          {fbrError}
        </div>
      )}
      {loading || !template ? (
        <p className="py-10 text-center text-sm text-neutral-400">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div id="invoice-print-area" className="print-area mx-auto w-fit bg-white p-3">
            <InvoicePrintLayout template={template} data={printData} />
          </div>
        </div>
      )}
    </Modal>
  );
}
