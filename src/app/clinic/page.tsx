"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Stethoscope, UserRoundPlus, CalendarDays, FileHeart, Clock, Users, Receipt } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BillModal } from "@/components/clinic/ConsultationOrders";
import { ClinicVisitInvoiceModal } from "@/components/clinic/ClinicPrints";
import { listDayBills, getVisitBill, type DayBillRow, type VisitBill } from "@/lib/repo/clinicServices";
import { useCanBill } from "@/lib/moduleAccess";
import { localDate } from "@/lib/localDate";
import { PageHeader } from "@/components/ui/PageHeader";
import { isTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import {
  getClinicStats,
  getTodayAppointments,
  type ClinicStats,
  type TodayAppointmentRow,
} from "@/lib/repo/clinic";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  arrived: "bg-amber-100 text-amber-700",
  in_consultation: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-neutral-100 text-neutral-500",
  no_show: "bg-red-100 text-red-600",
};

const EMPTY_STATS: ClinicStats = { totalPatients: 0, totalDoctors: 0, todayAppointments: 0, pendingRx: 0 };

export default function ClinicDashboardPage() {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const tenantName = useAuthStore((s) => s.currentTenant?.name ?? "Clinic");
  const [stats, setStats] = useState<ClinicStats>(EMPTY_STATS);
  const [appointments, setAppointments] = useState<TodayAppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Reception: what each patient of today owes; fees collected from here.
  const canBill = useCanBill();
  const [bills, setBills] = useState<Map<string, DayBillRow>>(new Map());
  const [billing, setBilling] = useState<VisitBill | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isTauri() || !tenantId) return;
    setLoading(true);
    Promise.all([
      getClinicStats().catch(() => EMPTY_STATS),
      getTodayAppointments(100).catch(() => [] as TodayAppointmentRow[]),
      canBill ? listDayBills(localDate()).catch(() => new Map<string, DayBillRow>()) : Promise.resolve(new Map<string, DayBillRow>()),
    ]).then(([s, a, b]) => {
      setStats(s);
      setAppointments(a);
      setBills(b);
      setLoading(false);
    });
  }, [tenantId, canBill, reloadKey]);

  async function collect(b: DayBillRow) {
    if (!b.consultationId) return;
    try { setBilling(await getVisitBill(b.consultationId)); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); }
  }

  const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const totals = [...bills.values()].reduce((t, b) => ({ paid: t.paid + b.paid, due: t.due + b.due + b.balance }), { paid: 0, due: 0 });

  const cards = [
    { label: "Total Patients", value: stats.totalPatients, icon: UserRoundPlus, href: "/clinic/patients", color: "text-blue-600" },
    { label: "Doctors", value: stats.totalDoctors, icon: Stethoscope, href: "/clinic/doctors", color: "text-indigo-600" },
    { label: "Today's Appointments", value: stats.todayAppointments, icon: CalendarDays, href: "/clinic/appointments", color: "text-amber-600" },
    { label: "Pending Prescriptions", value: stats.pendingRx, icon: FileHeart, href: "/clinic/consultations", color: "text-rose-600" },
  ];

  return (
    <div>
      <PageHeader title={tenantName} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-5">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] hover:shadow-md transition-shadow flex flex-col gap-2"
          >
            <c.icon className={`${c.color} shrink-0`} size={22} />
            <p className="text-2xl font-bold tabular-nums">{loading ? "…" : c.value}</p>
            <p className="text-xs text-neutral-500">{c.label}</p>
          </Link>
        ))}
      </div>

      {/* Today's queue */}
      <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Clock size={15} className="text-neutral-400" />
            Today&apos;s Queue
          </div>
          {canBill && (
            <div className="flex items-center gap-3 text-xs">
              <span>Collected today: <b className="tabular-nums text-emerald-700">Rs {money(totals.paid)}</b></span>
              <span>Still to collect: <b className="tabular-nums text-amber-700">Rs {money(totals.due)}</b></span>
            </div>
          )}
          <Link href="/clinic/appointments" className="text-xs text-blue-600 hover:underline">
            Manage →
          </Link>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-neutral-400">Loading…</p>
        ) : appointments.length === 0 ? (
          <p className="px-5 py-6 text-sm text-neutral-400">No appointments scheduled for today.</p>
        ) : (
          <div className="divide-y divide-neutral-50">
            {appointments.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-xs font-semibold text-neutral-600 shrink-0">
                  {a.token_no ?? <Users size={13} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{a.patient_name}</p>
                  {a.doctor_name && <p className="text-xs text-neutral-400 truncate">Dr. {a.doctor_name}</p>}
                </div>
                {a.time && <span className="text-xs text-neutral-400 shrink-0">{a.time}</span>}
                {canBill && bills.get(a.id) && (() => {
                  const b = bills.get(a.id)!;
                  return (
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      {b.billed > 0 && (
                        <button type="button" onClick={() => setInvoiceId(b.invoiceIds[b.invoiceIds.length - 1])} className="tabular-nums text-neutral-600 hover:underline" title="Open the invoice">
                          Billed Rs {money(b.billed)}{b.balance > 0 ? ` · owes Rs ${money(b.balance)}` : " · paid"}
                        </button>
                      )}
                      {b.due > 0 && (b.consultationId
                        ? <Button variant="primary" onClick={() => void collect(b)}><Receipt size={13} />Collect Rs {money(b.due)}</Button>
                        : <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600" title="Billed once the doctor starts the consultation">Fee Rs {money(b.due)}</span>)}
                    </div>
                  );
                })()}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[a.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                  {a.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {billing && (
        <BillModal bill={billing} onClose={() => setBilling(null)} onBilled={(id) => { setBilling(null); setInvoiceId(id); setReloadKey((k) => k + 1); }} />
      )}
      {invoiceId && <ClinicVisitInvoiceModal invoiceId={invoiceId} onClose={() => setInvoiceId(null)} />}
    </div>
  );
}
