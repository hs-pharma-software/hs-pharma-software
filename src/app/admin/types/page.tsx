"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { tenantsRepo } from "@/lib/repo/tenants";
import { isTauri } from "@/lib/platform";
import { NAV } from "@/config/nav";
import {
  BUSINESS_TYPES,
  CAPABILITY_LABELS,
  FAMILY_LABELS,
  STATUS_LABELS,
  businessType,
  type BusinessTypeDef,
  type CapabilityKey,
  type EntryForm,
  type Family,
  type FieldRule,
  type Level,
} from "@/config/businessTypes";
import type { Tenant } from "@/lib/types2";

const RULE_CLS: Record<FieldRule, string> = {
  REQUIRED: "bg-rose-50 text-rose-700 ring-rose-200",
  OPTIONAL: "bg-neutral-50 text-neutral-600 ring-neutral-200",
  CONDITIONAL: "bg-amber-50 text-amber-800 ring-amber-200",
  "NOT APPLICABLE": "bg-neutral-100 text-neutral-400 ring-neutral-200",
};

const LEVEL_CLS: Record<Level, string> = {
  Core: "bg-emerald-600 text-white",
  Optional: "bg-amber-100 text-amber-800",
  "Not Required": "bg-neutral-100 text-neutral-400",
};

const CAPS = Object.keys(CAPABILITY_LABELS) as CapabilityKey[];
const FAMILIES: Family[] = ["pharmacy", "retail", "clinic", "hospital"];
type Tab = "overview" | "product" | "service" | "rules" | "tenants";

function LevelChip({ cap, level }: { cap: CapabilityKey; level: Level }) {
  // Every type can issue FBR digital invoices when the tenant needs it.
  if (cap === "digitalInvoicing") return <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#006633] text-white">Ready</span>;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_CLS[level]}`}>{level}</span>;
}

function FormTable({ form }: { form: EntryForm }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-black/[0.06]">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left">
            {["Field", "Rule", "Stored in", "Notes"].map((h) => (
              <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {form.fields.map((f) => (
            <tr key={f.label} className="border-b border-neutral-50 last:border-0">
              <td className="px-3 py-2 font-medium text-neutral-800">{f.label}</td>
              <td className="px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${RULE_CLS[f.rule]}`}>{f.rule}</span>
              </td>
              <td className="px-3 py-2 text-neutral-500">{f.level ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-neutral-500">{f.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-black/[0.06]">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-sm text-neutral-700">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function TypeDetail({ type, tenants, onBack }: { type: BusinessTypeDef; tenants: Tenant[]; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "overview", label: "Overview", show: true },
    { id: "product", label: type.family === "clinic" || type.id === "contractor" ? "Product Entry (optional)" : "Product Entry", show: !!type.productForm },
    { id: "service", label: "Service Entry", show: !!type.serviceForm },
    { id: "rules", label: "Rules & Workflow", show: true },
    { id: "tenants", label: `Tenants (${tenants.length})`, show: true },
  ];
  const navLabel = (k: string) => NAV.find((n) => n.moduleKey === k)?.label ?? k;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onBack}>
          <ArrowLeft size={14} /> All Types
        </Button>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{type.label}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_LABELS[type.status].cls}`}>{STATUS_LABELS[type.status].label}</span>
        <span className="text-xs text-neutral-400">{FAMILY_LABELS[type.family].label}</span>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${tab === t.id ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
            <p className="text-sm text-neutral-700">{type.purpose}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              {type.workflow.map((w, i) => (
                <span key={w} className="flex items-center gap-1.5">
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-700">{w}</span>
                  {i < type.workflow.length - 1 && <ChevronRight size={12} className="text-neutral-300" />}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl bg-white p-3 ring-1 ring-black/[0.06]">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Modules (basic version)</p>
              <div className="grid grid-cols-2 gap-1.5">
                {CAPS.map((cap) => (
                  <div key={cap} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-2 py-1">
                    <span className="text-xs text-neutral-700">{CAPABILITY_LABELS[cap]}</span>
                    <LevelChip cap={cap} level={type.capabilities[cap]} />
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl bg-white p-3 ring-1 ring-black/[0.06]">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Default sidebar sections for new tenants</p>
                <div className="flex flex-wrap gap-1">
                  {type.defaultModules.map((k) => (
                    <span key={k} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
                      {navLabel(k)}
                    </span>
                  ))}
                </div>
              </div>
              <List title="Type-specific modules still to build" items={type.planned} />
              <List title="Not applicable to this type" items={type.notApplicable} />
            </div>
          </div>
        </div>
      )}

      {tab === "product" && type.productForm && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-neutral-900">{type.productForm.title}</h2>
          <FormTable form={type.productForm} />
        </div>
      )}

      {tab === "service" && type.serviceForm && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-neutral-900">{type.serviceForm.title}</h2>
          <p className="text-xs text-neutral-500">Services are billed but never stocked: they live in the service master, not the product inventory.</p>
          <FormTable form={type.serviceForm} />
        </div>
      )}

      {tab === "rules" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <List title="Inventory & stock" items={type.inventoryRules} />
          <List title="Pricing & discounts" items={type.pricingRules} />
          <List title="Units & packaging" items={type.units} />
          <List title="Purchasing & suppliers" items={type.purchasing} />
          <List title="Billing, invoicing & payments" items={type.billing} />
          <List title="Reports" items={type.reports} />
          <List title="Validation rules" items={type.validations} />
          <List title="MVP" items={type.mvp} />
          <List title="Advanced" items={type.advanced} />
        </div>
      )}

      {tab === "tenants" && (
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          {tenants.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-400">No tenant uses this type yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {tenants.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <span className="font-medium text-neutral-800">{t.name}</span>
                  <span className="text-xs text-neutral-500">
                    {t.owner_name ?? "—"} · {t.phone ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Super Admin > Types: the ten POS system types, how they differ, and which
 * tenants use each. Definitions live in config/businessTypes.ts. */
export default function TypesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "matrix">("cards");

  useEffect(() => {
    if (isTauri()) void tenantsRepo.list().then(setTenants);
  }, []);

  const tenantsOf = (id: string) => tenants.filter((t) => businessType(t.business_type).id === id);
  const type = BUSINESS_TYPES.find((t) => t.id === selected);
  if (type) return <TypeDetail type={type} tenants={tenantsOf(type.id)} onBack={() => setSelected(null)} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Types"
        actions={
          <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
            {(["cards", "matrix"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 font-medium ${view === v ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500"}`}
              >
                {v === "cards" ? "Types" : "Compare Modules"}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex items-start gap-3 rounded-2xl bg-[#006633]/[0.06] px-4 py-3 ring-1 ring-[#006633]/20">
        <BadgeCheck size={18} className="mt-0.5 shrink-0 text-[#006633]" />
        <p className="text-sm text-neutral-700">
          <span className="font-semibold text-[#006633]">All 10 types are ready for FBR Digital Invoicing.</span> Any tenant can
          submit invoices to FBR when it is registered and FBR is allowed in its tenant detail. Services taxed by a province
          (PRA, SRB, KPRA, BRA) follow that authority&apos;s rules; confirm the applicable regime with the business&apos;s tax adviser.
        </p>
      </div>

      {view === "matrix" ? (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left">
                <th className="sticky left-0 bg-neutral-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Module</th>
                {BUSINESS_TYPES.map((t) => (
                  <th key={t.id} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    <button type="button" onClick={() => setSelected(t.id)} className="max-w-[7rem] text-left hover:text-amber-700">
                      {t.label.split(" — ")[0].replace(" Management / ", " / ")}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPS.map((cap) => (
                <tr key={cap} className="border-b border-neutral-50 last:border-0">
                  <td className="sticky left-0 bg-white px-3 py-2 font-medium text-neutral-800">{CAPABILITY_LABELS[cap]}</td>
                  {BUSINESS_TYPES.map((t) => (
                    <td key={t.id} className="px-2 py-2">
                      <LevelChip cap={cap} level={t.capabilities[cap]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        FAMILIES.map((fam) => (
          <section key={fam}>
            <div className="mb-2">
              <h2 className="text-base font-semibold tracking-tight text-neutral-900">{FAMILY_LABELS[fam].label}</h2>
              <p className="text-xs text-neutral-500">{FAMILY_LABELS[fam].blurb}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {BUSINESS_TYPES.filter((t) => t.family === fam).map((t) => {
                const count = tenantsOf(t.id).length;
                const core = CAPS.filter((cap) => cap !== "digitalInvoicing" && t.capabilities[cap] === "Core");
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelected(t.id)}
                    className="flex flex-col rounded-2xl bg-white p-4 text-left shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] transition hover:ring-amber-300"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-neutral-900">{t.label}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_LABELS[t.status].cls}`}>
                        {STATUS_LABELS[t.status].label}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{t.purpose}</p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {core.map((cap) => (
                        <span key={cap} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                          {CAPABILITY_LABELS[cap]}
                        </span>
                      ))}
                      <span className="rounded bg-[#006633] px-1.5 py-0.5 text-[10px] text-white">FBR DI</span>
                    </div>
                    <p className="mt-3 text-[11px] text-neutral-400">
                      {count} tenant{count === 1 ? "" : "s"}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
