"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { card, EpAdminFrame, msg } from "@/components/admin/eprocurement/EpAdmin";
import { epCategories, epCategoryActive, epDeleteCategory, epSaveCategory } from "@/lib/eprocurementAdminClient";
import type { EpCategory } from "@/lib/vendorProfile";

const KINDS: { kind: "supplier" | "services"; title: string; hint: string }[] = [
  { kind: "supplier", title: "Supplier (goods)", hint: "What suppliers sell" },
  { kind: "services", title: "Services", hint: "Work service companies do" },
];

/** Super Admin > eProcurement > Business types: the kinds of work vendors choose from when they register. */
export default function EpCategoriesPage() {
  const [rows, setRows] = useState<EpCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await epCategories()); setError(null); } catch (e) { setRows([]); setError(msg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <EpAdminFrame>
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {KINDS.map((k) => <KindColumn key={k.kind} {...k} rows={(rows ?? []).filter((r) => r.kind === k.kind)} loading={rows === null} onChanged={load} />)}
      </div>
    </EpAdminFrame>
  );
}

function KindColumn({ kind, title, hint, rows, loading, onChanged }: { kind: "supplier" | "services"; title: string; hint: string; rows: EpCategory[]; loading: boolean; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setError(null);
    try { await fn(); if (done) notify(done, "success"); await onChanged(); return true; } catch (e) { setError(msg(e)); return false; } finally { setBusy(null); }
  }
  return (
    <section className={card}>
      <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
      <p className="mb-3 text-xs text-neutral-500">{hint}. Turned-off kinds are hidden from new registrations; vendors who chose them keep them.</p>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void act("add", () => epSaveCategory({ kind, name: name.trim() }), `Added "${name.trim()}".`).then((ok) => ok && setName("")); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a kind of work" aria-label={`Add to ${title}`} />
        <Button type="submit" variant="primary" loading={busy === "add"} disabled={busy !== null || !name.trim()}>Add</Button>
      </form>
      <FormError message={error} className="mb-2" />
      {loading ? <div className="h-24 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" /> : rows.length === 0 ? <p className="text-sm text-neutral-400">None yet.</p> : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-1.5">
              {editing?.id === r.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void act(r.id, () => epSaveCategory({ id: r.id, kind, name: editing.name.trim(), sort: r.sort }), "Renamed.").then((ok) => ok && setEditing(null)); }}>
                  <Input value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} autoFocus aria-label="New name" />
                  <Button type="submit" variant="primary" loading={busy === r.id} disabled={busy !== null}>Save</Button>
                  <Button onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : <>
                <span className={`min-w-0 flex-1 truncate text-sm ${r.active ? "text-neutral-800" : "text-neutral-400 line-through"}`}>{r.name}</span>
                <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <input type="checkbox" checked={r.active} disabled={busy !== null} onChange={(e) => void act(r.id, () => epCategoryActive(r.id, e.target.checked))} className="h-4 w-4 accent-[var(--accent)]" />On
                </label>
                <button type="button" aria-label={`Rename ${r.name}`} onClick={() => setEditing({ id: r.id, name: r.name })} className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><Pencil size={14} /></button>
                <button type="button" aria-label={`Delete ${r.name}`} disabled={busy !== null}
                  onClick={() => { if (window.confirm(`Delete "${r.name}"? Vendors who chose it keep it on their record.`)) void act(r.id, () => epDeleteCategory(r.id), "Deleted."); }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
              </>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
