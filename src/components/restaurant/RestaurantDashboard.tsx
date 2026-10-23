"use client";

import { useState } from "react";
import Link from "next/link";
import { restaurant } from "@/lib/restaurant";
import { today } from "@/lib/restaurant/store";
import { Field, Input } from "@/components/ui/Field";
import { Badge, Note, ORDER_TYPE_LABEL, PRA_BADGE, money, useLoad } from "@/components/restaurant/ui";

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/[0.05]" style={accent ? { borderTop: `3px solid ${accent}` } : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-neutral-900">{value}</p>
      {hint && <p className="text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function Bars({ rows, label }: { rows: { label: string; amount: number }[]; label: (l: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  if (!rows.length) return <p className="py-6 text-center text-xs text-neutral-400">No sales yet.</p>;
  return (
    <div className="flex h-36 items-end gap-1">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-1 flex-col items-center gap-1" title={`${label(r.label)}: ${money(r.amount)}`}>
          <div className="w-full rounded-t bg-amber-500/80" style={{ height: `${Math.max(3, (r.amount / max) * 110)}px` }} />
          <span className="text-[9px] text-neutral-500">{label(r.label)}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.05]">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {href && <Link href={href} className="text-[11px] text-amber-700 hover:underline">Open</Link>}
      </div>
      {children}
    </div>
  );
}

/** Restaurant tenants' dashboard. Every figure is read from finalised
 * restaurant records (refunds subtracted once, never double counted). */
export function RestaurantDashboard({ name }: { name: string }) {
  const [day, setDay] = useState(today());
  const weekFrom = today(new Date(new Date(day).getTime() - 6 * 864e5));
  const d = useLoad(() => restaurant.dashboard(day), [day]);
  const week = useLoad(() => restaurant.salesBy("day", weekFrom, day), [day]);
  const cats = useLoad(() => restaurant.salesBy("category", day, day), [day]);
  const cashiers = useLoad(() => restaurant.salesBy("cashier", day, day), [day]);
  const recent = useLoad(() => restaurant.listOrders({ from: day, to: day }), [day]);
  const data = d.data;
  const s = data?.summary;

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-neutral-400">Restaurant dashboard</p>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{name}</h1>
        </div>
        <div className="w-44"><Field label="Day"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field></div>
      </div>
      {d.error && <Note tone="rose">{d.error}</Note>}
      {data && s && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Stat label="Sales (collected)" value={money(s.collected)} hint="after refunds, incl. tax" accent="#10b981" />
            <Stat label="Net sales" value={money(s.netSales)} hint="after discounts & refunds, excl. tax" accent="#0ea5e9" />
            <Stat label="Completed bills" value={String(s.orders)} />
            <Stat label="Active orders" value={String(data.activeOrders)} accent="#f59e0b" />
            <Stat label="Average bill" value={money(s.averageOrder)} />
            <Stat label="Sales tax" value={money(s.taxCollected)} />
            <Stat label="Cash" value={money(data.payments.cash)} />
            <Stat label="Card" value={money(data.payments.card)} />
            <Stat label="Bank / digital" value={money((data.payments.bank ?? 0) + (data.payments.digital ?? 0))} />
            <Stat label="Discounts & offers" value={money(s.discounts)} />
            <Stat label="Refunds" value={money(s.refunds)} hint={`${s.refundCount} refunds · ${s.cancelled} cancelled`} accent="#f43f5e" />
            <Stat label="Pending kitchen" value={String(data.kitchen.sent + data.kitchen.preparing)} hint={`${data.kitchen.ready} ready to serve`} />
          </div>
          {data.target > 0 && (
            <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/[0.05]">
              <div className="mb-1 flex justify-between text-xs"><span>Daily target {money(data.target)}</span><span>{Math.round((s.collected / data.target) * 100)}%</span></div>
              <div className="h-2 rounded-full bg-neutral-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (s.collected / data.target) * 100)}%` }} /></div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Hourly sales"><Bars rows={data.hourly} label={(l) => `${l}h`} /></Card>
            <Card title="Last 7 days"><Bars rows={week.data ?? []} label={(l) => l.slice(5)} /></Card>
            <Card title="Tables" href="/restaurant">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[["Total", data.tables.total], ["Occupied", data.tables.occupied], ["Available", data.tables.available], ["Reserved", data.tables.reserved], ["Bill requested", data.tables.billRequested]].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg bg-neutral-50 px-3 py-2"><p className="text-[11px] text-neutral-500">{l}</p><p className="text-lg font-bold">{v}</p></div>
                ))}
              </div>
            </Card>
            <Card title="Sales by category">
              {(cats.data ?? []).map((c) => <div key={c.label} className="flex justify-between py-0.5 text-sm"><span>{c.label}</span><span>{money(c.amount)}</span></div>)}
              {cats.data?.length === 0 && <p className="text-xs text-neutral-400">No sales yet.</p>}
            </Card>
            <Card title="Best-selling dishes">
              {data.bestSellers.map((b, i) => <div key={b.label} className="flex justify-between py-0.5 text-sm"><span>{i + 1}. {b.label}</span><span className="text-neutral-500">{b.qty} sold</span></div>)}
              {data.bestSellers.length === 0 && <p className="text-xs text-neutral-400">No sales yet.</p>}
            </Card>
            <Card title="Kitchen" href="/restaurant/kitchen">
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                {[["Waiting", data.kitchen.sent], ["Preparing", data.kitchen.preparing], ["Ready", data.kitchen.ready]].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg bg-neutral-50 px-2 py-2"><p className="text-[11px] text-neutral-500">{l}</p><p className="text-lg font-bold">{v}</p></div>
                ))}
              </div>
            </Card>
            <Card title="Low-stock ingredients" href="/restaurant/inventory">
              {data.lowStock.map((i) => <div key={i.id} className="flex justify-between py-0.5 text-sm"><span>{i.name}</span><span className="text-rose-600">{i.stock} {i.unit}</span></div>)}
              {data.lowStock.length === 0 && <p className="text-xs text-neutral-400">Nothing low (or no ingredients tracked).</p>}
            </Card>
            <Card title="By cashier">
              {(cashiers.data ?? []).map((c) => <div key={c.label} className="flex justify-between py-0.5 text-sm"><span>{c.label}</span><span>{money(c.amount)} · {c.qty} bills</span></div>)}
              {cashiers.data?.length === 0 && <p className="text-xs text-neutral-400">No sales yet.</p>}
            </Card>
            <Card title="Recent transactions" href="/restaurant/orders">
              {(recent.data ?? []).filter((o) => o.invoice_no).slice(0, 8).map((o) => (
                <div key={o.id} className="flex items-center justify-between py-0.5 text-sm">
                  <span>#{o.invoice_no} · {o.table_name ?? ORDER_TYPE_LABEL[o.order_type]}</span>
                  <span className="flex items-center gap-1.5">{o.refund_of ? `-${money(o.total)}` : money(o.total)} <Badge cls={PRA_BADGE[o.pra_status]}>{o.pra_status === "not_required" ? "no PRA" : o.pra_status.replace("_", " ")}</Badge></span>
                </div>
              ))}
              {(recent.data ?? []).filter((o) => o.invoice_no).length === 0 && <p className="text-xs text-neutral-400">No invoices yet.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
