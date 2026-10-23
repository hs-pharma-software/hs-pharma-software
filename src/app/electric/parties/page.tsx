"use client";

import { useState } from "react";
import { BookOpen, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n";
import { electric, errorText } from "@/lib/electric";
import type { PaymentIn } from "@/lib/electric/engine";
import { PartyModal } from "@/components/electric/SaleForm";
import { DocModal, Err, EsGuard, Id, PageTitle, Txt, money, useLoad } from "@/components/electric/ui";

type PartyType = "customer" | "supplier";

export default function PartiesPage() {
  return (
    <EsGuard>
      <Parties />
    </EsGuard>
  );
}

function Parties() {
  const t = useT();
  const [type, setType] = useState<PartyType>("customer");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [ledger, setLedger] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ id: string; name: string; balance: number } | null>(null);
  const list = useLoad(() => electric.balances(type), [type]);
  const rows = (list.data ?? []).filter((r) => !search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()) || (r.phone ?? "").includes(search.trim()));
  const total = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  return (
    <div className="space-y-3">
      <PageTitle
        title={t("pt.title")}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={14} /> {type === "customer" ? t("pt.addCustomer") : t("pt.addSupplier")}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {(["customer", "supplier"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setType(k)} className={`rounded-full px-4 py-1.5 text-sm ${type === k ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
            {k === "customer" ? t("nav.customers") : t("nav.suppliers")}
          </button>
        ))}
        <Input className="!w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t("c.name")} / ${t("c.phone")}`} />
        <span className="ms-auto text-sm">
          {type === "customer" ? t("d.receivable") : t("d.payable")}: <b dir="ltr">{money(total)}</b>
        </span>
      </div>
      <Err error={list.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("c.name")}</th>
              <th className="px-3 py-2 text-start">{t("c.phone")}</th>
              <th className="px-3 py-2 text-end">{t("pt.opening")}</th>
              <th className="px-3 py-2 text-end">{t("pt.billed")}</th>
              <th className="px-3 py-2 text-end">{t("pt.returned")}</th>
              <th className="px-3 py-2 text-end">{t("pay.paid")}</th>
              <th className="px-3 py-2 text-end">{t("pay.balance")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="px-3 py-2 font-medium"><Txt>{r.name}</Txt></td>
                <td className="px-3 py-2"><Id>{r.phone}</Id></td>
                <td className="px-3 py-2 text-end">{money(r.opening)}</td>
                <td className="px-3 py-2 text-end">{money(r.billed)}</td>
                <td className="px-3 py-2 text-end">{money(r.returned)}</td>
                <td className="px-3 py-2 text-end">{money(r.paid)}</td>
                <td className={`px-3 py-2 text-end font-semibold ${r.balance > 0 ? "text-rose-600" : ""}`}>{money(r.balance)}</td>
                <td className="px-3 py-2 text-end whitespace-nowrap">
                  <Button variant="ghost" title={t("pt.ledger")} onClick={() => setLedger(r.id)}><BookOpen size={14} /></Button>
                  <Button variant="ghost" title={type === "customer" ? t("pay.receive") : t("pay.makePayment")} onClick={() => setPaying({ id: r.id, name: r.name, balance: r.balance })}><Wallet size={14} /></Button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{list.loading ? t("c.loading") : t("c.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      {adding && <PartyModal type={type} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void list.reload(); }} />}
      {ledger && <LedgerModal type={type} id={ledger} onClose={() => setLedger(null)} />}
      {paying && <PayModal type={type} party={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void list.reload(); }} />}
    </div>
  );
}

function LedgerModal({ type, id, onClose }: { type: PartyType; id: string; onClose: () => void }) {
  const t = useT();
  const data = useLoad(() => electric.ledger(type, id), [type, id]);
  const [doc, setDoc] = useState<string | null>(null);
  const entries = data.data
    ? [
        ...data.data.docs.map((d) => ({ key: d.id, date: d.date, label: `${t(`mv.${d.doc_type}`)} #${d.doc_no}`, debit: d.doc_type === "sale" || d.doc_type === "purchase" ? d.total : 0, credit: d.doc_type.endsWith("return") ? d.total : 0, docId: d.id })),
        ...data.data.payments.map((p) => ({ key: p.id, date: p.date, label: `${t("pay.payment")} — ${t(`pay.${p.method}`)}${p.note ? ` (${p.note})` : ""}`, debit: p.amount < 0 ? -p.amount : 0, credit: p.amount > 0 ? p.amount : 0, docId: null as string | null })),
      ].sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const party = data.data?.party as { name?: string; opening_balance?: number; balance_type?: string } | undefined;
  const opening = party ? (Number(party.opening_balance) || 0) * (party.balance_type === (type === "customer" ? "payable" : "receivable") ? -1 : 1) : 0;
  const running = entries.reduce<number[]>((acc, e) => [...acc, Math.round(((acc.at(-1) ?? opening) + e.debit - e.credit) * 100) / 100], []);
  return (
    <Modal title={`${t("pt.ledger")} — ${party?.name ?? ""}`} onClose={onClose} width="max-w-3xl">
      <Err error={data.error} />
      <div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="px-2 py-1.5 text-start">{t("c.date")}</th>
              <th className="px-2 py-1.5 text-start">{t("c.notes")}</th>
              <th className="px-2 py-1.5 text-end">{t("pt.billed")}</th>
              <th className="px-2 py-1.5 text-end">{t("pay.paid")} / {t("pt.returned")}</th>
              <th className="px-2 py-1.5 text-end">{t("pay.balance")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-neutral-100">
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5">{t("pt.opening")}</td>
              <td colSpan={2} />
              <td className="px-2 py-1.5 text-end">{money(opening)}</td>
            </tr>
            {entries.map((e, i) => {
              return (
                <tr key={e.key} className="border-t border-neutral-100">
                  <td className="px-2 py-1.5 text-xs"><Id>{e.date}</Id></td>
                  <td className="px-2 py-1.5">
                    {e.docId ? <button type="button" className="underline" onClick={() => setDoc(e.docId)}>{e.label}</button> : <Txt>{e.label}</Txt>}
                  </td>
                  <td className="px-2 py-1.5 text-end">{e.debit ? money(e.debit) : ""}</td>
                  <td className="px-2 py-1.5 text-end">{e.credit ? money(e.credit) : ""}</td>
                  <td className="px-2 py-1.5 text-end font-medium">{money(running[i])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {doc && <DocModal docId={doc} onClose={() => setDoc(null)} onChanged={() => void data.reload()} />}
    </Modal>
  );
}

function PayModal({ type, party, onClose, onDone }: { type: PartyType; party: { id: string; name: string; balance: number }; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [amount, setAmount] = useState(party.balance > 0 ? String(party.balance) : "");
  const [method, setMethod] = useState<PaymentIn["method"]>("cash");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`${type === "customer" ? t("pay.receive") : t("pay.makePayment")} — ${party.name}`} onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <p className="text-sm">{t("pay.balance")}: <b dir="ltr">{money(party.balance)}</b></p>
        <Field label={t("c.amount")} required><Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t("pay.method")}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentIn["method"])}>
            {(["cash", "card", "bank", "digital", "cheque"] as const).map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("c.notes")}><Input dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("c.cancel")}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await electric.receivePayment({ partyType: type, partyId: party.id, amount: Number(amount), method, note: note.trim() || undefined });
                onDone();
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            {t("c.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
