"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { restaurant } from "@/lib/restaurant";
import type { PriceOption } from "@/lib/restaurant/engine";
import { REST_SETTINGS, type CategoryRow, type MenuItemRow } from "@/lib/restaurant/store";
import { Badge, Note, RestGuard, money, useAction, useLoad } from "@/components/restaurant/ui";

export default function MenuPage() {
  return (
    <RestGuard>
      <Menu />
    </RestGuard>
  );
}

type Item = Omit<MenuItemRow, "variants" | "modifiers"> & { variants: PriceOption[]; modifiers: PriceOption[]; category_name?: string | null };

function Menu() {
  const cats = useLoad(() => restaurant.listCategories(true));
  const [catId, setCatId] = useState<string | null>(null);
  const items = useLoad(() => restaurant.listMenuItems({ categoryId: catId, includeUnavailable: true }) as Promise<Item[]>, [catId]);
  const [editCat, setEditCat] = useState<Partial<CategoryRow> | null>(null);
  const [editItem, setEditItem] = useState<Partial<Item> | null>(null);
  const act = useAction();

  const move = async (idx: number, dir: -1 | 1) => {
    const list = [...(cats.data ?? [])];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    await act.run(() => restaurant.reorderCategories(list.map((c) => c.id)));
    void cats.reload();
  };

  return (
    <div>
      <PageHeader
        title="Categories & Dishes"
        actions={
          <>
            <Button onClick={() => setEditCat({ is_active: 1 })}>Add Category</Button>
            <Button variant="primary" onClick={() => setEditItem({ category_id: catId, is_available: 1, variants: [], modifiers: [] })}>Add Dish</Button>
          </>
        }
      />
      {(cats.error || items.error || act.error) && <div className="mb-3"><Note tone="rose">{cats.error ?? items.error ?? act.error}</Note></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-2xl bg-white p-2 shadow-sm ring-1 ring-black/[0.05]">
          <button type="button" onClick={() => setCatId(null)} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${catId === null ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}>All dishes</button>
          {(cats.data ?? []).map((c, i) => (
            <div key={c.id} className={`group flex items-center gap-1 rounded-lg px-1 ${catId === c.id ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}>
              <button type="button" onClick={() => setCatId(c.id)} className="flex-1 px-2 py-2 text-left text-sm">
                {c.name} {!c.is_active && <span className="text-[10px] opacity-60">(off)</span>}
              </button>
              <button type="button" title="Up" onClick={() => void move(i, -1)} className="p-1 opacity-50 hover:opacity-100"><ArrowUp size={12} /></button>
              <button type="button" title="Down" onClick={() => void move(i, 1)} className="p-1 opacity-50 hover:opacity-100"><ArrowDown size={12} /></button>
              <button type="button" onClick={() => setEditCat(c)} className="px-1 text-[11px] underline opacity-60 hover:opacity-100">Edit</button>
            </div>
          ))}
          {cats.data?.length === 0 && <p className="p-3 text-xs text-neutral-400">Add categories such as Starters, BBQ, Burgers, Pizza, Drinks.</p>}
        </div>

        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.05]">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] uppercase tracking-widest text-neutral-400">
                {["Code", "Dish", "Category", "Price", "Takeaway", "Station", "Options", "Status"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(items.data ?? []).map((m) => (
                <tr key={m.id} onClick={() => setEditItem(m)} className="cursor-pointer border-b border-neutral-50 hover:bg-amber-50/40">
                  <td className="px-3 py-2 font-mono text-xs">{m.code}</td>
                  <td className="px-3 py-2 font-medium">{m.name}</td>
                  <td className="px-3 py-2">{m.category_name ?? "-"}</td>
                  <td className="px-3 py-2">{money(m.price)}</td>
                  <td className="px-3 py-2">{m.takeaway_price ? money(m.takeaway_price) : "-"}</td>
                  <td className="px-3 py-2">{m.station ?? "Kitchen"}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{m.variants.length} sizes · {m.modifiers.length} add-ons</td>
                  <td className="px-3 py-2">{m.is_available ? <Badge cls="bg-emerald-100 text-emerald-800">Available</Badge> : <Badge>Unavailable</Badge>}</td>
                </tr>
              ))}
              {items.data?.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-neutral-400">No content in table</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editCat && (
        <Modal title={editCat.id ? "Edit Category" : "Add Category"} onClose={() => setEditCat(null)} width="max-w-md">
          <div className="space-y-3">
            <Field label="Name" required><Input value={editCat.name ?? ""} onChange={(e) => setEditCat({ ...editCat, name: e.target.value })} autoFocus /></Field>
            <Field label="Description"><Input value={editCat.description ?? ""} onChange={(e) => setEditCat({ ...editCat, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Available from (optional)"><Input type="time" value={editCat.avail_from ?? ""} onChange={(e) => setEditCat({ ...editCat, avail_from: e.target.value })} /></Field>
              <Field label="Available to"><Input type="time" value={editCat.avail_to ?? ""} onChange={(e) => setEditCat({ ...editCat, avail_to: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editCat.is_active !== 0} onChange={(e) => setEditCat({ ...editCat, is_active: e.target.checked ? 1 : 0 })} /> Active (shown on the POS)</label>
            {act.error && <Note tone="rose">{act.error}</Note>}
            <div className="flex justify-between gap-2 border-t border-neutral-100 pt-3">
              {editCat.id ? <Button variant="danger" onClick={async () => { if (window.confirm("Delete this category? Its dishes stay, without a category.")) { await act.run(() => restaurant.deleteCategory(editCat.id!)); setEditCat(null); void cats.reload(); } }}>Delete</Button> : <span />}
              <div className="flex gap-2">
                <Button onClick={() => setEditCat(null)}>Cancel</Button>
                <Button variant="primary" disabled={act.busy} onClick={async () => { const r = await act.run(() => restaurant.saveCategory({ ...editCat, sort_order: editCat.sort_order ?? (cats.data?.length ?? 0) })); if (r) { setEditCat(null); void cats.reload(); } }}>Save</Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {editItem && <ItemModal item={editItem} categories={cats.data ?? []} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); void items.reload(); }} />}
    </div>
  );
}

function OptionList({ label, list, onChange }: { label: string; list: PriceOption[]; onChange: (l: PriceOption[]) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-neutral-600">{label}</p>
      {list.map((o, i) => (
        <div key={i} className="mb-1 flex gap-2">
          <Input value={o.name} placeholder="Name" onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input type="number" min="0" step="any" value={o.price} className="!w-28" onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} />
          <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      <button type="button" className="flex items-center gap-1 text-xs text-amber-700 hover:underline" onClick={() => onChange([...list, { name: "", price: 0 }])}><Plus size={12} /> Add</button>
    </div>
  );
}

function ItemModal({ item, categories, onClose, onSaved }: { item: Partial<Item>; categories: CategoryRow[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Item>>(item);
  const stations = useLoad(async () => ((await restaurant.settings.get(REST_SETTINGS.stations)) ?? "Kitchen,Grill,BBQ,Fryer,Pizza,Drinks").split(",").map((s) => s.trim()).filter(Boolean));
  const ingredients = useLoad(() => restaurant.listIngredients());
  const recipe = useLoad(async () => (item.id ? restaurant.getRecipe(item.id) : []), [item.id]);
  const [lines, setLines] = useState<{ ingredient_id: string; qty: number }[] | null>(null);
  const recipeLines = lines ?? (recipe.data ?? []).map((r) => ({ ingredient_id: r.ingredient_id, qty: r.qty }));
  const act = useAction();
  const cost = recipeLines.reduce((s, l) => s + l.qty * (ingredients.data?.find((i) => i.id === l.ingredient_id)?.cost ?? 0), 0);

  return (
    <Modal title={item.id ? `Edit ${item.name}` : "Add Dish"} onClose={onClose} width="max-w-3xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Item code" required><Input value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
            <div className="col-span-2"><Field label="Dish name" required><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field></div>
          </div>
          <Field label="Category">
            <Select value={f.category_id ?? ""} onChange={(e) => setF({ ...f, category_id: e.target.value || null })}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Description"><Input value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Price (dine-in)" required><Input type="number" min="0" step="any" value={f.price ?? ""} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} /></Field>
            <Field label="Takeaway / delivery price"><Input type="number" min="0" step="any" value={f.takeaway_price ?? ""} onChange={(e) => setF({ ...f, takeaway_price: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kitchen station">
              <Select value={f.station ?? ""} onChange={(e) => setF({ ...f, station: e.target.value || null })}>
                <option value="">Kitchen</option>
                {(stations.data ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Prep time (min)"><Input type="number" min="0" value={f.prep_minutes ?? ""} onChange={(e) => setF({ ...f, prep_minutes: Number(e.target.value) || null })} /></Field>
          </div>
          <Field label="Image URL (optional)"><Input value={f.image ?? ""} onChange={(e) => setF({ ...f, image: e.target.value || null })} /></Field>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_available !== 0} onChange={(e) => setF({ ...f, is_available: e.target.checked ? 1 : 0 })} /> Available</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.tax_exempt} onChange={(e) => setF({ ...f, tax_exempt: e.target.checked ? 1 : 0 })} /> Tax exempt</label>
          </div>
        </div>
        <div className="space-y-4">
          <OptionList label="Sizes / variants (replace the base price)" list={f.variants ?? []} onChange={(v) => setF({ ...f, variants: v })} />
          <OptionList label="Add-ons / modifiers (added to the price)" list={f.modifiers ?? []} onChange={(v) => setF({ ...f, modifiers: v })} />
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-600">Recipe (optional, per portion) — deducts ingredient stock when sent to the kitchen</p>
            {recipeLines.map((l, i) => (
              <div key={i} className="mb-1 flex gap-2">
                <Select value={l.ingredient_id} onChange={(e) => setLines(recipeLines.map((x, j) => (j === i ? { ...x, ingredient_id: e.target.value } : x)))}>
                  <option value="">Ingredient…</option>
                  {(ingredients.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}
                </Select>
                <Input type="number" min="0" step="any" value={l.qty} className="!w-24" onChange={(e) => setLines(recipeLines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
                <button type="button" onClick={() => setLines(recipeLines.filter((_, j) => j !== i))}><X size={14} /></button>
              </div>
            ))}
            <button type="button" className="flex items-center gap-1 text-xs text-amber-700 hover:underline" disabled={!ingredients.data?.length} onClick={() => setLines([...recipeLines, { ingredient_id: "", qty: 1 }])}><Plus size={12} /> Add ingredient</button>
            {!ingredients.data?.length && <p className="text-[11px] text-neutral-400">Add ingredients first (Ingredients page).</p>}
            {recipeLines.length > 0 && f.price ? (
              <p className="mt-1 text-xs text-neutral-600">Food cost {money(cost)} · margin {money(f.price - cost)} ({Math.round(((f.price - cost) / f.price) * 100)}%)</p>
            ) : null}
          </div>
        </div>
      </div>
      {act.error && <div className="mt-3"><Note tone="rose">{act.error}</Note></div>}
      <div className="mt-4 flex justify-between gap-2 border-t border-neutral-100 pt-3">
        {item.id ? <Button variant="danger" onClick={async () => { if (window.confirm("Delete this dish? Past invoices keep its name and price.")) { const r = await act.run(() => restaurant.deleteMenuItem(item.id!)); if (r) onSaved(); } }}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={act.busy}
            onClick={async () => {
              const saved = await act.run(async () => {
                const row = await restaurant.saveMenuItem(f);
                if (lines) await restaurant.saveRecipe(row.id, lines.filter((l) => l.ingredient_id && l.qty > 0));
                return row;
              });
              if (saved) onSaved();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
