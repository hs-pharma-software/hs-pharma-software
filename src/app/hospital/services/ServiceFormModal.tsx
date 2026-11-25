"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { hospitalDepartmentsRepo, hospitalServicesRepo, type HospitalService } from "@/lib/repo/hospital";
import type { HospitalServiceCategory, HospitalServiceBillingUnit } from "@/lib/types-hospital";
import { notify } from "@/lib/notify";

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
  const [doctorShare, setDoctorShare] = useState(service?.doctor_share != null ? String(service.doctor_share) : "");
  const [staffShare, setStaffShare] = useState(service?.staff_share != null ? String(service.staff_share) : "");
  // Lab and radiology: the doctor who performs (reports) it and the doctor who ordered it each have a share.
  const [orderingShare, setOrderingShare] = useState(service?.ordering_doctor_share != null ? String(service.ordering_doctor_share) : "");
  const investigation = category === "lab" || category === "imaging";
  const hospitalShare = (Number(rate) || 0) - (Number(doctorShare) || 0) - (Number(staffShare) || 0) - (investigation ? Number(orderingShare) || 0 : 0);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);

  useEffect(() => {
    void hospitalDepartmentsRepo.list({ orderBy: "name ASC" }).then((ds) => setDepartments(ds.filter((d) => d.is_active).map((d) => d.name))).catch(() => setDepartments([]));
  }, []);
  // A department typed in before the list existed stays selectable.
  const departmentOptions = department && !departments.includes(department) ? [department, ...departments] : departments;

  async function save() {
    if (!code.trim() || !name.trim()) { setTried(true); document.getElementById(!code.trim() ? "sv-code" : "sv-name")?.focus(); return; }
    if (hospitalShare < 0) { notify("The doctor's and staff's shares are more than the rate."); return; }
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
        // Only once set, so a service still saves before the v97 database update.
        ...(doctorShare.trim() || staffShare.trim() || service?.doctor_share != null || service?.staff_share != null
          ? { doctor_share: doctorShare.trim() ? Number(doctorShare) : null, staff_share: staffShare.trim() ? Number(staffShare) : null }
          : {}),
        ...(investigation && (orderingShare.trim() || service?.ordering_doctor_share != null)
          ? { ordering_doctor_share: orderingShare.trim() ? Number(orderingShare) : null }
          : !investigation && service?.ordering_doctor_share != null ? { ordering_doctor_share: null } : {}),
      };
      if (isEdit) {
        await hospitalServicesRepo.update(service.id, payload);
      } else {
        await hospitalServicesRepo.create(payload);
      }
      onSaved();
    } catch (e) {
      notify(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Service" : "Add Service"} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Field label="Service Code" required error={tried && !code.trim() ? "Enter a code, e.g. CONS-OPD" : undefined}>
          <Input id="sv-code" aria-invalid={(tried && !code.trim()) || undefined} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CONS-OPD" autoFocus={!isEdit} />
        </Field>
        <Field label="Service Name" required error={tried && !name.trim() ? "Enter the service's name" : undefined}>
          <Input id="sv-name" aria-invalid={(tried && !name.trim()) || undefined} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OPD Consultation" />
        </Field>
        <Field label="Department">
          <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">{departments.length ? "— Choose a department —" : "No departments yet (add them in Departments)"}</option>
            {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
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
        <div className="md:col-span-2 rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]">
          <p className="mb-2 text-xs font-semibold text-neutral-600">Charges breakdown (per unit)</p>
          <div className={`grid gap-2 ${investigation ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            <Field label={investigation ? "Performing doctor share (Rs)" : "Doctor share (Rs)"}><Input type="number" min="0" step="any" value={doctorShare} onChange={(e) => setDoctorShare(e.target.value)} placeholder="0" /></Field>
            {investigation && <Field label="Ordering doctor share (Rs)"><Input type="number" min="0" step="any" value={orderingShare} onChange={(e) => setOrderingShare(e.target.value)} placeholder="0" /></Field>}
            <Field label="Staff share (Rs)"><Input type="number" min="0" step="any" value={staffShare} onChange={(e) => setStaffShare(e.target.value)} placeholder="0" /></Field>
            <Field label="Hospital share (Rs)">
              <p className={`py-1.5 text-sm font-semibold tabular-nums ${hospitalShare < 0 ? "text-rose-700" : "text-neutral-800"}`}>{hospitalShare.toFixed(0)}</p>
            </Field>
          </div>
        </div>
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
        <Button loading={saving} variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Update" : "Add Service"}
        </Button>
      </div>
    </Modal>
  );
}
