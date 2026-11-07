"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { SERVER_DB } from "@/lib/serverMode";
import { BRANCH_TAB_KEY } from "@/config/branchTables";
import { branchApi, money, todayLocal, useBranchStore, type Allowance, type Branch } from "@/lib/branchClient";

interface Figures {
  branchId: string; name: string; code: string; status: string;
  netSales: number; returns: number; discounts: number; cogs: number; grossProfit: number; received: number;
  purchases: number; purchaseReturns: number; expenses: number; otherRevenue: number; netResult: number;
  receivable: number; payable: number; stockValue: number; invoices: number; extra: Record<string, number>;
}
interface Report { organization: string; from: string; to: string; currency: string; branchLabel: string; rows: Figures[]; total: Record<string, number>; totalExtra: Record<string, number> }
interface Dashboard {
  today: string; monthStart: string; branches: Branch[]; totals: { branches: number; active: number };
  day: Report; month: Report; alerts: { branchId: string; expired: number; expiring: number }[]; transfersInTransit: number;
  activity: { id: string; branchName: string | null; actor: string | null; action: string; createdAt: string }[]; allowance: Allowance;
}

/** Report rows: [key, label, money?]. Same definitions as Reports > Business P&L. */
const LINES: [keyof Figures, string, boolean][] = [
  ["netSales", "Net sales (after returns and discounts)", true],
  ["returns", "Sales returns", true],
  ["discounts", "Discounts given", true],
  ["cogs", "Cost of goods sold", true],
  ["grossProfit", "Gross profit", true],
  ["expenses", "Expenses", true],
  ["otherRevenue", "Other revenue", true],
  ["netResult", "Net profit / loss (as Business P&L)", true],
  ["received", "Received on sales", true],
  ["purchases", "Purchases", true],
  ["purchaseReturns", "Purchase returns", true],
  ["receivable", "Receivable from customers (to date)", true],
  ["payable", "Payable to suppliers (to date)", true],
  ["stockValue", "Stock value now (at cost)", true],
  ["invoices", "Sale invoices", false],
];

/** Opens a branch in this tab and goes to a page of it (drill-down). */
function openBranchAt(id: string, path: string) {
  if (!confirm("Open this branch in this tab? Anything not saved on the current screen is cleared.")) return;
  try { sessionStorage.setItem(BRANCH_TAB_KEY, id); } catch { /* storage off */ }
  window.location.href = path;
}

function monthStartOf(d: string) { return `${d.slice(0, 7)}-01`; }

export default function BranchReportsPage() {
  const { ctx, load } = useBranchStore();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [from, setFrom] = useState(monthStartOf(todayLocal()));
  const [to, setTo] = useState(todayLocal());
  const [picked, setPicked] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (ids: string[]) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await branchApi<Report>("report", { from, to, branchIds: ids }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (!SERVER_DB) return;
    void load();
    branchApi<Dashboard>("dashboard", { today: todayLocal() }).then(setDash).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);
  useEffect(() => { if (SERVER_DB) void run([]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!SERVER_DB) return <p className="text-sm text-neutral-600">Branch reports are in the web version (app.mavin.pk).</p>;
  const reportable = ctx ? ctx.branches.filter((b) => ctx.managed.includes(b.id)) : [];

  function exportCsv() {
    if (!report) return;
    const head = ["Metric", ...report.rows.map((r) => `${r.name} (${r.code})`), report.rows.length > 1 ? "Total" : ""].filter(Boolean);
    const extraKeys = Object.keys(report.totalExtra);
    const body = [
      ...LINES.map(([k, label]) => [label, ...report.rows.map((r) => String(r[k])), ...(report.rows.length > 1 ? [String(report.total[k] ?? "")] : [])]),
      ...extraKeys.map((k) => [k, ...report.rows.map((r) => String(r.extra[k] ?? 0)), ...(report.rows.length > 1 ? [String(report.totalExtra[k])] : [])]),
    ];
    const meta = [[`Organization: ${report.organization}`], [`Branches: ${report.branchLabel}`], [`Period: ${report.from} to ${report.to}`], [`Currency: ${report.currency}`], []];
    const csv = [...meta, head, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `branch-report-${report.from}-${report.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Branch Dashboard & Reports" actions={<>
        <Link href="/branches/transfers" className="rounded-full px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:underline">Stock transfers</Link>
        {ctx?.isOwner && <Link href="/branches" className="rounded-full px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:underline">Manage branches</Link>}
      </>} />
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {dash && (
        <section aria-label="Organisation overview" className="space-y-3 print:hidden">
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile label="Branches" value={`${dash.totals.active} active`} hint={`${dash.totals.branches} in all · limit ${dash.allowance.limit ?? "unlimited"}`} />
            <Tile label="Net sales today" value={money(dash.day.total.netSales ?? 0)} hint={`${dash.day.total.invoices ?? 0} invoices`} />
            <Tile label="Net sales this month" value={money(dash.month.total.netSales ?? 0)} hint={`Gross profit ${money(dash.month.total.grossProfit ?? 0)}`} />
            <Tile label="Stock in transit" value={String(dash.transfersInTransit)} hint="transfers not yet received" />
          </div>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr><th className="px-3 py-2">Branch</th><th className="px-3 py-2 text-right">Today</th><th className="px-3 py-2 text-right">This month</th><th className="px-3 py-2 text-right">Expenses (month)</th><th className="px-3 py-2">Expiry alerts</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody>
                {dash.month.rows.map((m) => {
                  const d = dash.day.rows.find((x) => x.branchId === m.branchId);
                  const al = dash.alerts.find((x) => x.branchId === m.branchId);
                  return (
                    <tr key={m.branchId} className="border-t border-neutral-100">
                      <td className="px-3 py-2 font-medium">{m.name} <span className="text-xs text-neutral-400">{m.code}</span>{m.status !== "active" && <span className="ml-1 rounded bg-neutral-200 px-1 text-[10px] uppercase">{m.status}</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(d?.netSales ?? 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(m.netSales)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(m.expenses)}</td>
                      <td className="px-3 py-2 text-xs">
                        {al && al.expired > 0 && <span className="mr-1 rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">{al.expired} expired in stock</span>}
                        {al && al.expiring > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">{al.expiring} expiring ≤ 90 days</span>}
                        {(!al || (!al.expired && !al.expiring)) && <span className="text-neutral-400">None</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-xs"><button type="button" className="text-[var(--accent)] hover:underline" onClick={() => openBranchAt(m.branchId, "/reports")}>Open reports</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {dash.activity.length > 0 && (
            <details className="rounded-xl border border-neutral-200 bg-white p-3 text-sm">
              <summary className="cursor-pointer font-medium text-neutral-800">Recent branch activity</summary>
              <ul className="mt-2 divide-y divide-neutral-100">
                {dash.activity.map((a) => <li key={a.id} className="flex justify-between gap-2 py-1"><span>{a.action.replace(/[._]/g, " ")}{a.branchName ? ` · ${a.branchName}` : ""}</span><span className="text-xs text-neutral-500">{a.actor ?? ""} · {new Date(a.createdAt).toLocaleString("en-PK")}</span></li>)}
              </ul>
            </details>
          )}
        </section>
      )}

      <section aria-label="Branch report" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-3 print:hidden">
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm" /></label>
          <fieldset className="flex flex-wrap items-center gap-2 text-sm">
            <legend className="mb-1 text-xs font-medium text-neutral-600">Branches (none ticked = all yours)</legend>
            {reportable.map((b) => (
              <label key={b.id} className="flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1">
                <input type="checkbox" checked={picked.includes(b.id)} onChange={() => setPicked(picked.includes(b.id) ? picked.filter((x) => x !== b.id) : [...picked, b.id])} />{b.name}
              </label>
            ))}
          </fieldset>
          <Button variant="primary" disabled={busy} onClick={() => void run(picked)}>{busy ? "Loading..." : "Show"}</Button>
          <Button disabled={!report} onClick={exportCsv}>Export CSV</Button>
          <Button disabled={!report} onClick={() => window.print()}>Print</Button>
        </div>

        {report && (
          <div className="print-area rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3">
              <h2 className="text-base font-semibold text-neutral-900">{report.organization}: branch report</h2>
              <p className="text-sm text-neutral-600">Branches: {report.branchLabel} · Period: {report.from} to {report.to} · Amounts in {report.currency}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr><th className="py-1.5 pr-3">Metric</th>{report.rows.map((r) => <th key={r.branchId} className="py-1.5 pr-3 text-right">{r.name}</th>)}{report.rows.length > 1 && <th className="py-1.5 text-right">Total</th>}</tr>
                </thead>
                <tbody>
                  {LINES.map(([k, label, isMoney]) => (
                    <tr key={k} className={`border-t border-neutral-100 ${k === "grossProfit" || k === "netResult" ? "font-semibold" : ""}`}>
                      <td className="py-1.5 pr-3">{label}</td>
                      {report.rows.map((r) => <td key={r.branchId} className="py-1.5 pr-3 text-right tabular-nums">{isMoney ? money(r[k] as number) : String(r[k])}</td>)}
                      {report.rows.length > 1 && <td className="py-1.5 text-right tabular-nums">{isMoney ? money(report.total[k] ?? 0) : String(report.total[k] ?? 0)}</td>}
                    </tr>
                  ))}
                  {Object.keys(report.totalExtra).map((k) => (
                    <tr key={k} className="border-t border-neutral-100">
                      <td className="py-1.5 pr-3">{k}</td>
                      {report.rows.map((r) => <td key={r.branchId} className="py-1.5 pr-3 text-right tabular-nums">{k.includes("(Rs)") ? money(r.extra[k] ?? 0) : String(r.extra[k] ?? 0)}</td>)}
                      {report.rows.length > 1 && <td className="py-1.5 text-right tabular-nums">{k.includes("(Rs)") ? money(report.totalExtra[k]) : String(report.totalExtra[k])}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-neutral-500">Stock moved between branches is not a sale or a purchase and is not in these figures; it changes each branch&apos;s stock value. Receivable and payable come from each branch&apos;s own bills. Stock value counts batch stock.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{value}</p>
      <p className="text-xs text-neutral-500">{hint}</p>
    </div>
  );
}
