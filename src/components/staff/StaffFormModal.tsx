"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { staffRepo, saveStaffWithLogin } from "@/lib/repo/staff";
import { listUsersForTenant } from "@/lib/repo/users";
import { isTauri } from "@/lib/platform";
import type { UserAccount } from "@/lib/types2";
import type { Staff } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { HospitalStaffFormModal } from "./HospitalStaffFormModal";

export function StaffFormModal({
  staff,
  onClose,
  onSaved,
}: {
  staff: Staff | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isHospital = useAuthStore((st) => businessType(st.currentTenant?.businessType).id === "hospital");
  if (isHospital) return <HospitalStaffFormModal staff={staff} onClose={onClose} onSaved={onSaved} />;
  return <GeneralStaffForm staff={staff} onClose={onClose} onSaved={onSaved} />;
}

function GeneralStaffForm({
  staff,
  onClose,
  onSaved,
}: {
  staff: Staff | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(staff);
  const [name, setName] = useState(staff?.name ?? "");
  const [designation, setDesignation] = useState(staff?.designation ?? "");
  const [address, setAddress] = useState(staff?.address ?? "");
  const [openingBalance, setOpeningBalance] = useState(String(staff?.opening_balance ?? 0));
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [cnic, setCnic] = useState(staff?.cnic ?? "");
  const [basicPay, setBasicPay] = useState(String(staff?.basic_pay ?? 0));
  const [dateOfJoining, setDateOfJoining] = useState(
    staff?.date_of_joining ?? new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The login this staff member uses (one staff member per login).
  const [userId, setUserId] = useState(staff?.user_id ?? "");
  const [logins, setLogins] = useState<UserAccount[]>([]);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const tenantId = useAuthStore((st) => st.currentTenant?.id ?? null);

  useEffect(() => {
    if (!isTauri() || !tenantId) return;
    void listUsersForTenant(tenantId).then((u) => setLogins(u.filter((x) => x.role !== "super_admin"))).catch(() => setLogins([]));
    void staffRepo.list({ where: "user_id IS NOT NULL" })
      .then((rows) => setTaken(new Set(rows.filter((r) => r.id !== staff?.id && r.user_id).map((r) => r.user_id as string))))
      .catch(() => setTaken(new Set()));
  }, [tenantId, staff?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !designation.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        designation: designation.trim(),
        address: address || null,
        opening_balance: Number(openingBalance) || 0,
        balance_type: "payable" as const,
        phone: phone || null,
        cnic: cnic || null,
        basic_pay: Number(basicPay) || 0,
        date_of_joining: dateOfJoining || null,
      };
      await saveStaffWithLogin(isEdit && staff ? staff.id : null, payload, userId || null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Staff" : "Add Staff"} onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Designation" required>
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Date Of Joining">
            <Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Phone No">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="CNIC">
            <Input value={cnic} onChange={(e) => setCnic(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Opening Balance">
            <Input type="number" step="any" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
          </Field>
          <Field label="Basic Pay" required>
            <Input type="number" min="0" step="any" value={basicPay} onChange={(e) => setBasicPay(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Login (user)">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">— Not linked —</option>
              {logins.filter((u) => u.id === userId || (u.is_active && !taken.has(u.id))).map((u) => (
                <option key={u.id} value={u.id}>{u.display_name ? `${u.display_name} (${u.username})` : u.username}{u.role === "owner" ? " - owner" : ""}</option>
              ))}
            </Select>
          </Field>
          <p className="self-end pb-2 text-xs text-neutral-500">The login this person signs in with. Their name and designation then show on what they record.</p>
        </div>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>
            Reset
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
