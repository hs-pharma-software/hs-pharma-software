"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChefHat, Minus, Plus, Receipt, RefreshCw, Search, ShoppingBag, Bike, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { restaurant, pra, errorText } from "@/lib/restaurant";
import { tableDisplayStatus, type KitchenStatus, type PayMethod, type TableStatus } from "@/lib/restaurant/engine";
import type { OrderItemRow, OrderRow } from "@/lib/restaurant/store";
import { tenantsRepo } from "@/lib/repo/tenants";
import { useAuthStore } from "@/store/authStore";
import { useCan } from "@/lib/actionPermissions";
import { Badge, KITCHEN_BADGE, Note, ORDER_TYPE_LABEL, RestGuard, money, useAction, useLoad, usePrinter, type ReceiptData } from "@/components/restaurant/ui";

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  available: { label: "Available", cls: "bg-emerald-50 ring-emerald-300 text-emerald-800" },
  reserved: { label: "Reserved", cls: "bg-violet-50 ring-violet-300 text-violet-800" },
  occupied: { label: "Occupied", cls: "bg-amber-50 ring-amber-300 text-amber-900" },
  order_placed: { label: "Order placed", cls: "bg-orange-50 ring-orange-300 text-orange-900" },
  preparing: { label: "Preparing", cls: "bg-sky-50 ring-sky-300 text-sky-900" },
  ready: { label: "Ready to serve", cls: "bg-teal-50 ring-teal-400 text-teal-900" },
  bill_requested: { label: "Bill requested", cls: "bg-rose-50 ring-rose-300 text-rose-800" },
};

const minutesSince = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

export default function RestaurantPosPage() {
  return (
    <RestGuard>
      <Pos />
    </RestGuard>
  );
}

function Pos() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const printer = usePrinter();
  const tenant = useAuthStore((s) => s.currentTenant);
  const [business, setBusiness] = useState<ReceiptData["business"]>({ name: tenant?.name ?? "Restaurant" });
  useEffect(() => {
    if (tenant?.id) void tenantsRepo.get(tenant.id).then((t) => t && setBusiness({ name: t.name, address: t.address, phone: t.phone }));
  }, [tenant?.id]);

  return (
    <div>
      {orderId ? (
        <OrderScreen orderId={orderId} onClose={() => setOrderId(null)} onSwitch={setOrderId} printer={printer} business={business} />
      ) : (
        <Floor onOpen={setOrderId} />
      )}
      {printer.view}
    </div>
  );
}

// ── Floor ─────────────────────────────────────────────────────────────

function Floor({ onOpen }: { onOpen: (orderId: string) => void }) {
  const { data, error, reload } = useLoad(async () => {
    const [tables, open, queue, tax] = await Promise.all([restaurant.listTables(), restaurant.listOpenOrders(), restaurant.kitchenQueue(), restaurant.settings.tax()]);
    return { tables, open, queue, tax };
  });
  const act = useAction();
  useEffect(() => {
    const t = setInterval(() => void reload(), 15000);
    return () => clearInterval(t);
  }, [reload]);

  const byArea = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>["tables"]>();
    for (const t of data?.tables ?? []) m.set(t.area || "Main Hall", [...(m.get(t.area || "Main Hall") ?? []), t]);
    return [...m.entries()];
  }, [data]);

  const statusOf = (t: NonNullable<typeof data>["tables"][number]) =>
    tableDisplayStatus(
      t.status as TableStatus,
      (data?.queue ?? []).filter((q) => q.order_id === t.current_order_id).map((q) => ({ kitchen_status: q.kitchen_status as KitchenStatus }))
    );

  const open = async (tableId: string | null, type: "dine_in" | "takeaway" | "delivery") => {
    const res = await act.run(() => restaurant.openOrder({ type, tableId }));
    if (res) onOpen(res.order.id);
  };

  const takeaways = (data?.open ?? []).filter((o) => o.order_type !== "dine_in" || !o.table_id || !data?.tables.some((t) => t.current_order_id === o.id));

  return (
    <div>
      <PageHeader
        title="Tables & Orders"
        actions={
          <>
            <Button variant="primary" onClick={() => void open(null, "takeaway")}>
              <ShoppingBag size={14} /> New Takeaway
            </Button>
            <Button onClick={() => void open(null, "delivery")}>
              <Bike size={14} /> New Delivery
            </Button>
            <Button onClick={() => void reload()}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </>
        }
      />
      {data && !data.tax.configured && <div className="mb-3"><Note tone="amber">Sales tax rates are not set yet. Set them in Restaurant Settings &gt; Billing &amp; Tax before billing customers.</Note></div>}
      {(error || act.error) && <div className="mb-3"><Note tone="rose">{error ?? act.error}</Note></div>}
      {data && data.tables.length === 0 && <Note>No tables yet. Add them in Restaurant POS &gt; Table Setup, or use Takeaway / Delivery.</Note>}

      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        {Object.entries(STATUS_STYLE).map(([k, v]) => (
          <span key={k} className={`rounded-full px-2 py-0.5 ring-1 ${v.cls}`}>{v.label}</span>
        ))}
      </div>

      {byArea.map(([area, tables]) => (
        <section key={area} className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-400">{area}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {tables.map((t) => {
              const st = statusOf(t);
              const s = STATUS_STYLE[st];
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={act.busy}
                  onClick={() => (t.current_order_id ? onOpen(t.current_order_id) : void open(t.id, "dine_in"))}
                  className={`flex aspect-square flex-col items-center justify-center rounded-2xl p-2 text-center ring-2 transition hover:scale-[1.02] ${s.cls}`}
                >
                  <span className="text-lg font-bold">{t.name}</span>
                  <span className="text-[11px]">{t.capacity} seats</span>
                  <span className="mt-1 text-[11px] font-semibold">{s.label}</span>
                  {t.current_order_id && (
                    <span className="mt-1 text-[11px]">
                      #{t.order_no} · {minutesSince(t.opened_at)} min
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {takeaways.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-400">Takeaway &amp; delivery</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {takeaways.map((o) => (
              <button key={o.id} type="button" onClick={() => onOpen(o.id)} className="rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-black/[0.06] hover:ring-amber-300">
                <p className="font-semibold text-neutral-900">#{o.order_no}</p>
                <p className="text-xs text-neutral-500">{ORDER_TYPE_LABEL[o.order_type]}{o.table_name ? ` · ${o.table_name}` : ""}</p>
                <p className="mt-1 text-xs text-neutral-500">{minutesSince(o.opened_at)} min · {o.status === "billed" ? "Bill requested" : "Open"}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Order screen ──────────────────────────────────────────────────────

type Printer = ReturnType<typeof usePrinter>;

function OrderScreen({ orderId, onClose, onSwitch, printer, business }: { orderId: string; onClose: () => void; onSwitch: (id: string) => void; printer: Printer; business: ReceiptData["business"] }) {
  const order = useLoad(() => restaurant.getOrder(orderId), [orderId]);
  const menu = useLoad(async () => {
    const [categories, items, deals, tables] = await Promise.all([restaurant.listCategories(), restaurant.listMenuItems(), restaurant.listDeals(false), restaurant.listTables()]);
    return { categories, items, deals, tables };
  });
  const [tab, setTab] = useState<string>("all");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<NonNullable<typeof menu.data>["items"][number] | null>(null);
  const [paying, setPaying] = useState(false);
  const [moving, setMoving] = useState<"move" | "merge" | "split" | "cancel" | null>(null);
  const act = useAction();
  const canVoid = useCan("rest.void");

  const o = order.data?.order;
  const items = order.data?.items ?? [];
  const tableName = menu.data?.tables.find((t) => t.id === o?.table_id)?.name ?? null;
  const lines = items.filter((i) => !i.parent_item_id);
  const fresh = lines.filter((i) => i.kitchen_status === "new");
  const sent = lines.filter((i) => i.kitchen_status !== "new");
  const comps = (id: string) => items.filter((i) => i.parent_item_id === id);
  const running = lines.filter((i) => i.kitchen_status !== "cancelled").reduce((s, i) => s + i.line_total, 0);
  const locked = !o || (o.status !== "open" && o.status !== "billed") || o.payment_status === "partial";

  const shown = (menu.data?.items ?? []).filter((m) => (tab === "all" || m.category_id === tab) && (!q.trim() || `${m.name} ${m.code}`.toLowerCase().includes(q.trim().toLowerCase())));

  const refresh = () => void order.reload();

  async function add(itemId: string, opts: { variant?: string | null; modifiers?: string[]; qty?: number; notes?: string } = {}) {
    await act.run(() => restaurant.addItem(orderId, { menuItemId: itemId, ...opts }));
    refresh();
  }

  async function sendKitchen() {
    const tickets = await act.run(() => restaurant.sendToKitchen(orderId));
    if (!tickets) return;
    for (const t of tickets) {
      const mark = await restaurant.markKotPrinted(t.kot.id);
      const full = await restaurant.kotWithItems(t.kot.id);
      printer.print({ kind: "kot", data: { ...full, reprint: mark.reprint, copy: mark.copy } });
    }
    refresh();
  }

  if (order.error) return <Note tone="rose">{order.error}</Note>;
  if (!o) return <p className="py-10 text-center text-sm text-neutral-400">Loading order...</p>;

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col gap-3 lg:flex-row">
      {/* Menu side */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-2">
          <Button onClick={onClose}>
            <ArrowLeft size={14} /> Floor
          </Button>
          <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-1.5 ring-1 ring-black/[0.06]">
            <Search size={14} className="text-neutral-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dish or code..." className="flex-1 bg-transparent text-sm outline-none" />
          </div>
        </div>
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {[{ id: "all", name: "All" }, ...(menu.data?.categories ?? []), { id: "deals", name: "Deals" }].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setTab(c.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${tab === c.id ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 ring-1 ring-black/[0.06] hover:bg-neutral-50"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
          {tab === "deals"
            ? (menu.data?.deals ?? []).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={locked || act.busy}
                  onClick={async () => {
                    await act.run(() => restaurant.addDeal(orderId, d.id));
                    refresh();
                  }}
                  className="rounded-2xl bg-amber-50 p-3 text-left ring-1 ring-amber-200 hover:ring-amber-400 disabled:opacity-50"
                >
                  <p className="font-semibold text-neutral-900">{d.name}</p>
                  <p className="text-[11px] text-neutral-500">{d.items.length} dishes · {d.code}</p>
                  <p className="mt-1 text-sm font-bold text-amber-800">{money(d.price)}</p>
                </button>
              ))
            : shown.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={locked || act.busy}
                  onClick={() => ((m.variants as unknown as unknown[]).length || (m.modifiers as unknown as unknown[]).length ? setPicking(m) : void add(m.id))}
                  className="flex flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] hover:ring-amber-300 disabled:opacity-50"
                >
                  {m.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt="" className="mb-2 h-20 w-full rounded-lg object-cover" />
                  )}
                  <p className="font-semibold leading-tight text-neutral-900">{m.name}</p>
                  <p className="text-[11px] text-neutral-400">{m.code}{m.category_name ? ` · ${m.category_name}` : ""}</p>
                  <p className="mt-auto pt-1 text-sm font-bold text-neutral-800">
                    {money(o.order_type !== "dine_in" && m.takeaway_price ? m.takeaway_price : m.price)}
                    {((m.variants as unknown as unknown[]).length > 0 || (m.modifiers as unknown as unknown[]).length > 0) && <span className="ml-1 text-[10px] font-normal text-neutral-400">+ options</span>}
                  </p>
                </button>
              ))}
          {tab !== "deals" && shown.length === 0 && <p className="col-span-full py-8 text-center text-sm text-neutral-400">No dishes{q ? " match" : " in this category"}.</p>}
        </div>
      </div>

      {/* Order side */}
      <div className="flex min-h-0 w-full flex-col rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/[0.06] lg:w-[400px]">
        <div className="mb-2 flex items-start justify-between">
          <div>
            <p className="text-lg font-bold text-neutral-900">
              {tableName ? `Table ${tableName}` : ORDER_TYPE_LABEL[o.order_type]} · #{o.order_no}
            </p>
            <p className="text-xs text-neutral-500">
              {o.status === "billed" ? "Bill requested" : o.status}
              {o.payment_status === "partial" ? ` · part paid ${money(o.paid)}` : ""} · {minutesSince(o.opened_at)} min
            </p>
          </div>
          <Select value="" onChange={(e) => setMoving(e.target.value as never)} className="!w-28 text-xs" disabled={locked}>
            <option value="">More…</option>
            {o.order_type === "dine_in" && <option value="move">Move table</option>}
            <option value="merge">Merge into…</option>
            <option value="split">Split bill</option>
            {canVoid && <option value="cancel">Cancel order</option>}
          </Select>
        </div>
        {act.error && <div className="mb-2"><Note tone="rose">{act.error}</Note></div>}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {fresh.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-sky-700">New — not sent yet</p>
              {fresh.map((i) => (
                <ItemRow key={i.id} item={i} comps={comps(i.id)} editable onChanged={refresh} />
              ))}
            </div>
          )}
          {sent.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Sent to kitchen</p>
              {sent.map((i) => (
                <ItemRow key={i.id} item={i} comps={comps(i.id)} canVoid={canVoid && !locked} onChanged={refresh} />
              ))}
            </div>
          )}
          {lines.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">Pick dishes from the menu.</p>}
        </div>

        <div className="mt-2 border-t border-neutral-100 pt-2">
          <div className="mb-2 flex justify-between text-sm font-semibold">
            <span>Running total (before discount & tax)</span>
            <span>{money(running)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Button disabled={locked || !fresh.length || act.busy} onClick={() => void sendKitchen()} className="justify-center">
              <ChefHat size={14} /> Kitchen
            </Button>
            <Button
              disabled={locked || o.status === "billed" || !lines.length || act.busy}
              onClick={async () => {
                await act.run(() => restaurant.requestBill(orderId));
                refresh();
              }}
              className="justify-center"
            >
              <Receipt size={14} /> Bill
            </Button>
            <Button variant="primary" disabled={!lines.length || act.busy || (o.status !== "open" && o.status !== "billed")} onClick={() => setPaying(true)} className="justify-center">
              Pay
            </Button>
          </div>
        </div>
      </div>

      {picking && (
        <OptionsModal
          item={picking}
          orderType={o.order_type}
          onClose={() => setPicking(null)}
          onAdd={async (opts) => {
            setPicking(null);
            await add(picking.id, opts);
          }}
        />
      )}
      {paying && (
        <PaymentModal
          order={o}
          onClose={() => setPaying(false)}
          onDone={async (paid, change) => {
            setPaying(false);
            // Fiscalise with PRA before printing so the receipt carries the number.
            let final = paid;
            if (paid.pra_status === "pending") {
              const sub = (await restaurant.praSubmissions()).find((s) => s.order_id === paid.id && s.invoice_type === 1);
              if (sub) await pra.submit(sub.id).catch(() => undefined);
              final = (await restaurant.getOrder(paid.id)).order;
            }
            const full = await restaurant.getOrder(paid.id);
            printer.print({ kind: "receipt", data: { order: final, items: full.items, business, tableName, change } });
            onClose();
          }}
          onPartial={refresh}
        />
      )}
      {moving && (
        <MoreModal
          kind={moving}
          order={o}
          items={lines.filter((i) => i.kitchen_status !== "cancelled")}
          tables={menu.data?.tables ?? []}
          onClose={() => setMoving(null)}
          onDone={(nextId) => {
            setMoving(null);
            if (nextId === "floor") onClose();
            else if (nextId) onSwitch(nextId);
            else refresh();
          }}
        />
      )}
    </div>
  );
}

function ItemRow({ item, comps, editable, canVoid, onChanged }: { item: OrderItemRow; comps: OrderItemRow[]; editable?: boolean; canVoid?: boolean; onChanged: () => void }) {
  const act = useAction();
  const mods = JSON.parse(item.modifiers ?? "[]") as string[];
  return (
    <div className="border-b border-neutral-50 py-1.5 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${item.kitchen_status === "cancelled" ? "text-neutral-400 line-through" : "text-neutral-900"}`}>{item.name}</p>
          {mods.length > 0 && <p className="text-[11px] text-neutral-500">+ {mods.join(", ")}</p>}
          {comps.map((c) => (
            <p key={c.id} className="text-[11px] text-neutral-500">
              · {c.qty} x {c.name} <Badge cls={KITCHEN_BADGE[c.kitchen_status]}>{c.kitchen_status}</Badge>
            </p>
          ))}
          {item.notes && <p className="text-[11px] italic text-neutral-500">Note: {item.notes}</p>}
          {item.cancel_reason && <p className="text-[11px] text-rose-600">{item.cancel_reason}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-semibold">{money(item.line_total)}</span>
          {!editable && !comps.length && <Badge cls={KITCHEN_BADGE[item.kitchen_status]}>{item.kitchen_status}</Badge>}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {editable ? (
          <>
            <button type="button" disabled={act.busy || item.qty <= 1} onClick={async () => { await act.run(() => restaurant.setItemQty(item.id, item.qty - 1)); onChanged(); }} className="rounded-full bg-neutral-100 p-1 disabled:opacity-40"><Minus size={12} /></button>
            <span className="w-6 text-center text-xs font-semibold">{item.qty}</span>
            <button type="button" disabled={act.busy} onClick={async () => { await act.run(() => restaurant.setItemQty(item.id, item.qty + 1)); onChanged(); }} className="rounded-full bg-neutral-100 p-1"><Plus size={12} /></button>
            <span className="text-[11px] text-neutral-400">x {money(item.unit_price)}</span>
            <button type="button" title="Remove" disabled={act.busy} onClick={async () => { await act.run(() => restaurant.cancelItem(item.id, "")); onChanged(); }} className="ml-auto rounded-full p-1 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={13} /></button>
          </>
        ) : (
          <>
            <span className="text-[11px] text-neutral-400">{item.qty} x {money(item.unit_price)}{item.kot_no ? ` · KOT ${item.kot_no}` : ""}</span>
            {canVoid && item.kitchen_status !== "cancelled" && item.kitchen_status !== "served" && (
              <button
                type="button"
                className="ml-auto text-[11px] text-rose-600 hover:underline"
                onClick={async () => {
                  const reason = window.prompt(`Cancel "${item.name}"? Reason:`);
                  if (reason === null) return;
                  await act.run(() => restaurant.cancelItem(item.id, reason));
                  onChanged();
                }}
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
      {act.error && <p className="text-[11px] text-rose-600">{act.error}</p>}
    </div>
  );
}

function OptionsModal({
  item,
  orderType,
  onClose,
  onAdd,
}: {
  item: { name: string; price: number; takeaway_price: number | null; variants: unknown; modifiers: unknown };
  orderType: string;
  onClose: () => void;
  onAdd: (o: { variant: string | null; modifiers: string[]; qty: number; notes: string }) => void;
}) {
  const variants = item.variants as { name: string; price: number }[];
  const modifiers = item.modifiers as { name: string; price: number }[];
  const [variant, setVariant] = useState<string | null>(null);
  const [mods, setMods] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const base = variant ? variants.find((v) => v.name === variant)!.price : orderType !== "dine_in" && item.takeaway_price ? item.takeaway_price : item.price;
  const unit = base + modifiers.filter((m) => mods.includes(m.name)).reduce((s, m) => s + m.price, 0);
  return (
    <Modal title={item.name} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        {variants.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-neutral-500">Size</p>
            <div className="flex flex-wrap gap-1.5">
              {[{ name: null as string | null, price: orderType !== "dine_in" && item.takeaway_price ? item.takeaway_price : item.price }, ...variants].map((v) => (
                <button key={v.name ?? "regular"} type="button" onClick={() => setVariant(v.name)} className={`rounded-full px-3 py-1.5 text-sm ring-1 ${variant === v.name ? "bg-neutral-900 text-white ring-neutral-900" : "ring-neutral-200"}`}>
                  {v.name ?? "Regular"} · {money(v.price)}
                </button>
              ))}
            </div>
          </div>
        )}
        {modifiers.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-neutral-500">Add-ons</p>
            <div className="grid grid-cols-2 gap-1.5">
              {modifiers.map((m) => (
                <label key={m.name} className="flex items-center gap-2 rounded-lg px-2 py-1.5 ring-1 ring-neutral-200">
                  <input type="checkbox" checked={mods.includes(m.name)} onChange={() => setMods((x) => (x.includes(m.name) ? x.filter((y) => y !== m.name) : [...x, m.name]))} />
                  <span className="flex-1 text-sm">{m.name}</span>
                  <span className="text-xs text-neutral-500">+{m.price}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-end gap-3">
          <Field label="Quantity">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="rounded-full bg-neutral-100 p-2"><Minus size={14} /></button>
              <span className="w-8 text-center font-semibold">{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} className="rounded-full bg-neutral-100 p-2"><Plus size={14} /></button>
            </div>
          </Field>
          <div className="flex-1">
            <Field label="Kitchen note">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. less spicy" />
            </Field>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
          <span className="text-lg font-bold">{money(unit * qty)}</span>
          <Button variant="primary" onClick={() => onAdd({ variant, modifiers: mods, qty, notes })}>Add to order</Button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({ order, onClose, onDone, onPartial }: { order: OrderRow; onClose: () => void; onDone: (o: OrderRow, change: number) => void; onPartial: () => void }) {
  const canDiscount = useCan("rest.discount");
  const [codes, setCodes] = useState<string[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [coupon, setCoupon] = useState("");
  const [discount, setDiscount] = useState("");
  const [pays, setPays] = useState<{ method: PayMethod; amount: string }[]>([{ method: "cash", amount: "" }]);
  const [customer, setCustomer] = useState({ name: order.customer_name ?? "", phone: order.customer_phone ?? "" });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof restaurant.previewBill>> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const act = useAction();
  const earlier = order.payments ? (JSON.parse(order.payments) as { method: PayMethod; amount: number }[]) : [];
  const methods = [...new Set([...earlier.map((p) => p.method), ...pays.filter((p) => Number(p.amount) > 0).map((p) => p.method), ...(pays.length ? [pays[0].method] : [])])];

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setPreview(await restaurant.previewBill(order.id, { offerCodes: codes, coupon: coupon || null, manualDiscount: Number(discount) || 0, methods }));
        setPreviewError(null);
      } catch (e) {
        setPreviewError(errorText(e));
      }
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, codes.join(","), coupon, discount, methods.join(",")]);

  const total = preview ? preview.bill.totalPaisa / 100 : 0;
  const paidBefore = earlier.reduce((s, p) => s + Number(p.amount), 0);
  const tendered = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const due = Math.max(0, Math.round((total - paidBefore) * 100) / 100);
  const balance = Math.round((due - tendered) * 100) / 100;

  return (
    <Modal title={`Payment · Order #${order.order_no}`} onClose={onClose} width="max-w-2xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Offer / coupon code">
            <div className="flex gap-2">
              <Input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="e.g. LUNCH20" />
              <Button
                onClick={() => {
                  const c = codeInput.trim();
                  if (c) {
                    setCodes((x) => [...x, c]);
                    if (!coupon) setCoupon(c);
                  }
                  setCodeInput("");
                }}
              >
                Apply
              </Button>
            </div>
          </Field>
          {codes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {codes.map((c, i) => (
                <span key={`${c}${i}`} className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                  {c}
                  <button type="button" onClick={() => setCodes((x) => x.filter((_, j) => j !== i))}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          {canDiscount && (
            <Field label="Manual discount (Rs)">
              <Input type="number" min="0" step="any" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Customer name">
              <Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            </Field>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-600">Payments</p>
            {pays.map((p, i) => (
              <div key={i} className="mb-1.5 flex gap-2">
                <Select value={p.method} onChange={(e) => setPays((x) => x.map((y, j) => (j === i ? { ...y, method: e.target.value as PayMethod } : y)))} className="!w-32">
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank transfer</option>
                  <option value="digital">JazzCash / Easypaisa / Raast</option>
                </Select>
                <Input type="number" min="0" step="any" value={p.amount} onChange={(e) => setPays((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} placeholder="Amount" />
                <Button onClick={() => setPays((x) => x.map((y, j) => (j === i ? { ...y, amount: String(Math.max(0, due - x.filter((_, k) => k !== j).reduce((s, z) => s + (Number(z.amount) || 0), 0))) } : y)))}>Exact</Button>
                {pays.length > 1 && <button type="button" onClick={() => setPays((x) => x.filter((_, j) => j !== i))}><X size={14} /></button>}
              </div>
            ))}
            <button type="button" className="text-xs text-amber-700 hover:underline" onClick={() => setPays((x) => [...x, { method: "card", amount: "" }])}>
              + Split payment
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-neutral-50 p-3 text-sm">
          {previewError && <Note tone="rose">{previewError}</Note>}
          {preview && (
            <div className="space-y-1">
              {!preview.taxConfigured && <Note tone="amber">Tax rates not set: tax is 0. Set them in Restaurant Settings.</Note>}
              <Row label="Total" value={money(preview.bill.grossPaisa / 100)} />
              {preview.promo.applied.map((a) => <Row key={a.offerId} label={`Offer ${a.code} – ${a.name}`} value={`-${money(a.discountPaisa / 100)}`} />)}
              {preview.promo.rejected.map((r) => <p key={r.code} className="text-[11px] text-rose-600">{r.reason}</p>)}
              {preview.manualDiscountPaisa > 0 && <Row label="Manual discount" value={`-${money(preview.manualDiscountPaisa / 100)}`} />}
              {preview.bill.servicePaisa > 0 && <Row label="Service charge" value={money(preview.bill.servicePaisa / 100)} />}
              <Row label={`Sales tax (${preview.bill.taxRate}% ${methods.includes("cash") || !methods.length ? "cash" : "card/digital"} rate)`} value={money(preview.bill.taxPaisa / 100)} />
              <div className="border-t border-neutral-200 pt-1">
                <Row label="Grand total" value={money(total)} bold />
              </div>
              {paidBefore > 0 && <Row label="Already paid" value={money(paidBefore)} />}
              <Row label="Due now" value={money(due)} bold />
              <Row label="Tendered" value={money(tendered)} />
              <Row label={balance > 0 ? "Still due" : "Change"} value={money(Math.abs(balance))} bold />
            </div>
          )}
        </div>
      </div>
      {act.error && <div className="mt-3"><Note tone="rose">{act.error}</Note></div>}
      <div className="mt-4 flex justify-end gap-2 border-t border-neutral-100 pt-3">
        <Button onClick={onClose}>Back</Button>
        <Button
          variant="primary"
          disabled={act.busy || !preview || tendered <= 0}
          onClick={async () => {
            const res = await act.run(() =>
              restaurant.pay(order.id, {
                payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })),
                offerCodes: codes,
                coupon: coupon || null,
                manualDiscount: Number(discount) || 0,
                customerName: customer.name,
                customerPhone: customer.phone,
              })
            );
            if (!res) return;
            if (res.finalized) onDone(res.order, res.change);
            else {
              onPartial();
              onClose();
            }
          }}
        >
          {balance > 0 ? "Take part payment" : "Pay & print receipt"}
        </Button>
      </div>
    </Modal>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <span className="text-neutral-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function MoreModal({
  kind,
  order,
  items,
  tables,
  onClose,
  onDone,
}: {
  kind: "move" | "merge" | "split" | "cancel";
  order: OrderRow;
  items: OrderItemRow[];
  tables: { id: string; name: string; current_order_id: string | null; area: string | null }[];
  onClose: () => void;
  onDone: (next: string | null) => void;
}) {
  const act = useAction();
  const [target, setTarget] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const others = useLoad(() => restaurant.listOpenOrders(), []);
  const title = { move: "Move to another table", merge: "Merge this order into…", split: "Split bill", cancel: "Cancel order" }[kind];
  return (
    <Modal title={title} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        {kind === "move" && (
          <Field label="Free table">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              {tables.filter((t) => !t.current_order_id).map((t) => <option key={t.id} value={t.id}>{t.area ? `${t.area} · ` : ""}{t.name}</option>)}
            </Select>
          </Field>
        )}
        {kind === "merge" && (
          <Field label="Open order to merge into">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              {(others.data ?? []).filter((x) => x.id !== order.id).map((x) => <option key={x.id} value={x.id}>#{x.order_no} {x.table_name ? `· Table ${x.table_name}` : `· ${ORDER_TYPE_LABEL[x.order_type]}`}</option>)}
            </Select>
          </Field>
        )}
        {kind === "split" && (
          <div>
            <p className="mb-1 text-xs text-neutral-500">Dishes to move to a separate bill:</p>
            {items.map((i) => (
              <label key={i.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" checked={chosen.includes(i.id)} onChange={() => setChosen((x) => (x.includes(i.id) ? x.filter((y) => y !== i.id) : [...x, i.id]))} />
                <span className="flex-1">{i.qty} x {i.name}</span>
                <span>{money(i.line_total)}</span>
              </label>
            ))}
          </div>
        )}
        {kind === "cancel" && (
          <Field label="Reason (required)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        )}
        {act.error && <Note tone="rose">{act.error}</Note>}
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button onClick={onClose}>Back</Button>
          <Button
            variant={kind === "cancel" ? "danger" : "primary"}
            disabled={act.busy}
            onClick={async () => {
              if (kind === "move") { const ok = await act.run(() => restaurant.moveOrder(order.id, target)); if (ok !== undefined) onDone(null); }
              if (kind === "merge") { const ok = await act.run(() => restaurant.mergeOrders(order.id, target)); if (ok !== undefined) onDone(target); }
              if (kind === "split") { const r = await act.run(() => restaurant.splitOrder(order.id, chosen)); if (r) onDone(r.order.id); }
              if (kind === "cancel") { const ok = await act.run(() => restaurant.cancelOrder(order.id, reason)); if (ok !== undefined) onDone("floor"); }
            }}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
