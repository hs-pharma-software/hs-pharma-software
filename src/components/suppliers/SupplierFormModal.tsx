"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { useAuthStore } from "@/store/authStore";
import { saveVendor } from "@/lib/repo/vendors";
import { Button } from "@/components/ui/Button";
import { suppliersRepo } from "@/lib/repo/suppliers";
import type { Supplier } from "@/lib/types";
import { FormError } from "@/components/ui/FormError";

export function SupplierFormModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(supplier);
  const [name, setName] = useState(supplier?.name ?? "");
  const [companyName, setCompanyName] = useState(supplier?.company_name ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [cnic, setCnic] = useState(supplier?.cnic ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [discountPct, setDiscountPct] = useState(String(supplier?.discount_pct ?? 0));
  const [openingBalance, setOpeningBalance] = useState(String(supplier?.opening_balance ?? 0));
  const [description, setDescription] = useState(supplier?.description ?? "");
  const [saving, setSaving] = useState(false);
  // Hospitals: Supplier & Vendors, each with its vendor number and bank details for payment.
  const hospital = useAuthStore((st) => st.currentTenant?.businessType) === "hospital";
  const [kind, setKind] = useState<"supplier" | "vendor" | "both">(supplier?.party_kind ?? "supplier");
  const [proprietor, setProprietor] = useState(supplier?.proprietor ?? "");
  const [bankName, setBankName] = useState(supplier?.bank_name ?? "");
  const [bankTitle, setBankTitle] = useState(supplier?.bank_title ?? "");
  const [iban, setIban] = useState(supplier?.iban ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (hospital) {
        await saveVendor(supplier?.id ?? null, {
          name, company_name: companyName, email, cnic, phone, address, discount_pct: Number(discountPct) || 0, opening_balance: Number(openingBalance) || 0,
          description, party_kind: kind, proprietor, bank_name: bankName, bank_title: bankTitle, iban,
        });
        onSaved();
        return;
      }
      const payload = {
        name: name.trim(),
        company_name: companyName || null,
        email: email || null,
        cnic: cnic || null,
        phone: phone || null,
        address: address || null,
        discount_pct: Number(discountPct) || 0,
        opening_balance: Number(openingBalance) || 0,
        balance_type: "payable" as const,
        description: description || null,
      };
      if (isEdit && supplier) {
        await suppliersRepo.update(supplier.id, payload);
      } else {
        await suppliersRepo.create(payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={hospital ? (isEdit ? `Edit Supplier / Vendor${supplier?.vendor_no ? ` · ${supplier.vendor_no}` : ""}` : "Add Supplier / Vendor") : isEdit ? "Edit Supplier" : "Add Supplier"} onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Company Name">
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          <div className="col-span-2 sm:col-span-1">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <Field label="CNIC">
            <Input value={cnic} onChange={(e) => setCnic(e.target.value)} />
          </Field>
          <Field label="Phone No">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <div className="col-span-2 sm:col-span-1">
            <Field label="Address">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          <Field label="Discount %">
            <Input type="number" min="0" step="any" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
          </Field>
          <Field label="Opening Balance" required>
            <Input type="number" step="any" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} required />
          </Field>
        </div>
        {hospital && (
          <div className="grid grid-cols-1 gap-3 rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04] sm:grid-cols-2">
            <Field label="Type">
              <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="supplier">Supplier (goods)</option><option value="vendor">Vendor (services)</option><option value="both">Both</option>
              </Select>
            </Field>
            <Field label="Proprietor"><Input value={proprietor} onChange={(e) => setProprietor(e.target.value)} /></Field>
            <Field label="Bank name"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Meezan Bank" /></Field>
            <Field label="Account title"><Input value={bankTitle} onChange={(e) => setBankTitle(e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="IBAN number"><Input value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} placeholder="PK36SCBL0000001123456702" /></Field></div>
          </div>
        )}
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <FormError message={error} />
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Reset
          </Button>
          <Button loading={saving} type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
