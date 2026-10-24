"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { saveHospitalStaff, nextEmployeeId } from "@/lib/repo/hospitalOpd";
import { hospitalDepartmentsRepo, type HospitalDepartment } from "@/lib/repo/hospital";
import { createStaffLogin } from "@/lib/hospitalLogins";
import { DESIGNATIONS, LICENSE_LABEL, designation as findDesignation } from "@/config/hospitalStaff";
import { localDate } from "@/lib/localDate";
import type { Staff } from "@/lib/types";

/** Hospital HR staff form: designation drives the licence field (PMDC / PNC /
 * licence), the automatic employee id and, optionally, a login with the
 * pages of that role. */
export function HospitalStaffFormModal({ staff, onClose, onSaved }: { staff: Staff | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = Boolean(staff);
  const [category, setCategory] = useState(staff?.staff_category ?? "");
  const [otherTitle, setOtherTitle] = useState(staff?.staff_category === "other" ? staff?.designation ?? "" : "");
  const [name, setName] = useState(staff?.name ?? "");
  const [licenseNo, setLicenseNo] = useState(staff?.license_no ?? "");
  const [department, setDepartment] = useState(staff?.department ?? "");
  const [specialization, setSpecialization] = useState(staff?.specialization ?? "");
  const [fee, setFee] = useState(String(staff?.consultation_fee ?? 0));
  const [address, setAddress] = useState(staff?.address ?? "");
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [cnic, setCnic] = useState(staff?.cnic ?? "");
  const [openingBalance, setOpeningBalance] = useState(String(staff?.opening_balance ?? 0));
  const [basicPay, setBasicPay] = useState(String(staff?.basic_pay ?? 0));
  const [dateOfJoining, setDateOfJoining] = useState(staff?.date_of_joining ?? localDate());
  const [makeLogin, setMakeLogin] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [employeeId, setEmployeeId] = useState(staff?.employee_id ?? "");
  const [departments, setDepartments] = useState<HospitalDepartment[]>([]);
  const [saving, setSaving] = useState(false);

  const d = findDesignation(category);
  const hasLogin = Boolean(staff?.user_id);

  useEffect(() => {
    void hospitalDepartmentsRepo.list({ orderBy: "name ASC" }).then((all) => setDepartments(all.filter((x) => x.is_active)));
  }, []);

  // Preview the id the designation will get (kept when editing within the same designation).
  useEffect(() => {
    if (!category) return setEmployeeId("");
    if (staff && staff.staff_category === category && staff.employee_id) return setEmployeeId(staff.employee_id);
    void nextEmployeeId(category).then(setEmployeeId).catch(() => setEmployeeId(""));
  }, [category, staff]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveHospitalStaff(staff?.id ?? null, {
        name,
        staff_category: category,
        designation: category === "other" ? otherTitle : undefined,
        license_no: licenseNo,
        department: department || null,
        specialization,
        consultation_fee: Number(fee) || 0,
        address: address || null,
        phone: phone || null,
        cnic: cnic || null,
        opening_balance: Number(openingBalance) || 0,
        balance_type: "payable",
        basic_pay: Number(basicPay) || 0,
        date_of_joining: dateOfJoining || null,
      });
      if (makeLogin && !hasLogin) await createStaffLogin(saved.id, username, password);
      onSaved();
    } catch (err) {
      window.alert(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Staff" : "Add Staff"} onClose={onClose} width="max-w-2xl">
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Designation" required>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="">— Select designation —</option>
              {DESIGNATIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </Select>
          </Field>
          <Field label="Employee ID (automatic)">
            <Input value={employeeId} readOnly tabIndex={-1} placeholder="Choose a designation" className="bg-neutral-50 font-mono text-neutral-500" />
          </Field>
          {category === "other" && (
            <Field label="Job title">
              <Input value={otherTitle} onChange={(e) => setOtherTitle(e.target.value)} placeholder="e.g. Ward Boy" />
            </Field>
          )}
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          {d?.license && (
            <Field label={LICENSE_LABEL[d.license]} required={d.licenseRequired}>
              <Input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} required={d.licenseRequired}
                placeholder={d.license === "PMDC" ? "Pakistan Medical & Dental Council registration" : d.license === "PNC" ? "Pakistan Nursing Council registration" : "Professional licence number"} />
            </Field>
          )}
          <Field label="Department">
            <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">— None —</option>
              {departments.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
              {department && !departments.some((x) => x.name === department) && <option value={department}>{department}</option>}
            </Select>
          </Field>
          {d?.doctor && (
            <>
              <Field label="Specialization">
                <Input value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="e.g. Neurology" />
              </Field>
              <Field label="OPD consultation fee (Rs)">
                <Input type="number" min="0" step="any" value={fee} onChange={(e) => setFee(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Phone No"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="CNIC"><Input value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="XXXXX-XXXXXXX-X" /></Field>
          <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="Date Of Joining"><Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} /></Field>
          <Field label="Opening Balance"><Input type="number" step="any" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} /></Field>
          <Field label="Basic Pay" required><Input type="number" min="0" step="any" value={basicPay} onChange={(e) => setBasicPay(e.target.value)} required /></Field>
        </div>

        <div className="rounded-xl border border-neutral-200 p-3">
          {hasLogin ? (
            <p className="text-sm text-emerald-700">This staff member has a login. Manage it in Settings &rsaquo; User Logins.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                <input type="checkbox" checked={makeLogin} onChange={(e) => setMakeLogin(e.target.checked)} />
                Give this staff member a login
              </label>
              {makeLogin && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Username" required><Input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" /></Field>
                  <Field label="Password" required><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" /></Field>
                  <p className="text-xs text-neutral-500 sm:col-span-2">
                    {d ? (d.pages === null ? "Opens every section." : `Opens only what a ${d.label} needs.`) : "Choose a designation to see what this login can open."}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
