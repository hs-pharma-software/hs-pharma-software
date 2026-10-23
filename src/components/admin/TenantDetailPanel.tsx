"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { PrintTemplatesModal } from "@/components/print/PrintTemplatesModal";
import { tenantsRepo } from "@/lib/repo/tenants";
import { tenantAllowedModules } from "@/lib/auth";
import { parseAllowedModules } from "@/lib/repo/subscriptionPlans";
import { ACTION_PERMISSIONS, parseDeniedActions } from "@/lib/actionPermissions";
import { PAPERS, loadDefaultPaper, saveDefaultPaper, type PaperSize } from "@/lib/printTemplates";
import { NAV } from "@/config/nav";
import type { SubscriptionPlan, Tenant } from "@/lib/types2";
import {
  BUSINESS_TYPES,
  CAPABILITY_LABELS,
  FAMILY_LABELS,
  STATUS_LABELS,
  businessType,
  defaultModulesFor,
  moduleAllowedForType,
  type CapabilityKey,
} from "@/config/businessTypes";


function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      {hint && <p className="mb-2 text-[11px] text-neutral-400">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, onLabel, offLabel }: { on: boolean; onChange: (v: boolean) => void; onLabel: string; offLabel: string }) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5 text-xs">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 font-medium transition-colors ${
            on === v ? (v ? "bg-emerald-600 text-white" : "bg-rose-600 text-white") : "text-neutral-500 hover:text-neutral-800"
          }`}
        >
          {v ? onLabel : offLabel}
        </button>
      ))}
    </div>
  );
}

/** Super Admin view of one pharmacy: identity, plan and type, accessible
 * sections, tenant-wide permissions, FBR integration and print templates.
 * Used on Users (after picking a tenant) and Tenants (clicking a name). */
export function TenantDetailPanel({
  tenant,
  plans,
  onSaved,
  onEdit,
}: {
  tenant: Tenant;
  plans: SubscriptionPlan[];
  onSaved: () => void;
  onEdit?: () => void;
}) {
  const plan = (id: string) => plans.find((p) => p.id === id) ?? null;
  const [planId, setPlanId] = useState(tenant.subscription_plan_id ?? "");
  const [typeId, setTypeId] = useState(businessType(tenant.business_type).id);
  const [customModules, setCustomModules] = useState(!!tenant.allowed_modules);
  const [modules, setModules] = useState<string[]>(() => tenantAllowedModules(tenant, plan(tenant.subscription_plan_id ?? "")));
  const [denied, setDenied] = useState<string[]>(parseDeniedActions(tenant.denied_actions));
  const [fbrAllowed, setFbrAllowed] = useState(tenant.fbr_allowed !== 0);
  const [templatesEditable, setTemplatesEditable] = useState(tenant.print_templates_editable !== 0);
  const [paper, setPaper] = useState<PaperSize>("a4");
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void loadDefaultPaper(tenant.id).then(setPaper);
  }, [tenant.id]);

  const type = businessType(typeId);
  const selectedPlan = plan(planId);
  const planModules = selectedPlan ? parseAllowedModules(selectedPlan) : [];
  const effectiveModules = customModules ? modules : planModules;

  function toggleModule(key: string) {
    if (!customModules) {
      setCustomModules(true);
      setModules(planModules.includes(key) ? planModules.filter((k) => k !== key) : [...planModules, key]);
      return;
    }
    setModules((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await tenantsRepo.update(tenant.id, {
        subscription_plan_id: planId || null,
        business_type: typeId,
        allowed_modules: customModules ? JSON.stringify(modules) : null,
        denied_actions: denied.length ? JSON.stringify(denied) : null,
        fbr_allowed: fbrAllowed ? 1 : 0,
        print_templates_editable: templatesEditable ? 1 : 0,
      });
      await saveDefaultPaper(paper, tenant.id);
      setMessage({ ok: true, text: "Saved. Applies to this pharmacy's logins on their next screen change." });
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const info = (label: string, value: React.ReactNode) => (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="text-sm font-medium text-neutral-800">{value || "—"}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-neutral-900">{tenant.name}</h2>
            <p className="text-xs text-neutral-500">{type.label}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                tenant.subscription_status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              {tenant.subscription_status}
            </span>
            {onEdit && <Button onClick={onEdit}>Edit Details</Button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {info("Owner Name", tenant.owner_name)}
          {info("Mobile No", tenant.phone)}
          {info("Email", tenant.email)}
          {info("Expires On", tenant.subscription_expires_at ? new Date(tenant.subscription_expires_at).toLocaleDateString() : null)}
          {tenant.address && <div className="col-span-2 sm:col-span-4">{info("Address", tenant.address)}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section title="Plan & Type">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Plan">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">No plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {(Object.keys(FAMILY_LABELS) as (keyof typeof FAMILY_LABELS)[]).map((fam) => (
                  <optgroup key={fam} label={FAMILY_LABELS[fam].label}>
                    {BUSINESS_TYPES.filter((t) => t.family === fam).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          </div>
          {selectedPlan && (
            <p className="mt-2 text-[11px] text-neutral-500">
              Up to {selectedPlan.max_staff_logins} sub user(s)
              {selectedPlan.max_invoices_per_month ? `, ${selectedPlan.max_invoices_per_month} invoices / month` : ", unlimited invoices"}
              , {selectedPlan.duration_days} days per renewal.
            </p>
          )}
          <div className="mt-3 rounded-lg bg-white p-2.5 ring-1 ring-neutral-200">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-neutral-800">{FAMILY_LABELS[type.family].label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_LABELS[type.status].cls}`}>
                {STATUS_LABELS[type.status].label}
              </span>
              <span className="rounded bg-[#006633] px-1.5 py-0.5 text-[10px] text-white">FBR DI ready</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(Object.keys(CAPABILITY_LABELS) as CapabilityKey[])
                .filter((cap) => cap !== "digitalInvoicing" && type.capabilities[cap] === "Core")
                .map((cap) => (
                  <span key={cap} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                    {CAPABILITY_LABELS[cap]}
                  </span>
                ))}
            </div>
            {type.planned.length > 0 && (
              <p className="mt-1.5 text-[11px] text-neutral-500">Still to build for this type: {type.planned.join(", ")}.</p>
            )}
          </div>
        </Section>

        <Section title="FBR Digital Integration">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Toggle on={fbrAllowed} onChange={setFbrAllowed} onLabel="Allowed" offLabel="Not Allowed" />
            <span className="text-[11px] text-neutral-500">
              {fbrAllowed
                ? "The pharmacy can set up FBR and submit invoices."
                : "FBR settings are hidden and no invoice is sent to FBR."}
            </span>
          </div>
        </Section>

        <Section
          title="Accessible Sections"
          hint={customModules ? "Custom list for this pharmacy." : "Following the plan. Tick or untick to customise."}
        >
          <div className="mb-2 flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setCustomModules(true);
                setModules(defaultModulesFor(type, planModules));
              }}
              className="text-sky-700 hover:underline"
            >
              Apply {type.label.split(" — ")[0]} defaults
            </button>
            {customModules && (
              <button type="button" onClick={() => setCustomModules(false)} className="text-amber-700 hover:underline">
                Reset to plan
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setCustomModules(true);
                setModules(NAV.map((n) => n.moduleKey));
              }}
              className="text-emerald-700 hover:underline"
            >
              Allow all
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {NAV.filter((item) => !item.onlyFor || item.onlyFor.includes(typeId)).map((item) => (
              <label key={item.moduleKey} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 hover:bg-white">
                <input
                  type="checkbox"
                  checked={effectiveModules.includes(item.moduleKey)}
                  onChange={() => toggleModule(item.moduleKey)}
                  className="accent-amber-500"
                />
                <span className="text-xs text-neutral-700">{item.label}</span>
              </label>
            ))}
          </div>
        </Section>

        <Section title="Permissions" hint="Applies to every login of this pharmacy, owner included.">
          {(["Invoices", "Purchases", "Restaurant"] as const)
            .filter((group) => {
              if (group === "Restaurant") return typeId === "restaurant";
              if (group === "Invoices") return moduleAllowedForType(typeId, "invoices");
              if (group === "Purchases") return moduleAllowedForType(typeId, "purchase");
              return true;
            })
            .map((group) => (
            <div key={group} className="mb-1.5 last:mb-0">
              <p className="mb-1 text-[11px] font-medium text-neutral-500">{group}</p>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {ACTION_PERMISSIONS.filter((a) => a.group === group).map((a) => (
                  <label key={a.key} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 hover:bg-white">
                    <input
                      type="checkbox"
                      checked={!denied.includes(a.key)}
                      onChange={() => setDenied((d) => (d.includes(a.key) ? d.filter((k) => k !== a.key) : [...d, a.key]))}
                      className="accent-amber-500"
                    />
                    <span className="text-xs text-neutral-700">{a.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </Section>

        <Section title="Print Templates" hint="Fixed: the pharmacy uses the templates you set here and can't change them.">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-600">Access</p>
              <Toggle on={templatesEditable} onChange={setTemplatesEditable} onLabel="Allow Editing" offLabel="Fixed" />
            </div>
            <div className="w-44">
              <Field label="Default Template">
                <Select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
                  {PAPERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button onClick={() => setEditorOpen(true)}>Edit Templates</Button>
          </div>
        </Section>
      </div>

      <div className="flex items-center justify-end gap-3">
        {message && <span className={`text-xs ${message.ok ? "text-emerald-600" : "text-rose-600"}`}>{message.text}</span>}
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      {editorOpen && <PrintTemplatesModal tenantId={tenant.id} onClose={() => setEditorOpen(false)} />}
    </div>
  );
}
