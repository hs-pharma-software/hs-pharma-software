"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { hospitalServicesRepo, type HospitalService } from "@/lib/repo/hospital";
import type { HospitalServiceCategory, HospitalServiceBillingUnit } from "@/lib/types-hospital";

interface Props {
  service: HospitalService | null;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: { value: HospitalServiceCategory; label: string }[] = [
  { value: "consultation", label: "Consultation" },
  { value: "procedure", label: "Procedure" },
  { value: "lab", label: "Lab / Pathology" },
  { value: "imaging", label: "Imaging / Radiology" },
  { value: "bed", label: "Bed / Room Charges" },
  { value: "nursing", label: "Nursing Care" },
  { value: "ot", label: "Operation Theatre" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "misc", label: "Miscellaneous" },
];

const BILLING_UNITS: { value: HospitalServiceBillingUnit; label: string }[] = [
  { value: "visit", label: "Per Visit" },
  { value: "day", label: "Per Day" },
  { value: "test", label: "Per Test" },
  { value: "procedure", label: "Per Procedure" },
  { value: "hour", label: "Per Hour" },
  { value: "unit", label: "Per Unit" },
];

export default function ServiceFormModal({ service, onClose, onSaved }: Props) {
  const isEdit = service !== null;
  const [code, setCode] = useState(service?.code ?? "");
  const [name, setName] = useState(service?.name ?? "");
  const [department, setDepartment] = useState(service?.department ?? "");
  const [category, setCategory] = useState<HospitalServiceCategory>(service?.category ?? "consultation");
  const [billingUnit, setBillingUnit] = useState<HospitalServiceBillingUnit>(service?.billing_unit ?? "visit");
  const [rate, setRate] = useState(String(service?.rate ?? ""));
  const [isActive, setIsActive] = useState(service ? Boolean(service.is_active) : true);
  const [notes, setNotes] = useState(service?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!code.trim() || !name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        department: department.trim() || "General",
        category,
        billing_unit: billingUnit,
        rate: Number(rate) || 0,
        is_active: isActive ? 1 : 0,
        notes: notes.trim() || null,
      };
      if (isEdit) {
        await hospitalServicesRepo.update(service.id, payload);
      } else {
        await hospitalServicesRepo.create(payload);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Service" : "Add Service"} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Field label="Service Code *">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CONS-OPD" autoFocus={!isEdit} />
        </Field>
        <Field label="Service Name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OPD Consultation" />
        </Field>
        <Field label="Department">
          <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. General Medicine, Surgery" />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as HospitalServiceCategory)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Billing Unit">
          <Select value={billingUnit} onChange={(e) => setBillingUnit(e.target.value as HospitalServiceBillingUnit)}>
            {BILLING_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </Select>
        </Field>
        <Field label="Standard Rate (Rs)">
          <Input type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !code.trim() || !name.trim()}>
          {saving ? "Saving…" : isEdit ? "Update" : "Add Service"}
        </Button>
      </div>
    </Modal>
  );
}
