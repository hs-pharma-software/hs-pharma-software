"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { BookingDetailModal } from "@/components/banquet/BookingDetailModal";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { listBookings, slotLabel, type BookingRow } from "@/lib/repo/banquet";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");
const SLOT_CLS: Record<string, string> = { lunch: "bg-amber-100 text-amber-900", dinner: "bg-indigo-100 text-indigo-900", full_day: "bg-rose-100 text-rose-900" };

/** A month of bookings: each day's events by slot and hall; click a free
 * day to book it. */
export default function CalendarPage() {
  const today = localDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;

  async function reload() {
    if (isTauri()) setRows(await listBookings({ from: `${month}-01`, to: `${month}-${pad(days)}` }).catch(() => []));
  }
  useEffect(() => { void reload(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const shift = (d: number) => {
    const dt = new Date(y, m - 1 + d, 1);
    setMonth(`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`);
  };
  const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader title="Calendar" actions={<>
        <Button onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={14} /></Button>
        <span className="min-w-36 text-center text-sm font-semibold text-neutral-800">{label}</span>
        <Button onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={14} /></Button>
        <Button onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
      </>} />
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7 gap-1.5">
          {DAYS.map((d) => <div key={d} className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: days }).map((_, i) => {
            const date = `${month}-${pad(i + 1)}`;
            const list = rows.filter((b) => b.event_date === date);
            const past = date < today;
            return (
              <div key={date} className={`flex min-h-28 flex-col gap-1 rounded-xl p-1.5 ring-1 ${date === today ? "bg-amber-50 ring-amber-300" : "bg-white ring-black/[0.06]"} ${past ? "opacity-70" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold ${date === today ? "text-amber-800" : "text-neutral-700"}`}>{i + 1}</span>
                  {!past && <Link href={`/banquet/bookings/new?date=${date}`} className="rounded px-1 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800" title="Book this day">+ Book</Link>}
                </div>
                {list.map((b) => (
                  <button key={b.id} type="button" onClick={() => setOpen(b.id)} title={`${b.customer_name} · ${b.event_type} · ${b.guests} guests`}
                    className={`truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium ${SLOT_CLS[b.slot] ?? "bg-neutral-100"} ${b.status === "tentative" ? "border border-dashed border-current" : ""}`}>
                    {slotLabel(b.slot)} · {b.hall_name ?? ""} · {b.customer_name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-neutral-500">Lunch, dinner and full-day bookings are coloured; a dashed outline is a tentative booking.</p>
      {open && <BookingDetailModal bookingId={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
    </div>
  );
}
