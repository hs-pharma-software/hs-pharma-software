"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { InsuranceCompanySelect } from "@/components/customers/InsuranceCompanySelect";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  CLAIM_STATUSES, claimLabel, claimTotals, groupInsurance, insuranceInvoices,
  type ClaimStatus, type InsuranceGroupRow, type InsuranceInvoice,
} from "@/lib/repo/insurance";
import { FormError } from "@/components/ui/FormError";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-3 font-medium";
const td = "py-1.5 pr-3";
const num = `${td} text-right tabular-nums`;
const money = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
const TABS = [["company", "Company wise"], ["invoice", "Invoice wise"], ["patient", "Patient wise"], ["month", "Monthly"]] as const;
type Tab = (typeof TABS)[number][0];
const SHOWN: ClaimStatus[] = ["not_claimed", "sent", "in_process", "paid", "unpaid"];
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-PK", { month: "long", year: "numeric" });

/** Reports > Insurance: claim amounts (whole invoices) by company, invoice,
 * patient or month, for a period, with each claim status's share. */
export default function InsuranceReportPage() {
  const [tab, setTab] = useState<Tab>("company");
  const [from, setFrom] = useState(`${localDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(localDate());
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState<ClaimStatus | "">("");
  const [rows, setRows] = useState<InsuranceInvoice[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isTauri() || !from || !to) return;
    setLoading(true);
    insuranceInvoices({ from, to, companyId: companyId || null, status: status || null })
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => { const m = e instanceof Error ? e.message : String(e); setError(/no such (table|column)/i.test(m) ? "Insurance needs the database update (v96)." : m); })
      .finally(() => setLoading(false));
  }, [from, to, companyId, status]);

  const total = claimTotals(rows);
  const groups = useMemo(() => (tab === "invoice" ? [] : groupInsurance(rows, tab)), [rows, tab]);

  return (
    <div>
      <PageHeader title="Insurance" actions={<Button variant="secondary" onClick={() => window.print()} className="print:hidden"><Printer size={14} />Print</Button>} />
      <div className={`${card} print:hidden`}>
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setTab(id); setOpen(null); }}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${tab === id ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>{label}</button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="From"><Input id="ir-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input id="ir-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="w-64"><Field label="Company"><InsuranceCompanySelect id="ir-company" allowAll value={companyId} onChange={(v) => setCompanyId(v)} /></Field></div>
          <Field label="Status">
            <Select id="ir-status" value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus | "")}>
              <option value="">All statuses</option>{CLAIM_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
        </div>
      </div>

      <div className={`${card} print-area mt-4`}>
        <p className="mb-1 hidden text-lg font-bold print:block">Insurance · {TABS.find((t) => t[0] === tab)?.[1]}</p>
        <p className="mb-3 text-xs text-neutral-500">{from} to {to}{status ? ` · ${claimLabel(status)}` : ""} · whole invoices of insured customers</p>
        <FormError message={error} className="mb-2" />
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>Invoices: <b>{total.invoices}</b></span>
          <span>Total: <b>Rs {money(total.total)}</b></span>
          <span className="text-emerald-700">Paid: <b>Rs {money(total.byStatus.paid)}</b></span>
          <span className="text-amber-700">Pending: <b>Rs {money(total.byStatus.sent + total.byStatus.in_process)}</b></span>
          <span className="text-rose-700">Unpaid: <b>Rs {money(total.byStatus.unpaid)}</b></span>
          <span className="text-neutral-500">Not claimed: <b>Rs {money(total.byStatus.not_claimed)}</b></span>
        </div>

        {loading && rows.length === 0 ? <p className="text-sm text-neutral-400">Loading…</p> : rows.length === 0 ? <p className="text-sm text-neutral-400">No insurance invoices in this period.</p> : tab === "invoice" ? (
          <InvoiceTable rows={rows} showCustomer />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className={th}>{tab === "company" ? "Company" : tab === "patient" ? "Patient" : "Month"}</th>
                <th className={`${th} text-right`}>Invoices</th>
                {SHOWN.map((s) => <th key={s} className={`${th} text-right`}>{claimLabel(s)}</th>)}
                <th className={`${th} text-right`}>Total (Rs)</th>
              </tr></thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.id}>
                    <GroupRow g={g} expandable={tab === "patient"} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} label={tab === "month" ? monthName(g.label) : g.label} />
                    {tab === "patient" && open === g.id && (
                      <tr><td colSpan={SHOWN.length + 3} className="bg-neutral-50 px-3 py-2"><InvoiceTable rows={rows.filter((r) => r.customerId === g.id)} /></td></tr>
                    )}
                  </Fragment>
                ))}
                <tr className="border-t-2 border-neutral-300 font-semibold">
                  <td className={td}>Total</td><td className={num}>{total.invoices}</td>
                  {SHOWN.map((s) => <td key={s} className={num}>{money(total.byStatus[s])}</td>)}
                  <td className={num}>{money(total.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupRow({ g, label, expandable, open, onToggle }: { g: InsuranceGroupRow; label: string; expandable: boolean; open: boolean; onToggle: () => void }) {
  return (
    <tr className={`border-t border-neutral-100 ${expandable ? "cursor-pointer hover:bg-neutral-50" : ""}`} onClick={expandable ? onToggle : undefined}>
      <td className={td}>
        <span className="inline-flex items-center gap-1">
          {expandable && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          <span className="font-medium text-neutral-900">{label}</span>
        </span>
        {g.sub && <span className="block pl-5 text-[11px] text-neutral-500">{g.sub}</span>}
      </td>
      <td className={num}>{g.invoices}</td>
      {SHOWN.map((s) => <td key={s} className={`${num} ${g.byStatus[s] ? "" : "text-neutral-300"}`}>{money(g.byStatus[s])}</td>)}
      <td className={`${num} font-semibold`}>{money(g.total)}</td>
    </tr>
  );
}

function InvoiceTable({ rows, showCustomer = false }: { rows: InsuranceInvoice[]; showCustomer?: boolean }) {
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-neutral-500">
          <th className={th}>Invoice</th><th className={th}>Date</th>
          {showCustomer && <><th className={th}>Patient</th><th className={th}>Company</th></>}
          <th className={th}>Status</th><th className={th}>Claim ref.</th><th className={`${th} text-right`}>Amount (Rs)</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-neutral-100">
              <td className={td}>#{r.invoiceNo ?? "—"}</td>
              <td className={`${td} whitespace-nowrap`}>{r.date}</td>
              {showCustomer && <><td className={td}>{r.customerName}{r.policyNo && <span className="block text-[11px] text-neutral-500">Policy {r.policyNo}</span>}</td><td className={td}>{r.companyName}</td></>}
              <td className={td}><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${CLAIM_STATUSES.find((s) => s.id === r.status)?.tone ?? ""}`}>{claimLabel(r.status)}</span></td>
              <td className={`${td} text-xs text-neutral-600`}>{r.claimRef ?? ""}</td>
              <td className={num}>{money(r.amount)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-neutral-300 font-semibold">
            <td className={td} colSpan={showCustomer ? 6 : 4}>Total · {rows.length} invoice{rows.length === 1 ? "" : "s"}</td>
            <td className={num}>{money(sum)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
