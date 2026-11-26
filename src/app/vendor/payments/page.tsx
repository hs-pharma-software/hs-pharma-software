"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { localDate } from "@/lib/localDate";
import { notify } from "@/lib/notify";
import { errText, pkr, portalPayments, submitInvoice, type PaymentStage, type PortalPayment } from "@/lib/vendorPortalClient";

const TONE: Record<PaymentStage, string> = {
  not_invoiced: "bg-amber-100 text-amber-800", with_purchase_cell: "bg-sky-100 text-sky-800", returned_to_vendor: "bg-rose-100 text-rose-800",
  with_store: "bg-sky-100 text-sky-800", returned_by_store: "bg-rose-100 text-rose-800", unpaid: "bg-orange-100 text-orange-800",
  part_paid: "bg-yellow-100 text-yellow-800", paid: "bg-emerald-100 text-emerald-800",
};
const METHOD: Record<string, string> = { bank: "Bank transfer", cash: "Cash", cheque: "Cheque" };

/** Vendor portal > Payments: each purchase order's invoice, where it is and what has been paid. */
export default function VendorPaymentsPage() {
  const [rows, setRows] = useState<PortalPayment[] | null>(null);
  const [show, setShow] = useState<"all" | "unpaid" | "paid">("all");
  const [invoicing, setInvoicing] = useState<PortalPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await portalPayments()); setError(null); } catch (e) { setRows([]); setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const list = (rows ?? []).filter((r) => show === "all" || (show === "paid" ? r.stage === "paid" : r.stage !== "paid"));
  const unpaid = (rows ?? []).filter((r) => r.stage !== "paid" && r.stage !== "not_invoiced" && r.stage !== "returned_to_vendor").reduce((s, r) => s + r.balance, 0);
  const paid = (rows ?? []).reduce((s, r) => s + r.paid, 0);

  return (
    <div>
      <PageHeader title="Payments" />
      <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rise-in rounded-2xl bg-white p-4 ring-1 ring-black/[0.04]"><p className="text-xs font-medium text-neutral-500">Paid to you</p><p className="mt-1 text-xl font-bold tabular-nums text-emerald-700">{pkr(paid)}</p></div>
        <div className="rise-in rounded-2xl bg-white p-4 ring-1 ring-black/[0.04]"><p className="text-xs font-medium text-neutral-500">Invoiced, not yet paid</p><p className="mt-1 text-xl font-bold tabular-nums text-orange-700">{pkr(unpaid)}</p></div>
      </div>
      <p className="mb-3 text-sm text-neutral-600">After supplying an order, submit your invoice. It goes to the Purchase Cell, then to the store for checking, then to Finance for payment.</p>
      <div role="tablist" aria-label="Show" className="mb-3 inline-flex rounded-xl bg-neutral-200/70 p-1 text-sm">
        {([["all", "All"], ["unpaid", "Unpaid"], ["paid", "Paid"]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)}
            className={`min-h-9 rounded-lg px-4 font-medium transition-colors ${show === k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>{label}</button>
        ))}
      </div>
      <FormError message={error} className="mb-3" />
      {rows === null ? (
        <div className="grid gap-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white" />)}</div>
      ) : list.length === 0 ? (
        <p className="fade-in rounded-2xl bg-white p-8 text-center text-sm text-neutral-500 ring-1 ring-black/[0.04]">Nothing here.</p>
      ) : (
        <ul className="grid gap-3">
          {list.map((r, i) => (
            <li key={r.poId} className="row-in rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{r.poNo}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.stage]}`}>{r.stageLabel}</span>
                <span className="ml-auto text-sm tabular-nums">Order {pkr(r.poTotal)}</span>
              </div>
              {r.invoice && (
                <p className="mt-1 text-sm text-neutral-600">Your invoice <b>{r.invoice.invoiceNo}</b> of {r.invoice.invoiceDate} · {pkr(r.invoice.amount)}
                  {(r.stage === "part_paid" || r.stage === "unpaid" || r.stage === "paid") && <> · paid <b className="text-emerald-700">{pkr(r.paid)}</b>{r.balance > 0.004 && <> · due <b className="text-orange-700">{pkr(r.balance)}</b></>}</>}
                </p>
              )}
              {r.stage === "returned_to_vendor" && r.invoice?.returnReason && <p className="mt-1 text-sm text-rose-700">Returned: {r.invoice.returnReason}. Correct it and submit again.</p>}
              {r.payments.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                  {r.payments.map((p, j) => <li key={j} className="flex justify-between gap-2"><span>{p.date} · {METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular-nums font-medium">{pkr(p.amount)}</span></li>)}
                </ul>
              )}
              {r.canSubmitInvoice && (
                <div className="mt-3 flex justify-end"><Button variant="primary" onClick={() => setInvoicing(r)}>Submit invoice</Button></div>
              )}
            </li>
          ))}
        </ul>
      )}
      {invoicing && <InvoiceModal row={invoicing} onClose={() => setInvoicing(null)} onDone={() => { setInvoicing(null); notify("Your invoice was sent to the hospital's Purchase Cell.", "success"); void load(); }} />}
    </div>
  );
}

function InvoiceModal({ row, onClose, onDone }: { row: PortalPayment; onClose: () => void; onDone: () => void }) {
  const [no, setNo] = useState("");
  const [date, setDate] = useState(localDate());
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const future = date > localDate();
  async function send() {
    setTried(true);
    if (!no.trim()) { document.getElementById("inv-no")?.focus(); return; }
    if (!date || future) { document.getElementById("inv-date")?.focus(); return; }
    setBusy(true);
    setError(null);
    try { await submitInvoice({ poId: row.poId, invoiceNo: no.trim(), invoiceDate: date, note: note.trim() || null }); onDone(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Invoice for ${row.poNo}`} onClose={onClose} width="max-w-md">
      <p className="mb-3 text-sm text-neutral-600">Amount of the order: <b className="tabular-nums">{pkr(row.poTotal)}</b></p>
      <div className="flex flex-col gap-3">
        <Field label="Your invoice number" required error={tried && !no.trim() ? "Enter the invoice number" : undefined}>
          <Input id="inv-no" value={no} onChange={(e) => setNo(e.target.value)} aria-invalid={(tried && !no.trim()) || undefined} autoFocus maxLength={60} />
        </Field>
        <Field label="Invoice date" required error={tried && future ? "Can't be in the future" : tried && !date ? "Enter the date" : undefined}>
          <Input id="inv-date" type="date" max={localDate()} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={(tried && (future || !date)) || undefined} />
        </Field>
        <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivered on 20 Nov, challan 1452" /></Field>
      </div>
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void send()}>Submit invoice</Button>
      </div>
    </Modal>
  );
}
