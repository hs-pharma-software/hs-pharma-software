"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { isTauri } from "@/lib/platform";
import { hospitalEpisodesRepo, hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import { getPatientHistory, type HistoryVisit } from "@/lib/repo/hospitalCare";
import { listForms, roleAllowed, currentActor } from "@/lib/repo/medicalRecord";
import { formDef } from "@/config/forms";
import { FormEditor, FormStatusPill, fmtWhen } from "@/components/hospital/record/FormEditor";
import type { FormRecord, HospitalEpisode } from "@/lib/types-hospital";

const TYPE: Record<string, { label: string; cls: string }> = {
  opd: { label: "OPD", cls: "bg-blue-100 text-blue-700" },
  ipd: { label: "Admission", cls: "bg-purple-100 text-purple-700" },
  emergency: { label: "Emergency", cls: "bg-red-100 text-red-700" },
};
const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

/** One patient's medical record: every visit and admission kept separate, with
 * its notes, forms, prescriptions, verified lab results, radiology and surgery
 * from the modules that hold them. Nothing here is a copy. */
export default function PatientRecordPage() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id")), []);
  const [patient, setPatient] = useState<HospitalPatient | null>(null);
  const [visits, setVisits] = useState<HistoryVisit[]>([]);
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [open, setOpen] = useState<{ record: FormRecord; episode: HospitalEpisode | null; canFinalize: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!isTauri() || !id) return;
    try {
      const p = await hospitalPatientsRepo.get(id);
      if (!p) throw new Error("Patient not found in this hospital.");
      setPatient(p);
      const [v, f] = await Promise.all([getPatientHistory(id, null, 200), listForms({ patientId: id, includeVoided: true })]);
      setVisits(v);
      setForms(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openForm(record: FormRecord) {
    const def = formDef(record.form_key);
    if (!def) return;
    const [episode, actor] = await Promise.all([record.episode_id ? hospitalEpisodesRepo.get(record.episode_id) : Promise.resolve(null), currentActor()]);
    setOpen({ record, episode, canFinalize: roleAllowed(def.finalizeRoles, actor) });
  }

  if (error) return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  if (!patient) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;

  const line = (label: string, value: string | null | undefined) => value?.trim()
    ? <p className="text-xs"><span className="font-medium text-neutral-500">{label}: </span><span className="whitespace-pre-line">{value}</span></p> : null;

  return (
    <div>
      <PageHeader title={`Medical record · ${patient.name}`} />
      <div className={`${card} mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4`}>
        <div><p className="text-xs text-neutral-400">MR No</p><p className="font-mono">{patient.mr_no}</p></div>
        <div><p className="text-xs text-neutral-400">Age / sex</p><p>{[patient.age_years != null ? `${patient.age_years} y` : null, patient.gender].filter(Boolean).join(" / ") || "—"}</p></div>
        <div><p className="text-xs text-neutral-400">Blood group</p><p>{patient.blood_group ?? "—"}</p></div>
        <div><p className="text-xs text-neutral-400">Allergies</p><p className={patient.allergies ? "font-medium text-rose-600" : ""}>{patient.allergies ?? "None recorded"}</p></div>
        <div><p className="text-xs text-neutral-400">Phone</p><p>{patient.phone ?? "—"}</p></div>
        <div><p className="text-xs text-neutral-400">CNIC</p><p>{patient.cnic ?? "—"}</p></div>
        <div><p className="text-xs text-neutral-400">Visits and admissions</p><p className="tabular-nums">{visits.length}</p></div>
        <div><p className="text-xs text-neutral-400">Forms</p><p className="tabular-nums">{forms.filter((f) => f.status !== "voided").length}</p></div>
      </div>

      {visits.length === 0 && <p className="text-sm text-neutral-400">No visits yet.</p>}
      <div className="flex flex-col gap-4">
        {visits.map((v) => {
          const ep = v.episode;
          const own = forms.filter((f) => f.episode_id === ep.id);
          return (
            <section key={ep.id} className={card}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE[ep.type]?.cls ?? ""}`}>{TYPE[ep.type]?.label ?? ep.type}</span>
                  <a href={`/hospital/episodes/view?id=${ep.id}`} className="font-mono text-sm font-semibold hover:underline">{ep.episode_no}</a>
                  <span className="text-sm text-neutral-600">{ep.date}{ep.discharge_date ? ` → ${ep.discharge_date}` : ""}</span>
                  <span className="text-xs text-neutral-400">{ep.status}</span>
                </div>
                <p className="text-xs text-neutral-500">{[v.doctorName, ep.department, ep.room_ward && `Ward ${ep.room_ward}`, ep.bed_no && `bed ${ep.bed_no}`].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-1">
                  {line("Complaint", ep.complaint)}
                  {line("Diagnosis", ep.diagnosis)}
                  {line("Examination", ep.findings)}
                  {line("Advice", ep.advice)}
                  {v.prescriptions.length > 0 && line("Prescription", v.prescriptions.map((r) => [r.product_name, r.dose, r.frequency, r.duration && `${r.duration} days`].filter(Boolean).join(" ")).join("; "))}
                  {v.labs.length > 0 && line("Lab (verified)", v.labs.map((l) => `${l.test_name} ${l.result_value ?? ""} ${l.unit ?? ""}${l.flag && l.flag !== "N" ? ` (${l.flag})` : ""}`).join("; "))}
                  {v.pendingLabs.length > 0 && line("Lab pending", v.pendingLabs.join(", "))}
                  {v.imaging.length > 0 && line("Radiology", v.imaging.map((r) => `${r.modality}${r.body_part ? ` ${r.body_part}` : ""}: ${r.impression ?? r.findings ?? ""}`).join("; "))}
                  {v.surgeries.length > 0 && line("Surgery", v.surgeries.map((s) => `${s.surgery_name} (${s.status})`).join("; "))}
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-neutral-600">Forms</p>
                  {own.length === 0 ? <p className="text-xs text-neutral-400">None.</p> : (
                    <ul className="flex flex-col gap-1">
                      {own.map((f) => (
                        <li key={f.id}>
                          <button type="button" onClick={() => void openForm(f)} className="flex w-full flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-neutral-50">
                            <span className="font-medium text-neutral-800">{formDef(f.form_key)?.title ?? f.form_key}</span>
                            <FormStatusPill status={f.status} />
                            <span className="text-neutral-500">{fmtWhen(f.created_at)} · {f.created_by_name}</span>
                            {f.summary && <span className="min-w-0 flex-1 truncate text-neutral-600">{f.summary}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
      {open && (
        <FormEditor formKey={open.record.form_key} patient={patient} episode={open.episode} record={open.record} canFinalize={open.canFinalize}
          onClose={() => setOpen(null)} onSaved={() => void load()} />
      )}
    </div>
  );
}
