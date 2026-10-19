"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { subscriptionPlansRepo, parseAllowedModules } from "@/lib/repo/subscriptionPlans";
import { NAV } from "@/config/nav";
import type { SubscriptionPlan } from "@/lib/types2";

export function SubscriptionPlanFormModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: SubscriptionPlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(plan);
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [price, setPrice] = useState(String(plan?.price ?? 0));
  const [durationDays, setDurationDays] = useState(String(plan?.duration_days ?? 30));
  const [maxStaffLogins, setMaxStaffLogins] = useState(String(plan?.max_staff_logins ?? 1));
  const [maxInvoicesPerMonth, setMaxInvoicesPerMonth] = useState(
    plan?.max_invoices_per_month != null ? String(plan.max_invoices_per_month) : ""
  );
  const [modules, setModules] = useState<Set<string>>(new Set(plan ? parseAllowedModules(plan) : NAV.map((n) => n.moduleKey)));
  const [saving, setSaving] = useState(false);

  function toggleModule(key: string) {
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description || null,
        price: Number(price) || 0,
        duration_days: Number(durationDays) || 30,
        allowed_modules: JSON.stringify([...modules]),
        max_staff_logins: Number(maxStaffLogins) || 1,
        max_invoices_per_month: maxInvoicesPerMonth === "" ? null : Number(maxInvoicesPerMonth),
      };
      if (isEdit && plan) {
        await subscriptionPlansRepo.update(plan.id, payload);
      } else {
        await subscriptionPlansRepo.create(payload);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "-:Edit Subscription Plan:-" : "-:Add Subscription Plan:-"} onClose={onClose} width="max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Price">
            <Input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Duration (Days)" required>
            <Input
              type="number"
              min="1"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              required
            />
          </Field>
          <Field label="Max Staff Logins" required>
            <Input
              type="number"
              min="0"
              value={maxStaffLogins}
              onChange={(e) => setMaxStaffLogins(e.target.value)}
              required
            />
          </Field>
          <Field label="Max Invoices / Month">
            <Input
              type="number"
              min="0"
              placeholder="Unlimited"
              value={maxInvoicesPerMonth}
              onChange={(e) => setMaxInvoicesPerMonth(e.target.value)}
            />
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-600">Allowed Modules</p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-neutral-200 p-3 sm:grid-cols-3">
            {NAV.map((item) => (
              <label key={item.moduleKey} className="flex items-center gap-1.5 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={modules.has(item.moduleKey)}
                  onChange={() => toggleModule(item.moduleKey)}
                />
                {item.label}
              </label>
            ))}
          </div>
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
