"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  bankLine, createServiceBill, deleteServiceBill, listServiceBills, listServiceTypes, listVendors,
  type ServiceBillRow, type ServiceType, type VendorRow,
} from "@/lib/repo/vendors";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const money = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Purchase Cell > Vendor Services > Service Bills: bills of services bought from vendors; they go to Finance for payment. */
export default function ServiceBillsPage() {
  const [rows, setRows] = useState<ServiceBillRow[]>([]);
  const [from, setFrom] = useState(`${localDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(localDate());
  const [status, setStatus] = useState<"" | "unpaid" | "paid">("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try { setRows(await listServiceBills({ from, to, status })); setError(null); } catch (e) {
      setError(/no such table/i.test(msg(e)) ? "Service bills need the database update (v100)." : msg(e));
    }
  }
  useEffect(() => { void reload(); }, [from, to, status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(b: ServiceBillRow) {
    if (!window.confirm(`Delete bill ${b.bill_no} of ${b.vendor_name}?`)) return;
    try { await deleteServiceBill(b.id); await reload(); } catch (e) { window.alert(msg(e)); }
  }
  const sum = rows.reduce((a, r) => ({ total: a.total + Number(r.total), balance: a.balance + Number(r.balance) }), { total: 0, balance: 0 });

  return (
    <div>
      <PageHeader title="Service Bills" actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />New Service Bill</Button>} />
      <div className={card}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Bills"><Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="">All</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option></Select></Field>
          <p className="pb-2 text-sm">Total <b>Rs {money(sum.total)}</b> · unpaid <b className="text-rose-700">Rs {money(sum.balance)}</b></p>
        </div>
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {rows.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No service bills.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className="pb-1.5 pr-3 font-medium">Bill</th><th className="pb-1.5 pr-3 font-medium">Vendor</th><th className="pb-1.5 pr-3 font-medium">Service</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Amount</th><th className="pb-1.5 pr-3 text-right font-medium">Tax</th><th className="pb-1.5 pr-3 text-right font-medium">Discount</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Total</th><th className="pb-1.5 pr-3 text-right font-medium">Balance</th><th />
              </tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-t border-neutral-100">
                    <td className="py-1.5 pr-3"><span className="font-mono text-xs">{b.bill_no}</span><span className="block text-[11px] text-neutral-500">{b.date}{b.vendor_invoice_no ? ` · Inv ${b.vendor_invoice_no}` : ""}</span></td>
                    <td className="py-1.5 pr-3">{b.vendor_name}<span className="block font-mono text-[11px] text-neutral-500">{b.vendor_no}</span></td>
                    <td className="py-1.5 pr-3">{b.service_type ?? "—"}{b.description && <span className="block text-[11px] text-neutral-500">{b.description}</span>}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(b.amount)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{money(b.tax)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(b.discount)}</td><td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{money(b.total)}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${Number(b.balance) > 0 ? "text-rose-700" : "text-emerald-700"}`}>{Number(b.balance) > 0 ? money(b.balance) : "Paid"}</td>
                    <td className="py-1.5 text-right">{Number(b.paid) === 0 && <button type="button" title="Delete" onClick={() => void remove(b)} className="text-neutral-400 hover:text-rose-600"><Trash2 size={15} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <NewBillModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
    </div>
  );
}

function NewBillModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [type, setType] = useState("");
  const [date, setDate] = useState(localDate());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void listVendors("", "vendor").then(setVendors).catch(() => setVendors([]));
    void listServiceTypes().then(setTypes).catch(() => setTypes([]));
  }, []);
  const total = (Number(amount) || 0) + (Number(tax) || 0) - (Number(discount) || 0);
  const vendor = vendors.find((v) => v.id === vendorId);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await createServiceBill({ vendorId, vendorInvoiceNo: invoiceNo, serviceType: type, description, date, amount: Number(amount), tax: Number(tax) || 0, discount: Number(discount) || 0 });
      onSaved();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title="New service bill" onClose={onClose} width="max-w-2xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Vendor" required>
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} autoFocus>
            <option value="">{vendors.length ? "— Choose the vendor —" : "No vendors yet: add one in Supplier & Vendors (type Vendor)"}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.vendor_no ? ` · ${v.vendor_no}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Vendor's invoice number"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
        <Field label="Service type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{types.length ? "— Choose —" : "No types yet: add them in Vendor Services › Types"}</option>
            {types.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Tent and chairs for the free medical camp" /></Field></div>
        <Field label="Amount (Rs)" required><Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Tax charged (Rs)"><Input type="number" min="0" step="any" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0" /></Field>
        <Field label="Discount (Rs)"><Input type="number" min="0" step="any" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
        <Field label="Total (Rs)"><p className="py-1.5 text-lg font-bold tabular-nums">{money(total)}</p></Field>
      </div>
      {vendor && bankLine(vendor) && <p className="mt-2 text-xs text-neutral-600"><span className="font-medium text-neutral-500">Pay to:</span> {bankLine(vendor)}</p>}
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !vendorId || !(Number(amount) > 0)} onClick={() => void save()}>{busy ? "Saving…" : "Save bill"}</Button>
      </div>
    </Modal>
  );
}
