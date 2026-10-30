"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { listAppointments, appointmentsRepo, type AppointmentWithNames } from "@/lib/repo/clinic";
import AppointmentFormModal from "./AppointmentFormModal";
import { AppointmentSlipModal } from "@/components/clinic/AppointmentSlipModal";
import { localDate } from "@/lib/localDate";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  arrived: "bg-amber-100 text-amber-700",
  in_consultation: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-neutral-100 text-neutral-500",
  no_show: "bg-red-100 text-red-600",
};

const TYPE_LABELS: Record<string, string> = {
  routine: "Routine",
  follow_up: "Follow-up",
  emergency: "Emergency",
};

export default function AppointmentsPage() {
  const router = useRouter();
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const [appointments, setAppointments] = useState<AppointmentWithNames[]>([]);
  const [dateFilter, setDateFilter] = useState(localDate());
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentWithNames | null>(null);
  const [slip, setSlip] = useState<AppointmentWithNames | null>(null);
  const tauriReady = useIsTauri();

  async function reload() {
    if (!isTauri()) return;
    setAppointments(await listAppointments({ date: dateFilter || undefined }));
  }

  useEffect(() => { void reload(); }, [tenantId, dateFilter]);

  const filtered = appointments.filter((a) => {
    const t = search.toLowerCase();
    return !t || a.patient_name.toLowerCase().includes(t) || (a.doctor_name ?? "").toLowerCase().includes(t);
  });

  async function updateStatus(id: string, status: string) {
    if (!isTauri()) return;
    await appointmentsRepo.update(id, { status: status as AppointmentWithNames["status"] });
    void reload();
  }

  const columns: Column<AppointmentWithNames>[] = [
    { header: "#", render: (a) => <span className="tabular-nums text-neutral-500">{a.token_no ?? "—"}</span> },
    { header: "Patient", render: (a) => <span className="font-medium">{a.patient_name}</span> },
    { header: "Doctor", render: (a) => a.doctor_name ? `Dr. ${a.doctor_name}` : "—" },
    { header: "Date", render: (a) => a.date },
    { header: "Time", render: (a) => a.time ?? "—" },
    { header: "Type", render: (a) => <span className="text-xs text-neutral-600">{TYPE_LABELS[a.type] ?? a.type}</span> },
    {
      header: "Status",
      render: (a) => (
        <select
          value={a.status}
          onChange={(e) => void updateStatus(a.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer ${STATUS_COLORS[a.status] ?? ""}`}
        >
          {["scheduled", "arrived", "in_consultation", "completed", "cancelled", "no_show"].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
      ),
    },
    {
      header: "",
      render: (a) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {a.status !== "cancelled" && a.status !== "no_show" && (
            <Button variant="ghost" onClick={() => router.push(`/clinic/consultations/new?appointment=${a.id}`)}>Consult</Button>
          )}
          <Button variant="ghost" onClick={() => setSlip(a)}>Slip</Button>
          <Button variant="ghost" onClick={() => { setEditing(a); setModalOpen(true); }}>Edit</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Appointments"
        actions={
          <>
            <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>Book Appointment</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-40" />
        <Button variant="ghost" onClick={() => setDateFilter(localDate())}>Today</Button>
        <Input placeholder="Search patient or doctor…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>
      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <DataTable columns={columns} rows={filtered} emptyMessage="No appointments found." onRowClick={(a) => { setEditing(a); setModalOpen(true); }} />
      )}
      {slip && <AppointmentSlipModal appointment={slip} onClose={() => setSlip(null)} />}
      {modalOpen && (
        <AppointmentFormModal
          appointment={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); void reload(); }}
        />
      )}
    </div>
  );
}
