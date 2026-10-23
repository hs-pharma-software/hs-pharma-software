"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { dist } from "@/lib/dist";
import { DistGuard, Err, PageTitle, Stat, downloadCsv, money, monthStart, todayYmd, useLoad } from "@/components/dist/ui";

type Tab = "company" | "category" | "salesman" | "customer" | "day" | "wht" | "bookings" | "stock";
const TABS: { id: Tab; label: string }[] = [
  { id: "company", label: "Company-wise sales" },
  { id: "category", label: "Category-wise sales" },
  { id: "salesman", label: "Salesman-wise sales" },
  { id: "customer", label: "Customer-wise sales" },
  { id: "day", label: "Daily sales" },
  { id: "wht", label: "Withholding tax" },
  { id: "bookings", label: "Booking → invoice" },
  { id: "stock", label: "Stock movement" },
];

export default function ReportsPage() {
  return <DistGuard need="reports.view">{() => <Reports />}</DistGuard>;
}

function Reports() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayYmd);
  const [tab, setTab] = useState<Tab>("company");
  const summary = useLoad(() => dist.adminSummary(from, to), [from, to]);
  const rows = useLoad<Record<string, unknown>[]>(async () => {
    if (tab === "wht") return dist.whtReport(from, to);
    if (tab === "bookings") return dist.bookingConversion(from, to);
    if (tab === "stock") return (await dist.stockMoves()) as Record<string, unknown>[];
    return dist.salesBy(tab, from, to);
  }, [tab, from, to]);
  const s = summary.data;
  const data = rows.data ?? [];
  const cols = data[0] ? Object.keys(data[0]).filter((k) => !["id", "tenant_id", "updated_at", "deleted_at", "doc_item_id", "product_id"].includes(k)) : [];
  return (
    <div className="space-y-3">
      <PageTitle title="Reports" actions={<Button onClick={() => downloadCsv(`${tab}-${from}-${to}.csv`, data)}>Export CSV</Button>} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Err error={summary.error ?? rows.error} />
      {s && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Invoiced sales" value={money(s.sales.total)} hint={`${s.sales.n} invoices`} />
          <Stat label="Sales returns" value={money(s.returns.total)} hint={`${s.returns.n} credit notes`} />
          <Stat label="WHT collected (net)" value={money(s.sales.wht - s.returns.wht)} />
          <Stat label="Purchases" value={money(s.purchases.total - s.purchaseReturns.total)} />
          <Stat label="Bookings (all states)" value={money(s.bookings.reduce((a, b) => a + b.total, 0))} hint="Not sales until invoiced" />
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`rounded-full px-3 py-1.5 text-xs ${tab === t.id ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "wht" && <p className="text-xs text-neutral-500">Withholding by customer, section and ATL status at invoice time (credit notes subtracted). Use with your monthly withholding statement; reconcile against FBR records.</p>}
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>{cols.map((k) => <th key={k} className="px-3 py-2 text-start">{k.replace(/_/g, " ")}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} className="border-t border-neutral-100">
                {cols.map((k) => <td key={k} className="px-3 py-1.5">{typeof r[k] === "number" && /amount|total|wht|base|invoiced|cost/.test(k) ? money(r[k] as number) : String(r[k] ?? "")}</td>)}
              </tr>
            ))}
            {!data.length && <tr><td className="py-8 text-center text-neutral-400">{rows.loading ? "Loading…" : "No data for this period."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
