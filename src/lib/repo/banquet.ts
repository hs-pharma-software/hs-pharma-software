/** Marquee / banquet hall (business type "banquet_hall", v67): halls, dishes
 * and menu packages priced per head, and event bookings (a hall on a date and
 * slot) with the menu, hall rent, extras, discount and payments. Each booking
 * has a bill (invoice) kept in step with it, printed with the business's
 * invoice template and sent to FBR like a lab bill. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { localDate } from "../localDate";
import { invoicesRepo, nextInvoiceNo } from "./invoices";
import { actorName } from "./clinicServices";
import { isMissingSchemaError } from "../dbErrors";
import type { Invoice } from "../types2";
import type { ServiceLine } from "../serviceFbr";
import { settlingCreate } from "./docNumbers";

export const BANQUET_INVOICE_TYPE = "banquet_booking";

export const EVENT_TYPES = ["Barat", "Walima", "Mehndi", "Nikah", "Engagement", "Birthday", "Corporate", "Conference", "Other"];
export const SLOTS = [
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "full_day", label: "Full day" },
] as const;
export type Slot = (typeof SLOTS)[number]["id"];
export const slotLabel = (s: string) => SLOTS.find((x) => x.id === s)?.label ?? s;
export const DISH_CATEGORIES = ["Starter", "Main course", "Rice", "BBQ", "Bread", "Salad", "Dessert", "Drinks", "Tea / Coffee"];
export const EXTRA_SUGGESTIONS = ["Stage decoration", "Lighting", "Sound system", "DJ", "Photography", "Videography", "Generator", "Floral entrance", "Extra waiters", "Valet parking"];

export interface BanquetHall extends TenantRow {
  name: string;
  capacity: number | null;
  rent: number;
  is_active: number;
  notes: string | null;
}
export interface BanquetDish extends TenantRow {
  name: string;
  category: string;
  price_per_head: number;
  is_active: number;
  notes: string | null;
}
export interface BanquetPackage extends TenantRow {
  name: string;
  price_per_head: number;
  /** JSON string[] of dish ids. */
  dish_ids: string;
  is_active: number;
  notes: string | null;
}
export type BookingStatus = "tentative" | "confirmed" | "completed" | "cancelled";
export interface BanquetBooking extends TenantRow {
  booking_no: string;
  customer_name: string;
  mobile: string;
  cnic: string | null;
  address: string | null;
  event_type: string;
  event_date: string;
  slot: Slot;
  start_time: string | null;
  end_time: string | null;
  hall_id: string | null;
  guests: number;
  package_id: string | null;
  per_head_rate: number;
  hall_rent: number;
  extras_amount: number;
  discount: number;
  total: number;
  paid: number;
  status: BookingStatus;
  notes: string | null;
  invoice_id: string | null;
  created_by: string | null;
}
export interface BookingItem extends TenantRow {
  booking_id: string;
  kind: "dish" | "extra";
  dish_id: string | null;
  name: string;
  qty: number;
  rate: number;
  amount: number;
}
export interface BookingPayment extends TenantRow {
  booking_id: string;
  date: string;
  amount: number;
  method: string;
  note: string | null;
  received_by: string | null;
}

export const hallsRepo = createTenantRepo<BanquetHall>("banquet_halls");
export const dishesRepo = createTenantRepo<BanquetDish>("banquet_dishes");
export const packagesRepo = createTenantRepo<BanquetPackage>("banquet_packages");
/** Bookings; two made at the same moment never share a booking number. */
export const bookingsRepo = settlingCreate(createTenantRepo<BanquetBooking>("banquet_bookings"), "banquet_bookings", "booking_no", { regenerate: () => nextBookingNo() });
export const bookingItemsRepo = createTenantRepo<BookingItem>("banquet_booking_items");
export const bookingPaymentsRepo = createTenantRepo<BookingPayment>("banquet_payments");

const round = (n: number) => Math.round(n * 100) / 100;
const NEEDS_V67 = "The banquet hall needs the latest database update (v67). Ask the administrator to run it.";
async function v67<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingSchemaError(e)) throw new Error(NEEDS_V67);
    throw e;
  }
}
export const parseDishIds = (json: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

// ── Halls, dishes, packages ──────────────────────────────────────────────

export async function saveHall(id: string | null, h: { name: string; capacity?: number | null; rent?: number; is_active?: boolean; notes?: string | null }): Promise<BanquetHall> {
  const name = h.name.trim();
  if (!name) throw new Error("Enter the hall's name.");
  const data = { name, capacity: h.capacity ? Math.round(Number(h.capacity)) : null, rent: Math.max(0, Number(h.rent) || 0), is_active: h.is_active === false ? 0 : 1, notes: h.notes?.trim() || null };
  return v67(async () => (id ? (await hallsRepo.update(id, data))! : hallsRepo.create(data)));
}

export async function saveDish(id: string | null, d: { name: string; category: string; price_per_head: number; is_active?: boolean; notes?: string | null }): Promise<BanquetDish> {
  const name = d.name.trim();
  if (!name) throw new Error("Enter the dish name.");
  if (!d.category.trim()) throw new Error("Choose the dish category.");
  const data = { name, category: d.category.trim(), price_per_head: Math.max(0, Number(d.price_per_head) || 0), is_active: d.is_active === false ? 0 : 1, notes: d.notes?.trim() || null };
  return v67(async () => (id ? (await dishesRepo.update(id, data))! : dishesRepo.create(data)));
}

export async function savePackage(id: string | null, p: { name: string; price_per_head: number; dish_ids: string[]; is_active?: boolean; notes?: string | null }): Promise<BanquetPackage> {
  const name = p.name.trim();
  if (!name) throw new Error("Enter the package name.");
  if (!(Number(p.price_per_head) > 0)) throw new Error("Enter the package price per head.");
  if (!p.dish_ids.length) throw new Error("Choose the dishes in the package.");
  const data = { name, price_per_head: Number(p.price_per_head), dish_ids: JSON.stringify([...new Set(p.dish_ids)]), is_active: p.is_active === false ? 0 : 1, notes: p.notes?.trim() || null };
  return v67(async () => (id ? (await packagesRepo.update(id, data))! : packagesRepo.create(data)));
}

// ── Bookings ─────────────────────────────────────────────────────────────

async function nextBookingNo(): Promise<string> {
  const ym = localDate().slice(0, 7).replace("-", "");
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM banquet_bookings WHERE tenant_id = ? AND booking_no LIKE ?`, [requireCurrentTenantId(), `BK-${ym}-%`]);
  let n = (Number(rows[0]?.n) || 0) + 1;
  for (;;) {
    const no = `BK-${ym}-${String(n).padStart(3, "0")}`;
    if (!(await dbSelect(`SELECT 1 FROM banquet_bookings WHERE tenant_id = ? AND booking_no = ?`, [requireCurrentTenantId(), no])).length) return no;
    n++;
  }
}

/** The booking already holding this hall on that date and slot (a full-day
 * booking holds both lunch and dinner), if any. */
export async function hallClash(hallId: string, date: string, slot: Slot, excludeId: string | null = null): Promise<BanquetBooking | null> {
  const rows = await v67(() => dbSelect<BanquetBooking>(
    `SELECT * FROM banquet_bookings WHERE tenant_id = ? AND deleted_at IS NULL AND status != 'cancelled'
       AND hall_id = ? AND event_date = ? AND (slot = ? OR slot = 'full_day' OR ? = 'full_day') AND id != ? LIMIT 1`,
    [requireCurrentTenantId(), hallId, date, slot, slot, excludeId ?? ""]
  ));
  return rows[0] ?? null;
}

export interface BookingInput {
  customer_name: string;
  mobile: string;
  cnic?: string | null;
  address?: string | null;
  event_type: string;
  event_date: string;
  slot: Slot;
  start_time?: string | null;
  end_time?: string | null;
  hall_id: string;
  guests: number;
  package_id?: string | null;
  /** Dishes chosen (a custom menu, or the package's own dishes). */
  dish_ids: string[];
  /** Per-head rate; when not given: the package price, else the dishes' total. */
  per_head_rate?: number | null;
  hall_rent?: number | null;
  extras: { name: string; qty: number; rate: number }[];
  discount?: number;
  status?: BookingStatus;
  notes?: string | null;
}

/** What a booking costs (menu x guests + hall rent + extras - discount). */
export function bookingTotals(i: { guests: number; per_head_rate: number; hall_rent: number; extras: { qty: number; rate: number }[]; discount: number }) {
  const menu = round(Number(i.guests) * Number(i.per_head_rate));
  const extras = round(i.extras.reduce((t, e) => t + Number(e.qty) * Number(e.rate), 0));
  const gross = round(menu + Number(i.hall_rent) + extras);
  return { menu, extras, gross, total: round(gross - Number(i.discount)) };
}

const MOBILE = /^03\d{9}$/;

/** Books (or changes) an event. The hall must be free on that date and slot.
 * The booking's bill follows its total; an advance can be received with it. */
export async function saveBooking(id: string | null, input: BookingInput, advance?: { amount: number; method?: string }): Promise<BanquetBooking> {
  return v67(async () => {
    const name = input.customer_name.trim();
    const mobile = input.mobile.replace(/[\s-]/g, "");
    if (!name) throw new Error("Enter the customer's name.");
    if (!MOBILE.test(mobile)) throw new Error("Mobile must be 11 digits starting with 03, e.g. 03001234567.");
    const cnic = (input.cnic ?? "").replace(/\D/g, "");
    if (cnic && cnic.length !== 13) throw new Error("CNIC must be 13 digits.");
    if (!input.event_type.trim()) throw new Error("Choose the event type.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.event_date)) throw new Error("Choose the event date.");
    if (!SLOTS.some((s) => s.id === input.slot)) throw new Error("Choose lunch, dinner or full day.");
    const guests = Math.round(Number(input.guests) || 0);
    if (guests <= 0) throw new Error("Enter the number of guests.");
    const hall = await hallsRepo.get(input.hall_id);
    if (!hall || hall.deleted_at) throw new Error("Choose the hall.");
    const before = id ? await bookingsRepo.get(id) : null;
    if (id && !before) throw new Error("Booking not found.");
    if (before?.status === "cancelled") throw new Error("This booking is cancelled.");
    const status = input.status ?? before?.status ?? "confirmed";
    if (status !== "cancelled") {
      const clash = await hallClash(hall.id, input.event_date, input.slot, id);
      if (clash) throw new Error(`${hall.name} is already booked on ${input.event_date} (${slotLabel(clash.slot)}) for ${clash.customer_name}, booking ${clash.booking_no}.`);
    }

    const pkg = input.package_id ? await packagesRepo.get(input.package_id) : null;
    if (input.package_id && !pkg) throw new Error("That menu package is not found.");
    const dishes = (await Promise.all([...new Set(input.dish_ids)].map((d) => dishesRepo.get(d)))).filter((d): d is BanquetDish => Boolean(d && !d.deleted_at));
    if (!pkg && !dishes.length) throw new Error("Choose a menu package or the dishes.");
    const perHead = input.per_head_rate != null && input.per_head_rate !== undefined && Number(input.per_head_rate) >= 0 && String(input.per_head_rate) !== ""
      ? Number(input.per_head_rate)
      : pkg ? Number(pkg.price_per_head) : dishes.reduce((t, d) => t + Number(d.price_per_head), 0);
    const extras = input.extras.filter((e) => e.name.trim() && Number(e.qty) > 0).map((e) => ({ name: e.name.trim(), qty: Number(e.qty), rate: Math.max(0, Number(e.rate) || 0) }));
    const hallRent = input.hall_rent != null ? Math.max(0, Number(input.hall_rent) || 0) : Number(hall.rent);
    const discount = Math.max(0, Number(input.discount) || 0);
    const t = bookingTotals({ guests, per_head_rate: perHead, hall_rent: hallRent, extras, discount });
    if (discount > t.gross) throw new Error("The discount is more than the bill.");
    const paidSoFar = before?.paid ?? 0;
    if (t.total + 1e-9 < paidSoFar) throw new Error(`Rs ${paidSoFar.toFixed(2)} is already received, more than the new total.`);

    const data = {
      customer_name: name, mobile, cnic: cnic || null, address: input.address?.trim() || null, event_type: input.event_type.trim(),
      event_date: input.event_date, slot: input.slot, start_time: input.start_time || null, end_time: input.end_time || null,
      hall_id: hall.id, guests, package_id: pkg?.id ?? null, per_head_rate: round(perHead), hall_rent: hallRent,
      extras_amount: t.extras, discount, total: t.total, status, notes: input.notes?.trim() || null,
    };
    let booking: BanquetBooking;
    if (before) {
      booking = (await bookingsRepo.update(before.id, data))!;
      for (const it of await bookingItemsRepo.list({ where: "booking_id = ?", params: [before.id] })) await bookingItemsRepo.remove(it.id);
    } else {
      booking = await bookingsRepo.create({ ...data, booking_no: await nextBookingNo(), paid: 0, invoice_id: null, created_by: actorName() });
    }
    for (const d of dishes) {
      await bookingItemsRepo.create({ booking_id: booking.id, kind: "dish", dish_id: d.id, name: d.name, qty: 1, rate: Number(d.price_per_head), amount: Number(d.price_per_head) });
    }
    for (const e of extras) {
      await bookingItemsRepo.create({ booking_id: booking.id, kind: "extra", dish_id: null, name: e.name, qty: e.qty, rate: e.rate, amount: round(e.qty * e.rate) });
    }
    booking = await syncBill(booking);
    if (advance && Number(advance.amount) > 0) booking = await addBookingPayment(booking.id, Number(advance.amount), advance.method ?? "cash", "Advance");
    return booking;
  });
}

/** Keeps the booking's bill (invoice) in step with the booking. */
async function syncBill(b: BanquetBooking): Promise<BanquetBooking> {
  const header = {
    date: b.invoice_id ? undefined : localDate(), inv_on: b.paid >= b.total ? "cash" : "credit",
    description: `${b.event_type} on ${b.event_date} (${slotLabel(b.slot)}), ${b.guests} guests - booking ${b.booking_no}`,
    customer_name: b.customer_name, customer_phone: b.mobile, buyer_ntn_cnic: b.cnic,
    total: round(b.total + b.discount), charges: 0, discount_pct: 0, discount_rs: b.discount, tax_pct: 0,
    payable: b.total, paid: b.paid, balance: round(b.total - b.paid),
  };
  if (b.invoice_id) {
    const { date: _date, ...rest } = header;
    void _date;
    await invoicesRepo.update(b.invoice_id, rest as Partial<Invoice>);
    return b;
  }
  const inv = await invoicesRepo.create({
    ...header, invoice_no: await nextInvoiceNo(), invoice_type: BANQUET_INVOICE_TYPE, salesman_id: null, customer_id: null,
    is_return: 0, is_memorized: 0, is_quotation: 0,
  } as Partial<Invoice>);
  return (await bookingsRepo.update(b.id, { invoice_id: inv.id }))!;
}

/** Receives a payment (advance, part, final) against a booking. */
export async function addBookingPayment(bookingId: string, amount: number, method = "cash", note: string | null = null): Promise<BanquetBooking> {
  return v67(async () => {
    const b = await bookingsRepo.get(bookingId);
    if (!b || b.deleted_at) throw new Error("Booking not found.");
    if (b.status === "cancelled") throw new Error("This booking is cancelled.");
    const a = round(Number(amount) || 0);
    if (a <= 0) throw new Error("Enter the amount received.");
    const due = round(b.total - b.paid);
    if (a > due + 1e-9) throw new Error(`Only Rs ${due.toFixed(2)} is due on this booking.`);
    await bookingPaymentsRepo.create({ booking_id: b.id, date: localDate(), amount: a, method, note: note?.trim() || null, received_by: actorName() });
    const updated = (await bookingsRepo.update(b.id, { paid: round(b.paid + a) }))!;
    return syncBill(updated);
  });
}

/** Cancels a booking: the hall is free again. Money already received stays
 * recorded on the booking (refund it from Cash / Expenses if agreed). */
export async function cancelBooking(bookingId: string, reason: string): Promise<BanquetBooking> {
  const why = reason.trim();
  if (!why) throw new Error("Give the reason for cancelling.");
  const b = await bookingsRepo.get(bookingId);
  if (!b) throw new Error("Booking not found.");
  return (await bookingsRepo.update(bookingId, { status: "cancelled", notes: [b.notes, `Cancelled: ${why}`].filter(Boolean).join("\n") }))!;
}

/** Marks the event held. */
export async function completeBooking(bookingId: string): Promise<BanquetBooking> {
  const b = await bookingsRepo.get(bookingId);
  if (!b || b.status === "cancelled") throw new Error("Booking not found.");
  return (await bookingsRepo.update(bookingId, { status: "completed" }))!;
}

export interface BookingRow extends BanquetBooking {
  hall_name: string | null;
  package_name: string | null;
}

export async function listBookings(opts: { from?: string; to?: string; status?: BookingStatus | "active" | "all"; term?: string } = {}): Promise<BookingRow[]> {
  const t = opts.term?.trim();
  const st = opts.status ?? "active";
  return v67(() => dbSelect<BookingRow>(
    `SELECT b.*, h.name AS hall_name, p.name AS package_name FROM banquet_bookings b
     LEFT JOIN banquet_halls h ON h.id = b.hall_id LEFT JOIN banquet_packages p ON p.id = b.package_id
     WHERE b.tenant_id = ? AND b.deleted_at IS NULL
       ${st === "active" ? "AND b.status != 'cancelled'" : st === "all" ? "" : "AND b.status = ?"}
       ${opts.from ? "AND b.event_date >= ?" : ""} ${opts.to ? "AND b.event_date <= ?" : ""}
       ${t ? "AND (b.customer_name LIKE ? OR b.mobile LIKE ? OR b.booking_no LIKE ? OR b.cnic LIKE ?)" : ""}
     ORDER BY b.event_date ASC, CASE b.slot WHEN 'lunch' THEN 0 WHEN 'full_day' THEN 1 ELSE 2 END LIMIT 500`,
    [requireCurrentTenantId(), ...(st !== "active" && st !== "all" ? [st] : []), ...(opts.from ? [opts.from] : []), ...(opts.to ? [opts.to] : []), ...(t ? Array(4).fill(`%${t}%`) : [])]
  ));
}

export interface BookingDetail {
  booking: BanquetBooking;
  hall: BanquetHall | null;
  pkg: BanquetPackage | null;
  dishes: BookingItem[];
  extras: BookingItem[];
  payments: BookingPayment[];
}

export async function getBooking(id: string): Promise<BookingDetail> {
  const booking = await v67(() => bookingsRepo.get(id));
  if (!booking || booking.deleted_at) throw new Error("Booking not found.");
  const [hall, pkg, items, payments] = await Promise.all([
    booking.hall_id ? hallsRepo.get(booking.hall_id) : Promise.resolve(null),
    booking.package_id ? packagesRepo.get(booking.package_id) : Promise.resolve(null),
    bookingItemsRepo.list({ where: "booking_id = ?", params: [id], orderBy: "created_at ASC" }),
    bookingPaymentsRepo.list({ where: "booking_id = ?", params: [id], orderBy: "created_at ASC" }),
  ]);
  return { booking, hall, pkg, dishes: items.filter((i) => i.kind === "dish"), extras: items.filter((i) => i.kind === "extra"), payments };
}

/** The booking's bill lines: the menu per head x guests, the hall, the extras. */
export function bookingBillLines(d: BookingDetail): ServiceLine[] {
  const b = d.booking;
  const lines: ServiceLine[] = [{ name: `Menu${d.pkg ? `: ${d.pkg.name}` : ""} (per head)`, qty: b.guests, rate: b.per_head_rate }];
  if (b.hall_rent > 0) lines.push({ name: `Hall: ${d.hall?.name ?? "rent"} (${slotLabel(b.slot)})`, qty: 1, rate: b.hall_rent });
  for (const e of d.extras) lines.push({ name: e.name, qty: e.qty, rate: e.rate });
  return lines;
}

export interface BanquetStats {
  today: number;
  upcoming30: number;
  monthBookings: number;
  monthRevenue: number;
  received: number;
  due: number;
}

export async function banquetStats(today = localDate()): Promise<BanquetStats> {
  const tenantId = requireCurrentTenantId();
  return v67(async () => {
    const in30 = new Date(`${today}T00:00:00`);
    in30.setDate(in30.getDate() + 30);
    const to30 = `${in30.getFullYear()}-${String(in30.getMonth() + 1).padStart(2, "0")}-${String(in30.getDate()).padStart(2, "0")}`;
    const [r] = await dbSelect<{ today: number; upcoming30: number; monthBookings: number; monthRevenue: number; received: number; due: number }>(
      `SELECT SUM(CASE WHEN event_date = ? THEN 1 ELSE 0 END) AS today,
              SUM(CASE WHEN event_date >= ? AND event_date <= ? THEN 1 ELSE 0 END) AS upcoming30,
              SUM(CASE WHEN substr(event_date, 1, 7) = ? THEN 1 ELSE 0 END) AS monthBookings,
              SUM(CASE WHEN substr(event_date, 1, 7) = ? THEN total ELSE 0 END) AS monthRevenue,
              SUM(paid) AS received,
              SUM(CASE WHEN event_date >= ? THEN total - paid ELSE 0 END) AS due
       FROM banquet_bookings WHERE tenant_id = ? AND deleted_at IS NULL AND status != 'cancelled'`,
      [today, today, to30, today.slice(0, 7), today.slice(0, 7), today.slice(0, 7) + "-01", tenantId]
    );
    return {
      today: Number(r?.today) || 0, upcoming30: Number(r?.upcoming30) || 0, monthBookings: Number(r?.monthBookings) || 0,
      monthRevenue: Number(r?.monthRevenue) || 0, received: Number(r?.received) || 0, due: Number(r?.due) || 0,
    };
  });
}
