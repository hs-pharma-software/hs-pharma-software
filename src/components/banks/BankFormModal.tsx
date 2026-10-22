"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { banksRepo } from "@/lib/repo/banks";
import type { Bank } from "@/lib/types2";

export function BankFormModal({
  bank,
  onClose,
  onSaved,
}: {
  bank: Bank | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(bank);
  const [name, setName] = useState(bank?.name ?? "");
  const [accountNo, setAccountNo] = useState(bank?.account_no ?? "");
  const [accountTitle, setAccountTitle] = useState(bank?.account_title ?? "");
  const [address, setAddress] = useState(bank?.address ?? "");
  const [phone, setPhone] = useState(bank?.phone ?? "");
  const [openingBalance, setOpeningBalance] = useState(String(bank?.opening_balance ?? 0));
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !accountNo.trim() || !accountTitle.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        account_no: accountNo.trim(),
        account_title: accountTitle.trim(),
        address: address || null,
        phone: phone || null,
        opening_balance: Number(openingBalance) || 0,
      };
      if (isEdit && bank) {
        await banksRepo.update(bank.id, payload);
      } else {
        await banksRepo.create(payload);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Bank" : "Add Bank"} onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label="Bank Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account #" required>
            <Input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} required />
          </Field>
          <Field label="Account Title" required>
            <Input value={accountTitle} onChange={(e) => setAccountTitle(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Phone No">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Opening Balance" required>
          <Input type="number" step="any" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} required />
        </Field>
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
