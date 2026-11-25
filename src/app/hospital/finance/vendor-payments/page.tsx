"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  VENDOR_PAY_METHODS, payVendorBill, pendingVendorBills, recentVendorPayments, type PayableDoc, type VendorPayMethod, type VendorPaymentRow,
} from "@/lib/repo/vendorPayments";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const money = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Finance > Vendor Payments: the Purchase Cell's purchases and service bills waiting to be paid, and paying them. */
export default function VendorPaymentsPage() {
  const [rows, setRows] = useState<PayableDoc[]>([]);
  const [recent, setRecent] = useState<VendorPaymentRow[]>([]);
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState<PayableDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try { const [p, r] = await Promise.all([pendingVendorBills(search), recentVendorPayments(15)]); setRows(p); setRecent(r); setError(null); }
    catch (e) { setError(/no such (table|column)/i.test(msg(e)) ? "Vendor payments need the database update (v100)." : msg(e)); }
  }
  useEffect(() => { const t = setTimeout(() => void reload(), 200); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const owed = rows.reduce((a, r) => a + r.balance, 0);

  return (
    <div>
      <PageHeader title="Vendor Payments" actions={rows.length ? <span className="rounded-full bg-rose-600 px-3 py-1 text-sm font-semibold text-white">{rows.length} pending</span> : undefined} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className={card}><p className="text-xs text-neutral-500">Bills waiting</p><p className="text-2xl font-bold text-rose-700">{rows.length}</p></div>
        <div className={card}><p className="text-xs text-neutral-500">Owed to vendors</p><p className="text-2xl font-bold">Rs {money(owed)}</p></div>
        <div className={card}><p className="text-xs text-neutral-500">Last payment</p><p className="text-lg font-semibold">{recent[0] ? `Rs ${money(recent[0].amount)}` : "—"}</p><p className="text-xs text-neutral-500">{recent[0] ? `${recent[0].vendor_name ?? ""} · ${recent[0].dated}` : ""}</p></div>
      </div>
      <div className={card}>
        <div className="mb-3 max-w-md"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find vendor, vendor no or bill" aria-label="Find bill" /></div>
        {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {rows.length === 0 ? <p className="text-sm text-neutral-400">No bills waiting for payment.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className="pb-1.5 pr-3 font-medium">Bill</th><th className="pb-1.5 pr-3 font-medium">Vendor</th><th className="pb-1.5 pr-3 font-medium">Pay to</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Total</th><th className="pb-1.5 pr-3 text-right font-medium">Paid</th><th className="pb-1.5 pr-3 text-right font-medium">Pending</th><th />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.docType}:${r.docId}`} className="border-t border-neutral-100">
                    <td className="py-1.5 pr-3">{r.no}<span className="block text-[11px] text-neutral-500">{r.date}{r.detail ? ` · ${r.detail}` : ""}</span></td>
                    <td className="py-1.5 pr-3">{r.vendorName}<span className="block font-mono text-[11px] text-neutral-500">{r.vendorNo}</span></td>
                    <td className="py-1.5 pr-3 text-xs">{r.iban ? <>{r.bankTitle ?? ""}{r.bankName ? ` · ${r.bankName}` : ""}<span className="block font-mono text-[11px] text-neutral-500">{r.iban}</span></> : <span className="text-neutral-400">No bank details</span>}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.total)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.paid)}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-rose-700">{money(r.balance)}</td>
                    <td className="py-1.5 text-right"><Button variant="primary" onClick={() => setPaying(r)}>Pay</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className={`${card} mt-4`}>
        <h2 className="mb-2 text-sm font-semibold">Last payments</h2>
        {recent.length === 0 ? <p className="text-sm text-neutral-400">No payments yet.</p> : (
          <table className="w-full text-sm">
            <tbody>
              {recent.map((p) => (
                <tr key={p.id} className="border-t border-neutral-100 first:border-0">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{p.dated}</td>
                  <td className="py-1.5 pr-3">{p.vendor_name ?? "—"} <span className="font-mono text-[11px] text-neutral-500">{p.vendor_no}</span></td>
                  <td className="py-1.5 pr-3 text-xs text-neutral-600">{VENDOR_PAY_METHODS[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</td>
                  <td className="py-1.5 pr-3 text-xs text-neutral-500">{p.paid_by_name}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {paying && <PayModal bill={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); void reload(); }} />}
    </div>
  );
}

function PayModal({ bill, onClose, onPaid }: { bill: PayableDoc; onClose: () => void; onPaid: () => void }) {
  const [full, setFull] = useState(true);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<VendorPayMethod>("bank");
  const [reference, setReference] = useState("");
  const [dated, setDated] = useState(localDate());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pay() {
    setBusy(true);
    setError(null);
    try { await payVendorBill({ docType: bill.docType, docId: bill.docId, full, amount: Number(amount), method, reference, dated, notes }); onPaid(); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Pay · ${bill.no}`} onClose={onClose} width="max-w-lg">
      <p className="mb-3 text-sm">{bill.vendorName} <span className="font-mono text-xs text-neutral-500">{bill.vendorNo}</span> · pending <b>Rs {money(bill.balance)}</b></p>
      {bill.iban && <p className="mb-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs">{bill.bankTitle} · {bill.bankName} · <span className="font-mono">{bill.iban}</span></p>}
      <div className="mb-3 flex gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" checked={full} onChange={() => setFull(true)} />Full payment</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={!full} onChange={() => setFull(false)} />Partial payment</label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!full && <Field label="Amount (Rs)" required><Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>}
        <Field label="Paid by">
          <Select value={method} onChange={(e) => setMethod(e.target.value as VendorPayMethod)}>
            {(Object.keys(VENDOR_PAY_METHODS) as VendorPayMethod[]).map((m) => <option key={m} value={m}>{VENDOR_PAY_METHODS[m]}</option>)}
          </Select>
        </Field>
        {method !== "cash" && <Field label={method === "cheque" ? "Cheque no." : "Transaction ID"} required><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
        <Field label="Dated"><Input type="date" value={dated} onChange={(e) => setDated(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      </div>
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button loading={busy} variant="primary" disabled={busy} onClick={() => void pay()}>{busy ? "Saving…" : `Pay ${full ? `Rs ${money(bill.balance)}` : ""}`}</Button>
      </div>
    </Modal>
  );
}
