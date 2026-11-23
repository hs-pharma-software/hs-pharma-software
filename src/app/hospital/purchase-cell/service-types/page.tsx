"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { DEFAULT_SERVICE_TYPES, addServiceType, listServiceTypes, removeServiceType, type ServiceType } from "@/lib/repo/vendors";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Purchase Cell > Vendor Services > Types: the kinds of service bought from vendors, offered on a new service bill. */
export default function ServiceTypesPage() {
  const [rows, setRows] = useState<ServiceType[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    if (!isTauri()) return;
    try { setRows(await listServiceTypes()); setError(null); } catch (e) { setError(/no such table/i.test(msg(e)) ? "Service types need the database update (v100)." : msg(e)); }
  }
  useEffect(() => { void reload(); }, []);
  async function add(n: string) {
    try { await addServiceType(n); setName(""); await reload(); } catch (e) { setError(msg(e)); }
  }
  async function remove(t: ServiceType) {
    if (!window.confirm(`Remove ${t.name}? Bills already made keep it.`)) return;
    try { await removeServiceType(t.id); await reload(); } catch (e) { setError(msg(e)); }
  }
  const missing = DEFAULT_SERVICE_TYPES.filter((d) => !rows.some((r) => r.name.toLowerCase() === d.toLowerCase()));
  return (
    <div>
      <PageHeader title="Service Types" />
      <div className={`${card} max-w-2xl`}>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tenting" aria-label="Service type"
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void add(name); }} />
          <Button variant="primary" disabled={!name.trim()} onClick={() => void add(name)}><Plus size={14} className="mr-1" />Add</Button>
        </div>
        {missing.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="text-neutral-500">Quick add:</span>
            {missing.map((d) => <button key={d} type="button" onClick={() => void add(d)} className="rounded-full bg-neutral-100 px-2 py-0.5 hover:bg-neutral-200">{d}</button>)}
          </div>
        )}
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {rows.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No service types yet.</p> : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-1.5 text-sm">{t.name}
                <button type="button" title="Remove" onClick={() => void remove(t)} className="text-neutral-400 hover:text-rose-600"><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
