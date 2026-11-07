"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { subscriptionPlansRepo, parseAllowedModules } from "@/lib/repo/subscriptionPlans";
import { NAV } from "@/config/nav";
import type { SubscriptionPlan } from "@/lib/types2";
import { BUSINESS_TYPES } from "@/config/businessTypes";

export function SubscriptionPlanFormModal({
  plan,
  onClose,
  onSaved,
  onDeleted,
}: {
  plan: SubscriptionPlan | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
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
  // On the website's pricing page.
  const listFrom = (raw: string | null | undefined): string[] => { try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
  const [types, setTypes] = useState<Set<string>>(new Set(listFrom(plan?.business_types)));
  const [graceDays, setGraceDays] = useState(String(plan?.grace_days ?? 7));
  const [isPublic, setIsPublic] = useState(plan?.is_public === 1);
  const [tagline, setTagline] = useState(plan?.tagline ?? "");
  const [features, setFeatures] = useState(listFrom(plan?.features).join("\n"));
  const [sortOrder, setSortOrder] = useState(String(plan?.sort_order ?? 0));
  const [webPages, setWebPages] = useState(plan?.web_max_pages != null ? String(plan.web_max_pages) : "");
  const [webStorage, setWebStorage] = useState(plan?.web_max_storage_mb != null ? String(plan.web_max_storage_mb) : "");
  const [webDomains, setWebDomains] = useState(plan?.web_max_custom_domains != null ? String(plan.web_max_custom_domains) : "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        business_types: types.size ? JSON.stringify([...types]) : null,
        grace_days: Math.max(0, Math.min(365, Math.round(Number(graceDays) || 0))),
        is_public: isPublic ? 1 : 0,
        tagline: tagline.trim() || null,
        features: JSON.stringify(features.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 20)),
        sort_order: Math.round(Number(sortOrder) || 0),
        web_max_pages: webPages === "" ? null : Math.max(0, Math.round(Number(webPages))),
        web_max_storage_mb: webStorage === "" ? null : Math.max(0, Math.round(Number(webStorage))),
        web_max_custom_domains: webDomains === "" ? null : Math.max(0, Math.round(Number(webDomains))),
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
    <Modal title={isEdit ? "Edit Subscription Plan" : "Add Subscription Plan"} onClose={onClose} width="max-w-2xl">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Grace period (days)">
            <Input type="number" min="0" max="365" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
          </Field>
          <Field label="Website pages">
            <Input type="number" min="0" placeholder="Default 20" value={webPages} onChange={(e) => setWebPages(e.target.value)} />
          </Field>
          <Field label="Image storage (MB)">
            <Input type="number" min="0" placeholder="Default 200" value={webStorage} onChange={(e) => setWebStorage(e.target.value)} />
          </Field>
          <Field label="Custom domains">
            <Input type="number" min="0" placeholder="Default 3" value={webDomains} onChange={(e) => setWebDomains(e.target.value)} />
          </Field>
        </div>
        <p className="-mt-1 text-[11px] text-neutral-500">After the plan ends, the business keeps working for the grace period (with a reminder), then access pauses if &quot;Lock after grace period&quot; is on.</p>
        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-600">For business types <span className="font-normal text-neutral-400">(none ticked = every type)</span></p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-neutral-200 p-3 sm:grid-cols-3">
            {BUSINESS_TYPES.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5 text-sm text-neutral-700">
                <input type="checkbox" checked={types.has(t.id)} onChange={() => setTypes((prev) => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} />
                {t.label}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Show on the website&apos;s pricing page
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Tagline">
              <Input value={tagline} maxLength={140} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. For a single pharmacy getting started" />
            </Field>
            <Field label="Order">
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </Field>
          </div>
          <Field label="What's included (one per line)">
            <Textarea rows={4} value={features} onChange={(e) => setFeatures(e.target.value)} placeholder={"Billing, stock and reports\n2 staff logins\nFBR Digital Invoicing setup"} />
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
        <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
          {/* Delete \u2014 only shown when editing an existing plan */}
          {isEdit && plan && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-rose-600">Sure?</span>
                <Button
                  type="button"
                  variant="danger"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await subscriptionPlansRepo.remove(plan.id, "Deleted by admin");
                      onDeleted?.();
                      onClose();
                    } finally {
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? "Deleting..." : "Yes, Delete"}
                </Button>
                <Button type="button" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )
          )}
          {!isEdit && <span />}

          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>Reset</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
