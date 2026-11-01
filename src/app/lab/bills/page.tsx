"use client";

import { useEffect, useState } from "react";
import { HandCoins, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ServiceBillModal } from "@/components/print/ServiceBillModal";
import { money } from "@/components/lab/labUi";
import { isTauri } from "@/lib/platform";
import { collectLabPayment, labBillLines, listLabBills, type LabBillRow } from "@/lib/repo/lab";
import type { ServiceLine } from "@/lib/serviceFbr";

/** Lab bills: print (the store's invoice template), send to FBR, and take
 * the balance of a part-paid bill. */
export default function LabBillsPage() {
  const [rows, setRows] = useState<LabBillRow[]>([]);
  const [term, setTerm] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [bill, setBill] = useState<{ invoiceId: string; lines: ServiceLine[] } | null>(null);
  const [collecting, setCollecting] = useState<LabBillRow | null>(null);

  async function reload() {
    if (isTauri()) setRows(await listLabBills({ term, dueOnly }).catch(() => []));
  }
  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [term, dueOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(r: LabBillRow) {
    const lines = (await labBillLines(r.id)).map((o) => ({ name: o.name, qty: Number(o.qty) || 1, rate: Number(o.rate) || 0 }));
    setBill({ invoiceId: r.id, lines });
  }

  const totals = rows.reduce((t, r) => ({ payable: t.payable + r.payable, paid: t.paid + r.paid, balance: t.balance + r.balance }), { payable: 0, paid: 0, balance: 0 });
  const columns: Column<LabBillRow>[] = [
    { header: "Bill", render: (r) => <span className="font-mono text-xs">#{r.invoice_no}</span> },
    { header: "Date", render: (r) => r.date },
    { header: "Patient", render: (r) => <span className="font-medium">{r.customer_name ?? "—"}</span> },
    { header: "Visit", render: (r) => <span className="text-xs text-neutral-500">{r.description ?? ""}</span> },
    { header: "Payable", render: (r) => <span className="tabular-nums">{money(r.payable)}</span> },
    { header: "Paid", render: (r) => <span className="tabular-nums">{money(r.paid)}</span> },
    { header: "Balance", render: (r) => <span className={`tabular-nums ${r.balance > 0.009 ? "font-semibold text-rose-700" : "text-neutral-500"}`}>{money(r.balance)}</span> },
    { header: "FBR", render: (r) => (r.fbr_invoice_no ? <span className="rounded bg-[#006633] px-1.5 py-0.5 text-[10px] text-white">Sent</span> : <span className="text-xs text-neutral-400">—</span>) },
    {
      header: "",
      render: (r) => (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {r.balance > 0.009 && <button type="button" title="Receive payment" aria-label="Receive payment" onClick={() => setCollecting(r)} className="rounded-full p-1.5 text-emerald-700 hover:bg-emerald-50"><HandCoins size={15} /></button>}
          <button type="button" title="View / print bill" aria-label="View / print bill" onClick={() => void open(r)} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100"><Printer size={15} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Bills" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input id="lb-search" className="max-w-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search patient, bill or visit…" />
        <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} /> Balance due only</label>
        <span className="ml-auto text-sm text-neutral-600">Billed <b className="tabular-nums">{money(totals.payable)}</b> · Received <b className="tabular-nums">{money(totals.paid)}</b> · Due <b className="tabular-nums text-rose-700">{money(totals.balance)}</b></span>
      </div>
      <DataTable columns={columns} rows={rows} onRowClick={(r) => void open(r)} emptyMessage="No lab bills yet. Bills are made at Reception." />
      {bill && <ServiceBillModal invoiceId={bill.invoiceId} lines={bill.lines} title="Lab Bill" onClose={() => { setBill(null); void reload(); }} />}
      {collecting && <PaymentModal row={collecting} onClose={() => setCollecting(null)} onSaved={() => { setCollecting(null); void reload(); }} />}
    </div>
  );
}

function PaymentModal({ row, onClose, onSaved }: { row: LabBillRow; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(row.balance));
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await collectLabPayment(row.id, Number(amount));
      onSaved();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={`Receive payment: bill #${row.invoice_no}`} onClose={onClose} width="max-w-sm">
      <p className="mb-3 text-sm text-neutral-600">{row.customer_name} · Due <b>{money(row.balance)}</b></p>
      <Field label="Amount received" required><Input id="lb-amount" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !(Number(amount) > 0)}>{saving ? "Saving…" : "Receive"}</Button>
      </div>
    </Modal>
  );
}
