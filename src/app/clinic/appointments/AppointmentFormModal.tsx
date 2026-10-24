"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { appointmentsRepo, patientsRepo, doctorsRepo } from "@/lib/repo/clinic";
import type { AppointmentWithNames } from "@/lib/repo/clinic";
import type { ClinicPatient, ClinicDoctor } from "@/lib/types-clinic";
import { isTauri } from "@/lib/platform";

export default function AppointmentFormModal({
  appointment,
  onClose,
  onSaved,
}: {
  appointment: AppointmentWithNames | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(appointment);
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [doctors, setDoctors] = useState<ClinicDoctor[]>([]);
  const [patientId, setPatientId] = useState(appointment?.patient_id ?? "");
  const [doctorId, setDoctorId] = useState(appointment?.doctor_id ?? "");
  const [date, setDate] = useState(appointment?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(appointment?.time ?? "");
  const [tokenNo, setTokenNo] = useState(String(appointment?.token_no ?? ""));
  const [status, setStatus] = useState<AppointmentWithNames["status"]>(appointment?.status ?? "scheduled");
  const [type, setType] = useState<AppointmentWithNames["type"]>(appointment?.type ?? "routine");
  const [reason, setReason] = useState(appointment?.reason ?? "");
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void patientsRepo.list({ orderBy: "name ASC" }).then(setPatients);
    void doctorsRepo.list({ orderBy: "name ASC" }).then(setDoctors);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!patientId || !date) return;
    setSaving(true);
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId || null,
        date,
        time: time || null,
        token_no: tokenNo ? Number(tokenNo) : null,
        status: status as AppointmentWithNames["status"],
        type: type as AppointmentWithNames["type"],
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      };
      if (isEdit && appointment) {
        await appointmentsRepo.update(appointment.id, payload);
      } else {
        await appointmentsRepo.create(payload);
      }
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Appointment" : "Book Appointment"} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Patient *">
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)} required>
              <option value="">— Select Patient —</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}{p.mrn ? ` (${p.mrn})` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Doctor">
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">— Any / Walk-in —</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.name}{d.specialization ? ` — ${d.specialization}` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Date *">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Time">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Token No">
            <Input type="number" min="1" value={tokenNo} onChange={(e) => setTokenNo(e.target.value)} placeholder="Queue token" />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as AppointmentWithNames["type"])}>
              <option value="routine">Routine</option>
              <option value="follow_up">Follow-up</option>
              <option value="emergency">Emergency</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as AppointmentWithNames["status"])}>
              <option value="scheduled">Scheduled</option>
              <option value="arrived">Arrived</option>
              <option value="in_consultation">In Consultation</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No Show</option>
            </Select>
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Chief complaint / reason for visit" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : isEdit ? "Update" : "Book"}</Button>
        </div>
      </form>
    </Modal>
  );
}
