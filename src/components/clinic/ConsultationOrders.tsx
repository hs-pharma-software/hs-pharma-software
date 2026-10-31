"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import {
  listClinicServices, addClinicOrder, listOrdersForConsultation, cancelClinicOrder, getVisitBill, createVisitInvoice,
  categoryLabel, SERVICE_CATEGORIES, type ClinicOrder, type ClinicService, type ClinicServiceCategory, type VisitBill,
} from "@/lib/repo/clinicServices";
import { ClinicReportModal, ClinicVisitInvoiceModal } from "./ClinicPrints";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<string, string> = { ordered: "Ordered", collected: "Sample collected", performed: "Done", reported: "Reported", cancelled: "Cancelled" };

/** Lab tests, radiology and other services of a consultation, and its bill.
 * Ordering on a new consultation saves it first (`ensureSaved`). */
export function ConsultationOrders({ consultationId, ensureSaved, canOrder }: {
  consultationId: string | null;
  ensureSaved: () => Promise<string>;
  canOrder: boolean;
}) {
  const [services, setServices] = useState<ClinicService[]>([]);
  const [orders, setOrders] = useState<ClinicOrder[]>([]);
  const [category, setCategory] = useState<ClinicServiceCategory>("lab");
  const [serviceId, setServiceId] = useState("");
  const [qty, setQty] = useState("1");
  const [priority, setPriority] = useState<ClinicOrder["priority"]>("routine");
  const [busy, setBusy] = useState(false);
  const [billing, setBilling] = useState<VisitBill | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [billed, setBilled] = useState<VisitBill["invoices"]>([]);

  async function reload(cid = consultationId) {
    if (!isTauri() || !cid) return;
    setOrders(await listOrdersForConsultation(cid));
    setBilled((await getVisitBill(cid)).invoices);
  }
  useEffect(() => {
    if (isTauri()) void listClinicServices().then(setServices).catch(() => setServices([]));
  }, []);
  useEffect(() => { void reload().catch(() => undefined); }, [consultationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = useMemo(() => services.filter((s) => s.category === category && s.category !== "consultation"), [services, category]);
  const service = services.find((s) => s.id === serviceId);
  const live = orders.filter((o) => o.status !== "cancelled");
  const unbilled = live.filter((o) => !o.invoice_id).reduce((s, o) => s + Number(o.amount), 0);

  async function add() {
    if (!serviceId) return;
    setBusy(true);
    try {
      const cid = consultationId ?? (await ensureSaved());
      await addClinicOrder({ consultationId: cid, serviceId, qty: Number(qty) || 1, priority });
      setServiceId("");
      setQty("1");
      setPriority("routine");
      await reload(cid);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(o: ClinicOrder) {
    if (!window.confirm(`Cancel ${o.name}?`)) return;
    try { await cancelClinicOrder(o.id); await reload(); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); }
  }

  async function openBill() {
    try {
      const cid = consultationId ?? (await ensureSaved());
      setBilling(await getVisitBill(cid));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  const perUnit = service ? SERVICE_CATEGORIES.find((c) => c.key === service.category)?.unit : null;
  return (
    <div className="mb-4 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-700">Lab, Radiology &amp; Services</h2>
        <div className="flex items-center gap-2">
          {billed.map((b) => (
            <Button key={b.id} variant="ghost" onClick={() => setInvoiceId(b.id)}><Receipt size={14} />Invoice #{b.invoice_no}</Button>
          ))}
          <Button variant="primary" onClick={() => void openBill()} disabled={!canOrder}><Receipt size={14} />Create bill</Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 items-end gap-2 md:grid-cols-[170px_1fr_90px_110px_auto]">
        <Field label="Type">
          <Select id="co-cat" value={category} onChange={(e) => { setCategory(e.target.value as ClinicServiceCategory); setServiceId(""); }}>
            {SERVICE_CATEGORIES.filter((c) => c.key !== "consultation").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label={category === "lab" ? "Test" : category === "radiology" ? "Study" : "Service"}>
          <Select id="co-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!canOrder}>
            <option value="">{choices.length ? "— Choose —" : "None offered yet (add them on Services)"}</option>
            {choices.map((s) => <option key={s.id} value={s.id}>{s.name} · Rs {Number(s.rate).toFixed(0)}</option>)}
          </Select>
        </Field>
        <Field label={perUnit === "per day" ? "Days" : "Qty"}>
          <Input id="co-qty" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select id="co-pri" value={priority} onChange={(e) => setPriority(e.target.value as ClinicOrder["priority"])} disabled={category !== "lab" && category !== "radiology"}>
            <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option>
          </Select>
        </Field>
        <Button variant="secondary" onClick={() => void add()} disabled={busy || !serviceId || !canOrder}><Plus size={14} />{busy ? "Adding…" : "Add"}</Button>
      </div>
      {!canOrder && <p className="mb-3 text-xs text-neutral-500">Choose the patient first.</p>}

      {live.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                <th className="pb-2 pr-2 font-medium">Item</th><th className="pb-2 pr-2 font-medium">Type</th><th className="pb-2 pr-2 text-right font-medium">Qty</th>
                <th className="pb-2 pr-2 text-right font-medium">Amount</th><th className="pb-2 pr-2 font-medium">Status / result</th><th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {live.map((o) => (
                <tr key={o.id} className="border-b border-neutral-50">
                  <td className="py-1.5 pr-2 font-medium">{o.name}</td>
                  <td className="py-1.5 pr-2 text-neutral-600">{categoryLabel(o.kind)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{o.qty}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{money(o.amount)}</td>
                  <td className="py-1.5 pr-2">
                    {o.kind === "lab" && o.result_value ? <span className={o.flag === "H" || o.flag === "L" ? "font-semibold text-rose-700" : ""}>{o.result_value} {o.unit ?? ""}</span>
                      : o.kind === "radiology" && o.impression ? <span>{o.impression}</span>
                      : <span className="text-neutral-500">{STATUS[o.status] ?? o.status}</span>}
                    {o.invoice_id && <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Billed</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    {o.status === "reported" && (o.kind === "lab" || o.kind === "radiology") && (
                      <button type="button" title="Report" onClick={() => setReport(o.id)} className="rounded p-1 text-neutral-500 hover:bg-neutral-100"><FileText size={14} /></button>
                    )}
                    {!o.invoice_id && o.status !== "reported" && o.kind !== "consultation" && (
                      <button type="button" title="Cancel" onClick={() => void cancel(o)} className="rounded p-1 text-neutral-400 hover:text-rose-600"><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {unbilled > 0 && <p className="mt-2 text-right text-sm">Not billed yet: <span className="font-semibold tabular-nums">Rs {money(unbilled)}</span> (plus the doctor&apos;s fee if not billed)</p>}
        </div>
      )}

      {billing && (
        <BillModal bill={billing} onClose={() => setBilling(null)} onBilled={(id) => { setBilling(null); setInvoiceId(id); void reload(billing.consultation.id); }} />
      )}
      {invoiceId && <ClinicVisitInvoiceModal invoiceId={invoiceId} onClose={() => setInvoiceId(null)} />}
      {report && <ClinicReportModal orderId={report} onClose={() => setReport(null)} />}
    </div>
  );
}

function BillModal({ bill, onClose, onBilled }: { bill: VisitBill; onClose: () => void; onBilled: (invoiceId: string) => void }) {
  const [discount, setDiscount] = useState("0");
  const [paid, setPaid] = useState(String(bill.total));
  const [saving, setSaving] = useState(false);
  const payable = Math.max(0, bill.total - (Number(discount) || 0));
  async function save() {
    setSaving(true);
    try {
      const inv = await createVisitInvoice(bill.consultation.id, { discount: Number(discount) || 0, paid: Number(paid) || 0 });
      onBilled(inv.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={`Bill: ${bill.patient?.name ?? "Patient"}`} onClose={onClose} width="max-w-lg">
      {bill.lines.length === 0 ? (
        <p className="text-sm text-neutral-600">Nothing to bill: every item of this visit is billed already.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <tbody>
              {bill.lines.map((l, i) => (
                <tr key={l.orderId ?? `fee-${i}`} className="border-b border-neutral-100">
                  <td className="py-1.5">{l.name}<div className="text-xs text-neutral-500">{categoryLabel(l.kind)}{l.qty !== 1 ? ` · ${l.qty} × ${money(l.rate)}` : ""}</div></td>
                  <td className="py-1.5 text-right tabular-nums">{money(l.amount)}</td>
                </tr>
              ))}
              <tr><td className="pt-2 font-semibold">Total</td><td className="pt-2 text-right font-semibold tabular-nums">{money(bill.total)}</td></tr>
            </tbody>
          </table>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="Discount (Rs)"><Input id="bill-disc" type="number" min="0" step="any" value={discount} onChange={(e) => { setDiscount(e.target.value); setPaid(String(Math.max(0, bill.total - (Number(e.target.value) || 0)))); }} /></Field>
            <Field label="Payable"><Input value={money(payable)} readOnly className="bg-neutral-50 font-semibold" /></Field>
            <Field label="Paid now (Rs)"><Input id="bill-paid" type="number" min="0" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
          </div>
          {Number(paid) < payable && <p className="mt-2 text-xs text-amber-700">Balance Rs {money(payable - (Number(paid) || 0))} stays due on the invoice.</p>}
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        {bill.lines.length > 0 && <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Billing…" : "Create invoice"}</Button>}
      </div>
    </Modal>
  );
}
