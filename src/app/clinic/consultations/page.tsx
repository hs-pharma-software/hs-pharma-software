"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Stethoscope } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { localDate } from "@/lib/localDate";
import {
  listConsultations, listConsultQueue, myClinicDoctorId, doctorsRepo, appointmentsRepo,
  type ConsultationWithNames, type QueueRow,
} from "@/lib/repo/clinic";
import type { ClinicDoctor } from "@/lib/types-clinic";

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Waiting", cls: "bg-sky-100 text-sky-800" },
  arrived: { label: "Arrived", cls: "bg-amber-100 text-amber-800" },
  in_consultation: { label: "In consultation", cls: "bg-violet-100 text-violet-800" },
};

/** The doctor's screen: today's queue (patients booked for the day, the
 * doctor's own first) to consult, and the consultations written so far. */
export default function ConsultationsPage() {
  const router = useRouter();
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const [consultations, setConsultations] = useState<ConsultationWithNames[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [doctors, setDoctors] = useState<ClinicDoctor[]>([]);
  // "" = every doctor; set to the logged-in doctor when they are one.
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(localDate());
  const [search, setSearch] = useState("");
  const tauriReady = useIsTauri();

  async function reload() {
    if (!isTauri()) return;
    const [c, q] = await Promise.all([listConsultations(200), listConsultQueue(date)]);
    setConsultations(c);
    setQueue(q);
  }

  useEffect(() => {
    if (!isTauri()) return;
    void doctorsRepo.list({ orderBy: "name ASC" }).then(setDoctors).catch(() => setDoctors([]));
    void myClinicDoctorId().then((id) => { if (id) setDoctorId(id); }).catch(() => undefined);
  }, [tenantId]);

  useEffect(() => {
    void reload().catch((e) => window.alert(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => void reload().catch(() => undefined), 30_000);
    return () => clearInterval(t);
  }, [tenantId, date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function done(q: QueueRow) {
    try {
      await appointmentsRepo.update(q.id, { status: "completed" });
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  const shownQueue = queue.filter((q) => !doctorId || q.doctor_id === doctorId);
  const t = search.toLowerCase();
  const filtered = consultations.filter((c) =>
    (!doctorId || c.doctor_id === doctorId)
    && (!t || c.patient_name.toLowerCase().includes(t) || (c.doctor_name ?? "").toLowerCase().includes(t) || (c.diagnosis ?? "").toLowerCase().includes(t)));

  const columns: Column<ConsultationWithNames>[] = [
    { header: "Date", render: (c) => c.date },
    { header: "Patient", render: (c) => <span className="font-medium">{c.patient_name}</span> },
    { header: "Doctor", render: (c) => c.doctor_name ? `Dr. ${c.doctor_name}` : "—" },
    { header: "Complaint", render: (c) => <span className="block max-w-xs truncate text-xs text-neutral-600">{c.complaint ?? "—"}</span> },
    { header: "Diagnosis", render: (c) => <span className="block max-w-xs truncate text-xs text-neutral-700">{c.diagnosis ?? "—"}</span> },
    {
      header: "",
      render: (c) => (
        <Link href={`/clinic/consultations/view?id=${c.id}`}>
          <Button variant="ghost">Open</Button>
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Consultations"
        actions={
          <>
            <Link href="/clinic/consultations/new">
              <Button variant="primary">New Consultation</Button>
            </Link>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select id="cq-doctor" className="w-auto" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor">
          <option value="">All doctors</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}
        </Select>
        <Input id="cq-date" type="date" className="w-auto" value={date} onChange={(e) => setDate(e.target.value || localDate())} aria-label="Queue date" />
        {date !== localDate() && <Button variant="ghost" onClick={() => setDate(localDate())}>Today</Button>}
      </div>

      <section className="mb-5 rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <Stethoscope size={16} />{date === localDate() ? "Today's queue" : `Queue for ${date}`}
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{shownQueue.length}</span>
        </h2>
        {!tauriReady ? <p className="text-sm text-neutral-400">Loading…</p> : shownQueue.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No patients waiting{doctorId ? " for this doctor" : ""}. Appointments booked at reception for {date === localDate() ? "today" : "this day"} appear here.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-neutral-100">
            {shownQueue.map((q) => (
              <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-sm font-bold tabular-nums text-white">{q.token_no ?? "—"}</span>
                  <div>
                    <p className="font-medium text-neutral-900">{q.patient_name} <span className="text-xs font-normal text-neutral-500">{q.mrn ?? ""}</span></p>
                    <p className="text-xs text-neutral-500">
                      {q.doctor_name ? `Dr. ${q.doctor_name}` : "No doctor"}{q.time ? ` · ${q.time}` : ""} · {q.type.replace("_", "-")}{q.reason ? ` · ${q.reason}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[q.status]?.cls ?? ""}`}>{STATUS[q.status]?.label ?? q.status}</span>
                  {q.consultation_id ? (
                    <Button variant="secondary" onClick={() => router.push(`/clinic/consultations/view?id=${q.consultation_id}`)}>Continue</Button>
                  ) : (
                    <Button variant="primary" onClick={() => router.push(`/clinic/consultations/new?appointment=${q.id}`)}>Consult</Button>
                  )}
                  {q.consultation_id && (
                    <Button variant="ghost" title="Consultation finished" onClick={() => void done(q)}><CheckCircle2 size={14} />Done</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input placeholder="Search consultations by patient, doctor or diagnosis…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
      </div>
      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <DataTable columns={columns} rows={filtered} emptyMessage="No consultations yet. Start one from the queue above." />
      )}
    </div>
  );
}
