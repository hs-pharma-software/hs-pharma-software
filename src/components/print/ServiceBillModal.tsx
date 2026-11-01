"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, Send } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { InvoicePrintLayout, type PrintData } from "@/components/print/InvoicePrintLayout";
import { DEFAULT_TEMPLATES, loadDefaultPaper, loadLogo, loadTemplate, type PrintTemplate } from "@/lib/printTemplates";
import { printDirect } from "@/lib/print";
import { isTauri } from "@/lib/platform";
import { getSetting } from "@/lib/repo/settings";
import { invoicesRepo } from "@/lib/repo/invoices";
import { loadFbrSettings } from "@/lib/fbr";
import { submitServiceInvoiceToFbr, type ServiceLine } from "@/lib/serviceFbr";
import { useCan } from "@/lib/actionPermissions";
import { useAuthStore } from "@/store/authStore";
import type { Invoice } from "@/lib/types2";

/** A service bill (lab visit, banquet booking) printed with the business's
 * own invoice template and theme (General Settings > Print Templates), the
 * same A4 / A5 / thermal designs as the store's invoices, and sent to FBR. */
export function ServiceBillModal({ invoiceId, lines, title = "Bill", note = null, onClose, autoPrint = false }: {
  invoiceId: string;
  /** The bill's lines (tests, menu, extras...). */
  lines: ServiceLine[];
  title?: string;
  note?: string | null;
  onClose: () => void;
  autoPrint?: boolean;
}) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [template, setTemplate] = useState<PrintTemplate | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [company, setCompany] = useState<{ ntn: string | null; stn: string | null; contact: string | null; address: string | null; pra: string | null }>({ ntn: null, stn: null, contact: null, address: null, pra: null });
  const [fbrOn, setFbrOn] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const printed = useRef(false);
  const tenantName = useAuthStore((s) => s.currentTenant?.name ?? "");
  const canFbr = useCan("invoice.fbr_submit");

  useEffect(() => {
    void invoicesRepo.get(invoiceId).then(setInv);
    if (!isTauri()) {
      setTemplate(structuredClone(DEFAULT_TEMPLATES.a4));
      return;
    }
    void loadDefaultPaper().then(loadTemplate).then(setTemplate);
    void loadLogo().then(setLogo);
    void loadFbrSettings().then((s) => setFbrOn(s.enabled)).catch(() => setFbrOn(false));
    void Promise.all(["company_ntn", "company_stn", "company_contact", "company_address", "company_pra"].map((k) => getSetting(k)))
      .then(([ntn, stn, contact, address, pra]) => setCompany({ ntn: ntn || null, stn: stn || null, contact: contact || null, address: address || null, pra: pra || null }));
  }, [invoiceId]);

  async function print() {
    if (!template) return;
    try {
      await printDirect(template.paper, areaRef.current);
    } catch (e) {
      window.alert(`Could not print: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  useEffect(() => {
    if (!autoPrint || !inv || !template || printed.current) return;
    printed.current = true;
    requestAnimationFrame(() => void print());
  });

  async function sendToFbr() {
    setSending(true);
    setMessage(null);
    try {
      const r = await submitServiceInvoiceToFbr(invoiceId, lines);
      if (r.success && r.fbrInvoiceNo) {
        setInv((i) => (i ? { ...i, fbr_invoice_no: r.fbrInvoiceNo } : i));
        setMessage({ ok: true, text: `Sent to FBR: ${r.fbrInvoiceNo}` });
      } else {
        setMessage({ ok: false, text: r.error ?? "FBR did not accept the bill." });
      }
    } finally {
      setSending(false);
    }
  }

  const gross = lines.reduce((t, l) => t + l.qty * l.rate, 0);
  const data: PrintData | null = inv && {
    business: { name: tenantName || "Business", address: company.address, phone: company.contact, ntn: company.ntn, stn: company.stn, pra: company.pra },
    logo,
    title: template?.paper === "thermal" ? "RECEIPT" : title.toUpperCase(),
    number: `#${inv.invoice_no ?? "-"}`,
    returnOf: null,
    date: inv.date,
    payment: inv.balance > 0.009 ? (inv.paid > 0 ? "Part paid" : "Credit") : "Cash",
    invoiceType: null,
    salesman: null,
    customer: { name: inv.customer_name ?? "", phone: inv.customer_phone ?? null, ntn: inv.buyer_ntn_cnic ?? null, address: inv.buyer_address ?? null },
    items: lines.map((l, i) => ({
      id: String(i), name: l.name, hsCode: null, batch: null, qty: String(l.qty), bonus: null, price: l.rate, discountPct: 0, taxPct: 0, taxRs: 0, total: l.qty * l.rate,
    })),
    totals: { total: gross, discount: Number(inv.discount_rs) || 0, tax: 0, charges: Number(inv.charges) || 0, payable: inv.payable, paid: inv.paid, balance: inv.balance },
    note: [inv.description, note].filter(Boolean).join("\n") || null,
    fbrInvoiceNo: inv.fbr_invoice_no ?? null,
  };

  return (
    <Modal title={inv ? `${title} #${inv.invoice_no ?? ""}` : title} onClose={onClose} width="max-w-4xl">
      {!data || !template ? <p className="p-6 text-sm text-neutral-400">Loading…</p> : (
        <>
          <div className="max-h-[65vh] overflow-auto">
            <div ref={areaRef} className="print-area mx-auto w-fit bg-white p-3 print:p-0">
              <InvoicePrintLayout template={template} data={data} />
            </div>
          </div>
          {message && <p className={`mt-2 whitespace-pre-line text-sm ${message.ok ? "text-emerald-700" : "text-rose-600"}`}>{message.text}</p>}
          <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
            {fbrOn && canFbr && !inv?.fbr_invoice_no && (
              <Button onClick={() => void sendToFbr()} disabled={sending}><Send size={14} />{sending ? "Sending…" : "Send to FBR"}</Button>
            )}
            <Button variant="primary" onClick={() => void print()}><Printer size={14} />Print</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
