"use client";

import { useState } from "react";
import { Pencil, Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText } from "@/lib/dist";
import type { DistSalesman } from "@/lib/dist/store";
import { Badge, DistGuard, Err, LIVE_TONE, Note, PageTitle, ago, money, thisMonth, useLoad, type DistCtx } from "@/components/dist/ui";
import { SalesmanDetail } from "@/components/dist/SalesmanDetail";

export default function SalesmenPage() {
  return <DistGuard>{(c) => (c.admin || c.can("salesmen.view") ? <Salesmen c={c} /> : <Note tone="amber">You don&apos;t have permission to view salesmen.</Note>)}</DistGuard>;
}

function Salesmen({ c }: { c: DistCtx }) {
  const [inactive, setInactive] = useState(false);
  const list = useLoad(() => dist.listSalesmen(inactive), [inactive]);
  const [editing, setEditing] = useState<(Partial<DistSalesman> & { companyIds?: string[] }) | null>(null);
  const [target, setTarget] = useState<DistSalesman | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <PageTitle title="Salesmen & Targets" actions={c.admin && <Button variant="primary" onClick={() => setEditing({ is_active: 1 })}><Plus size={14} /> Add salesman</Button>} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show inactive</label>
      <Err error={list.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">Code</th>
              <th className="px-3 py-2 text-start">Name</th>
              <th className="px-3 py-2 text-start">Mobile</th>
              <th className="px-3 py-2 text-start">Territory</th>
              <th className="px-3 py-2 text-end">Monthly target</th>
              <th className="px-3 py-2 text-start">Login</th>
              <th className="px-3 py-2 text-start">Location</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((s) => (
              <tr key={s.id} className={`border-t border-neutral-100 ${s.is_active ? "" : "opacity-50"}`}>
                <td className="px-3 py-2 text-xs">{s.code}</td>
                <td className="px-3 py-2"><button type="button" className="font-medium hover:underline" onClick={() => setOpen(s.id)}>{s.name}</button></td>
                <td className="px-3 py-2 text-xs">{s.mobile}</td>
                <td className="px-3 py-2 text-xs">{s.territory}</td>
                <td className="px-3 py-2 text-end">{money(s.monthly_target)}</td>
                <td className="px-3 py-2 text-xs">{s.user_id ? <Badge tone="green">linked</Badge> : <Badge tone="amber">no login</Badge>}</td>
                <td className="px-3 py-2 text-xs"><Badge tone={LIVE_TONE[s.live]}>{s.live}</Badge> <span className="text-neutral-400">{ago(s.last_point_at)}</span></td>
                <td className="whitespace-nowrap px-3 py-2 text-end">
                  {c.admin && <Button variant="ghost" title="Set target" onClick={() => setTarget(s)}><Target size={14} /></Button>}
                  {c.admin && <Button variant="ghost" onClick={() => setEditing({ ...s, companyIds: JSON.parse(s.company_ids || "[]") })}><Pencil size={14} /></Button>}
                </td>
              </tr>
            ))}
            {!list.data?.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{list.loading ? "Loading…" : "No salesmen yet."}</td></tr>}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal title={`${list.data?.find((s) => s.id === open)?.name ?? "Salesman"} — dashboard`} onClose={() => setOpen(null)} width="max-w-5xl">
          <div className="max-h-[80vh] overflow-y-auto">
            <SalesmanDetail salesmanId={open} showLocation={c.can("locations.view")} />
          </div>
        </Modal>
      )}
      {editing && <SalesmanModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
      {target && <TargetModal salesman={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function SalesmanModal({ value, onClose, onSaved }: { value: Partial<DistSalesman> & { companyIds?: string[] }; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const users = useLoad(() => dist.listUsers(), []);
  const companies = useLoad(() => dist.listCompanies(), []);
  const t = (k: keyof DistSalesman, label: string, required = false, type = "text") => (
    <Field label={label} required={required}><Input type={type} value={v[k] == null ? "" : String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  );
  const sel = new Set(v.companyIds ?? []);
  return (
    <Modal title={value.id ? "Edit salesman" : "Add salesman"} onClose={onClose} width="max-w-2xl">
      <div className="grid gap-3 md:grid-cols-2">
        {t("name", "Name", true)}
        {t("code", "Salesman code", true)}
        {t("mobile", "Mobile")}
        {t("territory", "Territory")}
        {t("monthly_target", "Default monthly target (Rs)", false, "number")}
        {t("employment", "Employment info (optional)")}
        <Field label="Login account (sub-user)">
          <Select value={v.user_id ?? ""} onChange={(e) => setV({ ...v, user_id: e.target.value || null })}>
            <option value="">— none —</option>
            {(users.data ?? []).filter((u) => u.role === "staff").map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={v.is_active !== 0} onChange={(e) => setV({ ...v, is_active: e.target.checked ? 1 : 0 })} /> Active</label>
        <div className="md:col-span-2">
          <p className="mb-1 text-xs font-medium text-neutral-600">Assigned companies (none = all)</p>
          <div className="flex flex-wrap gap-2">
            {(companies.data ?? []).map((co) => (
              <label key={co.id} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={sel.has(co.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(co.id); else n.delete(co.id); setV({ ...v, companyIds: [...n] }); }} /> {co.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <Note>Create the login under Settings → User Logins first, then give it permissions under Distributor Settings → User Permissions.</Note>
      <Err error={error} />
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => { try { await dist.saveSalesman({ ...v, monthly_target: Number(v.monthly_target) || 0 }); onSaved(); } catch (e) { setError(errorText(e)); } }}>Save</Button>
      </div>
    </Modal>
  );
}

function TargetModal({ salesman, onClose }: { salesman: DistSalesman; onClose: () => void }) {
  const [month, setMonth] = useState(thisMonth);
  const [amount, setAmount] = useState(String(salesman.monthly_target || ""));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Modal title={`Monthly target — ${salesman.name}`} onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Target (Rs)"><Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={async () => { try { await dist.setTarget(salesman.id, month, Number(amount)); setMsg({ ok: true, text: "Target saved." }); } catch (e) { setMsg({ ok: false, text: errorText(e) }); } }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
