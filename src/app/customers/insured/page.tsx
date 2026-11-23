"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { InsuranceCompanySelect } from "@/components/customers/InsuranceCompanySelect";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  CLAIM_STATUSES, claimLabel, claimTotals, insuranceInvoices, insuredCustomers, setClaimStatus,
  type ClaimStatus, type InsuranceInvoice, type InsuredCustomer,
} from "@/lib/repo/insurance";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const money = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 0 });

/** Customers > Insured: customers with a policy of the chosen company; click
 * one for their invoices and each invoice's claim status. */
export default function InsuredPage() {
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<InsuredCustomer[]>([]);
  const [invoices, setInvoices] = useState<InsuranceInvoice[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      const [c, i] = await Promise.all([insuredCustomers(companyId || null), insuranceInvoices({ companyId: companyId || null })]);
      setCustomers(c);
      setInvoices(i);
      setError(null);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/no such (table|column)/i.test(m) ? "Insurance needs the database update (v96)." : m);
    }
  }
  useEffect(() => { void reload(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byCustomer = useMemo(() => {
    const m = new Map<string, InsuranceInvoice[]>();
    for (const i of invoices) m.set(i.customerId, [...(m.get(i.customerId) ?? []), i]);
    return m;
  }, [invoices]);
  const q = search.trim().toLowerCase();
  const shown = customers.filter((c) => !q || `${c.name} ${c.phone ?? ""} ${c.policyNo ?? ""}`.toLowerCase().includes(q));
  const today = localDate();
  const current = customers.find((c) => c.id === chosen) ?? null;

  return (
    <div>
      <PageHeader title="Insured" />
      <div className={card}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_minmax(0,16rem)]">
          <Field label="Insurance company"><InsuranceCompanySelect id="ins-company" allowAll value={companyId} onChange={(v) => { setCompanyId(v); setChosen(null); }} /></Field>
          <Field label="Find customer"><Input id="ins-q" value={search} placeholder="Name, mobile or policy no." onChange={(e) => setSearch(e.target.value)} /></Field>
        </div>
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className={card}>
          <p className="mb-2 text-sm font-semibold">{shown.length} insured customer{shown.length === 1 ? "" : "s"}</p>
          {shown.length === 0 ? <p className="text-sm text-neutral-400">No insured customer{companyId ? " of this company" : ""}. Add the company and policy on the customer (Customer Detail → Edit).</p> : (
            <ul className="-mx-2 max-h-[34rem] overflow-y-auto">
              {shown.map((c) => {
                const t = claimTotals(byCustomer.get(c.id) ?? []);
                const expired = Boolean(c.expiry && c.expiry < today);
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setChosen(c.id)}
                      className={`w-full rounded-xl px-2 py-2 text-left transition ${chosen === c.id ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-neutral-50"}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium text-neutral-900">{c.name}</span>
                        <span className="shrink-0 text-sm tabular-nums text-neutral-700">Rs {money(t.total)}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 text-[11px] text-neutral-500">
                        <span className="truncate">{companyId ? "" : `${c.companyName} · `}Policy {c.policyNo ?? "—"}{c.expiry ? ` · till ${c.expiry}` : ""}{expired && <b className="ml-1 text-rose-600">Expired</b>}</span>
                        <span className="shrink-0">{t.invoices} invoice{t.invoices === 1 ? "" : "s"}{t.byStatus.not_claimed > 0 ? ` · Rs ${money(t.byStatus.not_claimed)} not claimed` : ""}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={card}>
          {current ? <CustomerClaims customer={current} rows={byCustomer.get(current.id) ?? []} onChanged={reload} /> : <p className="text-sm text-neutral-400">Choose a customer to see their claimed invoices.</p>}
        </div>
      </div>
    </div>
  );
}

function CustomerClaims({ customer, rows, onChanged }: { customer: InsuredCustomer; rows: InsuranceInvoice[]; onChanged: () => Promise<void> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<ClaimStatus>("sent");
  const [ref, setRef] = useState("");
  const [filter, setFilter] = useState<ClaimStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setPicked(new Set()); setMsg(null); }, [customer.id]);

  const list = filter ? rows.filter((r) => r.status === filter) : rows;
  const t = claimTotals(rows);

  async function apply(ids: string[], status: ClaimStatus, claimRef?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const n = await setClaimStatus(ids, status, claimRef === undefined ? undefined : claimRef);
      await onChanged();
      setPicked(new Set());
      setMsg(`${n} invoice${n === 1 ? "" : "s"} set to ${claimLabel(status)}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-neutral-900">{customer.name}</p>
          <p className="text-xs text-neutral-500">{customer.companyName} · Policy {customer.policyNo ?? "—"}{customer.expiry ? ` · expires ${customer.expiry}` : ""}{customer.phone ? ` · ${customer.phone}` : ""}</p>
        </div>
        <p className="text-sm">Total <b>Rs {money(t.total)}</b></p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {CLAIM_STATUSES.map((s) => (
          <button key={s.id} type="button" onClick={() => setFilter(filter === s.id ? "" : s.id)}
            className={`rounded-full px-2.5 py-1 font-medium ${s.tone} ${filter === s.id ? "ring-2 ring-neutral-800" : ""}`}>
            {s.label}: Rs {money(t.byStatus[s.id])}
          </button>
        ))}
      </div>

      {list.length === 0 ? <p className="mt-4 text-sm text-neutral-400">No invoices here.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500">
              <th className="pb-1.5 pr-2"><input type="checkbox" aria-label="Choose all" checked={picked.size === list.length} onChange={(e) => setPicked(e.target.checked ? new Set(list.map((r) => r.id)) : new Set())} /></th>
              <th className="pb-1.5 pr-3 font-medium">Invoice</th><th className="pb-1.5 pr-3 font-medium">Date</th><th className="pb-1.5 pr-3 text-right font-medium">Amount (Rs)</th>
              <th className="pb-1.5 pr-3 font-medium">Status</th><th className="pb-1.5 font-medium">Claim ref.</th>
            </tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-2"><input type="checkbox" aria-label={`Choose invoice ${r.invoiceNo ?? ""}`} checked={picked.has(r.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                  <td className="py-1.5 pr-3">#{r.invoiceNo ?? "—"}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3">{r.date}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.amount)}</td>
                  <td className="py-1.5 pr-3">
                    <select aria-label={`Claim status of invoice ${r.invoiceNo ?? ""}`} value={r.status} disabled={busy} onChange={(e) => void apply([r.id], e.target.value as ClaimStatus)}
                      className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${CLAIM_STATUSES.find((s) => s.id === r.status)?.tone ?? ""}`}>
                      {CLAIM_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 text-xs text-neutral-600">{r.claimRef ?? ""}{r.settledOn ? <span className="block text-neutral-400">settled {r.settledOn}</span> : r.sentOn ? <span className="block text-neutral-400">sent {r.sentOn}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picked.size > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3">
          <p className="pb-2 text-sm">{picked.size} chosen</p>
          <Field label="Set status">
            <Select value={bulk} onChange={(e) => setBulk(e.target.value as ClaimStatus)}>{CLAIM_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          </Field>
          <Field label="Claim ref. (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. JL-2026-1182" /></Field>
          <Button variant="primary" disabled={busy} onClick={() => void apply([...picked], bulk, ref.trim() ? ref : undefined)}>Apply</Button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-neutral-700">{msg}</p>}
    </div>
  );
}
