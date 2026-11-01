"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { listBookings, type BookingRow } from "@/lib/repo/banquet";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Bookings in a period: totals, by event type and by hall. */
export default function BanquetReportsPage() {
  const today = localDate();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<BookingRow[]>([]);

  useEffect(() => {
    if (isTauri() && from && to) void listBookings({ from, to }).then(setRows).catch(() => setRows([]));
  }, [from, to]);

  const sum = (list: BookingRow[]) => ({
    count: list.length, guests: list.reduce((t, b) => t + b.guests, 0), total: list.reduce((t, b) => t + b.total, 0),
    paid: list.reduce((t, b) => t + b.paid, 0), due: list.reduce((t, b) => t + (b.total - b.paid), 0),
  });
  const all = sum(rows);
  const group = (key: (b: BookingRow) => string) => [...new Set(rows.map(key))].map((k) => ({ k, ...sum(rows.filter((b) => key(b) === k)) })).sort((a, b) => b.total - a.total);
  const table = (title: string, data: ReturnType<typeof group>) => (
    <section className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500"><th className="py-1">{title.replace("By ", "")}</th><th className="py-1 text-right">Bookings</th><th className="py-1 text-right">Guests</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">Received</th><th className="py-1 text-right">Due</th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.k} className="border-b border-neutral-50">
                <td className="py-1">{r.k}</td><td className="py-1 text-right tabular-nums">{r.count}</td><td className="py-1 text-right tabular-nums">{r.guests}</td>
                <td className="py-1 text-right tabular-nums">{money(r.total)}</td><td className="py-1 text-right tabular-nums">{money(r.paid)}</td><td className="py-1 text-right tabular-nums">{money(r.due)}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={6} className="py-3 text-center text-neutral-400">No bookings in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div>
      <PageHeader title="Banquet Reports" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40"><Field label="Events from"><Input id="br-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
        <div className="w-40"><Field label="to"><Input id="br-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Bookings", String(all.count)], ["Guests", String(all.guests)], ["Total", money(all.total)], ["Received", money(all.paid)], ["Due", money(all.due)]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-black/[0.05]">
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">{l}</p>
            <p className={`text-lg font-semibold tabular-nums ${l === "Due" && all.due > 0 ? "text-rose-700" : "text-neutral-900"}`}>{v}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {table("By event", group((b) => b.event_type))}
        {table("By hall", group((b) => b.hall_name ?? "—"))}
      </div>
    </div>
  );
}
