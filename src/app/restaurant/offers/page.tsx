"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { restaurant } from "@/lib/restaurant";
import { Badge, Note, RestGuard, useAction, useLoad } from "@/components/restaurant/ui";
import { ScheduleFields, scheduleText } from "@/components/restaurant/schedule";

export default function OffersPage() {
  return (
    <RestGuard>
      <Offers />
    </RestGuard>
  );
}

type Offer = Awaited<ReturnType<typeof restaurant.listOffers>>[number];

const TYPE_LABEL: Record<string, string> = { percent: "% off", fixed: "Rs off", bogo: "Buy 1 Get 1", buy_x_get_y: "Buy X Get Y" };

const describe = (o: Offer) =>
  o.type === "percent" ? `${o.value}% off` : o.type === "fixed" ? `Rs ${o.value} off` : o.type === "bogo" ? "Buy 1 get 1 free" : `Buy ${o.buy_qty} get ${o.get_qty} free`;

function Offers() {
  const offers = useLoad(() => restaurant.listOffers());
  const [edit, setEdit] = useState<Partial<Offer> | null>(null);
  return (
    <div>
      <PageHeader title="Offers & Promotions" actions={<Button variant="primary" onClick={() => setEdit({ type: "percent", applies_to: "order", is_active: 1, exclude_discounted: 1, target_ids: [] })}>Add Offer</Button>} />
      <div className="mb-3">
        <Note>
          Rules: each offer applies once per bill. A <b>non-stackable</b> offer is never combined with another offer; if several are entered, the bill keeps the better choice. Deal items are left out unless an offer allows it. The total discount never exceeds the bill. Usage limits are counted when the bill is paid.
        </Note>
      </div>
      {offers.error && <Note tone="rose">{offers.error}</Note>}
      <DataTable
        rows={offers.data ?? []}
        onRowClick={(o) => setEdit(o)}
        columns={[
          { header: "Code", render: (o) => <span className="font-mono text-xs">{o.code}</span> },
          { header: "Offer", render: (o) => <span className="font-medium">{o.name}</span> },
          { header: "Benefit", render: (o) => describe(o) },
          { header: "On", render: (o) => (o.applies_to === "order" ? "Whole bill" : `${o.target_ids.length} ${o.applies_to === "category" ? "categories" : "dishes"}`) },
          { header: "Conditions", render: (o) => [o.min_order ? `min Rs ${o.min_order}` : "", o.min_qty ? `min ${o.min_qty} items` : "", o.max_discount ? `max Rs ${o.max_discount}` : "", o.coupon_code ? `coupon ${o.coupon_code}` : ""].filter(Boolean).join(" · ") || "-" },
          { header: "When", render: (o) => scheduleText(o) },
          { header: "Used", render: (o) => (o.usage_limit ? `${o.used_count}/${o.usage_limit}` : o.used_count) },
          { header: "Status", render: (o) => <div className="flex gap-1">{o.is_active ? <Badge cls="bg-emerald-100 text-emerald-800">Active</Badge> : <Badge>Off</Badge>}{o.stackable ? <Badge>Stackable</Badge> : null}</div> },
        ]}
      />
      {edit && <OfferModal offer={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void offers.reload(); }} />}
    </div>
  );
}

function OfferModal({ offer, onClose, onSaved }: { offer: Partial<Offer>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Offer>>(offer);
  const cats = useLoad(() => restaurant.listCategories(true));
  const menu = useLoad(() => restaurant.listMenuItems({ includeUnavailable: true }));
  const act = useAction();
  const targets = f.target_ids ?? [];
  const options = f.applies_to === "category" ? (cats.data ?? []).map((c) => ({ id: c.id, name: c.name })) : (menu.data ?? []).map((m) => ({ id: m.id, name: m.name }));
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <Modal title={offer.id ? `Edit ${offer.name}` : "Add Offer"} onClose={onClose} width="max-w-3xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Code" required><Input value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
            <div className="col-span-2"><Field label="Offer name" required><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Offer["type"] })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            {(f.type === "percent" || f.type === "fixed") && (
              <Field label={f.type === "percent" ? "Percent off" : "Rs off"} required><Input type="number" min="0" step="any" value={f.value ?? ""} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} /></Field>
            )}
            {f.type === "buy_x_get_y" && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Buy"><Input type="number" min="1" value={f.buy_qty ?? ""} onChange={(e) => setF({ ...f, buy_qty: num(e.target.value) })} /></Field>
                <Field label="Get free"><Input type="number" min="1" value={f.get_qty ?? ""} onChange={(e) => setF({ ...f, get_qty: num(e.target.value) })} /></Field>
              </div>
            )}
          </div>
          {(f.type === "bogo" || f.type === "buy_x_get_y") && <p className="text-[11px] text-neutral-500">The cheapest qualifying items are the free ones.</p>}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Min bill (Rs)"><Input type="number" min="0" value={f.min_order ?? ""} onChange={(e) => setF({ ...f, min_order: num(e.target.value) })} /></Field>
            <Field label="Min items"><Input type="number" min="0" value={f.min_qty ?? ""} onChange={(e) => setF({ ...f, min_qty: num(e.target.value) })} /></Field>
            <Field label="Max discount (Rs)"><Input type="number" min="0" value={f.max_discount ?? ""} onChange={(e) => setF({ ...f, max_discount: num(e.target.value) })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Coupon code (optional)"><Input value={f.coupon_code ?? ""} onChange={(e) => setF({ ...f, coupon_code: e.target.value.toUpperCase() || null })} /></Field>
            <Field label="Usage limit (total)"><Input type="number" min="0" value={f.usage_limit ?? ""} onChange={(e) => setF({ ...f, usage_limit: num(e.target.value) })} /></Field>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_active !== 0} onChange={(e) => setF({ ...f, is_active: e.target.checked ? 1 : 0 })} /> Active</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.stackable} onChange={(e) => setF({ ...f, stackable: e.target.checked ? 1 : 0 })} /> Can combine with other stackable offers</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.exclude_discounted !== 0} onChange={(e) => setF({ ...f, exclude_discounted: e.target.checked ? 1 : 0 })} /> Skip deal items</label>
          </div>
        </div>
        <div className="space-y-3">
          <Field label="Applies to">
            <Select value={f.applies_to} onChange={(e) => setF({ ...f, applies_to: e.target.value as Offer["applies_to"], target_ids: [] })}>
              <option value="order">Whole bill</option>
              <option value="category">Selected categories</option>
              <option value="items">Selected dishes</option>
            </Select>
          </Field>
          {f.applies_to !== "order" && (
            <div className="max-h-44 overflow-y-auto rounded-xl border border-neutral-200 p-2">
              {options.map((o) => (
                <label key={o.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={targets.includes(o.id)} onChange={() => setF({ ...f, target_ids: targets.includes(o.id) ? targets.filter((x) => x !== o.id) : [...targets, o.id] })} />
                  {o.name}
                </label>
              ))}
            </div>
          )}
          <ScheduleFields value={f} onChange={(v) => setF({ ...f, ...v })} />
          <p className="text-[11px] text-neutral-400">Happy hour: set From/To time. Weekend offer: pick the days.</p>
        </div>
      </div>
      {act.error && <div className="mt-3"><Note tone="rose">{act.error}</Note></div>}
      <div className="mt-4 flex justify-between border-t border-neutral-100 pt-3">
        {offer.id ? <Button variant="danger" onClick={async () => { if (window.confirm("Delete this offer? Past bills keep the discount they got.")) { const r = await act.run(() => restaurant.deleteOffer(offer.id!)); if (r) onSaved(); } }}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={act.busy} onClick={async () => { const r = await act.run(() => restaurant.saveOffer(f as never)); if (r) onSaved(); }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
