"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { customersRepo } from "@/lib/repo/customers";
import { can } from "@/lib/actionPermissions";
import type { Customer } from "@/lib/types";

/** The "+" next to a customer list on a bill: name, mobile and (owner, or
 * staff allowed to) whether this customer gets the extra discount. */
export function QuickCustomerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Customer) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [extra, setExtra] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mayExtra = can("customer.extra_discount");

  return (
    <Modal title="Add Customer" onClose={onClose} width="max-w-sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setSaving(true);
          setError(null);
          try {
            const created = await customersRepo.create({
              name: name.trim(), phone: phone.trim() || null, opening_balance: 0, balance_type: "receivable",
              // Only sent by those allowed to set it (the server refuses it from anyone else).
              ...(mayExtra ? { extra_discount: extra ? 1 : 0 } : {}),
            });
            onCreated(created);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Customer Name" required>
          <Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={120} />
        </Field>
        <Field label="Mobile Number">
          <Input id="qc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} placeholder="03xx-xxxxxxx" />
        </Field>
        {mayExtra ? (
          <label className="flex items-start gap-2 rounded-lg bg-neutral-50 p-2.5 text-sm">
            <input id="qc-extra" type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-neutral-800">Allow extra discount</span>
              <span className="block text-xs text-neutral-500">Shows an Extra Disc % on this customer&apos;s invoices and quotations, applied after the normal discount.</span>
            </span>
          </label>
        ) : (
          <p className="text-xs text-neutral-500">Extra discount for this customer can be turned on by the owner.</p>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
