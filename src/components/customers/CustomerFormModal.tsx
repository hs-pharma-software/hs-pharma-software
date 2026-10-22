"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { customersRepo } from "@/lib/repo/customers";
import type { Customer } from "@/lib/types";

export function CustomerFormModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(customer);
  const [name, setName] = useState(customer?.name ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [cnicNtn, setCnicNtn] = useState(customer?.cnic_ntn ?? "");
  const [address, setAddress] = useState(customer?.address ?? "");
  const [area, setArea] = useState(customer?.area ?? "");
  const [province, setProvince] = useState(customer?.province ?? "");
  const [licenseNo, setLicenseNo] = useState(customer?.license_no ?? "");
  const [licenseExpiry, setLicenseExpiry] = useState(customer?.license_expiry ?? "");
  const [discountPct, setDiscountPct] = useState(String(customer?.discount_pct ?? 0));
  const [openingBalance, setOpeningBalance] = useState(String(customer?.opening_balance ?? 0));
  const [balanceType, setBalanceType] = useState<string>(customer?.balance_type ?? "receivable");
  const [creditLimit, setCreditLimit] = useState(String(customer?.credit_limit ?? ""));
  const [incomeTaxStatus, setIncomeTaxStatus] = useState(customer?.income_tax_status ?? "");
  const [salesTaxStatus, setSalesTaxStatus] = useState(customer?.sales_tax_status ?? "");
  const [description, setDescription] = useState(customer?.description ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        email: email || null,
        phone: phone || null,
        cnic_ntn: cnicNtn || null,
        address: address || null,
        area: area || null,
        province: province || null,
        license_no: licenseNo || null,
        license_expiry: licenseExpiry || null,
        discount_pct: Number(discountPct) || 0,
        opening_balance: Number(openingBalance) || 0,
        balance_type: balanceType as "receivable" | "payable",
        credit_limit: creditLimit ? Number(creditLimit) : null,
        income_tax_status: incomeTaxStatus || null,
        sales_tax_status: salesTaxStatus || null,
        description: description || null,
      };
      if (isEdit && customer) {
        await customersRepo.update(customer.id, payload);
      } else {
        await customersRepo.create(payload);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Customer" : "Add Customer"} onClose={onClose} width="max-w-3xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Customer Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone No">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="CNIC / NTN">
            <Input value={cnicNtn} onChange={(e) => setCnicNtn(e.target.value)} />
          </Field>
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Area">
            <Input value={area} onChange={(e) => setArea(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Province">
            <Input value={province} onChange={(e) => setProvince(e.target.value)} />
          </Field>
          <Field label="License #">
            <Input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} />
          </Field>
          <Field label="Expiry">
            <Input type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Discount %">
            <Input type="number" min="0" step="any" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
          </Field>
          <Field label="Opening Balance" required>
            <Input type="number" step="any" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} required />
          </Field>
          <Field label="Select Criteria" required>
            <Select value={balanceType} onChange={(e) => setBalanceType(e.target.value)} required>
              <option value="receivable">Receivable</option>
              <option value="payable">Payable</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Credit Limit">
            <Input type="number" min="0" step="any" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
          </Field>
          <Field label="Income Tax Status">
            <Select value={incomeTaxStatus} onChange={(e) => setIncomeTaxStatus(e.target.value)}>
              <option value="">{"\u2014"}</option>
              <option value="filer">Filer</option>
              <option value="non-filer">Non-Filer</option>
            </Select>
          </Field>
          <Field label="Sales Tax Status">
            <Select value={salesTaxStatus} onChange={(e) => setSalesTaxStatus(e.target.value)}>
              <option value="">{"\u2014"}</option>
              <option value="registered">Registered</option>
              <option value="unregistered">Unregistered</option>
            </Select>
          </Field>
        </div>

        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
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
