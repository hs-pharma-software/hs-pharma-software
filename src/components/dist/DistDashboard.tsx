"use client";

import { useState } from "react";
import Link from "next/link";
import { dist } from "@/lib/dist";
import { Bars, DistGuard, Err, Note, money, useLoad, type DistCtx } from "./ui";
import { SalesmanDetail } from "./SalesmanDetail";
import { TargetBar } from "./TargetBar";
import { downloadClosingPdf } from "@/lib/dist/closingPdf";

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

const thisMonth = () => new Date().toISOString().slice(0, 7);
const SECTION: Record<string, string> = { "236H": "236H · retailers", "236G": "236G · distributors / wholesalers" };
const BOOKING_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", pending_approval: "Waiting approval", approved: "Approved", converted: "Invoiced", rejected: "Rejected", cancelled: "Cancelled" };

/** Change against the month before, in words and an arrow (not colour alone). */
function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (!before) return <span className="text-[11px] text-neutral-400">no figure last month</span>;
  const pct = ((now - before) / Math.abs(before)) * 100;
  const up = pct >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`text-[11px] font-medium ${Math.abs(pct) < 0.05 ? "text-neutral-500" : good ? "text-emerald-700" : "text-rose-700"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)} % vs last month
    </span>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900">{value}</p>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Net sales per day of the month: one series, so no legend; hover or focus a day for its figure. */
function DailyChart({ month, rows }: { month: string; rows: { day: string; amount: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = new Map(rows.map((r) => [Number(r.day.slice(8, 10)), r.amount]));
  const values = Array.from({ length: days }, (_, i) => byDay.get(i + 1) ?? 0);
  const max = Math.max(...values, 1);
  const W = 640, H = 170, top = 10, bottom = 22, left = 4;
  const slot = (W - left) / days;
  const bw = Math.max(3, slot - 2);
  const yOf = (v: number) => top + (H - top - bottom) * (1 - Math.max(0, v) / max);
  const total = values.reduce((a, b) => a + b, 0);
  if (!rows.length) return <p className="py-8 text-center text-xs text-neutral-400">No sales in this month yet.</p>;
  const h = hover != null ? { day: hover + 1, v: values[hover] } : null;
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-500" aria-live="polite">
        {h ? <><b className="text-neutral-800">{h.day} {new Date(Date.UTC(y, m - 1, h.day)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</b>: {money(h.v)}</> : <>Month total {money(total)} · best day {money(max)}</>}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Net sales per day in ${month}`} onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={left} x2={W} y1={yOf(max * f)} y2={yOf(max * f)} stroke="currentColor" className="text-neutral-200" strokeWidth={1} />
        ))}
        <line x1={left} x2={W} y1={H - bottom} y2={H - bottom} stroke="currentColor" className="text-neutral-300" strokeWidth={1} />
        {values.map((v, i) => {
          const x = left + i * slot + (slot - bw) / 2;
          const yy = yOf(v);
          const hgt = Math.max(0, H - bottom - yy);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`Day ${i + 1}: ${money(v)}`}>
              <rect x={left + i * slot} y={top} width={slot} height={H - top - bottom} fill="transparent" />
              {hgt > 0 && <path d={`M${x},${H - bottom} V${yy + Math.min(4, hgt)} Q${x},${yy} ${x + Math.min(4, bw / 2)},${yy} H${x + bw - Math.min(4, bw / 2)} Q${x + bw},${yy} ${x + bw},${yy + Math.min(4, hgt)} V${H - bottom} Z`} fill="#2a78d6" opacity={hover == null || hover === i ? 1 : 0.45} />}
              {(i === 0 || (i + 1) % 5 === 0) && <text x={left + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10" className="fill-neutral-500">{i + 1}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Admin({ c }: { c: DistCtx }) {
  const [month, setMonth] = useState(thisMonth());
  const d = useLoad(() => dist.dashboard(month), [month]);
  const alerts = useLoad(() => (c.mode === "pharma" && c.can("customers.view") ? dist.cdslAlerts() : Promise.resolve([])), []);
  // Month closing reminder (administrator): on the month's last day, or while last month is still open.
  const closing = useLoad(() => (c.admin ? dist.monthStatus(null) : Promise.resolve(null)), []);
  const [drafting, setDrafting] = useState(false);
  const x = d.data;
  const pending = x?.bookings.filter((b) => b.status === "submitted" || b.status === "pending_approval").reduce((a, b) => ({ n: a.n + b.n, total: a.total + b.total }), { n: 0, total: 0 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          Month
          <input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1" />
        </label>
        {!!pending?.n && <Link href="/dist/bookings" className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">{pending.n} booking{pending.n === 1 ? "" : "s"} waiting approval · {money(pending.total)}</Link>}
      </div>
      <Err error={d.error} />
      {closing.data && closing.data.due && !closing.data.closed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200" role="status">
          <p className="text-sm text-amber-900">
            <b>Close {new Date(`${closing.data.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}.</b>{" "}
            {closing.data.isLastDay ? "Today is the last day of the month." : "Last month is still open."} Check the draft report, then finalize to add salaries to Expenses.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={drafting} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              onClick={async () => { setDrafting(true); try { await downloadClosingPdf(await dist.closeMonth(closing.data!.month, { final: false })); } finally { setDrafting(false); } }}>
              {drafting ? "Preparing…" : "Download draft (PDF)"}
            </button>
            <Link href="/dist/salaries" className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">Finalize month</Link>
          </div>
        </div>
      )}
      {!!alerts.data?.length && (
        <Note tone="amber">
          CDSL attention needed: {alerts.data.slice(0, 8).map((a) => `${a.business_name} (${a.cdsl_state})`).join(", ")}
          {alerts.data.length > 8 ? "…" : ""}
        </Note>
      )}
      {x && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile label="Net sales" value={money(x.now.net)} sub={<Delta now={x.now.net} before={x.before.net} />} />
            <Tile label="Gross profit" value={money(x.now.grossProfit)} sub={<span className="text-[11px] text-neutral-500">margin {x.now.marginPct.toFixed(1)} % · <Delta now={x.now.grossProfit} before={x.before.grossProfit} /></span>} />
            <Tile label="Collected from customers" value={money(x.now.collected)} sub={<Delta now={x.now.collected} before={x.before.collected} />} />
            <Tile label="Invoices" value={x.now.invoices.toLocaleString("en-PK")} sub={<span className="text-[11px] text-neutral-500">returns {money(x.now.returns)}</span>} />
            <Tile label="Customers owe you" value={x.receivable == null ? "—" : money(x.receivable)} sub={<Link href="/dist/ledger" className="text-[11px] text-sky-700 underline">receivables</Link>} />
            <Tile label="You owe suppliers" value={x.payable == null ? "—" : money(x.payable)} sub={<Link href="/dist/ledger" className="text-[11px] text-sky-700 underline">payables</Link>} />
            <Tile label="Purchases" value={money(x.now.purchases)} sub={<Delta now={x.now.purchases} before={x.before.purchases} invert />} />
            <Tile label="Withholding tax collected" value={money(x.now.wht)} sub={<span className="text-[11px] text-neutral-500">236G / 236H, net of returns</span>} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><Card title="Net sales per day"><DailyChart month={month} rows={x.daily} /></Card></div>
            <Card title="Salesmen against target" action={<Link href="/dist/salesmen" className="text-xs text-sky-700 underline">all</Link>}>
              <div className="space-y-3">
                {x.targets.map((t) => <TargetBar key={t.id} {...t} status={t.target > 0 ? t.status : "below"} />)}
                {!x.targets.length && <p className="py-3 text-center text-xs text-neutral-400">No active salesmen.</p>}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Top companies"><Bars rows={x.companies} empty="No sales yet." /></Card>
            <Card title="Top customers"><Bars rows={x.customers} empty="No sales yet." /></Card>
            <Card title="Top products"><Bars rows={x.products} empty="No sales yet." /></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Withholding tax by section">
              {x.wht.length ? (
                <table className="w-full text-xs">
                  <thead className="text-neutral-500"><tr><th className="py-1 text-start font-medium">Section</th><th className="text-start font-medium">ATL</th><th className="text-end font-medium">Rate</th><th className="text-end font-medium">Tax</th></tr></thead>
                  <tbody className="divide-y divide-neutral-100">
                    {x.wht.map((w, i) => (
                      <tr key={i}>
                        <td className="py-1.5">{SECTION[w.section] ?? w.section}</td>
                        <td>{w.status === "active" ? "Active (filer)" : w.status === "inactive" ? "Not active" : w.status}</td>
                        <td className="text-end tabular-nums">{Number(w.rate).toFixed(2)} %</td>
                        <td className="text-end tabular-nums">{money(w.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="py-3 text-center text-xs text-neutral-400">No withholding tax this month.</p>}
            </Card>
            <Card title="Bookings this month">
              <Bars rows={x.bookings.map((b) => ({ label: `${BOOKING_LABEL[b.status] ?? b.status} (${b.n})`, amount: b.total }))} empty="No bookings yet." />
            </Card>
            <Card title={`Low stock${x.lowStock.length ? ` (${x.lowStock.length})` : ""}`} action={<Link href="/dist/catalog" className="text-xs text-sky-700 underline">products</Link>}>
              {x.lowStock.length ? (
                <ul className="max-h-56 divide-y divide-neutral-100 overflow-y-auto text-xs">
                  {x.lowStock.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 py-1.5">
                      <span className="truncate">{p.name} <span className="text-neutral-400">{p.code}</span></span>
                      <span className={`shrink-0 tabular-nums ${p.stock <= 0 ? "font-semibold text-rose-700" : "text-amber-700"}`}>{p.stock <= 0 ? "Out" : p.stock} / {p.reorder_level}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-3 text-center text-xs text-neutral-400">Nothing below its reorder level.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
