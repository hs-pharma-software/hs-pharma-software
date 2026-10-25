"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { localDate } from "@/lib/localDate";
import { hospitalDepartmentsRepo, type HospitalService } from "@/lib/repo/hospital";
import { admitFromVisit, listSurgeryTypes } from "@/lib/repo/hospitalCare";
import { listHospitalDoctors } from "@/lib/repo/hospitalOpd";
import { parseBreakdown, EMPTY_BREAKDOWN } from "@/config/surgeryCharges";
import { SurgeryChargesFields, draftFrom, draftToBreakdown, draftTotal, type ChargeDraft } from "@/components/hospital/SurgeryChargesFields";
import type { HospitalEpisode } from "@/lib/types-hospital";
import type { Staff } from "@/lib/types";

/** Admit the patient of an OPD or emergency visit to a department, as IPD or
 * for surgery. The admission then waits for that department's Head Nurse
 * (or the Nursing Superintendent) to confirm it in Admission Requests. */
export function AdmitModal({ episode, onClose, onDone }: { episode: HospitalEpisode; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(episode.diagnosis ?? "");
  const [plan, setPlan] = useState<"ipd" | "surgery">("ipd");
  const [department, setDepartment] = useState(episode.department ?? "");
  const [wardRoom, setWardRoom] = useState("");
  const [bedNo, setBedNo] = useState("");
  const [surgeryId, setSurgeryId] = useState("");
  const [plannedDate, setPlannedDate] = useState(localDate());
  const [surgeonId, setSurgeonId] = useState(episode.doctor_id ?? "");
  const [charges, setCharges] = useState<ChargeDraft>(() => draftFrom(EMPTY_BREAKDOWN));
  const [surgeries, setSurgeries] = useState<HospitalService[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listSurgeryTypes().then(setSurgeries).catch(() => setSurgeries([]));
    void hospitalDepartmentsRepo.list({ orderBy: "name ASC" }).then((ds) => setDepartments(ds.filter((d) => d.is_active).map((d) => d.name))).catch(() => setDepartments([]));
    void listHospitalDoctors().then(setDoctors).catch(() => setDoctors([]));
  }, []);

  const deptOptions = department && !departments.includes(department) ? [department, ...departments] : departments;

  async function save() {
    setSaving(true);
    try {
      await admitFromVisit({
        fromEpisodeId: episode.id, reason, plan, department: department || null, wardRoom, bedNo,
        surgeryTypeId: plan === "surgery" ? surgeryId : null,
        plannedDate: plan === "surgery" ? plannedDate || null : null,
        surgeonId: plan === "surgery" ? surgeonId || null : null,
        charges: plan === "surgery" ? draftToBreakdown(charges) : null,
      });
      onDone();
    } catch (e) {
      window.alert(`Could not admit: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={episode.type === "emergency" ? "Admit / refer to a department" : "Admit patient"} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Reason / details *">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the patient is being admitted" autoFocus />
        </Field>
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600">Plan</p>
          <div className="flex gap-2">
            {(["ipd", "surgery"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPlan(p)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium ${plan === p ? "border-amber-500 bg-amber-50 text-amber-800" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"}`}>
                {p === "ipd" ? "IPD (ward admission)" : "Surgery"}
              </button>
            ))}
          </div>
        </div>
        {plan === "surgery" && (
          <div className="grid grid-cols-1 gap-3 rounded-xl bg-neutral-50 p-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Type of surgery *">
                <Select value={surgeryId} onChange={(e) => {
                  setSurgeryId(e.target.value);
                  const s = surgeries.find((x) => x.id === e.target.value);
                  setCharges(draftFrom(s ? parseBreakdown(s.fee_breakdown, s.rate) : EMPTY_BREAKDOWN));
                  if (s?.department && departments.includes(s.department)) setDepartment(s.department);
                }}>
                  <option value="">{surgeries.length ? "— Choose the surgery —" : "No surgeries yet (the admin adds them in Surgery)"}</option>
                  {surgeries.map((s) => <option key={s.id} value={s.id}>{s.name}{s.department ? ` · ${s.department}` : ""} · Rs {Number(s.rate).toLocaleString()}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Planned date"><Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} /></Field>
            <Field label="Surgeon">
              <Select value={surgeonId} onChange={(e) => setSurgeonId(e.target.value)}>
                <option value="">— Not decided —</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.designation ? ` · ${d.designation}` : ""}</option>)}
              </Select>
            </Field>
            {surgeryId && (
              <div className="md:col-span-2">
                <p className="mb-2 text-xs font-semibold text-neutral-700">Charges for this patient <span className="font-normal text-neutral-500">(each a line on the surgery invoice)</span></p>
                <SurgeryChargesFields idPrefix="admit" value={charges} onChange={setCharges} />
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Department">
            <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">—</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Ward / room"><Input value={wardRoom} onChange={(e) => setWardRoom(e.target.value)} placeholder="e.g. Surgical ward" /></Field>
          <Field label="Bed no"><Input value={bedNo} onChange={(e) => setBedNo(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !reason.trim() || (plan === "surgery" && (!surgeryId || !(draftTotal(charges) > 0)))}>
            {saving ? "Admitting…" : "Admit"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Where the admission made from a visit stands: waiting for the department's
 * Head Nurse, accepted (with ward / bed), or not accepted (then it can be made again). */
export function AdmissionBadge({ admission, declined }: { admission: HospitalEpisode | null; declined: HospitalEpisode | null }) {
  if (admission) {
    const pending = admission.admission_status === "pending";
    return (
      <span className={`self-center rounded-full px-2.5 py-1 text-xs font-medium ${pending ? "bg-amber-100 text-amber-800" : "bg-violet-100 text-violet-700"}`}
        title={pending ? `Waiting for the Head Nurse of ${admission.department ?? "the department"} to confirm` : undefined}>
        {pending
          ? `Awaiting Head Nurse · ${admission.episode_no} · ${admission.department ?? ""}`
          : `Admitted · ${admission.episode_no}${admission.room_ward ? ` · ${admission.room_ward}${admission.bed_no ? ` bed ${admission.bed_no}` : ""}` : ""}`}
      </span>
    );
  }
  if (declined) return <span className="self-center text-xs text-rose-600">Not accepted by {declined.department ?? "the department"}</span>;
  return null;
}
