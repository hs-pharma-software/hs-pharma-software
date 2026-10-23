/**
 * Restaurant pricing, promotion, billing and state rules.
 *
 * Pure functions only (no database, no React, relative imports only) so the
 * same code runs in the app and under `node --test`.
 *
 * Money is handled in integer paisa (1 PKR = 100 paisa) and converted back to
 * rupees only at the edges, so totals never drift by floating-point error.
 */

export const toPaisa = (rupees: number): number => Math.round((Number(rupees) || 0) * 100);
export const toRupees = (paisa: number): number => Math.round(paisa) / 100;

// ── Menu and order lines ──────────────────────────────────────────────

export interface PriceOption {
  name: string;
  price: number;
}

export interface MenuItemLike {
  id: string;
  price: number;
  takeaway_price?: number | null;
  variants?: PriceOption[];
  modifiers?: PriceOption[];
  is_available?: number;
}

export type OrderType = "dine_in" | "takeaway" | "delivery";

/** Unit price (paisa) of a menu item for this order type, variant and modifiers.
 * Throws on a variant or modifier the item doesn't offer, so a client can't
 * invent prices. */
export function unitPricePaisa(
  item: MenuItemLike,
  orderType: OrderType,
  variantName: string | null,
  modifierNames: string[]
): number {
  let base = orderType !== "dine_in" && item.takeaway_price != null && item.takeaway_price > 0 ? item.takeaway_price : item.price;
  if (variantName) {
    const v = (item.variants ?? []).find((x) => x.name === variantName);
    if (!v) throw new Error(`"${variantName}" is not a size/variant of this dish.`);
    base = v.price;
  }
  let total = toPaisa(base);
  for (const name of modifierNames) {
    const mod = (item.modifiers ?? []).find((x) => x.name === name);
    if (!mod) throw new Error(`"${name}" is not an add-on for this dish.`);
    total += toPaisa(mod.price);
  }
  return total;
}

/** A priced order line as the engine sees it. */
export interface Line {
  id: string;
  menuItemId: string | null;
  categoryId: string | null;
  /** Deal parent line (carries the deal price). Its components are not lines here. */
  dealId: string | null;
  qty: number;
  unitPaisa: number;
  cancelled?: boolean;
}

export const lineGross = (l: Line): number => (l.cancelled ? 0 : Math.round(l.unitPaisa * l.qty));

// ── Schedules (deals and offers) ──────────────────────────────────────

export interface Schedule {
  is_active: number;
  start_date?: string | null; // YYYY-MM-DD
  end_date?: string | null;
  /** Comma list of weekdays 0 (Sun) .. 6 (Sat); empty = every day. */
  days?: string | null;
  start_time?: string | null; // HH:MM
  end_time?: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Why a schedule is not usable now, or null when it is. */
export function scheduleBlock(s: Schedule, at: Date): string | null {
  if (!s.is_active) return "inactive";
  const day = ymd(at);
  if (s.start_date && day < s.start_date) return "not started yet";
  if (s.end_date && day > s.end_date) return "expired";
  if (s.days && s.days.trim()) {
    const days = s.days.split(",").map((x) => Number(x.trim()));
    if (!days.includes(at.getDay())) return "not available today";
  }
  if (s.start_time && s.end_time) {
    const t = hm(at);
    // Window may cross midnight (e.g. 22:00-02:00).
    const inside = s.start_time <= s.end_time ? t >= s.start_time && t <= s.end_time : t >= s.start_time || t <= s.end_time;
    if (!inside) return `only between ${s.start_time} and ${s.end_time}`;
  }
  return null;
}

// ── Deals ─────────────────────────────────────────────────────────────

export interface DealComponent {
  menu_item_id: string;
  qty: number;
  variant?: string | null;
}

export interface DealLike extends Schedule {
  id: string;
  name: string;
  price: number;
  items: DealComponent[];
  max_redemptions?: number | null;
  redemptions?: number;
}

/** Validates a deal for use now. Components must all exist and be available
 * (rule: an unavailable component rejects the deal; no silent substitution). */
export function validateDeal(deal: DealLike, at: Date, menu: Map<string, MenuItemLike>): string | null {
  const block = scheduleBlock(deal, at);
  if (block) return `Deal "${deal.name}" is ${block}.`;
  if (deal.max_redemptions && (deal.redemptions ?? 0) >= deal.max_redemptions) return `Deal "${deal.name}" has reached its limit.`;
  if (!deal.items.length) return `Deal "${deal.name}" has no items.`;
  for (const c of deal.items) {
    const m = menu.get(c.menu_item_id);
    if (!m) return `Deal "${deal.name}" contains a dish that no longer exists.`;
    if (m.is_available === 0) return `Deal "${deal.name}" is unavailable: one of its dishes is unavailable.`;
    if (c.variant && !(m.variants ?? []).some((v) => v.name === c.variant)) return `Deal "${deal.name}" has an invalid size.`;
  }
  return null;
}

/** Sum of the components at their normal prices: for display only, never
 * applied as a discount. */
export function dealOriginalPaisa(deal: DealLike, menu: Map<string, MenuItemLike>, orderType: OrderType): number {
  return deal.items.reduce((s, c) => {
    const m = menu.get(c.menu_item_id);
    return m ? s + unitPricePaisa(m, orderType, c.variant ?? null, []) * c.qty : s;
  }, 0);
}

// ── Offers / promotions ───────────────────────────────────────────────

export type OfferType = "percent" | "fixed" | "bogo" | "buy_x_get_y";

export interface OfferLike extends Schedule {
  id: string;
  code: string;
  name: string;
  type: OfferType;
  /** percent: 0-100; fixed: rupees. */
  value: number;
  buy_qty?: number | null;
  get_qty?: number | null;
  applies_to: "order" | "category" | "items";
  target_ids?: string[];
  min_order?: number | null;
  min_qty?: number | null;
  max_discount?: number | null;
  usage_limit?: number | null;
  used_count?: number;
  coupon_code?: string | null;
  stackable?: number;
  /** Skip deal lines (already discounted). Default on. */
  exclude_discounted?: number;
}

export interface OfferResult {
  offerId: string;
  code: string;
  name: string;
  discountPaisa: number;
}

function eligibleLines(offer: OfferLike, lines: Line[]): Line[] {
  const excl = offer.exclude_discounted !== 0;
  const targets = new Set(offer.target_ids ?? []);
  return lines.filter((l) => {
    if (l.cancelled) return false;
    if (excl && l.dealId) return false;
    if (offer.applies_to === "category") return !!l.categoryId && targets.has(l.categoryId);
    if (offer.applies_to === "items") return !!l.menuItemId && targets.has(l.menuItemId);
    return true;
  });
}

/** Checks one offer against the order. `coupon` is what the cashier entered.
 * Returns the discount or the reason it can't apply. */
export function evaluateOffer(
  offer: OfferLike,
  lines: Line[],
  at: Date,
  coupon: string | null
): { ok: true; result: OfferResult } | { ok: false; reason: string } {
  const block = scheduleBlock(offer, at);
  if (block) return { ok: false, reason: `Offer "${offer.name}" is ${block}.` };
  if (offer.usage_limit && (offer.used_count ?? 0) >= offer.usage_limit) return { ok: false, reason: `Offer "${offer.name}" has been fully used.` };
  if (offer.coupon_code && offer.coupon_code.trim().toUpperCase() !== (coupon ?? "").trim().toUpperCase()) {
    return { ok: false, reason: `Offer "${offer.name}" needs its coupon code.` };
  }
  const orderGross = lines.reduce((s, l) => s + lineGross(l), 0);
  if (offer.min_order && orderGross < toPaisa(offer.min_order)) {
    return { ok: false, reason: `Offer "${offer.name}" needs a minimum order of Rs ${offer.min_order}.` };
  }
  const elig = eligibleLines(offer, lines);
  const eligQty = elig.reduce((s, l) => s + l.qty, 0);
  const eligGross = elig.reduce((s, l) => s + lineGross(l), 0);
  if (!elig.length || eligGross <= 0) return { ok: false, reason: `No dishes in this order qualify for "${offer.name}".` };
  if (offer.min_qty && eligQty < offer.min_qty) return { ok: false, reason: `Offer "${offer.name}" needs at least ${offer.min_qty} qualifying items.` };

  let discount = 0;
  switch (offer.type) {
    case "percent":
      discount = Math.round((eligGross * Math.min(100, Math.max(0, offer.value))) / 100);
      break;
    case "fixed":
      discount = Math.min(toPaisa(offer.value), eligGross);
      break;
    case "bogo":
    case "buy_x_get_y": {
      const buy = offer.type === "bogo" ? 1 : Math.max(1, offer.buy_qty ?? 1);
      const get = offer.type === "bogo" ? 1 : Math.max(1, offer.get_qty ?? 1);
      // Expand to single units (whole quantities only), cheapest units are free.
      const units: number[] = [];
      for (const l of elig) for (let i = 0; i < Math.floor(l.qty); i++) units.push(l.unitPaisa);
      units.sort((a, b) => a - b);
      const free = Math.floor(units.length / (buy + get)) * get;
      if (free === 0) return { ok: false, reason: `Add ${buy + get} qualifying items for "${offer.name}".` };
      discount = units.slice(0, free).reduce((s, u) => s + u, 0);
      break;
    }
  }
  if (offer.max_discount) discount = Math.min(discount, toPaisa(offer.max_discount));
  discount = Math.min(discount, eligGross);
  if (discount <= 0) return { ok: false, reason: `Offer "${offer.name}" gives no discount on this order.` };
  return { ok: true, result: { offerId: offer.id, code: offer.code, name: offer.name, discountPaisa: discount } };
}

/** Applies the requested offers with explicit stacking rules:
 * - each offer at most once (duplicates rejected);
 * - a non-stackable offer cannot be combined with any other offer;
 * - total discount never exceeds the discountable amount.
 * Returns applied offers and the reasons for any rejected ones. */
export function applyOffers(
  offers: OfferLike[],
  lines: Line[],
  at: Date,
  coupon: string | null
): { applied: OfferResult[]; rejected: { code: string; reason: string }[]; discountPaisa: number } {
  const rejected: { code: string; reason: string }[] = [];
  const seen = new Set<string>();
  const valid: { offer: OfferLike; result: OfferResult }[] = [];
  for (const offer of offers) {
    if (seen.has(offer.id)) {
      rejected.push({ code: offer.code, reason: `Offer "${offer.name}" is already applied.` });
      continue;
    }
    seen.add(offer.id);
    const r = evaluateOffer(offer, lines, at, coupon);
    if (r.ok) valid.push({ offer, result: r.result });
    else rejected.push({ code: offer.code, reason: r.reason });
  }
  let applied = valid;
  if (valid.length > 1 && valid.some((v) => !v.offer.stackable)) {
    // Keep the single best choice: best non-stackable alone vs all stackables together.
    const stackables = valid.filter((v) => v.offer.stackable);
    const stackSum = stackables.reduce((s, v) => s + v.result.discountPaisa, 0);
    const bestSolo = valid.filter((v) => !v.offer.stackable).sort((a, b) => b.result.discountPaisa - a.result.discountPaisa)[0];
    applied = bestSolo.result.discountPaisa >= stackSum ? [bestSolo] : stackables;
    for (const v of valid) {
      if (!applied.includes(v)) rejected.push({ code: v.offer.code, reason: `Offer "${v.offer.name}" can't be combined with the other offer.` });
    }
  }
  const cap = lines.filter((l) => !l.cancelled).reduce((s, l) => s + lineGross(l), 0);
  let total = 0;
  const out: OfferResult[] = [];
  for (const v of applied) {
    const d = Math.min(v.result.discountPaisa, cap - total);
    if (d <= 0) continue;
    total += d;
    out.push({ ...v.result, discountPaisa: d });
  }
  return { applied: out, rejected, discountPaisa: total };
}

// ── Bill totals ───────────────────────────────────────────────────────

export type PayMethod = "cash" | "card" | "bank" | "digital";

export interface TaxSettings {
  /** Sales tax % when paid in cash. */
  cashRate: number;
  /** Sales tax % when paid by card / bank / digital wallet. */
  cardRate: number;
  /** Service charge % (dine-in only). */
  serviceChargePct: number;
  serviceChargeTaxable: boolean;
}

export interface BillTotals {
  grossPaisa: number;
  discountPaisa: number;
  /** Discount spread over lines (same order as input; cancelled lines get 0). */
  lineDiscounts: number[];
  servicePaisa: number;
  taxRate: number;
  /** Tax per line (same order) plus service-charge tax. */
  lineTax: number[];
  serviceTaxPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
}

/** Tax rate for the way the bill is paid. Mixed payments that include cash
 * use the cash rate (documented assumption: the stricter rate applies). */
export function taxRateFor(methods: PayMethod[], s: TaxSettings): number {
  if (!methods.length || methods.includes("cash")) return s.cashRate;
  return s.cardRate;
}

/** Splits `amount` across `weights` proportionally; remainders go to the
 * largest weights so the parts always add up exactly. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const base = raw.map(Math.floor);
  let rest = amount - base.reduce((s, b) => s + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r), w: weights[i] })).sort((a, b) => b.frac - a.frac || b.w - a.w);
  for (const o of order) {
    if (rest <= 0) break;
    base[o.i]++;
    rest--;
  }
  return base;
}

/** Full bill: gross → discount (allocated to lines) → service charge →
 * tax (per line, on the discounted value) → total. Tax-exempt lines are
 * passed via `exempt`. */
export function computeBill(
  lines: Line[],
  discountPaisa: number,
  orderType: OrderType,
  methods: PayMethod[],
  s: TaxSettings,
  exempt: boolean[] = []
): BillTotals {
  const gross = lines.map(lineGross);
  const grossPaisa = gross.reduce((a, b) => a + b, 0);
  const discount = Math.min(Math.max(0, Math.round(discountPaisa)), grossPaisa);
  const lineDiscounts = allocate(discount, gross);
  const net = gross.map((g, i) => g - lineDiscounts[i]);
  const netTotal = net.reduce((a, b) => a + b, 0);
  const servicePaisa = orderType === "dine_in" ? Math.round((netTotal * Math.max(0, s.serviceChargePct)) / 100) : 0;
  const taxRate = taxRateFor(methods, s);
  const lineTax = net.map((n, i) => (exempt[i] ? 0 : Math.round((n * taxRate) / 100)));
  const serviceTaxPaisa = s.serviceChargeTaxable ? Math.round((servicePaisa * taxRate) / 100) : 0;
  const taxPaisa = lineTax.reduce((a, b) => a + b, 0) + serviceTaxPaisa;
  return {
    grossPaisa,
    discountPaisa: discount,
    lineDiscounts,
    servicePaisa,
    taxRate,
    lineTax,
    serviceTaxPaisa,
    taxPaisa,
    totalPaisa: netTotal + servicePaisa + taxPaisa,
  };
}

// ── Payments ──────────────────────────────────────────────────────────

export interface Payment {
  method: PayMethod;
  amount: number; // rupees
}

export type PaymentStatus = "unpaid" | "partial" | "paid" | "refunded";

export function paymentStatus(totalPaisa: number, payments: Payment[]): { paidPaisa: number; balancePaisa: number; status: PaymentStatus } {
  const paidPaisa = payments.reduce((s, p) => s + toPaisa(p.amount), 0);
  const balancePaisa = totalPaisa - paidPaisa;
  const status: PaymentStatus = paidPaisa <= 0 ? "unpaid" : balancePaisa > 0 ? "partial" : "paid";
  return { paidPaisa, balancePaisa, status };
}

// ── State machines ────────────────────────────────────────────────────

export type OrderStatus = "open" | "billed" | "paid" | "cancelled" | "refunded";

const ORDER_FLOW: Record<OrderStatus, OrderStatus[]> = {
  open: ["billed", "paid", "cancelled"],
  billed: ["open", "paid", "cancelled"],
  paid: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canOrderMove(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_FLOW[from]?.includes(to) ?? false;
}

export type TableStatus = "available" | "occupied" | "bill_requested" | "reserved";

const TABLE_FLOW: Record<TableStatus, TableStatus[]> = {
  available: ["occupied", "reserved"],
  reserved: ["occupied", "available"],
  occupied: ["bill_requested", "available"],
  bill_requested: ["occupied", "available"],
};

export function canTableMove(from: TableStatus, to: TableStatus): boolean {
  return TABLE_FLOW[from]?.includes(to) ?? false;
}

export type KitchenStatus = "new" | "sent" | "preparing" | "ready" | "served" | "cancelled";

const KITCHEN_FLOW: Record<KitchenStatus, KitchenStatus[]> = {
  new: ["sent", "cancelled"],
  sent: ["preparing", "ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["served", "cancelled"],
  served: [],
  cancelled: [],
};

export function canKitchenMove(from: KitchenStatus, to: KitchenStatus): boolean {
  return KITCHEN_FLOW[from]?.includes(to) ?? false;
}

/** What a table shows on the floor plan, from its order's item states. */
export function tableDisplayStatus(
  table: TableStatus,
  items: { kitchen_status: KitchenStatus }[]
): "available" | "reserved" | "occupied" | "order_placed" | "preparing" | "ready" | "bill_requested" {
  if (table === "available" || table === "reserved" || table === "bill_requested") return table;
  const live = items.filter((i) => i.kitchen_status !== "cancelled" && i.kitchen_status !== "served");
  if (live.some((i) => i.kitchen_status === "ready")) return "ready";
  if (live.some((i) => i.kitchen_status === "preparing")) return "preparing";
  if (live.some((i) => i.kitchen_status === "sent")) return "order_placed";
  return "occupied";
}
