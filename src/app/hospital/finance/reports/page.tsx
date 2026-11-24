"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  PERIOD_LABEL, departmentPl, doctorShares, episodePl, insurancePl, type DoctorShareRow, type Period, type PlRow,
} from "@/lib/repo/hospitalReports";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-3 font-medium";
const td = "py-1.5 pr-3";
const num = `${td} text-right tabular-nums`;
const money = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
const TABS = [["opd", "OPD wise"], ["lab", "Lab wise"], ["radiology", "Radiology wise"], ["insurance", "Insurance wise"], ["episode", "Episode wise"], ["doctor", "Doctor share"]] as const;
type Tab = (typeof TABS)[number][0];

/** Finance > Reports: profit / loss by OPD, lab, radiology, insurance and episode, and doctors' shares. */
export default function HospitalReportsPage() {
  const [tab, setTab] = useState<Tab>("opd");
  const [period, setPeriod] = useState<Period>("day");
  const [from, setFrom] = useState(`${localDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(localDate());
  const [rows, setRows] = useState<PlRow[]>([]);
  const [shares, setShares] = useState<DoctorShareRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const periodUsed = tab === "opd" || tab === "lab" || tab === "radiology" || tab === "doctor";

  useEffect(() => {
    if (!isTauri() || !from || !to) return;
    const range = { from, to };
    setLoading(true);
    const job = tab === "doctor" ? doctorShares(range, period).then((r) => { setShares(r); setRows([]); })
      : (tab === "insurance" ? insurancePl(range) : tab === "episode" ? episodePl(range) : departmentPl(tab, range, period)).then((r) => { setRows(r); setShares([]); });
    job.then(() => setError(null)).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  }, [tab, period, from, to]);

  const total = rows.reduce((a, r) => ({ count: a.count + r.count, revenue: a.revenue + r.revenue, doctor: a.doctor + r.doctorShare, staff: a.staff + r.staffShare, other: a.other + r.otherCost, profit: a.profit + r.profit }),
    { count: 0, revenue: 0, doctor: 0, staff: 0, other: 0, profit: 0 });
  const shareTotal = shares.reduce((a, r) => a + r.total, 0);
  const label = TABS.find((t) => t[0] === tab)?.[1] ?? "";

  return (
    <div>
      <PageHeader title="Profit / Loss Reports" actions={<Button variant="secondary" onClick={() => window.print()} className="print:hidden"><Printer size={14} />Print</Button>} />
      <div className={`${card} print:hidden`}>
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(([id, l]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${tab === id ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>{l}</button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {periodUsed && (
            <Field label="Show">
              <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
              </Select>
            </Field>
          )}
        </div>
      </div>

      <div className={`${card} print-area mt-4`}>
        <p className="mb-1 text-lg font-bold">{label}</p>
        <p className="mb-3 text-xs text-neutral-500">{from} to {to}{periodUsed ? ` · ${PERIOD_LABEL[period]}` : ""} · revenue is what was charged; shares are paid out to doctors and staff; surgery shares and expenses on the day of the surgery</p>
        {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {loading ? <p className="text-sm text-neutral-400">Loading…</p> : tab === "doctor" ? (
          shares.length === 0 ? <p className="text-sm text-neutral-400">No doctor shares in this period.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500">
                  <th className={th}>Period</th><th className={th}>Doctor</th><th className={`${th} text-right`}>Consultations</th><th className={`${th} text-right`}>Services</th><th className={`${th} text-right`}>Tests ordered</th><th className={`${th} text-right`}>Surgeries</th><th className={`${th} text-right`}>Total (Rs)</th>
                </tr></thead>
                <tbody>
                  {shares.map((r) => (
                    <tr key={r.key} className="border-t border-neutral-100">
                      <td className={`${td} whitespace-nowrap`}>{r.period}</td><td className={td}>{r.doctor}</td>
                      <td className={num}>{money(r.consultation)}</td><td className={num}>{money(r.services)}</td><td className={num}>{money(r.ordered)}</td><td className={num}>{money(r.surgery)}</td><td className={`${num} font-semibold`}>{money(r.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-neutral-300 font-semibold"><td className={td} colSpan={6}>Total</td><td className={num}>{money(shareTotal)}</td></tr>
                </tbody>
              </table>
            </div>
          )
        ) : rows.length === 0 ? <p className="text-sm text-neutral-400">Nothing in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className={th}>{tab === "insurance" ? "Insurance company" : tab === "episode" ? "Episode" : "Period"}</th>
                {tab !== "episode" && <th className={`${th} text-right`}>{tab === "insurance" ? "Patients' visits" : "Charges"}</th>}
                <th className={`${th} text-right`}>Revenue</th><th className={`${th} text-right`}>Doctor share</th><th className={`${th} text-right`}>Staff share</th>
                {tab === "episode" && <th className={`${th} text-right`}>Surgery expenses</th>}
                <th className={`${th} text-right`}>Profit (Rs)</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-neutral-100">
                    <td className={td}>{r.label}{r.sub && <span className="block text-[11px] text-neutral-500">{r.sub}</span>}</td>
                    {tab !== "episode" && <td className={num}>{r.count}</td>}
                    <td className={num}>{money(r.revenue)}</td><td className={num}>{money(r.doctorShare)}</td><td className={num}>{money(r.staffShare)}</td>
                    {tab === "episode" && <td className={num}>{money(r.otherCost)}</td>}
                    <td className={`${num} font-semibold ${r.profit < 0 ? "text-rose-700" : "text-emerald-700"}`}>{money(r.profit)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-neutral-300 font-semibold">
                  <td className={td}>Total</td>
                  {tab !== "episode" && <td className={num}>{total.count}</td>}
                  <td className={num}>{money(total.revenue)}</td><td className={num}>{money(total.doctor)}</td><td className={num}>{money(total.staff)}</td>
                  {tab === "episode" && <td className={num}>{money(total.other)}</td>}
                  <td className={num}>{money(total.profit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
