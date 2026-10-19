"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { staffRepo } from "@/lib/repo/staff";
import type { Staff } from "@/lib/types";

export function StaffFormModal({
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !designation.trim()) return;
    setSaving(true);
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
      if (isEdit && staff) {
        await staffRepo.update(staff.id, payload);
      } else {
        await staffRepo.create(payload);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "-:Edit Staff:-" : "-:Add Staff:-"} onClose={onClose} width="max-w-2xl">
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
