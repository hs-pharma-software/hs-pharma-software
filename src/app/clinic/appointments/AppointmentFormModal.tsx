"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ClinicPatientPicker } from "@/components/clinic/ClinicPatientPicker";
import { saveAppointment, patientsRepo, doctorsRepo, nextAppointmentToken } from "@/lib/repo/clinic";
import type { AppointmentWithNames } from "@/lib/repo/clinic";
import type { ClinicPatient, ClinicDoctor } from "@/lib/types-clinic";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";

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
  const [date, setDate] = useState(appointment?.date ?? localDate());
  const [time, setTime] = useState(appointment?.time ?? "");
  // Given automatically: the next token of the chosen doctor on the chosen day.
  const [tokenNo, setTokenNo] = useState<number | null>(appointment?.token_no ?? null);
  const [status, setStatus] = useState<AppointmentWithNames["status"]>(appointment?.status ?? "scheduled");
  const [type, setType] = useState<AppointmentWithNames["type"]>(appointment?.type ?? "routine");
  const [reason, setReason] = useState(appointment?.reason ?? "");
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void patientsRepo.list({ orderBy: "name ASC" }).then(setPatients);
    void doctorsRepo.list({ orderBy: "name ASC" }).then((list) => {
      setDoctors(list);
      // Only one doctor: pick him for a new appointment.
      if (!appointment && list.length === 1) setDoctorId((cur) => cur || list[0].id);
    });
  }, [appointment]);

  // The token the appointment will get (kept when editing without changing doctor or day).
  useEffect(() => {
    if (!isTauri() || !doctorId || !date) { setTokenNo(null); return; }
    if (appointment && appointment.doctor_id === doctorId && appointment.date === date && appointment.token_no != null) {
      setTokenNo(appointment.token_no);
      return;
    }
    let live = true;
    void nextAppointmentToken(doctorId, date, appointment?.id).then((n) => { if (live) setTokenNo(n); }).catch(() => undefined);
    return () => { live = false; };
  }, [doctorId, date, appointment]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!patientId || !doctorId || !date || saving) return;
    setSaving(true);
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId,
        date,
        time: time || null,
        token_no: tokenNo,
        status: status as AppointmentWithNames["status"],
        type: type as AppointmentWithNames["type"],
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      };
      await saveAppointment(isEdit && appointment ? appointment.id : null, payload);
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
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Patient *</span>
            <ClinicPatientPicker patients={patients} value={patientId} onChange={setPatientId} onRegistered={(p) => setPatients((x) => [p, ...x])} />
          </div>
          <Field label="Doctor" required>
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required>
              <option value="" disabled>— Select doctor —</option>
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
            <Input value={tokenNo ?? ""} readOnly placeholder={doctorId ? "…" : "Choose the doctor"} title="Given automatically: the doctor's next token for that day" className="bg-neutral-50 font-semibold tabular-nums" />
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
