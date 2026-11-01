"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { addClothType, clothTypeCounts, deleteClothType, loadClothTypes, renameClothType } from "@/lib/cloth";

/** Cloth store: the product types (Shalwar Kameez, Kurta, ...) offered on
 * the product form. Renaming a type renames it on its products too. */
export default function ProductTypesPage() {
  const isCloth = useAuthStore((s) => s.currentTenant?.businessType === "cloth_store");
  const [types, setTypes] = useState<string[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const [t, c] = await Promise.all([loadClothTypes(), clothTypeCounts()]);
    setTypes(t);
    setCounts(c);
  }
  useEffect(() => { void reload(); }, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  if (!isCloth) return <div><PageHeader title="Product Types" /><p className="text-sm text-neutral-500">Product types are for cloth stores.</p></div>;

  return (
    <div>
      <PageHeader title="Product Types" />
      <section className="max-w-2xl rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <p className="mb-3 text-sm text-neutral-500">The types offered when you add or edit a product. Renaming a type renames it on its products too.</p>
        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => addClothType(adding)).then((ok) => ok && setAdding("")); }}>
          <Input id="pt-add" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New type, e.g. Waistcoat" />
          <Button type="submit" variant="primary" disabled={!adding.trim()}><Plus size={14} />Add</Button>
        </form>
        {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
          {types.length === 0 && <li className="px-3 py-3 text-sm text-neutral-500">No types yet. Add the first one above.</li>}
          {types.map((t) => {
            const n = counts.get(t.toLowerCase()) ?? 0;
            const isEditing = editing?.from === t;
            return (
              <li key={t} className="flex items-center gap-2 px-3 py-2 text-sm">
                {isEditing ? (
                  <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); void run(() => renameClothType(t, editing.to)).then((ok) => ok && setEditing(null)); }}>
                    <Input aria-label={`Rename ${t}`} autoFocus value={editing.to} onChange={(e) => setEditing({ from: t, to: e.target.value })} />
                    <button type="submit" title="Save" aria-label="Save" className="rounded-full p-1.5 text-emerald-700 hover:bg-emerald-50"><Check size={15} /></button>
                    <button type="button" title="Cancel" aria-label="Cancel" onClick={() => setEditing(null)} className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100"><X size={15} /></button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 font-medium text-neutral-800">{t}</span>
                    <span className="text-xs text-neutral-500">{n} product{n === 1 ? "" : "s"}</span>
                    <button type="button" title="Edit" aria-label={`Edit ${t}`} onClick={() => setEditing({ from: t, to: t })} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100"><Pencil size={15} /></button>
                    <button type="button" title="Delete" aria-label={`Delete ${t}`} onClick={() => { if (window.confirm(`Delete the type ${t}?`)) void run(() => deleteClothType(t)); }} className="rounded-full p-1.5 text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
