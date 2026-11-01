"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { DISH_CATEGORIES, dishesRepo, packagesRepo, parseDishIds, saveDish, savePackage, type BanquetDish, type BanquetPackage } from "@/lib/repo/banquet";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Dishes priced per head, and menu packages (a set of dishes at one price per head). */
export default function MenuPage() {
  const [dishes, setDishes] = useState<BanquetDish[]>([]);
  const [packages, setPackages] = useState<BanquetPackage[]>([]);
  const [tab, setTab] = useState<"dishes" | "packages">("dishes");
  const [editDish, setEditDish] = useState<BanquetDish | "new" | null>(null);
  const [editPkg, setEditPkg] = useState<BanquetPackage | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      const [d, p] = await Promise.all([dishesRepo.list({ orderBy: "category ASC, name ASC" }), packagesRepo.list({ orderBy: "price_per_head ASC" })]);
      setDishes(d);
      setPackages(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void reload(); }, []);

  const edit = (onClick: () => void, label: string) => <button type="button" title="Edit" aria-label={`Edit ${label}`} onClick={(e) => { e.stopPropagation(); onClick(); }} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100"><Pencil size={15} /></button>;
  const dishCols: Column<BanquetDish>[] = [
    { header: "Dish", render: (d) => <span className={`font-medium ${d.is_active ? "" : "text-neutral-400 line-through"}`}>{d.name}</span> },
    { header: "Category", render: (d) => d.category },
    { header: "Per head (Rs)", render: (d) => <span className="tabular-nums">{money(d.price_per_head)}</span> },
    { header: "", render: (d) => edit(() => setEditDish(d), d.name) },
  ];
  const pkgCols: Column<BanquetPackage>[] = [
    { header: "Package", render: (p) => <span className={`font-medium ${p.is_active ? "" : "text-neutral-400 line-through"}`}>{p.name}</span> },
    { header: "Per head (Rs)", render: (p) => <span className="tabular-nums">{money(p.price_per_head)}</span> },
    { header: "Dishes", render: (p) => { const names = parseDishIds(p.dish_ids).map((id) => dishes.find((d) => d.id === id)?.name).filter(Boolean).join(", "); return <span title={names} className="inline-block max-w-[28rem] truncate align-bottom text-xs text-neutral-700">{names}</span>; } },
    { header: "", render: (p) => edit(() => setEditPkg(p), p.name) },
  ];

  return (
    <div>
      <PageHeader title="Menu & Packages" actions={tab === "dishes"
        ? <Button variant="primary" onClick={() => setEditDish("new")}><Plus size={14} />Add dish</Button>
        : <Button variant="primary" onClick={() => setEditPkg("new")} disabled={!dishes.length}><Plus size={14} />Add package</Button>} />
      <div className="mb-3 flex overflow-hidden rounded-lg border border-neutral-200 text-sm w-fit">
        {(["dishes", "packages"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setTab(v)} className={`px-3 py-1.5 ${tab === v ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>{v === "dishes" ? `Dishes (${dishes.length})` : `Packages (${packages.length})`}</button>
        ))}
      </div>
      {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
      {tab === "dishes"
        ? <DataTable columns={dishCols} rows={dishes} onRowClick={(d) => setEditDish(d)} emptyMessage="No dishes yet. Add each dish with its price per head." />
        : <DataTable columns={pkgCols} rows={packages} onRowClick={(p) => setEditPkg(p)} emptyMessage="No packages yet. A package is a set of dishes at one price per head (e.g. Silver, Gold)." />}
      {editDish && <DishForm dish={editDish === "new" ? null : editDish} onClose={() => setEditDish(null)} onSaved={() => { setEditDish(null); void reload(); }} />}
      {editPkg && <PackageForm pkg={editPkg === "new" ? null : editPkg} dishes={dishes.filter((d) => d.is_active)} onClose={() => setEditPkg(null)} onSaved={() => { setEditPkg(null); void reload(); }} />}
    </div>
  );
}

function DishForm({ dish, onClose, onSaved }: { dish: BanquetDish | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(dish?.name ?? "");
  const [category, setCategory] = useState(dish?.category ?? DISH_CATEGORIES[1]);
  const [price, setPrice] = useState(dish ? String(dish.price_per_head) : "");
  const [active, setActive] = useState(dish ? Boolean(dish.is_active) : true);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await saveDish(dish?.id ?? null, { name, category, price_per_head: Number(price) || 0, is_active: active });
      onSaved();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={dish ? `Edit ${dish.name}` : "Add dish"} onClose={onClose} width="max-w-md">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Dish" required><Input id="ds-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken Karahi" autoFocus /></Field></div>
        <Field label="Category" required>
          <Select id="ds-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{DISH_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Per head (Rs)" required><Input id="ds-price" type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> On the menu</label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

function PackageForm({ pkg, dishes, onClose, onSaved }: { pkg: BanquetPackage | null; dishes: BanquetDish[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(pkg?.name ?? "");
  const [price, setPrice] = useState(pkg ? String(pkg.price_per_head) : "");
  const [ids, setIds] = useState<string[]>(parseDishIds(pkg?.dish_ids));
  const [active, setActive] = useState(pkg ? Boolean(pkg.is_active) : true);
  const [saving, setSaving] = useState(false);
  const sum = ids.reduce((t, id) => t + Number(dishes.find((d) => d.id === id)?.price_per_head ?? 0), 0);
  async function save() {
    setSaving(true);
    try {
      await savePackage(pkg?.id ?? null, { name, price_per_head: Number(price) || 0, dish_ids: ids, is_active: active });
      onSaved();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  const groups = [...new Set(dishes.map((d) => d.category))];
  return (
    <Modal title={pkg ? `Edit ${pkg.name}` : "Add package"} onClose={onClose} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Package" required><Input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gold" autoFocus /></Field>
        <Field label="Price per head (Rs)" required><Input id="pk-price" type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={sum ? String(sum) : ""} /></Field>
      </div>
      <p className="mb-1 mt-3 text-xs text-neutral-500">Dishes ({ids.length} chosen, Rs {money(sum)} per head separately)</p>
      <div className="grid max-h-[45vh] grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g} className="rounded-xl border border-neutral-200 p-2.5">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{g}</legend>
            {dishes.filter((d) => d.category === g).map((d) => (
              <label key={d.id} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" checked={ids.includes(d.id)} onChange={() => setIds((x) => (x.includes(d.id) ? x.filter((y) => y !== d.id) : [...x, d.id]))} />
                <span className="flex-1">{d.name}</span><span className="text-xs tabular-nums text-neutral-500">{money(d.price_per_head)}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Offered</label>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
