"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText } from "@/lib/dist";
import type { DistCompany } from "@/lib/dist/store";
import { DistGuard, Err, PageTitle, useLoad } from "@/components/dist/ui";

export default function CompaniesPage() {
  return <DistGuard need="catalog.view">{(c) => <Companies canManage={c.can("companies.manage")} />}</DistGuard>;
}

function Companies({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Partial<DistCompany> | null>(null);
  const list = useLoad(() => dist.listCompanies({ search, includeInactive: showInactive }), [search, showInactive]);
  return (
    <div className="space-y-3">
      <PageTitle
        title="Companies"
        sub="Manufacturers / brands whose products you distribute. Separate from suppliers (who you buy from)."
        actions={canManage && <Button variant="primary" onClick={() => setEditing({ is_active: 1 })}><Plus size={14} /> Add company</Button>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input className="!w-72" placeholder="Search company name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
      </div>
      <Err error={list.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data ?? []).map((c) => (
          <div key={c.id} className={`rounded-xl bg-white p-4 ring-1 ring-black/5 ${c.is_active ? "" : "opacity-60"}`}>
            <div className="flex items-start gap-3">
              {c.logo ? <img src={c.logo} alt="" className="h-10 w-10 rounded object-contain" /> : <div className="flex h-10 w-10 items-center justify-center rounded bg-sky-100 text-sm font-bold text-sky-700">{c.code.slice(0, 3)}</div>}
              <div className="min-w-0 flex-1">
                <Link href={`/dist/companies/view?id=${c.id}`} className="block truncate font-semibold hover:underline">{c.name}</Link>
                <p className="text-xs text-neutral-500">{c.code} · {c.products} product(s){c.is_active ? "" : " · inactive"}</p>
                {c.representative && <p className="text-xs text-neutral-500">Rep: {c.representative}</p>}
              </div>
              {canManage && <Button variant="ghost" onClick={() => setEditing(c)}><Pencil size={14} /></Button>}
            </div>
          </div>
        ))}
        {!list.data?.length && <p className="text-sm text-neutral-400">{list.loading ? "Loading…" : "No companies yet."}</p>}
      </div>
      {editing && <CompanyModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
    </div>
  );
}

function CompanyModal({ value, onClose, onSaved }: { value: Partial<DistCompany>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const f = (k: keyof DistCompany, label: string, required = false) => (
    <Field label={label} required={required}>
      <Input value={String(v[k] ?? "")} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Modal title={value.id ? "Edit company" : "Add company"} onClose={onClose} width="max-w-2xl">
      <div className="grid gap-3 md:grid-cols-2">
        {f("name", "Company name", true)}
        {f("code", "Company code", true)}
        {f("contact_person", "Contact person")}
        {f("phone", "Phone")}
        {f("email", "Email")}
        {f("representative", "Company representative (optional)")}
        {f("logo", "Logo URL (optional)")}
        {f("address", "Address")}
        <div className="md:col-span-2">
          <Field label="Description"><Textarea rows={2} value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.is_active !== 0} onChange={(e) => setV({ ...v, is_active: e.target.checked ? 1 : 0 })} /> Active</label>
      </div>
      <Err error={error} />
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => { try { await dist.saveCompany(v); onSaved(); } catch (e) { setError(errorText(e)); } }}>Save</Button>
      </div>
    </Modal>
  );
}
