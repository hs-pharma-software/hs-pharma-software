"use client";

import Link from "next/link";
import { dist } from "@/lib/dist";
import { Badge, DistGuard, Err, LIVE_TONE, Note, Stat, ago, money, monthStart, todayYmd, useLoad, type DistCtx } from "./ui";
import { SalesmanDetail } from "./SalesmanDetail";

/** /dashboard for distributors: the salesman sees their own target; the admin the business. */
export function DistDashboard({ name }: { name: string }) {
  return (
    <DistGuard>
      {(c) => (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{c.mode === "pharma" ? "Pharma" : "General"} Distributor</h1>
            <p className="text-sm text-neutral-500">{name}</p>
          </div>
          {c.salesmanId ? (
            <>
              <Note>
                <Link className="underline" href="/dist/field">Open the Field Panel</Link> to share your location and book orders.
              </Note>
              <SalesmanDetail salesmanId={c.salesmanId} showLocation={false} />
            </>
          ) : c.can("reports.view") ? (
            <Admin c={c} />
          ) : (
            <Note>Use the menu to open the sections you have access to.</Note>
          )}
        </div>
      )}
    </DistGuard>
  );
}

function Admin({ c }: { c: DistCtx }) {
  const s = useLoad(() => dist.adminSummary(monthStart(), todayYmd()), []);
  const salesmen = useLoad(() => (c.can("salesmen.view") || c.admin ? dist.listSalesmen() : Promise.resolve([])), []);
  const alerts = useLoad(() => (c.mode === "pharma" && c.can("customers.view") ? dist.cdslAlerts() : Promise.resolve([])), []);
  const pending = s.data?.bookings.find((b) => b.status === "pending_approval");
  return (
    <div className="space-y-4">
      <Err error={s.error} />
      {s.data && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Invoiced this month" value={money(s.data.sales.total)} hint={`${s.data.sales.n} invoices`} />
          <Stat label="Returns this month" value={money(s.data.returns.total)} />
          <Stat label="WHT collected" value={money(s.data.sales.wht - s.data.returns.wht)} />
          <Stat label="Purchases this month" value={money(s.data.purchases.total)} />
          <Stat label="Pending approval" value={<Link className="underline" href="/dist/bookings">{pending?.n ?? 0} bookings</Link>} hint={money(pending?.total ?? 0)} />
        </div>
      )}
      {!!alerts.data?.length && (
        <Note tone="amber">
          CDSL attention needed: {alerts.data.slice(0, 8).map((a) => `${a.business_name} (${a.cdsl_state})`).join(", ")}
          {alerts.data.length > 8 ? "…" : ""}
        </Note>
      )}
      <section className="rounded-xl bg-white p-4 ring-1 ring-black/5">
        <h2 className="mb-2 text-sm font-semibold">Salesmen</h2>
        <ul className="divide-y divide-neutral-100 text-sm">
          {(salesmen.data ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between py-1.5">
              <span>{m.name} <span className="text-xs text-neutral-400">{m.code}</span></span>
              <span className="text-xs"><Badge tone={LIVE_TONE[m.live]}>{m.live}</Badge> {ago(m.last_point_at)}</span>
            </li>
          ))}
          {!salesmen.data?.length && <li className="py-2 text-neutral-400">No salesmen yet.</li>}
        </ul>
      </section>
    </div>
  );
}
