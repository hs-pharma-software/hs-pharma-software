"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { BookingDetailModal, STATUS_CLS } from "@/components/banquet/BookingDetailModal";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { listBookings, slotLabel, type BookingRow, type BookingStatus } from "@/lib/repo/banquet";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Bookings: upcoming by default; search by customer, mobile, CNIC or number. */
export default function BookingsPage() {
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [term, setTerm] = useState("");
  const [view, setView] = useState<"upcoming" | "past" | BookingStatus | "all">("upcoming");
  const [open, setOpen] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const today = localDate();
    const opts = view === "upcoming" ? { from: today, status: "active" as const }
      : view === "past" ? { to: today, status: "active" as const }
      : view === "all" ? { status: "all" as const } : { status: view };
    const r = await listBookings({ ...opts, term }).catch(() => []);
    setRows(view === "past" ? [...r].reverse() : r);
  }
  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [term, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpen(id);
  }, []);

  const columns: Column<BookingRow>[] = [
    { header: "Booking", render: (b) => <span className="font-mono text-xs">{b.booking_no}</span> },
    { header: "Date", render: (b) => <span>{b.event_date}<span className="block text-xs text-neutral-500">{slotLabel(b.slot)}</span></span> },
    { header: "Customer", render: (b) => <span><span className="font-medium">{b.customer_name}</span><span className="block text-xs text-neutral-500">{b.mobile}</span></span> },
    { header: "Event", render: (b) => b.event_type },
    { header: "Hall", render: (b) => b.hall_name ?? "—" },
    { header: "Guests", render: (b) => <span className="tabular-nums">{b.guests}</span> },
    { header: "Total", render: (b) => <span className="tabular-nums">{money(b.total)}</span> },
    { header: "Due", render: (b) => <span className={`tabular-nums ${b.total - b.paid > 0.009 ? "font-semibold text-rose-700" : "text-neutral-500"}`}>{money(b.total - b.paid)}</span> },
    { header: "Status", render: (b) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CLS[b.status] ?? ""}`}>{b.status}</span> },
  ];

  return (
    <div>
      <PageHeader title="Bookings" actions={<Link href="/banquet/bookings/new" className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium btn-primary-theme"><Plus size={14} />New booking</Link>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input id="bk-search" className="max-w-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search customer, mobile, CNIC or booking…" />
        <Select id="bk-view" className="w-44" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
          <option value="tentative">Tentative</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </Select>
      </div>
      <DataTable columns={columns} rows={rows} onRowClick={(b) => setOpen(b.id)} emptyMessage={view === "upcoming" ? "No upcoming bookings. Click New booking to book a hall." : "No bookings here."} />
      {open && <BookingDetailModal bookingId={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
    </div>
  );
}
