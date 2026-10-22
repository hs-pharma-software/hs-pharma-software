"use client";

import { useEffect, useRef, useState } from "react";
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
  loadDefaultPaper,
  loadLogo,
  loadTemplate,
  type PrintTemplate,
} from "@/lib/printTemplates";
import { printDirect } from "@/lib/print";

interface InvoiceViewRow {
  invoice: Invoice;
  customerName: string;
  salesmanName: string | null;
}

/** Invoice detail + print, using the default print template from Settings.
 * Only `.print-area` is visible in print CSS (globals.css). With `autoPrint`
 * nothing is shown: the invoice goes straight to the printer, then closes. */
export function InvoiceViewModal({
  row,
  onClose,
  autoPrint = false,
}: {
  row: InvoiceViewRow;
  onClose: () => void;
  autoPrint?: boolean;
}) {
  const [items, setItems] = useState<InvoiceItemWithProduct[]>([]);
  const [originalInvoiceNo, setOriginalInvoiceNo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantInfo, setTenantInfo] = useState<Tenant | null>(null);
  const [template, setTemplate] = useState<PrintTemplate | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [sellerNtn, setSellerNtn] = useState<string | null>(null);
  const [fbrSettings, setFbrSettings] = useState<FbrSettings | null>(null);
  const [fbrInvoiceNo, setFbrInvoiceNo] = useState<string | null>(row.invoice.fbr_invoice_no ?? null);
  const [fbrSubmitting, setFbrSubmitting] = useState(false);
  const [fbrError, setFbrError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const autoPrinted = useRef(false);
  const sessionTenant = useAuthStore((s) => s.currentTenant);

  useEffect(() => {
    const tauri = isTauri();
    void Promise.all([
      listItemsForInvoice(row.invoice.id).then(setItems),
      row.invoice.original_invoice_id
        ? invoicesRepo.get(row.invoice.original_invoice_id).then((orig) => setOriginalInvoiceNo(orig?.invoice_no ?? null))
        : null,
      tauri && sessionTenant?.id ? tenantsRepo.get(sessionTenant.id).then(setTenantInfo) : null,
      tauri
        ? loadFbrSettings().then((s) => {
            if (s.enabled) setFbrSettings(s);
            setSellerNtn(s.sellerNtn || null);
          })
        : null,
      tauri ? loadDefaultPaper().then(loadTemplate).then(setTemplate) : setTemplate(structuredClone(DEFAULT_TEMPLATES.a4)),
      tauri ? loadLogo().then(setLogo) : null,
    ]).finally(() => setLoading(false));
  }, [row.invoice.id, row.invoice.original_invoice_id, sessionTenant?.id]);

  async function handlePrint() {
    if (!template) return;
    setPrinting(true);
    setPrintError(null);
    try {
      await printDirect(template.paper, areaRef.current);
    } catch (e) {
      setPrintError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrinting(false);
    }
  }

  // Direct print from the list: print once everything has rendered, then close.
  useEffect(() => {
    if (!autoPrint || loading || !template || autoPrinted.current) return;
    autoPrinted.current = true;
    requestAnimationFrame(() => {
      void printDirect(template.paper, areaRef.current)
        .catch((e) => window.alert(e instanceof Error ? e.message : String(e)))
        .finally(onClose);
    });
  }, [autoPrint, loading, template, onClose]);

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

  const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));
  const printData: PrintData = {
    business: {
      name: tenantInfo?.name ?? sessionTenant?.name ?? "Pharmacy",
      address: tenantInfo?.address ?? null,
      phone: tenantInfo?.phone ?? null,
      ntn: sellerNtn,
    },
    logo,
    title: inv.is_return ? "RETURN" : template?.paper === "thermal" ? "RECEIPT" : "INVOICE",
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

  const printArea =
    template && !loading ? (
      <div ref={areaRef} id="invoice-print-area" className="print-area mx-auto w-fit bg-white p-3 print:p-0">
        <InvoicePrintLayout template={template} data={printData} />
      </div>
    ) : null;

  // Direct print: render off-screen (still visible to print CSS) instead of the modal.
  if (autoPrint) {
    return <div className="pointer-events-none fixed inset-0 -z-10 opacity-0 print:z-auto print:opacity-100">{printArea}</div>;
  }

  return (
    <Modal
      title={`${inv.is_return ? "Return" : "Invoice"} #${inv.invoice_no ?? "—"}`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="flex items-center justify-between pb-3">
        <p className="text-xs text-neutral-500">
          {template ? `Prints on ${PAPERS.find((p) => p.id === template.paper)!.label}` : ""}
          <span className="text-neutral-400"> (change in Settings &gt; Print Templates)</span>
        </p>
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
          <Button disabled={!template || printing} onClick={() => void handlePrint()}>
            {printing ? "Printing…" : "Print"}
          </Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>

      {(fbrError || printError) && (
        <div className="mb-3 whitespace-pre-line break-words rounded-xl bg-rose-50 px-4 py-2.5 text-xs leading-relaxed text-rose-700 ring-1 ring-rose-200">
          <p className="font-semibold">{fbrError ? "FBR Error" : "Print Error"}</p>
          {fbrError ?? printError}
        </div>
      )}
      {!printArea ? (
        <p className="py-10 text-center text-sm text-neutral-400">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3">{printArea}</div>
      )}
    </Modal>
  );
}
