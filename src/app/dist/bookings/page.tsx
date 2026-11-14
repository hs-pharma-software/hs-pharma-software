"use client";

import { useMemo, useRef, useState } from "react";
import { MapPin, Plus, Printer, RefreshCw, Send, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText, openMaps } from "@/lib/dist";
import { schemeLabel, schemeOffer } from "@/lib/dist/engine";
import type { DistDoc, DistDocItem, DistProduct, DistScheme } from "@/lib/dist/store";
import { startTracking, useTracker } from "@/lib/dist/tracker";
import { printDirect } from "@/lib/print";
import { Badge, BOOKING_TONE, DistGuard, Err, Note, PageTitle, money, monthStart, todayYmd, useLoad, type DistCtx } from "@/components/dist/ui";
import { DocView, ReturnModal } from "@/components/dist/DocView";
import { ProductPicker } from "@/components/dist/DocForm";
import { Combo } from "@/components/dist/Combo";

export default function BookingsPage() {
  return <DistGuard>{(c) => <Bookings c={c} />}</DistGuard>;
}

const STATUSES = ["", "draft", "pending_approval", "approved", "rejected", "converted", "cancelled"];
const STATUS_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", pending_approval: "Waiting (store keeper)", approved: "Proceeded", rejected: "Rejected", converted: "Invoiced", cancelled: "Cancelled" };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Bookings({ c }: { c: DistCtx }) {
  const canDeliver = c.can("deliveries.manage");
  const [tab, setTab] = useState<"bookings" | "deliveries">(canDeliver && !c.can("bookings.approve") ? "deliveries" : "bookings");
  const [status, setStatus] = useState(c.can("bookings.approve") ? "pending_approval" : "");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayYmd);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useLoad(() => dist.listBookings({ status: status || undefined, from, to }), [status, from, to]);
  return (
    <div className="space-y-3">
      <PageTitle
        title="Bookings"
        sub="Salesman books → store keeper proceeds and generates the invoice → supply man delivers and takes the payment."
        actions={c.can("bookings.create") && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> New Booking</Button>}
      />
      {(canDeliver || c.can("invoices.view")) && (
        <div className="flex gap-1">
          {(["bookings", "deliveries"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm ${tab === t ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
              {t === "bookings" ? "Bookings" : "Deliveries"}
            </button>
          ))}
        </div>
      )}
      {tab === "deliveries" ? <Deliveries c={c} /> : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s ? STATUS_LABEL[s] ?? s : "All"}</option>)}
              </Select>
            </Field>
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Err error={list.error} />
          <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-start">No.</th>
                  <th className="px-3 py-2 text-start">Date</th>
                  <th className="px-3 py-2 text-start">Customer</th>
                  <th className="px-3 py-2 text-start">Salesman</th>
                  <th className="px-3 py-2 text-end">Value</th>
                  <th className="px-3 py-2 text-start">Status</th>
                  <th className="px-3 py-2 text-start">Location</th>
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((b) => (
                  <tr key={b.id} className="cursor-pointer border-t border-neutral-100 hover:bg-amber-50/40" onClick={() => setOpen(b.id)}>
                    <td className="px-3 py-2 font-medium">#{b.booking_no}</td>
                    <td className="px-3 py-2 text-xs">{b.date}</td>
                    <td className="px-3 py-2">{b.customer_name}</td>
                    <td className="px-3 py-2 text-xs">{b.salesman_name ?? "—"}</td>
                    <td className="px-3 py-2 text-end">{money(b.total)}</td>
                    <td className="px-3 py-2"><Badge tone={BOOKING_TONE[b.status]}>{STATUS_LABEL[b.status] ?? b.status}</Badge></td>
                    <td className="px-3 py-2 text-xs">{b.loc_lat != null ? `±${Math.round(b.loc_accuracy ?? 0)} m${b.loc_distance_m != null ? ` · ${Math.round(b.loc_distance_m)} m from shop` : ""}` : "—"}</td>
                  </tr>
                ))}
                {!list.data?.length && <tr><td colSpan={7} className="py-8 text-center text-neutral-400">{list.loading ? "Loading…" : "No content in table"}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {open && <BookingModal c={c} id={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
      {creating && <NewBooking c={c} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void list.reload(); }} />}
    </div>
  );
}

// ── New booking ──────────────────────────────────────────────────────────

interface BLine { key: string; p: DistProduct; qty: string; stock: number | null; schemes: DistScheme[] }

/** Customer → location check at the customer's pin (when the owner requires it) →
 * products with quantity, price, available stock and the company's scheme → submit. */
function NewBooking({ c, onClose, onDone }: { c: DistCtx; onClose: () => void; onDone: () => void }) {
  const customers = useLoad(() => dist.listCustomers({ status: "active" }), []);
  const tracker = useTracker();
  const [customerId, setCustomerId] = useState("");
  const loc = useLoad(() => (customerId ? dist.bookingLocationCheck(customerId) : Promise.resolve(null)), [customerId, tracker.lastSentAt]);
  const [lines, setLines] = useState<BLine[]>([]);
  const [notes, setNotes] = useState("");
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const day = ymd(new Date());
  const customerItems = useMemo(() => (customers.data ?? []).map((x) => ({
    id: x.id, label: x.business_name, sub: `${x.code}${x.owner_name ? ` · ${x.owner_name}` : ""}${x.address ? ` · ${x.address}` : ""}${x.lat == null ? " · no pin" : ""}`,
  })), [customers.data]);
  const cust = customers.data?.find((x) => x.id === customerId);
  const figures = (l: BLine) => {
    const qty = Number(l.qty) || 0;
    const o = schemeOffer(l.schemes, qty, day);
    const gross = qty * l.p.trade_price;
    const net = gross * (1 - (o?.extraPct ?? 0) / 100) * (1 + l.p.sales_tax_rate / 100);
    return { qty, offer: o, net: Math.round(net * 100) / 100 };
  };
  const total = lines.reduce((s, l) => s + figures(l).net, 0);
  const add = (p: DistProduct) => {
    if (lines.some((l) => l.p.id === p.id)) return;
    const key = crypto.randomUUID();
    setLines((ls) => [...ls, { key, p, qty: "", stock: p.stock, schemes: [] }]);
    void dist.productStock(p.id).then((s) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, stock: s.stock, schemes: s.schemes } : l)))).catch(() => undefined);
    requestAnimationFrame(() => document.getElementById(`bq-${key}`)?.focus());
  };
  const clear = () => { setLines([]); setNotes(""); setMsg(null); setClientRef(crypto.randomUUID()); };
  const blocked = !!loc.data && loc.data.required && !loc.data.ok;
  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const b = await dist.createBooking({ clientRef, customerId, lines: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ productId: l.p.id, qty: Number(l.qty) })), notes });
      if (c.can("bookings.submit")) {
        try {
          await dist.submitBooking(b.booking.id);
        } catch (e) {
          setMsg({ ok: false, text: `Booking #${b.booking.booking_no} saved as a draft but not submitted: ${errorText(e)}` });
          setClientRef(crypto.randomUUID());
          return;
        }
      }
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New Booking" onClose={onClose} width="max-w-4xl">
      <div className="space-y-3 text-sm">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-white">
          <span className="text-xs text-neutral-300">{lines.filter((l) => Number(l.qty) > 0).length} product(s)</span>
          <span className="text-lg font-bold tabular-nums">Total {money(total)} <span className="text-xs font-normal text-neutral-300">incl. sales tax</span></span>
        </div>
        <Field label="Customer" required>
          <Combo items={customerItems} value={customerId} onPick={setCustomerId} autoFocus loading={customers.loading} placeholder="Search customer (↑ ↓ Enter)" emptyText="No customer matches." />
        </Field>
        {cust && (
          <div className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs ring-1 ${loc.data?.required ? (loc.data.ok ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200") : "bg-neutral-50 ring-black/5"}`} role="status">
            <MapPin size={14} />
            <span className="min-w-0 flex-1">
              <b>{cust.business_name}</b>{cust.address ? ` · ${cust.address}` : ""}
              <span className="block">{loc.loading ? "Checking your location…" : loc.data?.reason ?? ""}</span>
            </span>
            {cust.lat != null && <button type="button" className="text-sky-700 underline" onClick={() => void openMaps(cust.lat!, cust.lng!)}>Pinned location</button>}
            {loc.data?.required && tracker.status !== "on" && <Button onClick={() => void startTracking()}>Share my location</Button>}
            <Button variant="ghost" title="Check again" onClick={() => void loc.reload()}><RefreshCw size={14} /></Button>
          </div>
        )}
        {customerId && (
          <>
            <ProductPicker onPick={add} />
            {lines.length ? (
              <div className="overflow-x-auto rounded-xl ring-1 ring-black/5">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-neutral-50 text-[11px] text-neutral-500">
                    <tr><th className="px-2 py-1.5 text-start font-medium">Product</th><th className="font-medium">Qty</th><th className="text-end font-medium">Price</th><th className="text-end font-medium">Available</th><th className="px-1 text-start font-medium">Bonus / extra</th><th className="px-2 text-end font-medium">Total</th><th /></tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const f = figures(l);
                      const short = l.stock != null && f.qty + (f.offer?.bonus ?? 0) > l.stock;
                      return (
                        <tr key={l.key} className="border-t border-neutral-100 align-top">
                          <td className="px-2 py-1.5"><span className="font-medium">{l.p.name}</span><span className="block text-[11px] text-neutral-500">{l.p.code} · {l.p.unit}</span></td>
                          <td className="px-1 py-1"><Input id={`bq-${l.key}`} className="!w-20 !px-1.5 !py-1 text-end" type="number" min="0" step="any" value={l.qty} placeholder="Qty"
                            onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} /></td>
                          <td className="px-1 py-2 text-end tabular-nums">{money(l.p.trade_price)}{l.p.sales_tax_rate ? <span className="block text-[10px] text-neutral-400">+{l.p.sales_tax_rate}% ST</span> : null}</td>
                          <td className={`px-1 py-2 text-end tabular-nums ${short ? "font-semibold text-rose-700" : ""}`}>{l.stock ?? "…"}</td>
                          <td className="px-1 py-2 text-xs">
                            {f.offer ? <span className="text-emerald-700">{f.offer.bonus ? `+${f.offer.bonus} free` : ""}{f.offer.bonus && f.offer.extraPct ? " · " : ""}{f.offer.extraPct ? `${f.offer.extraPct} % extra` : ""}</span>
                              : l.schemes.length ? <span className="text-neutral-500">{l.schemes.map((s) => schemeLabel(s)).join(", ")}</span> : <span className="text-neutral-300">—</span>}
                          </td>
                          <td className="px-2 py-2 text-end font-medium tabular-nums">{money(f.net)}</td>
                          <td className="py-1"><Button variant="ghost" title="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={14} /></Button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="rounded-xl bg-neutral-50 py-6 text-center text-xs text-neutral-400">Search a product above (↑ ↓ Enter), then type the quantity.</p>}
            <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </>
        )}
        {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="me-auto text-[11px] text-neutral-500">Final prices, scheme and tax are worked out when saved.</span>
          <Button onClick={clear} disabled={busy || (!lines.length && !notes)}>Clear</Button>
          <Button variant="primary" disabled={busy || !customerId || !lines.some((l) => Number(l.qty) > 0) || blocked} onClick={() => void send()}>
            <Send size={14} /> {c.can("bookings.submit") ? "Submit booking" : "Save booking"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── One booking: store keeper (print, proceed, generate invoice) ─────────────

function BookingModal({ c, id, onClose, onChanged }: { c: DistCtx; id: string; onClose: () => void; onChanged: () => void }) {
  const data = useLoad(() => dist.getBooking(id), [id]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [convert, setConvert] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await data.reload();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };
  const b = data.data?.booking;
  const customer = useLoad(() => (b ? dist.getCustomer(b.customer_id).catch(() => null) : Promise.resolve(null)), [b?.customer_id]);
  return (
    <Modal title={b ? `Booking #${b.booking_no}` : "Booking"} onClose={onClose} width="max-w-3xl">
      <Err error={data.error} />
      {b && data.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={BOOKING_TONE[b.status]}>{STATUS_LABEL[b.status] ?? b.status}</Badge>
            <span>{b.date}</span>
            {b.loc_lat != null && (
              <button type="button" className="text-xs text-sky-700 underline" onClick={() => void openMaps(b.loc_lat!, b.loc_lng!)}>
                Booked at {b.loc_lat.toFixed(5)}, {b.loc_lng!.toFixed(5)} (±{Math.round(b.loc_accuracy ?? 0)} m{b.loc_distance_m != null ? `, ${Math.round(b.loc_distance_m)} m from the shop` : ""})
              </button>
            )}
          </div>
          <div ref={area} className="text-[12px]">
            <div className="mb-2">
              <p className="font-semibold">Booking #{b.booking_no} · {b.date}</p>
              <p className="text-xs text-neutral-600">{customer.data?.business_name ?? ""}{customer.data?.address ? ` · ${customer.data.address}` : ""}{customer.data?.mobile ? ` · ${customer.data.mobile}` : ""}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500">
                <tr><th className="text-start">Product</th><th className="text-end">Qty</th><th className="text-end">Bonus</th><th className="text-end">Price</th><th className="text-end">Disc.</th><th className="text-end">ST</th><th className="text-end">Total</th></tr>
              </thead>
              <tbody>
                {data.data.items.map((i) => (
                  <tr key={i.id} className="border-t border-neutral-100">
                    <td>{i.name} <span className="text-[11px] text-neutral-400">{i.code}</span></td>
                    <td className="text-end">{i.qty} {i.unit}</td>
                    <td className="text-end">{i.bonus_qty ? i.bonus_qty : "—"}</td>
                    <td className="text-end">{money(i.price)}</td>
                    <td className="text-end">{money(i.discount)}{i.extra_disc_pct ? <span className="block text-[10px] text-neutral-400">{i.extra_disc_pct}% extra</span> : null}</td>
                    <td className="text-end">{money(i.sales_tax)}</td>
                    <td className="text-end font-medium">{money(i.line_total)}</td>
                  </tr>
                ))}
                <tr className="border-t border-neutral-300 font-semibold"><td colSpan={6}>Booking value</td><td className="text-end">{money(b.total)}</td></tr>
              </tbody>
            </table>
            {b.notes && <p className="mt-2 text-xs">Notes: {b.notes}</p>}
          </div>
          <ul className="text-xs text-neutral-500">
            {data.data.events.map((e) => <li key={e.id}>{e.created_at.slice(0, 16).replace("T", " ")} · {e.from_status ? STATUS_LABEL[e.from_status] ?? e.from_status : "—"} → <b>{STATUS_LABEL[e.to_status] ?? e.to_status}</b> · {e.user_name}{e.note ? ` · ${e.note}` : ""}</li>)}
          </ul>
          <Field label="Note / reason"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void printDirect("a4", area.current)}><Printer size={14} /> Print</Button>
            {c.can("bookings.approve") && ["submitted", "pending_approval"].includes(b.status) && (
              <>
                <Button variant="primary" onClick={() => void run(() => dist.decideBooking(id, "approved", note), "Proceeded: generate the invoice next.")}>Proceed</Button>
                <Button variant="danger" onClick={() => void run(() => dist.decideBooking(id, "rejected", note), "Rejected.")}>Reject</Button>
              </>
            )}
            {b.status === "approved" && c.can("invoices.create") && <Button variant="primary" onClick={() => setConvert(true)}>Generate Invoice</Button>}
            {b.status === "draft" && c.can("bookings.submit") && <Button variant="primary" onClick={() => void run(() => dist.submitBooking(id), "Submitted.")}><Send size={14} /> Submit</Button>}
            {["draft", "submitted", "pending_approval", "approved"].includes(b.status) && <Button onClick={() => void run(() => dist.cancelBooking(id, note), "Cancelled.")}>Cancel booking</Button>}
          </div>
          {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
          {convert && <ConvertModal c={c} bookingId={id} customerId={b.customer_id} items={data.data.items} onClose={() => setConvert(false)} onDone={() => { setConvert(false); void data.reload(); onChanged(); }} />}
        </div>
      )}
    </Modal>
  );
}

/** Generate the invoice, with the withholding-tax preview (calculated by the data layer). */
function ConvertModal({ c, bookingId, customerId, items, onClose, onDone }: { c: DistCtx; bookingId: string; customerId: string; items: { product_id: string; qty: number; price: number; discount: number }[]; onClose: () => void; onDone: () => void }) {
  const lines = items.map((i) => ({ productId: i.product_id, qty: i.qty, price: i.price, discount: i.discount }));
  const preview = useLoad(() => dist.previewWht(customerId, lines), [customerId]);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [rate, setRate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  if (doc) return <DocView id={doc} onClose={onDone} />;
  const t = preview.data?.treatment;
  return (
    <Modal title="Generate invoice" onClose={onClose} width="max-w-lg">
      <div className="space-y-3 text-sm">
        <Err error={preview.error} />
        {preview.data && t && (
          <div className="space-y-1 rounded-xl bg-neutral-50 p-3">
            <p>Goods total (incl. sales tax): <b>{money(preview.data.goods)}</b></p>
            <p>Withholding {t.section}: status <b>{t.status}</b> → {t.rate}% on {money(preview.data.base)} = <b>{money(preview.data.amount)}</b></p>
            <p className="text-xs text-neutral-500">{t.note}</p>
            {t.blocked && <Err error={t.blocked} />}
            <p className="text-base">Payable: <b>{money(preview.data.payable)}</b></p>
          </div>
        )}
        {c.can("invoices.edit_wht_rate") && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Override WHT rate % (optional)"><Input type="number" step="any" min="0" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field label="Reason (required to override)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        )}
        {c.can("payments.receive") && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Received now"><Input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
          </div>
        )}
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              try {
                const r = await dist.convertBooking(bookingId, { payments: Number(paid) > 0 ? [{ method, amount: Number(paid) }] : [], wht: rate !== "" ? { rate: Number(rate), reason } : undefined });
                setDoc(r.doc.id);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Generate invoice
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Deliveries: supply man ───────────────────────────────────────────────────

const DELIVERY_LABEL: Record<string, string> = { "": "To collect", collected: "Collected", delivered: "Delivered", returned: "Returned", settled: "Paid / closed" };
const DELIVERY_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue" | "violet"> = { "": "amber", collected: "blue", delivered: "green", returned: "red", settled: "neutral" };

function Deliveries({ c }: { c: DistCtx }) {
  const [status, setStatus] = useState<"open" | "pending" | "collected" | "delivered" | "returned" | "settled" | "all">("open");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayYmd);
  const list = useLoad(() => dist.deliveries({ status, from, to }), [status, from, to]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [returning, setReturning] = useState<{ doc: DistDoc; items: DistDocItem[] } | null>(null);
  const [paying, setPaying] = useState<DistDoc | null>(null);
  const [view, setView] = useState<string | null>(null);
  const can = c.can("deliveries.manage");
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); await list.reload(); } catch (e) { setMsg({ ok: false, text: errorText(e) }); }
  };
  const wholeReturn = (d: DistDoc) => run(async () => {
    const reason = prompt(`Whole return of invoice #${d.doc_no}: reason?`, "Customer refused the order");
    if (!reason) throw new Error("A reason is needed for a return.");
    const { items } = await dist.getDoc(d.id);
    const lines = items.map((i) => ({ itemId: i.id, qty: Math.round((Number(i.qty) - Number(i.returned_qty)) * 1000) / 1000 })).filter((l) => l.qty > 0);
    if (lines.length) await dist.createSaleReturn({ invoiceId: d.id, lines, reason });
    await dist.deliveryStep(d.id, "returned", reason);
  }, `Invoice #${d.doc_no} returned in full: stock is back and the customer is credited.`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Show">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">Open (not closed)</option>
            <option value="pending">To collect</option>
            <option value="collected">Collected</option>
            <option value="delivered">Delivered</option>
            <option value="returned">Returned</option>
            <option value="settled">Paid / closed</option>
            <option value="all">All</option>
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {!can && <Note>Only users with &quot;Deliver orders&quot; (Permissions) can collect, deliver, return and take payment here.</Note>}
      <Err error={list.error} />
      {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">Invoice</th><th className="px-3 py-2 text-start">Customer</th><th className="px-3 py-2 text-end">Payable</th>
              <th className="px-3 py-2 text-end">Balance</th><th className="px-3 py-2 text-start">Status</th><th className="px-3 py-2 text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((d) => {
              const st = d.delivery_status ?? "";
              return (
                <tr key={d.id} className="border-t border-neutral-100 align-top">
                  <td className="px-3 py-2">
                    <button type="button" className="font-medium text-sky-700 underline" onClick={() => setView(d.id)}>#{d.doc_no}</button>
                    <span className="block text-[11px] text-neutral-500">{d.date}{d.booking_no ? ` · booking #${d.booking_no}` : ""}</span>
                  </td>
                  <td className="px-3 py-2">{d.party_name}<span className="block text-[11px] text-neutral-500">{d.customer_mobile ?? ""}{d.party_address ? ` · ${d.party_address}` : ""}</span></td>
                  <td className="px-3 py-2 text-end tabular-nums">{money(Number(d.total) + Number(d.wht_amount))}{d.returned ? <span className="block text-[10px] text-rose-600">returned {money(d.returned)}</span> : null}</td>
                  <td className={`px-3 py-2 text-end tabular-nums ${d.balance > 0 ? "font-semibold text-rose-600" : "text-emerald-700"}`}>{d.balance > 0 ? money(d.balance) : "Paid"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={DELIVERY_TONE[st]}>{DELIVERY_LABEL[st]}</Badge>
                    {d.delivery_by_name && <span className="block text-[11px] text-neutral-500"><Truck size={11} className="inline" /> {d.delivery_by_name}</span>}
                    {d.delivery_note && <span className="block text-[11px] text-neutral-500">{d.delivery_note}</span>}
                  </td>
                  <td className="space-x-1 whitespace-nowrap px-3 py-2 text-end">
                    {can && st === "" && <Button variant="primary" onClick={() => void run(() => dist.deliveryStep(d.id, "collect"), `Invoice #${d.doc_no} collected.`)}>Collect</Button>}
                    {can && st === "collected" && (
                      <>
                        <Button variant="primary" onClick={() => void run(() => dist.deliveryStep(d.id, "deliver"), `Invoice #${d.doc_no} delivered.`)}>Delivered</Button>
                        <ReturnMenu onWhole={() => void wholeReturn(d)} onItems={() => void dist.getDoc(d.id).then((x) => setReturning(x)).catch((e) => setMsg({ ok: false, text: errorText(e) }))} />
                      </>
                    )}
                    {can && (st === "delivered" || st === "returned") && <Button variant="primary" onClick={() => setPaying(d)}>Paid</Button>}
                  </td>
                </tr>
              );
            })}
            {!list.data?.length && <tr><td colSpan={6} className="py-8 text-center text-neutral-400">{list.loading ? "Loading…" : "Nothing here."}</td></tr>}
          </tbody>
        </table>
      </div>
      {returning && (
        <ReturnModal doc={returning.doc} items={returning.items} onClose={() => setReturning(null)}
          onDone={() => { const d = returning.doc; setReturning(null); void run(() => dist.deliveryStep(d.id, "deliver", "Some items returned"), `Items returned; the rest of invoice #${d.doc_no} is delivered.`); }} />
      )}
      {paying && <PaidModal doc={paying} onClose={() => setPaying(null)} onDone={(text) => { setPaying(null); setMsg({ ok: true, text }); void list.reload(); }} />}
      {view && <DocView id={view} onClose={() => { setView(null); void list.reload(); }} />}
    </div>
  );
}

/** "Return" with its two choices: the whole invoice, or some items. */
function ReturnMenu({ onWhole, onItems }: { onWhole: () => void; onItems: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <Button variant="danger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Return ▾</Button>
      {open && (
        <span className="absolute right-0 z-20 mt-1 flex w-40 flex-col rounded-xl bg-white py-1 text-start shadow-lg ring-1 ring-black/10" onMouseLeave={() => setOpen(false)}>
          <button type="button" className="px-3 py-1.5 text-start text-sm hover:bg-rose-50" onClick={() => { setOpen(false); onWhole(); }}>Whole return</button>
          <button type="button" className="px-3 py-1.5 text-start text-sm hover:bg-rose-50" onClick={() => { setOpen(false); onItems(); }}>Items return</button>
        </span>
      )}
    </span>
  );
}

/** Payment at delivery: in full, or part (the rest stays on the customer's balance). */
function PaidModal({ doc, onClose, onDone }: { doc: DistDoc; onClose: () => void; onDone: (text: string) => void }) {
  const [kind, setKind] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const due = Number(doc.balance) || 0;
  const pay = kind === "full" ? due : Number(amount) || 0;
  return (
    <Modal title={`Payment · invoice #${doc.doc_no}`} onClose={onClose} width="max-w-sm">
      <div className="space-y-3 text-sm">
        <p>Due on this invoice: <b>{money(due)}</b></p>
        {due > 0 ? (
          <>
            <div className="flex gap-2">
              {(["full", "partial"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={`flex-1 rounded-lg px-3 py-2 text-sm ring-1 ${kind === k ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white ring-black/10"}`}>
                  {k === "full" ? "Full payment" : "Partial payment"}
                </button>
              ))}
            </div>
            {kind === "partial" && (
              <Field label="Amount received"><Input type="number" min="0" step="any" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            )}
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            {kind === "partial" && pay > 0 && pay < due && <Note>Rs {(due - pay).toFixed(2)} stays on {doc.party_name}&apos;s balance.</Note>}
          </>
        ) : <Note tone="emerald">Nothing is due: close the delivery.</Note>}
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (due > 0 && !(pay > 0))} onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              if (due > 0 && pay > 0) await dist.receivePayment({ partyType: "customer", partyId: doc.party_id, amount: Math.min(pay, due), method, docId: doc.id, note: kind === "full" ? "Full payment at delivery" : "Part payment at delivery" });
              await dist.deliveryStep(doc.id, "settle", kind === "partial" && pay < due ? `Part paid; Rs ${(due - pay).toFixed(2)} on the customer's balance` : "Paid in full");
              onDone(kind === "partial" && pay < due ? `Rs ${pay.toFixed(2)} received; Rs ${(due - pay).toFixed(2)} added to ${doc.party_name}'s balance.` : `Invoice #${doc.doc_no} paid and closed.`);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
