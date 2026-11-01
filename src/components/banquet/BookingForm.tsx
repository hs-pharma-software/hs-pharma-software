"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import {
  DISH_CATEGORIES, EVENT_TYPES, EXTRA_SUGGESTIONS, SLOTS, bookingTotals, dishesRepo, getBooking, hallClash, hallsRepo, packagesRepo, parseDishIds, saveBooking,
  slotLabel, type BanquetDish, type BanquetHall, type BanquetPackage, type BookingStatus, type Slot,
} from "@/lib/repo/banquet";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
interface Extra { name: string; qty: string; rate: string }

/** A new booking or changes to one: customer, event, hall and slot (checked
 * against other bookings), guests, menu (a package or dishes), extras,
 * discount and, for a new booking, the advance. */
export function BookingForm({ bookingId, initialDate }: { bookingId?: string; initialDate?: string }) {
  const router = useRouter();
  const [halls, setHalls] = useState<BanquetHall[]>([]);
  const [dishes, setDishes] = useState<BanquetDish[]>([]);
  const [packages, setPackages] = useState<BanquetPackage[]>([]);
  const [loaded, setLoaded] = useState(!bookingId);

  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [cnic, setCnic] = useState("");
  const [address, setAddress] = useState("");
  const [eventType, setEventType] = useState(EVENT_TYPES[0]);
  const [date, setDate] = useState(initialDate ?? "");
  const [slot, setSlot] = useState<Slot>("dinner");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [hallId, setHallId] = useState("");
  const [guests, setGuests] = useState("");
  const [packageId, setPackageId] = useState("");
  const [dishIds, setDishIds] = useState<string[]>([]);
  const [rate, setRate] = useState("");
  const [rateTouched, setRateTouched] = useState(false);
  const [rent, setRent] = useState("");
  const [extras, setExtras] = useState<Extra[]>([]);
  const [discount, setDiscount] = useState("");
  const [status, setStatus] = useState<BookingStatus>("confirmed");
  const [notes, setNotes] = useState("");
  const [advance, setAdvance] = useState("");
  const [method, setMethod] = useState("cash");
  const [clash, setClash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void Promise.all([
      hallsRepo.list({ orderBy: "name ASC" }), dishesRepo.list({ orderBy: "category ASC, name ASC" }), packagesRepo.list({ orderBy: "name ASC" }),
    ]).then(([h, d, p]) => {
      setHalls(h.filter((x) => x.is_active));
      setDishes(d.filter((x) => x.is_active));
      setPackages(p.filter((x) => x.is_active));
      if (!bookingId && h.length === 1) { setHallId(h[0].id); setRent(String(h[0].rent)); }
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (!bookingId) return;
    void getBooking(bookingId).then((d) => {
      const b = d.booking;
      setCustomer(b.customer_name); setMobile(b.mobile); setCnic(b.cnic ?? ""); setAddress(b.address ?? "");
      setEventType(b.event_type); setDate(b.event_date); setSlot(b.slot); setStart(b.start_time ?? ""); setEnd(b.end_time ?? "");
      setHallId(b.hall_id ?? ""); setGuests(String(b.guests)); setPackageId(b.package_id ?? ""); setDishIds(d.dishes.map((x) => x.dish_id!).filter(Boolean));
      setRate(String(b.per_head_rate)); setRateTouched(true); setRent(String(b.hall_rent));
      setExtras(d.extras.map((e) => ({ name: e.name, qty: String(e.qty), rate: String(e.rate) })));
      setDiscount(b.discount ? String(b.discount) : ""); setStatus(b.status); setNotes(b.notes ?? "");
      setLoaded(true);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [bookingId]);

  // The hall free on that date and slot?
  useEffect(() => {
    if (!hallId || !date || !isTauri()) return setClash(null);
    const t = setTimeout(() => {
      void hallClash(hallId, date, slot, bookingId ?? null).then((c) => setClash(c ? `Booked: ${c.customer_name} (${c.event_type}, ${slotLabel(c.slot)}), ${c.booking_no}` : null)).catch(() => setClash(null));
    }, 200);
    return () => clearTimeout(t);
  }, [hallId, date, slot, bookingId]);

  const pkg = packages.find((p) => p.id === packageId) ?? null;
  const autoRate = pkg ? pkg.price_per_head : dishIds.reduce((t, id) => t + Number(dishes.find((d) => d.id === id)?.price_per_head ?? 0), 0);
  const perHead = rateTouched && rate !== "" ? Number(rate) : autoRate;
  const hall = halls.find((h) => h.id === hallId);
  const extraRows = extras.filter((e) => e.name.trim() && Number(e.qty) > 0).map((e) => ({ qty: Number(e.qty), rate: Number(e.rate) || 0 }));
  const t = bookingTotals({ guests: Number(guests) || 0, per_head_rate: perHead, hall_rent: Number(rent) || 0, extras: extraRows, discount: Number(discount) || 0 });
  const byCategory = useMemo(() => DISH_CATEGORIES.concat(dishes.map((d) => d.category).filter((c) => !DISH_CATEGORIES.includes(c)))
    .map((c) => ({ c, list: dishes.filter((d) => d.category === c) })).filter((g) => g.list.length), [dishes]);

  function choosePackage(id: string) {
    setPackageId(id);
    const p = packages.find((x) => x.id === id);
    if (p) setDishIds(parseDishIds(p.dish_ids));
    setRateTouched(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const b = await saveBooking(bookingId ?? null, {
        customer_name: customer, mobile, cnic, address, event_type: eventType, event_date: date, slot, start_time: start, end_time: end,
        hall_id: hallId, guests: Number(guests) || 0, package_id: packageId || null, dish_ids: dishIds,
        per_head_rate: rateTouched && rate !== "" ? Number(rate) : null, hall_rent: rent === "" ? null : Number(rent),
        extras: extras.map((e) => ({ name: e.name, qty: Number(e.qty) || 0, rate: Number(e.rate) || 0 })), discount: Number(discount) || 0, status, notes,
      }, bookingId ? undefined : { amount: Number(advance) || 0, method });
      router.push(`/banquet/bookings?open=${b.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;
  const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
  return (
    <div>
      <PageHeader title={bookingId ? "Change booking" : "New booking"} actions={<Button onClick={() => router.push("/banquet/bookings")}>Back to bookings</Button>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <section className={card}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-700">Customer</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Name" required><Input id="bk-name" value={customer} onChange={(e) => setCustomer(e.target.value)} autoFocus /></Field>
              <Field label="Mobile" required><Input id="bk-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="03001234567" inputMode="tel" /></Field>
              <Field label="CNIC"><Input id="bk-cnic" value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="13 digits" /></Field>
              <div className="md:col-span-3"><Field label="Address"><Input id="bk-address" value={address} onChange={(e) => setAddress(e.target.value)} /></Field></div>
            </div>
          </section>
          <section className={card}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-700">Event</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Event" required>
                <Select id="bk-type" value={eventType} onChange={(e) => setEventType(e.target.value)}>{EVENT_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
              </Field>
              <Field label="Date" required><Input id="bk-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Slot" required>
                <Select id="bk-slot" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>{SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
              </Field>
              <Field label="Guests" required><Input id="bk-guests" type="number" min="1" step="1" value={guests} onChange={(e) => setGuests(e.target.value)} /></Field>
              <div className="col-span-2">
                <Field label="Hall" required>
                  <Select id="bk-hall" value={hallId} onChange={(e) => { setHallId(e.target.value); const h = halls.find((x) => x.id === e.target.value); if (h) setRent(String(h.rent)); }}>
                    <option value="">Choose…</option>
                    {halls.map((h) => <option key={h.id} value={h.id}>{h.name}{h.capacity ? ` (up to ${h.capacity})` : ""}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="From"><Input id="bk-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="To"><Input id="bk-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            {!halls.length && <p className="mt-2 text-sm text-amber-700">Add your halls first (Halls).</p>}
            {clash ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-sm text-rose-800 ring-1 ring-rose-200">{hall?.name ?? "This hall"} is not free: {clash}</p>
              : hallId && date ? <p className="mt-2 text-sm text-emerald-700">{hall?.name} is free on {date} ({slotLabel(slot)}).</p> : null}
            {hall?.capacity && Number(guests) > hall.capacity && <p className="mt-1 text-sm text-amber-700">{guests} guests is more than {hall.name}&apos;s capacity of {hall.capacity}.</p>}
          </section>
          <section className={card}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-700">Menu</h2>
            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Package">
                <Select id="bk-package" value={packageId} onChange={(e) => choosePackage(e.target.value)}>
                  <option value="">Custom menu (choose dishes)</option>
                  {packages.map((p) => <option key={p.id} value={p.id}>{p.name}: Rs {money(p.price_per_head)} per head</option>)}
                </Select>
              </Field>
              <Field label={`Rate per head${rateTouched ? "" : " (auto)"}`}>
                <Input id="bk-rate" type="number" min="0" step="any" value={rateTouched ? rate : String(autoRate)} onChange={(e) => { setRate(e.target.value); setRateTouched(true); }} />
              </Field>
            </div>
            {!dishes.length ? <p className="text-sm text-amber-700">Add dishes first (Menu &amp; Packages).</p> : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {byCategory.map((g) => (
                  <fieldset key={g.c} className="rounded-xl border border-neutral-200 p-2.5">
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{g.c}</legend>
                    {g.list.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 py-0.5 text-sm">
                        <input type="checkbox" checked={dishIds.includes(d.id)} onChange={() => setDishIds((ids) => (ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id]))} />
                        <span className="flex-1">{d.name}</span>
                        {!pkg && <span className="text-xs tabular-nums text-neutral-500">{money(d.price_per_head)}</span>}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
          </section>
          <section className={card}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-700">Extras</h2>
              <Button onClick={() => setExtras((x) => [...x, { name: "", qty: "1", rate: "" }])}><Plus size={14} />Add extra</Button>
            </div>
            <datalist id="bk-extra-list">{EXTRA_SUGGESTIONS.map((x) => <option key={x} value={x} />)}</datalist>
            {extras.length === 0 ? <p className="text-sm text-neutral-500">No extras. Add decoration, lighting, sound, photography…</p> : (
              <div className="flex flex-col gap-2">
                {extras.map((e, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_110px_32px] items-center gap-2">
                    <Input aria-label="Extra" list="bk-extra-list" value={e.name} onChange={(ev) => setExtras((x) => x.map((r, j) => (j === i ? { ...r, name: ev.target.value } : r)))} placeholder="e.g. Stage decoration" />
                    <Input aria-label="Quantity" type="number" min="0" step="any" value={e.qty} onChange={(ev) => setExtras((x) => x.map((r, j) => (j === i ? { ...r, qty: ev.target.value } : r)))} />
                    <Input aria-label="Rate" type="number" min="0" step="any" value={e.rate} onChange={(ev) => setExtras((x) => x.map((r, j) => (j === i ? { ...r, rate: ev.target.value } : r)))} placeholder="Rate" />
                    <button type="button" aria-label="Remove extra" title="Remove" onClick={() => setExtras((x) => x.filter((_, j) => j !== i))} className="rounded-full p-1 text-rose-600 hover:bg-rose-50"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3"><Field label="Notes"><Textarea id="bk-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. separate family seating, vegetarian table" /></Field></div>
          </section>
        </div>

        <aside className={`${card} h-fit xl:sticky xl:top-4`}>
          <h2 className="mb-3 text-sm font-semibold text-neutral-700">Bill</h2>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between"><dt>Menu ({Number(guests) || 0} × {money(perHead)})</dt><dd className="tabular-nums">{money(t.menu)}</dd></div>
            <div className="flex items-center justify-between gap-2"><dt>Hall rent</dt><dd><Input aria-label="Hall rent" className="!w-28 text-right tabular-nums" type="number" min="0" step="any" value={rent} onChange={(e) => setRent(e.target.value)} /></dd></div>
            <div className="flex justify-between"><dt>Extras</dt><dd className="tabular-nums">{money(t.extras)}</dd></div>
            <div className="flex items-center justify-between gap-2"><dt>Discount</dt><dd><Input aria-label="Discount" className="!w-28 text-right tabular-nums" type="number" min="0" step="any" value={discount} onChange={(e) => setDiscount(e.target.value)} /></dd></div>
            <div className="mt-1 flex justify-between border-t border-neutral-200 pt-2 text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{money(t.total)}</dd></div>
          </dl>
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Status">
              <Select id="bk-status" value={status} onChange={(e) => setStatus(e.target.value as BookingStatus)}>
                <option value="confirmed">Confirmed</option>
                <option value="tentative">Tentative (holds the hall)</option>
                {bookingId && <option value="completed">Completed</option>}
              </Select>
            </Field>
            {!bookingId && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Advance"><Input id="bk-advance" type="number" min="0" step="any" value={advance} onChange={(e) => setAdvance(e.target.value)} /></Field>
                <Field label="Paid by">
                  <Select id="bk-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="cash">Cash</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="digital">Digital</option>
                  </Select>
                </Field>
              </div>
            )}
            {error && <p className="whitespace-pre-line text-sm text-rose-600">{error}</p>}
            <Button variant="primary" onClick={() => void save()} disabled={saving || Boolean(clash)}>{saving ? "Saving…" : bookingId ? "Save changes" : "Book"}</Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
