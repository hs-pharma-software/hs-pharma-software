"use client";

import { useEffect, useState } from "react";
import { STORES, STORE_ROLES, staffStores, type StoreId } from "@/config/hospitalStores";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { saveHospitalStaff, nextEmployeeId } from "@/lib/repo/hospitalOpd";
import { hospitalDepartmentsRepo, type HospitalDepartment } from "@/lib/repo/hospital";
import { createStaffLogin, linkStaffLogin, listLinkableLogins } from "@/lib/hospitalLogins";
import { listCollectionCenters } from "@/lib/repo/labReports";
import type { CollectionCenter } from "@/lib/types-hospital";
import { LICENSE_LABEL, designation as findDesignation, designationsFor, extraRoles } from "@/config/hospitalStaff";
import { businessType } from "@/config/businessTypes";
import { useAuthStore } from "@/store/authStore";
import { localDate } from "@/lib/localDate";
import type { Staff } from "@/lib/types";

/** Hospital HR staff form: designation drives the licence field (PMDC / PNC /
 * licence), the automatic employee id and, optionally, a login with the
 * pages of that role. */
export function HospitalStaffFormModal({ staff, onClose, onSaved }: { staff: Staff | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = Boolean(staff);
  const designations = designationsFor(businessType(useAuthStore((s) => s.currentTenant?.businessType)).id);
  const [category, setCategory] = useState(staff?.staff_category ?? "");
  const [otherTitle, setOtherTitle] = useState(staff?.staff_category === "other" ? staff?.designation ?? "" : "");
  // Other roles of the same person (a ward nurse who is also the infection control nurse).
  const [extra, setExtra] = useState<string[]>(() => extraRoles(staff?.extra_roles));
  // Store keepers / purchase officers: all stores or chosen ones (they see only those).
  const [allStores, setAllStores] = useState(() => { try { return (JSON.parse(staff?.stores ?? "[]") as string[]).includes("all"); } catch { return false; } });
  const [stores, setStores] = useState<StoreId[]>(() => staffStores(staff?.stores));
  const worksInStores = [category, ...extra].some((r) => STORE_ROLES.includes(r));
  const [name, setName] = useState(staff?.name ?? "");
  const [licenseNo, setLicenseNo] = useState(staff?.license_no ?? "");
  const [department, setDepartment] = useState(staff?.department ?? "");
  const [specialization, setSpecialization] = useState(staff?.specialization ?? "");
  const [fee, setFee] = useState(String(staff?.consultation_fee ?? 0));
  const [docShare, setDocShare] = useState(staff?.consultation_doctor_share != null ? String(staff.consultation_doctor_share) : "");
  const [qualification, setQualification] = useState(staff?.qualification ?? "");
  const [address, setAddress] = useState(staff?.address ?? "");
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [cnic, setCnic] = useState(staff?.cnic ?? "");
  const [openingBalance, setOpeningBalance] = useState(String(staff?.opening_balance ?? 0));
  const [basicPay, setBasicPay] = useState(String(staff?.basic_pay ?? 0));
  const [dateOfJoining, setDateOfJoining] = useState(staff?.date_of_joining ?? localDate());
  const [makeLogin, setMakeLogin] = useState(false);
  /** A new login, or one that already exists (made under Settings > User Logins). */
  const [loginMode, setLoginMode] = useState<"new" | "link">("new");
  const [linkable, setLinkable] = useState<{ id: string; username: string; display_name: string | null }[]>([]);
  const [linkUserId, setLinkUserId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [employeeId, setEmployeeId] = useState(staff?.employee_id ?? "");
  const [departments, setDepartments] = useState<HospitalDepartment[]>([]);
  const [centers, setCenters] = useState<CollectionCenter[]>([]);
  const [centerId, setCenterId] = useState(staff?.collection_center_id ?? "");
  const [saving, setSaving] = useState(false);

  const d = findDesignation(category);
  const hasLogin = Boolean(staff?.user_id);

  useEffect(() => {
    void hospitalDepartmentsRepo.list({ orderBy: "name ASC" }).then((all) => setDepartments(all.filter((x) => x.is_active)));
    void listCollectionCenters().then(setCenters).catch(() => setCenters([]));
    void listLinkableLogins().then(setLinkable).catch(() => setLinkable([]));
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
        ...(extra.length || staff?.extra_roles ? { extra_roles: JSON.stringify(extra.filter((k) => k !== category)) } : {}),
        ...(worksInStores || staff?.stores ? { stores: worksInStores ? JSON.stringify(allStores ? ["all"] : stores) : null } : {}),
        license_no: licenseNo,
        department: department || null,
        collection_center_id: centerId || null,
        specialization,
        consultation_fee: Number(fee) || 0,
        // Only once set, so staff still save before the v97 database update.
        ...(docShare.trim() || staff?.consultation_doctor_share != null ? { consultation_doctor_share: docShare.trim() ? Number(docShare) : null } : {}),
        ...(qualification.trim() || staff?.qualification ? { qualification: qualification.trim() || null } : {}),
        address: address || null,
        phone: phone || null,
        cnic: cnic || null,
        opening_balance: Number(openingBalance) || 0,
        balance_type: "payable",
        basic_pay: Number(basicPay) || 0,
        date_of_joining: dateOfJoining || null,
      });
      if (makeLogin && !hasLogin) {
        if (loginMode === "link") {
          if (!linkUserId) throw new Error("Choose the login to link.");
          await linkStaffLogin(saved.id, linkUserId);
        } else {
          await createStaffLogin(saved.id, username, password);
        }
      }
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
              {designations.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </Select>
          </Field>
          <Field label="Employee ID (automatic)">
            <Input value={employeeId} readOnly tabIndex={-1} placeholder="Choose a designation" className="bg-neutral-50 font-mono text-neutral-500" />
          </Field>
          {category && (
            <details className="sm:col-span-2 rounded-xl bg-neutral-50 px-3 py-2 ring-1 ring-black/[0.04]" open={extra.length > 0}>
              <summary className="cursor-pointer text-xs font-semibold text-neutral-700">
                Also works as{extra.length ? `: ${extra.map((k) => findDesignation(k)?.label ?? k).join(", ")}` : " (other roles, optional)"}
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                {designations.filter((x) => x.key !== category && x.key !== "other").map((x) => (
                  <label key={x.key} className="flex items-center gap-2">
                    <input type="checkbox" checked={extra.includes(x.key)} onChange={(e) => setExtra((p) => (e.target.checked ? [...p, x.key] : p.filter((k) => k !== x.key)))} />
                    {x.label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">The login opens the pages of every role, and can do what each role does.</p>
            </details>
          )}
          {worksInStores && (
            <div className="sm:col-span-2 rounded-xl bg-amber-50/60 px-3 py-2 ring-1 ring-amber-100">
              <p className="text-xs font-semibold text-neutral-700">Stores this person works in</p>
              <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={allStores} onChange={(e) => setAllStores(e.target.checked)} />All stores</label>
              {!allStores && (
                <div className="mt-1 grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
                  {STORES.map((st) => (
                    <label key={st.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={stores.includes(st.id)} onChange={(e) => setStores((p) => (e.target.checked ? [...p, st.id] : p.filter((k) => k !== st.id)))} />{st.label}
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-neutral-500">Their login shows only these stores.</p>
            </div>
          )}
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
          <Field label="Works at">
            <Select value={centerId} onChange={(e) => setCenterId(e.target.value)}>
              <option value="">Hospital</option>
              {centers.map((c) => <option key={c.id} value={c.id}>{c.name} (collection center)</option>)}
            </Select>
          </Field>
          {d?.doctor && (
            <>
              <Field label="Qualification (printed on prescriptions)">
                <Input value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. MBBS, FCPS (Medicine)" />
              </Field>
              <Field label="Specialization">
                <Input value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="e.g. Neurology" />
              </Field>
              <Field label="OPD consultation fee (Rs)">
                <Input type="number" min="0" step="any" value={fee} onChange={(e) => setFee(e.target.value)} />
              </Field>
              <Field label="Doctor share of the fee (Rs)">
                <Input type="number" min="0" step="any" value={docShare} onChange={(e) => setDocShare(e.target.value)} placeholder="e.g. 1500" />
                <span className="text-[11px] text-neutral-500">Hospital share: Rs {Math.max(0, (Number(fee) || 0) - (Number(docShare) || 0)).toFixed(0)}{(Number(docShare) || 0) > (Number(fee) || 0) ? " (the doctor's share is more than the fee)" : ""}</span>
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
                  <div className="flex gap-4 text-sm text-neutral-700 sm:col-span-2">
                    <label className="flex items-center gap-1.5"><input type="radio" checked={loginMode === "new"} onChange={() => setLoginMode("new")} /> New login</label>
                    <label className="flex items-center gap-1.5"><input type="radio" checked={loginMode === "link"} onChange={() => setLoginMode("link")} /> Link an existing login</label>
                  </div>
                  {loginMode === "link" ? (
                    <div className="sm:col-span-2">
                      <Field label="Login" required>
                        <Select value={linkUserId} onChange={(e) => setLinkUserId(e.target.value)} required>
                          <option value="">{linkable.length ? "— Choose a login —" : "No unlinked staff login"}</option>
                          {linkable.map((u) => <option key={u.id} value={u.id}>{u.username}{u.display_name ? ` (${u.display_name})` : ""}</option>)}
                        </Select>
                      </Field>
                    </div>
                  ) : (
                    <>
                      <Field label="Username" required><Input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" /></Field>
                      <Field label="Password" required><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" /></Field>
                    </>
                  )}
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
