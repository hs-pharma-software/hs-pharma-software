"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { restaurant } from "@/lib/restaurant";
import { today } from "@/lib/restaurant/store";
import { Note, RestGuard, money, useLoad } from "@/components/restaurant/ui";

export default function ReportsPage() {
  return (
    <RestGuard>
      <Reports />
    </RestGuard>
  );
}

type Dim = "day" | "hour" | "category" | "dish" | "table" | "cashier" | "deal" | "offer";
const DIMS: { id: Dim; label: string; qtyLabel: string; amountLabel: string }[] = [
  { id: "day", label: "Daily sales", qtyLabel: "Bills", amountLabel: "Sales" },
  { id: "hour", label: "Sales by hour", qtyLabel: "Bills", amountLabel: "Sales" },
  { id: "category", label: "Sales by category", qtyLabel: "Qty", amountLabel: "Net sales" },
  { id: "dish", label: "Sales by dish", qtyLabel: "Qty", amountLabel: "Net sales" },
  { id: "table", label: "Sales by table", qtyLabel: "Bills", amountLabel: "Sales" },
  { id: "cashier", label: "Sales by cashier", qtyLabel: "Bills", amountLabel: "Sales" },
  { id: "deal", label: "Deal performance", qtyLabel: "Sold", amountLabel: "Net sales" },
  { id: "offer", label: "Offers & discounts", qtyLabel: "Times used", amountLabel: "Discount given" },
];

function Reports() {
  const [from, setFrom] = useState(() => today(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(today());
  const [dim, setDim] = useState<Dim>("day");
  const summary = useLoad(() => restaurant.salesSummary(from, to), [from, to]);
  const pays = useLoad(() => restaurant.paymentBreakdown(from, to), [from, to]);
  const rows = useLoad(() => restaurant.salesBy(dim, from, to), [dim, from, to]);
  const praStatus = useLoad(async () => {
    const subs = await restaurant.praSubmissions();
    return subs.reduce<Record<string, number>>((m, s) => ({ ...m, [s.status]: (m[s.status] ?? 0) + 1 }), {});
  });
  const def = DIMS.find((d) => d.id === dim)!;
  const s = summary.data;
  const card = (label: string, value: string, hint?: string) => (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/[0.05]">
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="text-lg font-bold text-neutral-900">{value}</p>
      {hint && <p className="text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Restaurant Reports" actions={<Button onClick={() => window.print()}>Print</Button>} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {[["Today", 0], ["7 days", 6], ["30 days", 29]].map(([l, d]) => (
          <Button key={l as string} onClick={() => { setFrom(today(new Date(Date.now() - (d as number) * 864e5))); setTo(today()); }}>{l}</Button>
        ))}
      </div>
      {summary.error && <Note tone="rose">{summary.error}</Note>}
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {card("Gross sales", money(s.grossSales), "before discounts & tax")}
          {card("Discounts", money(s.discounts), "offers + manual")}
          {card("Refunds", money(s.refunds), `${s.refundCount} credit notes`)}
          {card("Net sales", money(s.netSales), "after discounts & refunds, excl. tax")}
          {card("Sales tax", money(s.taxCollected), "collected, net of refunds")}
          {card("Service charge", money(s.serviceCharges))}
          {card("Collected", money(s.collected), "money in, net of refunds")}
          {card("Bills", String(s.orders))}
          {card("Average bill", money(s.averageOrder))}
          {card("Cancelled orders", String(s.cancelled))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.05]">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {DIMS.map((d) => (
              <button key={d.id} type="button" onClick={() => setDim(d.id)} className={`rounded-full px-3 py-1 text-xs font-medium ${dim === d.id ? "bg-neutral-900 text-white" : "ring-1 ring-neutral-200"}`}>{d.label}</button>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase tracking-widest text-neutral-400"><th className="py-1">{def.label.replace("Sales by ", "")}</th><th className="text-right">{def.qtyLabel}</th><th className="text-right">{def.amountLabel}</th></tr></thead>
            <tbody>
              {(rows.data ?? []).map((r) => (
                <tr key={r.label} className="border-t border-neutral-50"><td className="py-1">{dim === "hour" ? `${r.label}:00` : r.label}</td><td className="text-right">{Math.round(r.qty * 100) / 100}</td><td className="text-right">{money(r.amount)}</td></tr>
              ))}
              {rows.data?.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-neutral-400">No sales in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.05]">
            <h3 className="mb-2 text-sm font-semibold">Payment methods</h3>
            {Object.entries(pays.data ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between py-0.5 text-sm"><span className="capitalize">{k === "digital" ? "Digital wallet" : k}</span><span>{money(v)}</span></div>
            ))}
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.05]">
            <h3 className="mb-2 text-sm font-semibold">Tax summary</h3>
            {s && (
              <>
                <div className="flex justify-between text-sm"><span>Taxable sales (net)</span><span>{money(s.netSales + s.serviceCharges)}</span></div>
                <div className="flex justify-between text-sm"><span>Sales tax</span><span>{money(s.taxCollected)}</span></div>
              </>
            )}
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.05]">
            <h3 className="mb-2 text-sm font-semibold">PRA submissions (all time)</h3>
            {Object.keys(praStatus.data ?? {}).length === 0 && <p className="text-xs text-neutral-400">None.</p>}
            {Object.entries(praStatus.data ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm"><span className="capitalize">{k.replace("_", " ")}</span><span>{v}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
