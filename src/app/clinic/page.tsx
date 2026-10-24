"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Stethoscope, UserRoundPlus, CalendarDays, FileHeart, Clock, Users } from "lucide-react";
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

  useEffect(() => {
    if (!isTauri() || !tenantId) return;
    setLoading(true);
    Promise.all([
      getClinicStats().catch(() => EMPTY_STATS),
      getTodayAppointments(20).catch(() => [] as TodayAppointmentRow[]),
    ]).then(([s, a]) => {
      setStats(s);
      setAppointments(a);
      setLoading(false);
    });
  }, [tenantId]);

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
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[a.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                  {a.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
