"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { createRepo, type BaseRow } from "@/lib/repo/base";
import { BUSINESS_TYPES } from "@/config/businessTypes";

/** Super Admin > Subscription Plans > Add-ons: extras sold on top of a plan
 * (website, online store, own domain, extra staff logins...), listed on the
 * website's pricing page when public. Switching an add-on on for a business
 * stays where it is done today (Tenants > Website & Domains, staff limits). */
export interface PlanAddon extends BaseRow {
  name: string; description: string | null; feature: string; price: number; billing: "one_time" | "monthly" | "yearly" | "per_term";
  business_types: string | null; is_public: number; sort_order: number;
}
export const planAddonsRepo = createRepo<PlanAddon>("plan_addons");

export const ADDON_FEATURES: Record<string, string> = {
  website: "Website", online_store: "Online store", website_store: "Website + online store", custom_domain: "Own domain (e.g. www.yourshop.pk)",
  extra_staff: "Extra staff login", fbr_setup: "FBR Digital Invoicing setup", data_migration: "Data migration", training: "Training", other: "Other",
};
export const BILLING_LABEL: Record<PlanAddon["billing"], string> = { one_time: "one time", monthly: "per month", yearly: "per year", per_term: "per plan term" };

const listFrom = (raw: string | null | undefined): string[] => { try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

export function PlanAddonsCard() {
  const [rows, setRows] = useState<PlanAddon[] | null>(null);
  const [editing, setEditing] = useState<PlanAddon | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { planAddonsRepo.list({ orderBy: "sort_order ASC, name ASC" }).then(setRows).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  return (
    <div className="mt-6 rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-neutral-800">Add-ons</p>
          <p className="text-xs text-neutral-500">Extras sold on top of any plan. Public ones are listed on the website&apos;s pricing page.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>Add add-on</Button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {!rows ? <p className="text-sm text-neutral-500">Loading…</p> : !rows.length ? <p className="py-4 text-center text-sm text-neutral-400">No add-ons yet. Add Website, Online store or Own domain, with their prices.</p> : (
        <ul className="divide-y divide-neutral-100 text-sm">
          {rows.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setEditing(a)} className="flex w-full flex-wrap items-center gap-2 py-2 text-left hover:bg-neutral-50">
                <span className="font-medium text-neutral-800">{a.name}</span>
                <span className="text-xs text-neutral-500">{ADDON_FEATURES[a.feature] ?? a.feature}</span>
                <span className="ml-auto tabular-nums">Rs {a.price.toLocaleString("en-PK")} {BILLING_LABEL[a.billing]}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${a.is_public ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"}`}>{a.is_public ? "On website" : "Hidden"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <AddonForm addon={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function AddonForm({ addon, onClose, onSaved }: { addon: PlanAddon | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: addon?.name ?? "", description: addon?.description ?? "", feature: addon?.feature ?? "website", price: String(addon?.price ?? 0),
    billing: addon?.billing ?? "monthly", isPublic: addon ? addon.is_public === 1 : true, sort: String(addon?.sort_order ?? 0),
  });
  const [types, setTypes] = useState<Set<string>>(new Set(listFrom(addon?.business_types)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: f.name.trim(), description: f.description.trim() || null, feature: f.feature, price: Math.max(0, Number(f.price) || 0), billing: f.billing,
        business_types: types.size ? JSON.stringify([...types]) : null, is_public: f.isPublic ? 1 : 0, sort_order: Math.round(Number(f.sort) || 0),
      } as Partial<PlanAddon>;
      if (addon) await planAddonsRepo.update(addon.id, payload);
      else await planAddonsRepo.create(payload as Omit<PlanAddon, keyof BaseRow>);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={addon ? "Edit add-on" : "Add add-on"} onClose={onClose} width="max-w-xl">
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="e.g. Business website" /></Field>
          <Field label="Kind">
            <Select value={f.feature} onChange={(e) => setF({ ...f, feature: e.target.value })}>{Object.entries(ADDON_FEATURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
          <Field label="Price (Rs)"><Input type="number" min="0" step="any" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Charged">
            <Select value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value as PlanAddon["billing"] })}>{Object.entries(BILLING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
        </div>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Your own website with a free name.mavin.pk address" /></Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-600">For business types <span className="font-normal text-neutral-400">(none ticked = every type)</span></p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-neutral-200 p-3 sm:grid-cols-3">
            {BUSINESS_TYPES.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5 text-sm text-neutral-700">
                <input type="checkbox" checked={types.has(t.id)} onChange={() => setTypes((p) => { const n = new Set(p); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} />{t.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Show on the website&apos;s pricing page</label>
          <Field label="Order"><Input type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} className="w-24" /></Field>
        </div>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-between border-t border-neutral-200 pt-3">
          {addon ? <Button type="button" variant="danger" onClick={async () => { if (!confirm(`Delete the add-on “${addon.name}”?`)) return; await planAddonsRepo.remove(addon.id, "Deleted by admin"); onSaved(); }}>Delete</Button> : <span />}
          <div className="flex gap-2"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>
        </div>
      </form>
    </Modal>
  );
}
