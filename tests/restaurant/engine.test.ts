import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocate,
  applyOffers,
  canKitchenMove,
  canOrderMove,
  canTableMove,
  computeBill,
  evaluateOffer,
  paymentStatus,
  scheduleBlock,
  tableDisplayStatus,
  toPaisa,
  unitPricePaisa,
  validateDeal,
  type Line,
  type OfferLike,
  type TaxSettings,
} from "../../src/lib/restaurant/engine.ts";

const tax: TaxSettings = { cashRate: 16, cardRate: 5, serviceChargePct: 10, serviceChargeTaxable: true };
const at = new Date("2026-10-23T13:30:00"); // Friday
const line = (id: string, unit: number, qty = 1, extra: Partial<Line> = {}): Line => ({ id, menuItemId: id, categoryId: "c1", dealId: null, qty, unitPaisa: toPaisa(unit), ...extra });
const offer = (o: Partial<OfferLike>): OfferLike => ({ id: o.code ?? "o", code: "O", name: "Offer", type: "percent", value: 10, applies_to: "order", is_active: 1, ...o });

test("modifier and variant pricing; unknown options rejected", () => {
  const item = { id: "b", price: 500, takeaway_price: 480, variants: [{ name: "Large", price: 650 }], modifiers: [{ name: "Cheese", price: 80 }] };
  assert.equal(unitPricePaisa(item, "dine_in", null, ["Cheese"]), 58000);
  assert.equal(unitPricePaisa(item, "takeaway", null, []), 48000);
  assert.equal(unitPricePaisa(item, "dine_in", "Large", ["Cheese"]), 73000);
  assert.throws(() => unitPricePaisa(item, "dine_in", null, ["Gold Leaf"]), /not an add-on/);
  assert.throws(() => unitPricePaisa(item, "dine_in", "Huge", []), /not a size/);
});

test("allocation always sums exactly", () => {
  for (const [amount, weights] of [[100, [1, 1, 1]], [1, [3, 3, 3]], [9999, [12345, 1, 77]], [0, [5, 5]]] as const) {
    const parts = allocate(amount, [...weights]);
    assert.equal(parts.reduce((s, p) => s + p, 0), amount);
  }
});

test("bill: discount, service charge (dine-in only), tax by payment method", () => {
  const lines = [line("a", 500, 2), line("b", 250)];
  const cash = computeBill(lines, toPaisa(125), "dine_in", ["cash"], tax);
  assert.equal(cash.grossPaisa, 125000);
  assert.equal(cash.discountPaisa, 12500);
  assert.equal(cash.lineDiscounts.reduce((a, b) => a + b, 0), 12500);
  assert.equal(cash.servicePaisa, 11250); // 10% of 1125
  assert.equal(cash.taxRate, 16);
  assert.equal(cash.lineTax.reduce((a, b) => a + b, 0) + cash.serviceTaxPaisa, cash.taxPaisa);
  assert.equal(cash.totalPaisa, 112500 + 11250 + cash.taxPaisa);
  const card = computeBill(lines, 0, "takeaway", ["card"], tax);
  assert.equal(card.servicePaisa, 0);
  assert.equal(card.taxRate, 5);
  assert.equal(card.taxPaisa, 6250);
  const mixed = computeBill(lines, 0, "takeaway", ["card", "cash"], tax);
  assert.equal(mixed.taxRate, 16, "mixed with cash uses the cash rate");
  assert.equal(computeBill(lines, toPaisa(99999), "takeaway", ["cash"], tax).discountPaisa, 125000, "discount capped at gross");
});

test("tax-exempt lines get no tax", () => {
  const b = computeBill([line("a", 100), line("b", 100)], 0, "takeaway", ["cash"], tax, [false, true]);
  assert.deepEqual(b.lineTax, [1600, 0]);
});

test("offers: percent with cap, fixed, minimum order, expiry, coupon", () => {
  const lines = [line("a", 1000, 2)];
  const pct = evaluateOffer(offer({ value: 20, max_discount: 300 }), lines, at, null);
  assert.ok(pct.ok && pct.result.discountPaisa === 30000, "20% of 2000 = 400 capped to 300");
  const fixed = evaluateOffer(offer({ type: "fixed", value: 150 }), lines, at, null);
  assert.ok(fixed.ok && fixed.result.discountPaisa === 15000);
  const min = evaluateOffer(offer({ min_order: 3000 }), lines, at, null);
  assert.ok(!min.ok && /minimum order/.test(min.reason));
  const expired = evaluateOffer(offer({ end_date: "2026-10-01" }), lines, at, null);
  assert.ok(!expired.ok && /expired/.test(expired.reason));
  const needsCoupon = evaluateOffer(offer({ coupon_code: "SAVE10" }), lines, at, null);
  assert.ok(!needsCoupon.ok && /coupon/.test(needsCoupon.reason));
  assert.ok(evaluateOffer(offer({ coupon_code: "SAVE10" }), lines, at, "save10").ok);
  const used = evaluateOffer(offer({ usage_limit: 5, used_count: 5 }), lines, at, null);
  assert.ok(!used.ok && /fully used/.test(used.reason));
});

test("happy hour and weekday offers", () => {
  const lines = [line("a", 1000)];
  assert.ok(evaluateOffer(offer({ start_time: "13:00", end_time: "15:00" }), lines, at, null).ok);
  const late = evaluateOffer(offer({ start_time: "18:00", end_time: "20:00" }), lines, at, null);
  assert.ok(!late.ok && /only between/.test(late.reason));
  assert.ok(evaluateOffer(offer({ days: "5" }), lines, at, null).ok, "Friday allowed");
  assert.ok(!evaluateOffer(offer({ days: "1,2" }), lines, at, null).ok);
  assert.equal(scheduleBlock({ is_active: 1, start_time: "22:00", end_time: "02:00" }, new Date("2026-10-23T23:30:00")), null, "window across midnight");
});

test("BOGO and buy-X-get-Y give the cheapest units free", () => {
  const lines = [line("a", 500, 1), line("b", 300, 1), line("c", 200, 1)];
  const bogo = evaluateOffer(offer({ type: "bogo" }), lines, at, null);
  assert.ok(bogo.ok && bogo.result.discountPaisa === 20000, "3 items: 1 pair, cheapest (200) free");
  const b2g1 = evaluateOffer(offer({ type: "buy_x_get_y", buy_qty: 2, get_qty: 1 }), lines, at, null);
  assert.ok(b2g1.ok && b2g1.result.discountPaisa === 20000);
  const notEnough = evaluateOffer(offer({ type: "buy_x_get_y", buy_qty: 3, get_qty: 1 }), lines, at, null);
  assert.ok(!notEnough.ok);
});

test("category and dish targeting; deal lines excluded by default", () => {
  const lines = [line("a", 1000, 1, { categoryId: "bbq" }), line("b", 500, 1, { categoryId: "drinks" }), line("deal", 900, 1, { dealId: "d1", menuItemId: null, categoryId: null })];
  const cat = evaluateOffer(offer({ applies_to: "category", target_ids: ["bbq"], value: 10 }), lines, at, null);
  assert.ok(cat.ok && cat.result.discountPaisa === 10000);
  const all = evaluateOffer(offer({ value: 10 }), lines, at, null);
  assert.ok(all.ok && all.result.discountPaisa === 15000, "deal line excluded");
  const inclDeals = evaluateOffer(offer({ value: 10, exclude_discounted: 0 }), lines, at, null);
  assert.ok(inclDeals.ok && inclDeals.result.discountPaisa === 24000);
});

test("stacking: duplicates rejected, non-stackable conflicts resolved to the better choice", () => {
  const lines = [line("a", 1000, 2)];
  const a = offer({ id: "A", code: "A", name: "Ten", value: 10 });
  const b = offer({ id: "B", code: "B", name: "Flat", type: "fixed", value: 500 });
  const dup = applyOffers([a, a], lines, at, null);
  assert.equal(dup.applied.length, 1);
  assert.match(dup.rejected[0].reason, /already applied/);
  const conflict = applyOffers([a, b], lines, at, null);
  assert.equal(conflict.applied.length, 1);
  assert.equal(conflict.applied[0].code, "B", "500 beats 10% of 2000");
  assert.equal(conflict.rejected.length, 1);
  const s1 = offer({ id: "S1", code: "S1", value: 10, stackable: 1 });
  const s2 = offer({ id: "S2", code: "S2", type: "fixed", value: 100, stackable: 1 });
  const stacked = applyOffers([s1, s2], lines, at, null);
  assert.equal(stacked.discountPaisa, 20000 + 10000);
  const huge = applyOffers([offer({ id: "H1", code: "H1", type: "fixed", value: 1500, stackable: 1 }), offer({ id: "H2", code: "H2", type: "fixed", value: 1500, stackable: 1 })], lines, at, null);
  assert.equal(huge.discountPaisa, 200000, "never more than the bill");
});

test("deal validation: schedule, limits, unavailable or missing dishes", () => {
  const menu = new Map([
    ["b", { id: "b", price: 500, is_available: 1 }],
    ["f", { id: "f", price: 250, is_available: 0 }],
  ]);
  const deal = { id: "d", name: "Combo", price: 650, is_active: 1, items: [{ menu_item_id: "b", qty: 1 }] };
  assert.equal(validateDeal(deal, at, menu), null);
  assert.match(validateDeal({ ...deal, end_date: "2026-10-01" }, at, menu)!, /expired/);
  assert.match(validateDeal({ ...deal, max_redemptions: 2, redemptions: 2 }, at, menu)!, /limit/);
  assert.match(validateDeal({ ...deal, items: [{ menu_item_id: "f", qty: 1 }] }, at, menu)!, /unavailable/);
  assert.match(validateDeal({ ...deal, items: [{ menu_item_id: "zzz", qty: 1 }] }, at, menu)!, /no longer exists/);
});

test("payment status and state machines", () => {
  assert.deepEqual(paymentStatus(10000, []).status, "unpaid");
  assert.deepEqual(paymentStatus(10000, [{ method: "cash", amount: 40 }]).status, "partial");
  assert.deepEqual(paymentStatus(10000, [{ method: "cash", amount: 60 }, { method: "card", amount: 40 }]).status, "paid");
  assert.ok(canOrderMove("open", "paid") && !canOrderMove("paid", "open") && !canOrderMove("cancelled", "open"));
  assert.ok(canTableMove("available", "occupied") && !canTableMove("available", "bill_requested"));
  assert.ok(canKitchenMove("sent", "preparing") && !canKitchenMove("served", "preparing") && !canKitchenMove("new", "ready"));
  assert.equal(tableDisplayStatus("occupied", [{ kitchen_status: "sent" }, { kitchen_status: "ready" }]), "ready");
  assert.equal(tableDisplayStatus("occupied", [{ kitchen_status: "new" }]), "occupied");
});
