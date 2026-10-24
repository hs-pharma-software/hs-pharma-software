"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { doctorsRepo } from "@/lib/repo/clinic";
import type { ClinicDoctor } from "@/lib/types-clinic";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function DoctorFormModal({
  doctor,
  onClose,
  onSaved,
}: {
  doctor: ClinicDoctor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(doctor);
  const [name, setName] = useState(doctor?.name ?? "");
  const [specialization, setSpecialization] = useState(doctor?.specialization ?? "");
  const [qualification, setQualification] = useState(doctor?.qualification ?? "");
  const [phone, setPhone] = useState(doctor?.phone ?? "");
  const [email, setEmail] = useState(doctor?.email ?? "");
  const [consultFee, setConsultFee] = useState(String(doctor?.consultation_fee ?? 0));
  const [followUpFee, setFollowUpFee] = useState(String(doctor?.follow_up_fee ?? 0));
  const [followUpDays, setFollowUpDays] = useState(String(doctor?.follow_up_days ?? 14));
  const [slotMinutes, setSlotMinutes] = useState(String(doctor?.slot_minutes ?? 15));
  const parsedDays = (): string[] => {
    try { return JSON.parse(doctor?.available_days ?? "[]") as string[]; } catch { return []; }
  };
  const [availDays, setAvailDays] = useState<string[]>(parsedDays());
  const [notes, setNotes] = useState(doctor?.notes ?? "");
  const [saving, setSaving] = useState(false);

  function toggleDay(day: string) {
    setAvailDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        specialization: specialization.trim() || null,
        qualification: qualification.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        consultation_fee: Number(consultFee) || 0,
        follow_up_fee: Number(followUpFee) || 0,
        follow_up_days: Number(followUpDays) || 14,
        slot_minutes: Number(slotMinutes) || 15,
        available_days: JSON.stringify(availDays),
        notes: notes.trim() || null,
      };
      if (isEdit && doctor) {
        await doctorsRepo.update(doctor.id, payload);
      } else {
        await doctorsRepo.create(payload);
      }
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Doctor" : "Add Doctor"} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Full Name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Doctor's name (without Dr.)" required />
          </Field>
          <Field label="Specialization">
            <Input value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="e.g. General Physician" />
          </Field>
          <Field label="Qualification">
            <Input value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. MBBS, FCPS" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Consultation Fee (Rs)">
            <Input type="number" min="0" step="1" value={consultFee} onChange={(e) => setConsultFee(e.target.value)} />
          </Field>
          <Field label="Follow-up Fee (Rs)">
            <Input type="number" min="0" step="1" value={followUpFee} onChange={(e) => setFollowUpFee(e.target.value)} />
          </Field>
          <Field label="Follow-up Window (days)">
            <Input type="number" min="1" value={followUpDays} onChange={(e) => setFollowUpDays(e.target.value)} />
          </Field>
          <Field label="Slot Duration (min)">
            <Input type="number" min="5" step="5" value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)} />
          </Field>
          <div className="md:col-span-2">
          <Field label="Available Days">
            <div className="flex gap-2 flex-wrap mt-1">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${availDays.includes(d) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-neutral-600 border-neutral-300 hover:border-blue-400"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : isEdit ? "Update" : "Add Doctor"}</Button>
        </div>
      </form>
    </Modal>
  );
}
