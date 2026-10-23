"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { customersRepo } from "@/lib/repo/customers";
import type { Customer } from "@/lib/types";

const PAKISTAN_PROVINCES = [
  "AZAD JAMMU AND KASHMIR",
  "BALOCHISTAN",
  "CAPITAL TERRITORY",
  "GILGIT BALTISTAN",
  "KHYBER PAKHTUNKHWA",
  "PUNJAB",
  "SINDH",
] as const;

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
  const [ntn, setNtn] = useState(customer?.ntn ?? "");
  const [strn, setStrn] = useState(customer?.strn ?? "");
  const [registrationType, setRegistrationType] = useState(customer?.registration_type ?? "Individual");
  const [businessName, setBusinessName] = useState(customer?.business_name ?? "");
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
  const [salesTaxStatus, setSalesTaxStatus] = useState(customer?.sales_tax_status ?? "unknown");
  const [fbrActiveStatus, setFbrActiveStatus] = useState(customer?.fbr_active_status ?? "unknown");
  const [description, setDescription] = useState(customer?.description ?? "");
  const [saving, setSaving] = useState(false);

  const needsBusiness = registrationType === "Registered" || registrationType === "Unregistered";

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
        ntn: ntn || null,
        strn: strn || null,
        registration_type: registrationType || null,
        business_name: businessName || null,
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
        fbr_active_status: fbrActiveStatus || null,
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
    <Modal title={isEdit ? "Edit Customer" : "Add New Client"} onClose={onClose} width="max-w-3xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">

        {/* ── Identity ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Client Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Province">
            <Select value={province} onChange={(e) => setProvince(e.target.value)}>
              <option value="">Select Province</option>
              {PAKISTAN_PROVINCES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="CNIC Number">
            <Input
              value={cnicNtn}
              onChange={(e) => setCnicNtn(e.target.value.replace(/\D/g, "").slice(0, 13))}
              placeholder="1234567890123"
              maxLength={13}
            />
            <p className="mt-1 text-[11px] text-neutral-400">Exactly 13 digits</p>
          </Field>
          <Field label="NTN Number">
            <Input
              value={ntn}
              onChange={(e) => setNtn(e.target.value.slice(0, 8))}
              placeholder="9999997 or ABC12XY"
              maxLength={8}
            />
            <p className="mt-1 text-[11px] text-neutral-400">7 or 8 characters (alphanumeric)</p>
          </Field>
        </div>

        <Field label="STRN">
          <Input
            value={strn}
            onChange={(e) => setStrn(e.target.value.slice(0, 25))}
            placeholder="Optional identifier"
            maxLength={25}
          />
          <p className="mt-1 text-[11px] text-neutral-400">Max 25 characters (optional)</p>
        </Field>

        <Field label="Address">
          <Textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Registration Type">
            <Select value={registrationType} onChange={(e) => setRegistrationType(e.target.value)}>
              <option value="Individual">Individual</option>
              <option value="Registered">Registered Business</option>
              <option value="Unregistered">Unregistered Business</option>
            </Select>
          </Field>
          <Field label="Area">
            <Input value={area} onChange={(e) => setArea(e.target.value)} />
          </Field>
        </div>

        {/* ── FBR Configuration ── */}
        <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Info size={16} className="shrink-0 text-amber-600" />
            <h4 className="text-sm font-semibold text-neutral-800">FBR Configuration</h4>
          </div>
          <p className="mb-3 text-[11px] text-neutral-500">
            Required for FBR (Federal Board of Revenue) compliance and invoice submission.
          </p>

          <div className="flex flex-col gap-3">
            <Field label="Business Name (for Business Clients)">
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Enter business name if client is a business entity"
              />
              {needsBusiness && (
                <p className="mt-1 text-[11px] text-neutral-400">
                  Required for Registered / Unregistered business
                </p>
              )}
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="FBR Registration Status">
                <Select value={salesTaxStatus} onChange={(e) => setSalesTaxStatus(e.target.value)}>
                  <option value="unknown">Unknown</option>
                  <option value="registered">Registered</option>
                  <option value="unregistered">Unregistered</option>
                </Select>
                <p className="mt-1 text-[11px] text-neutral-400">Auto-updated when CNIC / NTN is entered</p>
              </Field>
              <Field label="FBR Active Status">
                <Select value={fbrActiveStatus} onChange={(e) => setFbrActiveStatus(e.target.value)}>
                  <option value="unknown">Unknown</option>
                  <option value="active">Active</option>
                  <option value="inactive">In-Active</option>
                </Select>
                <p className="mt-1 text-[11px] text-neutral-400">Auto-updated when CNIC / NTN is entered</p>
              </Field>
            </div>
          </div>
        </div>

        {/* ── Financial / accounting ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Opening Balance" required>
            <Input type="number" step="any" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} required />
          </Field>
          <Field label="Balance Type" required>
            <Select value={balanceType} onChange={(e) => setBalanceType(e.target.value)} required>
              <option value="receivable">Receivable</option>
              <option value="payable">Payable</option>
            </Select>
          </Field>
          <Field label="Credit Limit">
            <Input type="number" min="0" step="any" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Discount %">
            <Input type="number" min="0" step="any" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
          </Field>
          <Field label="Income Tax Status">
            <Select value={incomeTaxStatus} onChange={(e) => setIncomeTaxStatus(e.target.value)}>
              <option value="">{"—"}</option>
              <option value="filer">Filer</option>
              <option value="non-filer">Non-Filer</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="License #">
              <Input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} />
            </Field>
            <Field label="Expiry">
              <Input type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
            </Field>
          </div>
        </div>

        <Field label="Notes">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
