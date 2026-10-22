"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { tenantsRepo } from "@/lib/repo/tenants";
import { createUser, AuthError } from "@/lib/auth";
import { nowIso } from "@/lib/id";
import type { Tenant, SubscriptionPlan } from "@/lib/types2";

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function TenantFormModal({
  tenant,
  plans,
  onClose,
  onSaved,
}: {
  tenant: Tenant | null;
  plans: SubscriptionPlan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(tenant);
  const [name, setName] = useState(tenant?.name ?? "");
  const [ownerName, setOwnerName] = useState(tenant?.owner_name ?? "");
  const [phone, setPhone] = useState(tenant?.phone ?? "");
  const [email, setEmail] = useState(tenant?.email ?? "");
  const [address, setAddress] = useState(tenant?.address ?? "");
  const [planId, setPlanId] = useState(tenant?.subscription_plan_id ?? plans[0]?.id ?? "");
  const [mrpDiscountPct, setMrpDiscountPct] = useState(String(tenant?.mrp_discount_pct ?? 0));
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !planId) return;
    setError(null);
    setSaving(true);
    try {
      const plan = plans.find((p) => p.id === planId) ?? null;
      const payload = {
        name: name.trim(),
        owner_name: ownerName || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        subscription_plan_id: planId,
        mrp_discount_pct: Number(mrpDiscountPct) || 0,
      };
      if (isEdit && tenant) {
        await tenantsRepo.update(tenant.id, payload);
      } else {
        if (!loginUsername.trim() || loginPassword.length < 4) {
          setError("Enter a login username and a password of at least 4 characters for the new tenant.");
          setSaving(false);
          return;
        }
        const created = await tenantsRepo.create({
          ...payload,
          subscription_status: "active",
          subscription_started_at: nowIso(),
          subscription_expires_at: addDaysIso(plan?.duration_days ?? 30),
          is_active: 1,
        });
        await createUser({
          username: loginUsername,
          password: loginPassword,
          role: "owner",
          tenantId: created.id,
          displayName: ownerName || null,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Tenant" : "Add Tenant"} onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Pharmacy Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Owner Name">
            <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Subscription Plan" required>
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
            <option value="">Select...</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          </Field>
          <Field label="MRP Discount % (dealer portal, 0 = none)">
            <Input type="number" min="0" max="100" step="0.1" value={mrpDiscountPct} onChange={(e) => setMrpDiscountPct(e.target.value)} />
          </Field>
        </div>

        {!isEdit && (
          <div className="rounded-xl border border-neutral-200 p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">First login for this pharmacy</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Username" required>
                <Input value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} required />
              </Field>
              <Field label="Password" required>
                <Input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required />
              </Field>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}
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
