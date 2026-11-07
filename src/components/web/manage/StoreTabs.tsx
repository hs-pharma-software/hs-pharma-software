"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useFormTabs } from "@/store/formTabsStore";
import type { StoreSettings } from "@/lib/web/sections";
import { ImageField, Note, Pill, Toggle, card, errText, inputCls, labelCls, webCall } from "./shared";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

export function StoreSettingsCard({ settings, tenantId, onSaved }: { settings: StoreSettings; tenantId?: string; onSaved: () => void }) {
  const [s, setS] = useState(settings);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const up = (p: Partial<StoreSettings>) => setS({ ...s, ...p });
  return (
    <div className={`${card} space-y-3`}>
      <p className="text-sm font-semibold text-neutral-800">Ordering, delivery and payment</p>
      <Toggle id="ss-auto" checked={s.autoList} onChange={(v) => up({ autoList: v })} label="Show every product online" hint="All products in your stock list appear on the website, new ones too, including when out of stock (shown as Out of stock). Use Take offline to hide one." />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Toggle id="ss-pick" checked={s.pickup} onChange={(v) => up({ pickup: v })} label="Pickup from the shop" />
          <Toggle id="ss-del" checked={s.delivery} onChange={(v) => up({ delivery: v })} label="Delivery" />
          {s.delivery && (
            <fieldset className="space-y-1 pl-6">
              <legend className="text-xs font-medium text-neutral-600">Delivery areas and charges</legend>
              {s.zones.map((z, i) => (
                <div key={i} className="flex gap-2">
                  <input aria-label={`Area ${i + 1}`} value={z.name} maxLength={60} placeholder="Area" onChange={(e) => up({ zones: s.zones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className={`${inputCls} flex-1`} />
                  <input aria-label={`Charge ${i + 1}`} type="number" min={0} value={z.charge} onChange={(e) => up({ zones: s.zones.map((x, j) => (j === i ? { ...x, charge: Number(e.target.value) || 0 } : x)) })} className={`${inputCls} w-28`} />
                  <button type="button" className="text-xs text-rose-600" onClick={() => up({ zones: s.zones.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
              <button type="button" className="text-xs font-medium text-[var(--accent)] hover:underline" onClick={() => up({ zones: [...s.zones, { name: "", charge: 0 }] })}>+ Add area</button>
            </fieldset>
          )}
          <label htmlFor="ss-min" className={labelCls}>Minimum order (Rs)<input id="ss-min" type="number" min={0} value={s.minOrder} onChange={(e) => up({ minOrder: Number(e.target.value) || 0 })} className={`${inputCls} w-36`} /></label>
          <label htmlFor="ss-hold" className={labelCls}>Hold stock for a new order (hours)<input id="ss-hold" type="number" min={1} max={168} value={s.reserveHours} onChange={(e) => up({ reserveHours: Number(e.target.value) || 24 })} className={`${inputCls} w-24`} /></label>
          <p className="text-[11px] text-neutral-500">A new order holds its stock this long; once confirmed it holds until billed or cancelled.</p>
        </div>
        <div className="space-y-2">
          <Toggle id="ss-cod" checked={s.payment.cod} onChange={(v) => up({ payment: { ...s.payment, cod: v } })} label="Cash on delivery" />
          <Toggle id="ss-pop" checked={s.payment.pickup} onChange={(v) => up({ payment: { ...s.payment, pickup: v } })} label="Pay on pickup" />
          <Toggle id="ss-bank" checked={s.payment.bank} onChange={(v) => up({ payment: { ...s.payment, bank: v } })} label="Bank transfer" hint="Orders stay unpaid until you confirm the transfer." />
          {s.payment.bank && <label htmlFor="ss-bd" className={labelCls}>Bank details shown to customers<textarea id="ss-bd" value={s.bankDetails} maxLength={600} rows={3} onChange={(e) => up({ bankDetails: e.target.value })} className={inputCls} /></label>}
          <p className="text-[11px] text-neutral-500">Online card payments are not connected.</p>
          <label htmlFor="ss-not" className={labelCls}>Notice on the shop page (optional)<textarea id="ss-not" value={s.notice} maxLength={400} rows={2} onChange={(e) => up({ notice: e.target.value })} className={inputCls} /></label>
          <label htmlFor="ss-rx" className={labelCls}>Prescription notice at checkout<textarea id="ss-rx" value={s.rxNotice} maxLength={400} rows={2} onChange={(e) => up({ rxNotice: e.target.value })} className={inputCls} /></label>
        </div>
      </div>
      {msg && <Note kind={msg.ok ? "ok" : "error"}>{msg.text}</Note>}
      <Button variant="primary" onClick={async () => { try { const r = await webCall<StoreSettings>("storeSettings", { settings: s }, tenantId); setS(r); setMsg({ ok: true, text: "Store settings saved. They apply to new orders at once." }); onSaved(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } }}>Save store settings</Button>
    </div>
  );
}

interface Row {
  productId: string; name: string; barcode: string | null; category: string | null; narcotic: boolean; posPrice: number | null; stock: number;
  listing: { showOnline: boolean; allowOrder: boolean; title: string; description: string; images: { url: string; alt: string }[]; onlinePrice: number | null; featured: boolean; onlineCategory: string; rxRequired: boolean; stockVisibility: string; slug: string } | null;
}

/** `pharmacy`: shows the prescription rules (controlled medicines always need one; the server enforces it). */
export function ProductsTab({ tenantId, pharmacy = false }: { tenantId?: string; pharmacy?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [onlyListed, setOnlyListed] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { webCall<Row[]>("products", { q, onlyListed }, tenantId).then(setRows).catch((e) => setError(errText(e))); }, [q, onlyListed, tenantId]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  async function quickToggle(r: Row) {
    setBusy(r.productId);
    setError(null);
    const l = r.listing;
    const on = !l?.showOnline;
    try {
      await webCall("saveListing", {
        productId: r.productId,
        listing: {
          showOnline: on,
          // A new listing becomes orderable at once (controlled medicines never are).
          allowOrder: l ? l.allowOrder : on,
          title: l?.title ?? "", description: l?.description ?? "", images: l?.images ?? [], onlinePrice: l?.onlinePrice ?? null,
          featured: l?.featured ?? false, onlineCategory: l?.onlineCategory ?? "", rxRequired: (l?.rxRequired ?? false) || r.narcotic, stockVisibility: l?.stockVisibility ?? "status",
        },
      }, tenantId);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className={`${card} space-y-3`}>
      <div>
        <p className="text-sm font-semibold text-neutral-800">Products on the website</p>
        <p className="text-xs text-neutral-500">Only products you switch on appear online. Stock and the POS price come from your records; cost price, suppliers and batches are never shown.</p>
        {pharmacy && <p className="mt-1 text-xs font-medium text-amber-800">Prescriptions: controlled medicines always need one. For other medicines, open Edit and tick Prescription required where needed. The customer attaches it at checkout and you approve it before confirming.</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor="pt-q" className={`${labelCls} min-w-[12rem] flex-1`}>Search<input id="pt-q" value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="Name or barcode" /></label>
        <Toggle id="pt-only" checked={onlyListed} onChange={setOnlyListed} label="Only products online" />
      </div>
      {error && <Note kind="error">{error}</Note>}
      {!rows ? <p className="text-sm text-neutral-500">Loading…</p> : !rows.length ? <p className="py-4 text-center text-sm text-neutral-400">No products found.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1.5 pr-2 font-medium">Product</th><th className="py-1.5 pr-2 text-right font-medium">Stock</th><th className="py-1.5 pr-2 text-right font-medium">Price online</th><th className="py-1.5 pr-2 font-medium">Online</th><th className="py-1.5 font-medium"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <Fragment key={r.productId}>
                <tr className={edit === r.productId ? "bg-neutral-50" : ""}>
                  <td className="py-2 pr-2"><span className="font-medium text-neutral-800">{r.listing?.title || r.name}</span>{r.narcotic && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">Controlled: prescription always required</span>}<span className="block text-xs text-neutral-400">{r.category ?? ""}</span></td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.stock}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.listing?.onlinePrice != null ? rs(r.listing.onlinePrice) : r.posPrice != null ? `${rs(r.posPrice)} (POS)` : "–"}</td>
                  <td className="py-2 pr-2 text-xs">{r.listing?.showOnline ? <span className="text-emerald-700">Shown{r.listing.allowOrder ? " · orderable" : ""}{r.listing.rxRequired ? " · Rx" : ""}{r.listing.featured ? " · featured" : ""}</span> : <span className="text-neutral-400">Hidden</span>}</td>
                  <td className="py-2 text-right">
                    <span className="flex flex-wrap justify-end gap-2">
                      <button type="button" disabled={busy === r.productId} onClick={() => void quickToggle(r)}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${r.listing?.showOnline ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-100" : "bg-[var(--accent)] text-white hover:opacity-90"}`}>
                        {busy === r.productId ? "…" : r.listing?.showOnline ? "Take offline" : "Put online"}
                      </button>
                      <button type="button" aria-expanded={edit === r.productId} className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100" onClick={() => setEdit(edit === r.productId ? null : r.productId)}>
                        {edit === r.productId ? "Close" : "Edit"}
                      </button>
                    </span>
                  </td>
                </tr>
                {edit === r.productId && (
                  <tr><td colSpan={5} className="pb-3">
                    <ListingEditor key={r.productId} row={r} tenantId={tenantId} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />
                  </td></tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ListingEditor({ row, tenantId, onClose, onSaved }: { row: Row; tenantId?: string; onClose: () => void; onSaved: () => void }) {
  const l = row.listing;
  const [f, setF] = useState({
    showOnline: l?.showOnline ?? false, allowOrder: l?.allowOrder ?? false, title: l?.title ?? "", description: l?.description ?? "", images: l?.images ?? [],
    onlinePrice: l?.onlinePrice == null ? "" : String(l.onlinePrice), featured: l?.featured ?? false, onlineCategory: l?.onlineCategory ?? "", rxRequired: l?.rxRequired ?? false, stockVisibility: l?.stockVisibility ?? "status",
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3 rounded-xl border border-[var(--accent)]/40 bg-neutral-50 p-3" role="dialog" aria-label={`Online listing: ${row.name}`}>
      <p className="text-sm font-semibold text-neutral-800">{row.name}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle id="le-show" checked={f.showOnline} onChange={(v) => setF({ ...f, showOnline: v })} label="Show on the website" />
        <Toggle id="le-order" checked={f.allowOrder} onChange={(v) => setF({ ...f, allowOrder: v })} label="Allow online orders" />
        <Toggle id="le-rx" checked={f.rxRequired || row.narcotic} disabled={row.narcotic} onChange={(v) => setF({ ...f, rxRequired: v })} label="Prescription required"
          hint={row.narcotic ? "Always on for controlled medicines." : "The customer attaches it; you review it before confirming."} />
        <Toggle id="le-feat" checked={f.featured} onChange={(v) => setF({ ...f, featured: v })} label="Featured" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor="le-title" className={labelCls}>Online name (optional)<input id="le-title" value={f.title} maxLength={140} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} placeholder={row.name} /></label>
        <label htmlFor="le-cat" className={labelCls}>Online category (optional)<input id="le-cat" value={f.onlineCategory} maxLength={60} onChange={(e) => setF({ ...f, onlineCategory: e.target.value })} className={inputCls} placeholder={row.category ?? ""} /></label>
        <label htmlFor="le-price" className={labelCls}>Online price (empty = POS price{row.posPrice != null ? ` ${rs(row.posPrice)}` : ""})<input id="le-price" type="number" min={0} step="0.01" value={f.onlinePrice} onChange={(e) => setF({ ...f, onlinePrice: e.target.value })} className={inputCls} /></label>
        <label htmlFor="le-vis" className={labelCls}>Stock shown to customers
          <select id="le-vis" value={f.stockVisibility} onChange={(e) => setF({ ...f, stockVisibility: e.target.value })} className={inputCls}><option value="status">In stock / out of stock</option><option value="qty">Exact quantity</option><option value="hide">Nothing</option></select>
        </label>
      </div>
      <label htmlFor="le-desc" className={labelCls}>Description (optional)<textarea id="le-desc" value={f.description} maxLength={3000} rows={3} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputCls} /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        {f.images.map((im, i) => <ImageField key={i} id={`le-img${i}`} label={`Photo ${i + 1}`} value={im} tenantId={tenantId} onChange={(v) => setF({ ...f, images: v ? f.images.map((x, j) => (j === i ? v : x)) : f.images.filter((_, j) => j !== i) })} />)}
        {f.images.length < 6 && <ImageField id="le-imgnew" label="Add a photo" value={null} tenantId={tenantId} onChange={(v) => v && setF({ ...f, images: [...f.images, v] })} />}
      </div>
      {error && <Note kind="error">{error}</Note>}
      <div className="flex gap-2">
        <Button variant="primary" onClick={async () => { try { await webCall("saveListing", { productId: row.productId, listing: { ...f, onlinePrice: f.onlinePrice === "" ? null : Number(f.onlinePrice) } }, tenantId); onSaved(); } catch (e) { setError(errText(e)); } }}>Save</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

interface OrderRow { id: string; orderNo: number; status: string; paymentMethod: string; paymentStatus: string; fulfillment: string; name: string; phone: string; total: number; rxRequired: boolean; rxStatus: string | null; holdExpired: boolean; invoiceId: string | null; createdAt: string }
interface OrderFull extends Omit<OrderRow, "holdExpired"> {
  zone: string | null; email: string | null; address: string | null; notes: string | null; subtotal: number; delivery: number; reservedUntil: string | null; next: string[];
  items: { productId: string; name: string; qty: number; price: number; total: number; rx: boolean }[];
  events: { actor: string; action: string; note: string | null; at: string }[];
  files: { id: string; name: string; mime: string; size: number }[];
}
const PAY: Record<string, string> = { cod: "Cash on delivery", pickup: "Pay on pickup", bank: "Bank transfer" };
const NEXT_LABEL: Record<string, string> = { confirmed: "Confirm", preparing: "Preparing", ready: "Ready", dispatched: "Dispatched", completed: "Completed", cancelled: "Cancel", rejected: "Reject" };

export function OrdersTab({ tenantId }: { tenantId?: string }) {
  const [view, setView] = useState<"orders" | "requests">("orders");
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); webCall<OrderRow[]>("orders", { status }, tenantId).then(setRows).catch((e) => setError(errText(e))); }, [status, tenantId]);
  useEffect(load, [load]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
          {(["orders", "requests"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 font-medium ${view === v ? "bg-white shadow-sm" : "text-neutral-500"}`}>{v === "orders" ? "Orders" : "Requests & messages"}</button>)}
        </span>
        {view === "orders" && (
          <label htmlFor="ot-st" className="ml-auto flex items-center gap-2 text-xs text-neutral-600">Show
            <select id="ot-st" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-40`}>
              <option value="open">Open orders</option>{["pending", "confirmed", "preparing", "ready", "dispatched", "completed", "cancelled", "rejected"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </label>
        )}
      </div>
      {view === "requests" ? <RequestsList tenantId={tenantId} /> : (
        <div className={card}>
          {error && <Note kind="error">{error}</Note>}
          {!rows ? <p className="text-sm text-neutral-500">Loading…</p> : !rows.length ? <p className="py-6 text-center text-sm text-neutral-400">No orders here.</p> : (
            <ul className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <li key={r.id} className="py-2">
                  <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} className="flex w-full flex-wrap items-center gap-2 text-left text-sm">
                    <span className="font-semibold text-neutral-800">#{r.orderNo}</span>
                    <span className="min-w-0 flex-1 truncate text-neutral-700">{r.name} · {r.phone}</span>
                    {r.rxRequired && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">Rx {r.rxStatus?.replace("_", " ")}</span>}
                    {r.holdExpired && <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600">Stock hold ended</span>}
                    <span className="tabular-nums">{rs(r.total)}</span>
                    <Pill s={r.status} />
                  </button>
                  {open === r.id && <OrderDetail id={r.id} tenantId={tenantId} onChanged={load} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ id, tenantId, onChanged }: { id: string; tenantId?: string; onChanged: () => void }) {
  const [o, setO] = useState<OrderFull | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const openFromWebOrder = useFormTabs((s) => s.openNewFromWebOrder);
  const load = useCallback(() => { webCall<OrderFull>("order", { id }, tenantId).then(setO).catch((e) => setMsg({ ok: false, text: errText(e) })); }, [id, tenantId]);
  useEffect(load, [load]);
  const act = async (action: string, body: Record<string, unknown>, ok: string) => {
    setMsg(null);
    try { await webCall(action, { id, ...body }, tenantId); setMsg({ ok: true, text: ok }); setNote(""); load(); onChanged(); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  if (!o) return msg ? <Note kind="error">{msg.text}</Note> : <p className="py-2 text-xs text-neutral-500">Loading…</p>;
  const fileUrl = (fid: string) => `/api/web/file/?id=${encodeURIComponent(fid)}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ""}`;
  return (
    <div className="mt-2 space-y-3 rounded-xl bg-neutral-50 p-3 text-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p><b>{o.name}</b> · <a href={`tel:${o.phone}`} className="underline">{o.phone}</a>{o.email ? ` · ${o.email}` : ""}</p>
          <p className="text-neutral-600">{o.fulfillment === "delivery" ? `Delivery to ${o.zone ?? ""}: ${o.address ?? ""}` : "Pickup from the shop"}</p>
          {o.notes && <p className="text-neutral-600">Note: {o.notes}</p>}
          <p className="text-neutral-600">Payment: {PAY[o.paymentMethod] ?? o.paymentMethod} · <b>{o.paymentStatus.replace("_", " ")}</b></p>
          {o.invoiceId ? <p className="text-emerald-700">Billed in the POS (invoice saved).</p> : <p className="text-neutral-500">Not billed yet.</p>}
        </div>
        <ul className="divide-y divide-neutral-200 rounded-lg bg-white">
          {o.items.map((i, k) => <li key={k} className="flex justify-between gap-2 px-2 py-1"><span>{i.name} × {i.qty}{i.rx && <span className="ml-1 text-[10px] text-amber-700">Rx</span>}</span><span className="tabular-nums">{rs(i.total)}</span></li>)}
          {o.delivery > 0 && <li className="flex justify-between px-2 py-1"><span>Delivery</span><span className="tabular-nums">{rs(o.delivery)}</span></li>}
          <li className="flex justify-between px-2 py-1 font-semibold"><span>Total</span><span className="tabular-nums">{rs(o.total)}</span></li>
        </ul>
      </div>

      {o.rxRequired && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="font-medium text-amber-900">Prescription: {o.rxStatus?.replace("_", " ")}</p>
          <ul className="mt-1 flex flex-wrap gap-2">{o.files.map((f) => <li key={f.id}><a href={fileUrl(f.id)} target="_blank" rel="noopener" className="text-xs font-medium text-amber-900 underline">{f.name} ({Math.round(f.size / 1024)} KB)</a></li>)}</ul>
          {["pending", "confirmed"].includes(o.status) && o.rxStatus !== "approved" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => void act("rxReview", { decision: "approved", note }, "Prescription approved.")}>Approve</Button>
              <Button onClick={() => void act("rxReview", { decision: "clarification", note }, "Marked: clarification needed. Call the customer.")}>Ask to clarify</Button>
              <Button variant="danger" onClick={() => void act("rxReview", { decision: "rejected", note }, "Prescription rejected; the order is rejected.")}>Reject</Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={`on-${id}`} className={`${labelCls} min-w-[14rem] flex-1`}>Note (needed to cancel, reject or ask)<input id={`on-${id}`} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></label>
        {o.next.map((n) => <Button key={n} variant={n === "cancelled" || n === "rejected" ? "danger" : "secondary"} onClick={() => void act("orderStatus", { status: n, note }, `Order ${n}.`)}>{NEXT_LABEL[n] ?? n}</Button>)}
        {o.paymentMethod === "bank" && o.paymentStatus !== "paid" && <Button onClick={() => void act("payment", { status: "paid", note }, "Transfer confirmed.")}>Confirm transfer received</Button>}
        {o.paymentMethod !== "bank" && o.paymentStatus === "unpaid" && <Button onClick={() => void act("payment", { status: "paid", note }, "Marked paid.")}>Mark paid</Button>}
        {!o.invoiceId && ["confirmed", "preparing", "ready", "dispatched"].includes(o.status) && !tenantId && (
          <Button variant="primary" onClick={() => openFromWebOrder(o.id)}>Create invoice in POS</Button>
        )}
      </div>
      <p className="text-xs text-neutral-500">Billing opens the usual POS invoice filled from this order: stock, accounts and invoice rules (FBR included) work exactly as for any sale. The order is completed after billing.</p>
      {msg && <Note kind={msg.ok ? "ok" : "error"}>{msg.text}</Note>}
      <details className="text-xs text-neutral-500"><summary className="cursor-pointer">History</summary><ul className="mt-1 space-y-0.5">{o.events.map((e, k) => <li key={k}>{new Date(e.at).toLocaleString("en-PK")} · {e.action.replace("_", " ")} · {e.actor}{e.note ? ` · ${e.note}` : ""}</li>)}</ul></details>
    </div>
  );
}

function RequestsList({ tenantId }: { tenantId?: string }) {
  const [rows, setRows] = useState<{ id: string; kind: string; name: string; phone: string | null; email: string | null; message: string | null; data: Record<string, string>; status: string; createdAt: string }[] | null>(null);
  const load = useCallback(() => { webCall<typeof rows>("requests", {}, tenantId).then(setRows).catch(() => setRows([])); }, [tenantId]);
  useEffect(load, [load]);
  if (!rows) return <p className="text-sm text-neutral-500">Loading…</p>;
  return (
    <div className={card}>
      {!rows.length ? <p className="py-6 text-center text-sm text-neutral-400">No messages or requests yet.</p> : (
        <ul className="divide-y divide-neutral-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className={`py-2 ${r.status !== "new" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] capitalize">{r.kind}</span>
                <b>{r.name}</b>{r.phone && <a href={`tel:${r.phone}`} className="underline">{r.phone}</a>}{r.email && <span>{r.email}</span>}
                <span className="ml-auto text-xs text-neutral-400">{new Date(r.createdAt).toLocaleString("en-PK")}</span>
              </div>
              {r.message && <p className="mt-1 whitespace-pre-line text-neutral-700">{r.message}</p>}
              {(r.data.preferredDate || r.data.doctor || r.data.items) && <p className="text-xs text-neutral-500">{r.data.preferredDate && `Date: ${r.data.preferredDate} `}{r.data.doctor && `Doctor: ${r.data.doctor} `}{r.data.items && `Items: ${r.data.items}`}</p>}
              <div className="mt-1 flex gap-3 text-xs">
                {r.status === "new" ? <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={() => void webCall("requestStatus", { id: r.id, status: "handled" }, tenantId).then(load)}>Mark handled</button>
                  : <button type="button" className="text-neutral-500 hover:underline" onClick={() => void webCall("requestStatus", { id: r.id, status: "new" }, tenantId).then(load)}>Mark new</button>}
                <button type="button" className="text-neutral-500 hover:underline" onClick={() => void webCall("requestStatus", { id: r.id, status: "spam" }, tenantId).then(load)}>Spam</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
