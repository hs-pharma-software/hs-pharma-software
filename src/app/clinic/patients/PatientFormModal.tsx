"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { patientsRepo } from "@/lib/repo/clinic";
import type { ClinicPatient } from "@/lib/types-clinic";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export default function PatientFormModal({
  patient,
  onClose,
  onSaved,
}: {
  patient: ClinicPatient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(patient);
  const [name, setName] = useState(patient?.name ?? "");
  const [mrn, setMrn] = useState(patient?.mrn ?? "");
  const [dob, setDob] = useState(patient?.dob ?? "");
  const [gender, setGender] = useState(patient?.gender ?? "");
  const [phone, setPhone] = useState(patient?.phone ?? "");
  const [address, setAddress] = useState(patient?.address ?? "");
  const [bloodGroup, setBloodGroup] = useState(patient?.blood_group ?? "");
  const [allergies, setAllergies] = useState(patient?.allergies ?? "");
  const [emergencyContact, setEmergencyContact] = useState(patient?.emergency_contact ?? "");
  const [notes, setNotes] = useState(patient?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        mrn: mrn.trim() || null,
        dob: dob || null,
        gender: gender || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        blood_group: bloodGroup || null,
        allergies: allergies.trim() || null,
        emergency_contact: emergencyContact.trim() || null,
        notes: notes.trim() || null,
      };
      if (isEdit && patient) {
        await patientsRepo.update(patient.id, payload);
      } else {
        await patientsRepo.create(payload);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Patient" : "Add Patient"} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Full Name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Patient name" required />
          </Field>
          <Field label="MRN">
            <Input value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="Medical record number" />
          </Field>
          <Field label="Date of Birth">
            <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </Field>
          <Field label="Gender">
            <Select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">— Select —</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </Select>
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Contact number" />
          </Field>
          <Field label="Blood Group">
            <Select value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
              <option value="">— Select —</option>
              {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Allergies">
              <Input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="Known allergies (e.g. Penicillin, Aspirin)" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Emergency Contact">
              <Input value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} placeholder="Name & phone of emergency contact" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Additional notes" />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : isEdit ? "Update" : "Add Patient"}</Button>
        </div>
      </form>
    </Modal>
  );
}
