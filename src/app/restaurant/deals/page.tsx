"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { restaurant } from "@/lib/restaurant";
import type { DealComponent, PriceOption } from "@/lib/restaurant/engine";
import { Badge, Note, RestGuard, money, useAction, useLoad } from "@/components/restaurant/ui";
import { ScheduleFields, scheduleText } from "@/components/restaurant/schedule";

export default function DealsPage() {
  return (
    <RestGuard>
      <Deals />
    </RestGuard>
  );
}

type Deal = Awaited<ReturnType<typeof restaurant.listDeals>>[number];

function Deals() {
  const deals = useLoad(() => restaurant.listDeals(true));
  const menu = useLoad(() => restaurant.listMenuItems({ includeUnavailable: true }));
  const [edit, setEdit] = useState<Partial<Deal> | null>(null);
  const name = (id: string) => menu.data?.find((m) => m.id === id)?.name ?? "?";
  return (
    <div>
      <PageHeader title="Deals & Combos" actions={<Button variant="primary" onClick={() => setEdit({ is_active: 1, items: [] })}>Add Deal</Button>} />
      <p className="mb-3 text-sm text-neutral-500">A deal is a fixed combination of dishes sold at its own price (e.g. Burger + Fries + Drink). Discounts and coupons are under Offers &amp; Promotions.</p>
      {deals.error && <Note tone="rose">{deals.error}</Note>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(deals.data ?? []).map((d) => (
          <button key={d.id} type="button" onClick={() => setEdit(d)} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-black/[0.05] hover:ring-amber-300">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-neutral-900">{d.name}</p>
                <p className="text-xs text-neutral-400">{d.code}</p>
              </div>
              <span className="text-lg font-bold text-amber-800">{money(d.price)}</span>
            </div>
            <ul className="mt-2 text-xs text-neutral-600">
              {d.items.map((c, i) => <li key={i}>{c.qty} x {name(c.menu_item_id)}{c.variant ? ` (${c.variant})` : ""}</li>)}
            </ul>
            <div className="mt-2 flex flex-wrap gap-1">
              {d.is_active ? <Badge cls="bg-emerald-100 text-emerald-800">Active</Badge> : <Badge>Off</Badge>}
              <Badge>{scheduleText(d)}</Badge>
              {d.max_redemptions ? <Badge>{d.redemptions}/{d.max_redemptions} used</Badge> : <Badge>{d.redemptions} sold</Badge>}
            </div>
          </button>
        ))}
        {deals.data?.length === 0 && <Note>No deals yet.</Note>}
      </div>
      {edit && <DealModal deal={edit} menu={menu.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void deals.reload(); }} />}
    </div>
  );
}

function DealModal({ deal, menu, onClose, onSaved }: { deal: Partial<Deal>; menu: { id: string; name: string; price: number; variants: unknown }[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Deal>>(deal);
  const act = useAction();
  const comps: DealComponent[] = f.items ?? [];
  const original = comps.reduce((s, c) => {
    const m = menu.find((x) => x.id === c.menu_item_id);
    if (!m) return s;
    const v = c.variant ? (m.variants as PriceOption[]).find((x) => x.name === c.variant) : null;
    return s + (v ? v.price : m.price) * c.qty;
  }, 0);
  return (
    <Modal title={deal.id ? `Edit ${deal.name}` : "Add Deal"} onClose={onClose} width="max-w-3xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Code" required><Input value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
            <div className="col-span-2"><Field label="Deal name" required><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field></div>
          </div>
          <Field label="Description"><Input value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Deal price" required><Input type="number" min="0" step="any" value={f.price ?? ""} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} /></Field>
            <Field label="Max sales (optional)"><Input type="number" min="0" value={f.max_redemptions ?? ""} onChange={(e) => setF({ ...f, max_redemptions: Number(e.target.value) || null })} /></Field>
          </div>
          <ScheduleFields value={f} onChange={(v) => setF({ ...f, ...v })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active !== 0} onChange={(e) => setF({ ...f, is_active: e.target.checked ? 1 : 0 })} /> Active</label>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600">Dishes in the deal</p>
          {comps.map((c, i) => {
            const m = menu.find((x) => x.id === c.menu_item_id);
            const variants = (m?.variants as PriceOption[] | undefined) ?? [];
            return (
              <div key={i} className="mb-1.5 flex gap-2">
                <Select value={c.menu_item_id} onChange={(e) => setF({ ...f, items: comps.map((x, j) => (j === i ? { ...x, menu_item_id: e.target.value, variant: null } : x)) })}>
                  <option value="">Dish…</option>
                  {menu.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
                {variants.length > 0 && (
                  <Select value={c.variant ?? ""} className="!w-28" onChange={(e) => setF({ ...f, items: comps.map((x, j) => (j === i ? { ...x, variant: e.target.value || null } : x)) })}>
                    <option value="">Regular</option>
                    {variants.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                  </Select>
                )}
                <Input type="number" min="1" value={c.qty} className="!w-16" onChange={(e) => setF({ ...f, items: comps.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)) })} />
                <button type="button" onClick={() => setF({ ...f, items: comps.filter((_, j) => j !== i) })}><X size={14} /></button>
              </div>
            );
          })}
          <button type="button" className="flex items-center gap-1 text-xs text-amber-700 hover:underline" onClick={() => setF({ ...f, items: [...comps, { menu_item_id: "", qty: 1 }] })}><Plus size={12} /> Add dish</button>
          {comps.length > 0 && (
            <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              Dishes at normal prices: {money(original)} · deal price {money(f.price ?? 0)}
              {original > (f.price ?? 0) ? ` · customer saves ${money(original - (f.price ?? 0))}` : ""}. Shown for information only; it is never applied as an extra discount.
            </p>
          )}
          <p className="mt-2 text-[11px] text-neutral-400">If a dish in the deal is unavailable, the deal can&apos;t be ordered until it is available again (no automatic substitution).</p>
        </div>
      </div>
      {act.error && <div className="mt-3"><Note tone="rose">{act.error}</Note></div>}
      <div className="mt-4 flex justify-between border-t border-neutral-100 pt-3">
        {deal.id ? <Button variant="danger" onClick={async () => { if (window.confirm("Delete this deal?")) { const r = await act.run(() => restaurant.deleteDeal(deal.id!)); if (r) onSaved(); } }}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={act.busy} onClick={async () => { const r = await act.run(() => restaurant.saveDeal({ ...f, items: comps.filter((c) => c.menu_item_id) } as never)); if (r) onSaved(); }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
