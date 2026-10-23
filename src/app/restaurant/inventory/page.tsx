"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { restaurant } from "@/lib/restaurant";
import { today, type IngredientRow } from "@/lib/restaurant/store";
import { Badge, Note, RestGuard, money, useAction, useLoad } from "@/components/restaurant/ui";

export default function InventoryPage() {
  return (
    <RestGuard>
      <Inventory />
    </RestGuard>
  );
}

function Inventory() {
  const list = useLoad(() => restaurant.listIngredients());
  const [from, setFrom] = useState(() => today(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(today());
  const usage = useLoad(() => restaurant.ingredientUsage(from, to), [from, to]);
  const [edit, setEdit] = useState<Partial<IngredientRow> | null>(null);
  const [adjust, setAdjust] = useState<IngredientRow | null>(null);
  const low = (list.data ?? []).filter((i) => i.reorder_level > 0 && i.stock <= i.reorder_level);
  return (
    <div className="space-y-4">
      <PageHeader title="Ingredients" actions={<Button variant="primary" onClick={() => setEdit({ is_active: 1, purchase_factor: 1 })}>Add Ingredient</Button>} />
      <Note>Optional. Give dishes a recipe (Menu &gt; dish &gt; Recipe) and ingredient stock goes down automatically when the dish is sent to the kitchen. Dishes without a recipe sell normally with no stock change.</Note>
      {low.length > 0 && <Note tone="amber">Low stock: {low.map((i) => `${i.name} (${i.stock} ${i.unit})`).join(", ")}</Note>}
      {list.error && <Note tone="rose">{list.error}</Note>}
      <DataTable
        rows={list.data ?? []}
        onRowClick={(i) => setEdit(i)}
        columns={[
          { header: "Ingredient", render: (i) => <span className="font-medium">{i.name}</span> },
          { header: "In stock", render: (i) => <span className={i.reorder_level > 0 && i.stock <= i.reorder_level ? "font-semibold text-rose-600" : ""}>{Math.round(i.stock * 1000) / 1000} {i.unit}</span> },
          { header: "Reorder at", render: (i) => (i.reorder_level ? `${i.reorder_level} ${i.unit}` : "-") },
          { header: "Cost / unit", render: (i) => money(i.cost) },
          { header: "Stock value", render: (i) => money(Math.max(0, i.stock) * i.cost) },
          { header: "Purchase unit", render: (i) => (i.purchase_unit ? `1 ${i.purchase_unit} = ${i.purchase_factor} ${i.unit}` : "-") },
          { header: "", render: (i) => <button type="button" className="text-xs text-amber-700 hover:underline" onClick={(e) => { e.stopPropagation(); setAdjust(i); }}>Stock in / out</button> },
        ]}
      />

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.05]">
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <h2 className="mr-auto text-base font-semibold">Usage &amp; wastage</h2>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase tracking-widest text-neutral-400"><th className="py-1">Ingredient</th><th>Used in dishes</th><th>Wasted</th><th>Purchased</th></tr></thead>
          <tbody>
            {(usage.data ?? []).map((u) => (
              <tr key={u.name} className="border-t border-neutral-50"><td className="py-1">{u.name}</td><td>{u.used} {u.unit}</td><td>{u.wasted} {u.unit}</td><td>{u.purchased} {u.unit}</td></tr>
            ))}
            {usage.data?.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-neutral-400">No stock movement in this period.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && <IngredientModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void list.reload(); }} />}
      {adjust && <AdjustModal ing={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); void list.reload(); void usage.reload(); }} />}
    </div>
  );
}

function IngredientModal({ value, onClose, onSaved }: { value: Partial<IngredientRow>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(value);
  const act = useAction();
  return (
    <Modal title={value.id ? `Edit ${value.name}` : "Add Ingredient"} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <Field label="Name" required><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Recipe unit (e.g. g, ml, pcs)" required><Input value={f.unit ?? ""} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          <Field label="Cost per recipe unit"><Input type="number" min="0" step="any" value={f.cost ?? ""} onChange={(e) => setF({ ...f, cost: Number(e.target.value) })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Purchase unit (e.g. kg, crate)"><Input value={f.purchase_unit ?? ""} onChange={(e) => setF({ ...f, purchase_unit: e.target.value })} /></Field>
          <Field label="Recipe units per purchase unit"><Input type="number" min="0" step="any" value={f.purchase_factor ?? 1} onChange={(e) => setF({ ...f, purchase_factor: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Reorder level (recipe units)"><Input type="number" min="0" step="any" value={f.reorder_level ?? ""} onChange={(e) => setF({ ...f, reorder_level: Number(e.target.value) })} /></Field>
        {act.error && <Note tone="rose">{act.error}</Note>}
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={act.busy} onClick={async () => { const r = await act.run(() => restaurant.saveIngredient(f)); if (r) onSaved(); }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function AdjustModal({ ing, onClose, onSaved }: { ing: IngredientRow; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"purchase" | "wastage" | "adjustment" | "count">("purchase");
  const [qty, setQty] = useState("");
  const [inPurchaseUnits, setInPurchaseUnits] = useState(!!ing.purchase_unit);
  const [note, setNote] = useState("");
  const act = useAction();
  const factor = inPurchaseUnits && ing.purchase_unit ? ing.purchase_factor : 1;
  return (
    <Modal title={`Stock: ${ing.name}`} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-neutral-600">In stock now: {ing.stock} {ing.unit}</p>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as never)}>
            <option value="purchase">Purchase / stock in</option>
            <option value="wastage">Wastage / spoilage</option>
            <option value="adjustment">Adjustment (+ or −)</option>
            <option value="count">Stock count (set exact amount)</option>
          </Select>
        </Field>
        <Field label={`Quantity (${inPurchaseUnits && ing.purchase_unit ? ing.purchase_unit : ing.unit})`}>
          <Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        {ing.purchase_unit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inPurchaseUnits} onChange={(e) => setInPurchaseUnits(e.target.checked)} /> Enter in {ing.purchase_unit} (1 = {ing.purchase_factor} {ing.unit})</label>}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Supplier / reason" /></Field>
        {act.error && <Note tone="rose">{act.error}</Note>}
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={act.busy || qty === ""} onClick={async () => { const r = await act.run(() => restaurant.adjustStock(ing.id, kind, Number(qty) * factor, note)); if (r) onSaved(); }}>Save</Button>
        </div>
        <p className="text-[11px] text-neutral-400"><Badge>audited</Badge> Every stock change is logged with your name.</p>
      </div>
    </Modal>
  );
}
