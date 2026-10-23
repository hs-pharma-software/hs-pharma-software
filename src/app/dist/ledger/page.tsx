"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText } from "@/lib/dist";
import { DistGuard, Err, PageTitle, downloadCsv, money, useLoad, type DistCtx } from "@/components/dist/ui";

export default function LedgerPage() {
  return <DistGuard>{(c) => <Ledger c={c} />}</DistGuard>;
}

function Ledger({ c }: { c: DistCtx }) {
  const [type, setType] = useState<"customer" | "supplier">(c.can("invoices.view") ? "customer" : "supplier");
  const list = useLoad(() => dist.balances(type), [type]);
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const [paying, setPaying] = useState<{ id: string; name: string; balance: number } | null>(null);
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      <PageTitle
        title="Receivables & Payables"
        actions={c.can("reports.view") && <Button onClick={() => downloadCsv(`${type}-balances.csv`, rows)}>Export CSV</Button>}
      />
      <div className="flex gap-1">
        {(["customer", "supplier"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setType(t)} className={`rounded-full px-4 py-1.5 text-sm ${type === t ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>{t === "customer" ? "Customer receivables" : "Supplier payables"}</button>
        ))}
      </div>
      <Err error={list.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr><th className="px-3 py-2 text-start">Name</th><th className="px-3 py-2 text-end">Opening</th><th className="px-3 py-2 text-end">Billed (incl. WHT)</th><th className="px-3 py-2 text-end">Returned</th><th className="px-3 py-2 text-end">Paid</th><th className="px-3 py-2 text-end">Balance</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="px-3 py-2"><button type="button" className="font-medium hover:underline" onClick={() => setOpen(r)}>{r.name}</button></td>
                <td className="px-3 py-2 text-end">{money(r.opening)}</td>
                <td className="px-3 py-2 text-end">{money(r.billed)}</td>
                <td className="px-3 py-2 text-end">{money(r.returned)}</td>
                <td className="px-3 py-2 text-end">{money(r.paid)}</td>
                <td className={`px-3 py-2 text-end font-semibold ${r.balance > 0 ? "text-rose-600" : ""}`}>{money(r.balance)}</td>
                <td className="px-3 py-2 text-end">{c.can("payments.receive") && <Button variant="ghost" onClick={() => setPaying(r)}>{type === "customer" ? "Receive" : "Pay"}</Button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-8 text-center text-neutral-400">{list.loading ? "Loading…" : "No balances."}</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <LedgerModal type={type} party={open} onClose={() => setOpen(null)} />}
      {paying && <PayModal type={type} party={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void list.reload(); }} />}
    </div>
  );
}

function LedgerModal({ type, party, onClose }: { type: "customer" | "supplier"; party: { id: string; name: string }; onClose: () => void }) {
  const data = useLoad(() => dist.ledger(type, party.id), [type, party.id]);
  const entries = data.data
    ? [
        ...data.data.docs.map((d) => ({ key: d.id, date: d.date, label: `${d.doc_type.replace("_", " ")} #${d.doc_no}`, dr: d.doc_type === "sale" || d.doc_type === "purchase" ? d.total + d.wht_amount : 0, cr: d.doc_type.endsWith("return") ? d.total + d.wht_amount : 0 })),
        ...(data.data.payments as { id: string; date: string; amount: number; method: string; reference: string | null }[]).map((p) => ({ key: p.id, date: p.date, label: `Payment (${p.method}${p.reference ? ` ${p.reference}` : ""})`, dr: p.amount < 0 ? -p.amount : 0, cr: p.amount > 0 ? p.amount : 0 })),
      ].sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const running = entries.reduce<number[]>((acc, e) => [...acc, Math.round(((acc.at(-1) ?? 0) + e.dr - e.cr) * 100) / 100], []);
  return (
    <Modal title={`Ledger — ${party.name}`} onClose={onClose} width="max-w-3xl">
      <Err error={data.error} />
      <table className="w-full text-sm">
        <thead className="text-xs text-neutral-500"><tr><th className="text-start">Date</th><th className="text-start">Entry</th><th className="text-end">Debit</th><th className="text-end">Credit</th><th className="text-end">Balance</th></tr></thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.key} className="border-t border-neutral-100"><td className="text-xs">{e.date}</td><td>{e.label}</td><td className="text-end">{e.dr ? money(e.dr) : ""}</td><td className="text-end">{e.cr ? money(e.cr) : ""}</td><td className="text-end font-medium">{money(running[i])}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-neutral-400">Opening balance not included in the running column.</p>
    </Modal>
  );
}

function PayModal({ type, party, onClose, onDone }: { type: "customer" | "supplier"; party: { id: string; name: string; balance: number }; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(party.balance > 0 ? String(party.balance) : "");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`${type === "customer" ? "Receive from" : "Pay"} ${party.name}`} onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <Field label="Amount"><Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        </Field>
        <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { try { await dist.receivePayment({ partyType: type, partyId: party.id, amount: Number(amount), method, reference }); onDone(); } catch (e) { setError(errorText(e)); } }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
