"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { BookingDetailModal, STATUS_CLS } from "@/components/banquet/BookingDetailModal";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { useAuthStore } from "@/store/authStore";
import { banquetStats, listBookings, slotLabel, type BanquetStats, type BookingRow } from "@/lib/repo/banquet";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** The marquee's next events and this month's money. */
export default function BanquetDashboardPage() {
  const name = useAuthStore((s) => s.currentTenant?.name ?? "Banquet");
  const today = localDate();
  const [s, setS] = useState<BanquetStats | null>(null);
  const [next, setNext] = useState<BookingRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      const in14 = new Date(`${today}T00:00:00`);
      in14.setDate(in14.getDate() + 14);
      const to = `${in14.getFullYear()}-${String(in14.getMonth() + 1).padStart(2, "0")}-${String(in14.getDate()).padStart(2, "0")}`;
      const [st, list] = await Promise.all([banquetStats(today), listBookings({ from: today, to })]);
      setS(st);
      setNext(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title={name} actions={<Link href="/banquet/bookings/new" className="inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium btn-primary-theme">New booking</Link>} />
      {error && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">{error}</p>}
      {s && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
          {[["Events today", String(s.today)], ["Next 30 days", String(s.upcoming30)], ["This month", String(s.monthBookings)], ["Month's bookings (Rs)", money(s.monthRevenue)], ["Received (all)", money(s.received)], ["Due (this month on)", money(s.due)]].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-black/[0.05]">
              <p className="text-[11px] uppercase tracking-wide text-neutral-500">{l}</p>
              <p className={`text-lg font-semibold tabular-nums ${l.startsWith("Due") && s.due > 0 ? "text-rose-700" : "text-neutral-900"}`}>{v}</p>
            </div>
          ))}
        </div>
      )}
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">Next 14 days</h2>
      <div className="flex flex-col gap-2">
        {next.length === 0 && <p className="rounded-xl bg-white p-4 text-sm text-neutral-500 ring-1 ring-black/[0.05]">No events booked in the next 14 days.</p>}
        {next.map((b) => (
          <button key={b.id} type="button" onClick={() => setOpen(b.id)} className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-2.5 text-left text-sm ring-1 ring-black/[0.05] hover:ring-neutral-300">
            <span className="w-28 font-semibold tabular-nums">{b.event_date === today ? "Today" : b.event_date}</span>
            <span className="w-20 text-neutral-600">{slotLabel(b.slot)}</span>
            <span className="min-w-40 flex-1"><b>{b.customer_name}</b> · {b.event_type} · {b.guests} guests</span>
            <span className="text-neutral-600">{b.hall_name ?? ""}</span>
            {b.total - b.paid > 0.009 && <span className="tabular-nums text-rose-700">Due {money(b.total - b.paid)}</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CLS[b.status] ?? ""}`}>{b.status}</span>
          </button>
        ))}
      </div>
      {open && <BookingDetailModal bookingId={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
    </div>
  );
}
