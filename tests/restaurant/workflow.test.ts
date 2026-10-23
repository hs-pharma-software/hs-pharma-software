/** End-to-end restaurant workflows on the real schema (scenarios A-D, H),
 * plus permissions, idempotency and concurrency. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ctx, makeDb, makeStore, seedMenu } from "./harness.ts";

let env: ReturnType<typeof makeDb>;
let store: ReturnType<typeof makeStore>["store"];
let session: ReturnType<typeof makeStore>["session"];
let M: Awaited<ReturnType<typeof seedMenu>>;

beforeEach(async () => {
  env = makeDb();
  ({ store, session } = makeStore(env.db, ctx("R")));
  M = await seedMenu(store);
  await store.settings.set("rest_tax_cash_rate", "16");
  await store.settings.set("rest_tax_card_rate", "5");
  await store.settings.set("rest_service_charge_pct", "0");
});

const kitchen = (items: { kitchen_status: string; name: string }[]) => items.map((i) => `${i.name}:${i.kitchen_status}`);

test("Scenario A: dine-in from open table to paid invoice and free table", async () => {
  const t = await store.saveTable({ name: "T1", capacity: 4 });
  const { order } = await store.openOrder({ type: "dine_in", tableId: t.id, guests: 2 });
  assert.equal((await store.listTables())[0].current_order_id, order.id);
  await store.addItem(order.id, { menuItemId: M.burger.id, modifiers: ["Extra Cheese"], qty: 2, notes: "no onion" });
  await store.addItem(order.id, { menuItemId: M.cola.id, qty: 2 });
  const tickets = await store.sendToKitchen(order.id);
  assert.deepEqual(tickets.map((t) => t.kot.station).sort(), ["Drinks", "Grill"]);
  const ids = tickets.flatMap((t) => t.items.map((i) => i.id));
  await store.setKitchenStatus(ids, "preparing");
  await store.setKitchenStatus(ids, "ready");
  await store.setKitchenStatus(ids, "served");
  await store.requestBill(order.id);
  assert.equal((await store.listTables())[0].status, "bill_requested");
  const preview = await store.previewBill(order.id, { methods: ["cash"] });
  // (500+80)*2 + 150*2 = 1460; 16% tax = 233.60
  assert.equal(preview.bill.grossPaisa, 146000);
  assert.equal(preview.bill.taxPaisa, 23360);
  const res = await store.pay(order.id, { payments: [{ method: "cash", amount: 2000 }] });
  assert.ok(res.finalized);
  assert.equal(res.order.invoice_no, 1);
  assert.equal(res.order.total, 1693.6);
  assert.equal(res.change, 306.4);
  const table = (await store.listTables())[0];
  assert.equal(table.status, "available");
  assert.equal(table.current_order_id, null);
});

test("Scenario B: added dishes go to the kitchen once; bill has no duplicates", async () => {
  const t = await store.saveTable({ name: "T2" });
  const { order } = await store.openOrder({ type: "dine_in", tableId: t.id });
  await store.addItem(order.id, { menuItemId: M.tikka.id });
  const first = await store.sendToKitchen(order.id);
  assert.equal(first.length, 1);
  // Opening the same table again returns the same order (no duplicate order).
  const again = await store.openOrder({ type: "dine_in", tableId: t.id });
  assert.equal(again.order.id, order.id);
  await store.addItem(order.id, { menuItemId: M.cola.id, qty: 3 });
  const second = await store.sendToKitchen(order.id);
  assert.equal(second.length, 1);
  assert.deepEqual(second[0].items.map((i) => i.name), ["Cola"]);
  assert.equal((await store.sendToKitchen(order.id)).length, 0, "nothing new: no ticket");
  const { items } = await store.getOrder(order.id);
  assert.deepEqual(kitchen(items).sort(), ["Chicken Tikka:sent", "Cola:sent"]);
  const p = await store.previewBill(order.id);
  assert.equal(p.bill.grossPaisa, 90000 + 45000);
});

test("Scenario C: deal price, kitchen routing and ingredient deduction", async () => {
  const bun = await store.saveIngredient({ name: "Bun", unit: "pcs", reorder_level: 5 });
  const patty = await store.saveIngredient({ name: "Patty", unit: "pcs" });
  await store.adjustStock(bun.id, "purchase", 50);
  await store.adjustStock(patty.id, "purchase", 50);
  await store.saveRecipe(M.burger.id, [
    { ingredient_id: bun.id, qty: 1 },
    { ingredient_id: patty.id, qty: 1 },
  ]);
  const dealId = await store.saveDeal({
    code: "FAM",
    name: "Family Deal",
    price: 1500,
    items: [
      { menu_item_id: M.burger.id, qty: 2 },
      { menu_item_id: M.fries.id, qty: 1, variant: "Large" },
      { menu_item_id: M.cola.id, qty: 2 },
    ],
  });
  const { order } = await store.openOrder({ type: "takeaway" });
  await store.addDeal(order.id, dealId, 2);
  const tickets = await store.sendToKitchen(order.id);
  const byStation = Object.fromEntries(tickets.map((t) => [t.kot.station, t.items.map((i) => `${i.name} x${i.qty}`)]));
  assert.deepEqual(byStation, { Grill: ["Chicken Burger x4"], Fryer: ["Fries (Large) x2"], Drinks: ["Cola x4"] });
  const ings = await store.listIngredients();
  assert.equal(ings.find((i) => i.name === "Bun")!.stock, 46, "2 deals x 2 burgers = 4 buns");
  // Retrying the send must not deduct again.
  await store.sendToKitchen(order.id);
  assert.equal((await store.listIngredients()).find((i) => i.name === "Bun")!.stock, 46);
  const p = await store.previewBill(order.id);
  assert.equal(p.bill.grossPaisa, 300000, "deal price x2, components not charged");
  const paid = await store.pay(order.id, { payments: [{ method: "card", amount: 3150 }] });
  assert.equal(paid.order.total, 3150, "5% card tax on 3000");
  const deals = await store.listDeals();
  assert.equal(deals[0].redemptions, 2);
});

test("Scenario D: offer applies once; repeat and conflicts rejected; usage limit enforced", async () => {
  await store.saveOffer({ code: "TEN", name: "Ten off", type: "percent", value: 10, usage_limit: 1 });
  await store.saveOffer({ code: "FLAT", name: "Flat 50", type: "fixed", value: 50 });
  const a = await store.openOrder({ type: "takeaway" });
  await store.addItem(a.order.id, { menuItemId: M.tikka.id, qty: 2 });
  const p1 = await store.previewBill(a.order.id, { offerCodes: ["TEN"] });
  assert.equal(p1.promo.discountPaisa, 18000);
  const dup = await store.previewBill(a.order.id, { offerCodes: ["TEN", "TEN"] });
  assert.equal(dup.promo.applied.length, 1, "same offer only once");
  const conflict = await store.previewBill(a.order.id, { offerCodes: ["TEN", "FLAT"] });
  assert.equal(conflict.promo.applied.length, 1);
  await assert.rejects(store.pay(a.order.id, { payments: [{ method: "cash", amount: 5000 }], offerCodes: ["TEN", "FLAT"] }), /can't be combined/);
  const paid = await store.pay(a.order.id, { payments: [{ method: "cash", amount: 5000 }], offerCodes: ["TEN"] });
  assert.equal(paid.order.discount, 180);
  const b = await store.openOrder({ type: "takeaway" });
  await store.addItem(b.order.id, { menuItemId: M.tikka.id });
  await assert.rejects(store.pay(b.order.id, { payments: [{ method: "cash", amount: 5000 }], offerCodes: ["TEN"] }), /fully used/);
});

test("concurrent redemption of a last-use offer: exactly one succeeds", async () => {
  await store.saveOffer({ code: "ONE", name: "One left", type: "fixed", value: 100, usage_limit: 1 });
  const o1 = await store.openOrder({ type: "takeaway" });
  const o2 = await store.openOrder({ type: "takeaway" });
  await store.addItem(o1.order.id, { menuItemId: M.tikka.id });
  await store.addItem(o2.order.id, { menuItemId: M.tikka.id });
  const results = await Promise.allSettled([
    store.pay(o1.order.id, { payments: [{ method: "cash", amount: 5000 }], offerCodes: ["ONE"] }),
    store.pay(o2.order.id, { payments: [{ method: "cash", amount: 5000 }], offerCodes: ["ONE"] }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await store.listOffers())[0].used_count, 1);
});

test("double-clicking Pay finalises once with one invoice number", async () => {
  const o = await store.openOrder({ type: "takeaway" });
  await store.addItem(o.order.id, { menuItemId: M.cola.id });
  const [r1, r2] = await Promise.all([
    store.pay(o.order.id, { payments: [{ method: "cash", amount: 200 }] }),
    store.pay(o.order.id, { payments: [{ method: "cash", amount: 200 }] }),
  ]);
  assert.equal(r1.order.invoice_no, r2.order.invoice_no);
  const n = env.sql.prepare(`SELECT COUNT(*) AS n FROM rest_orders WHERE invoice_no IS NOT NULL`).get() as { n: number };
  assert.equal(n.n, 1);
});

test("partial then final payment; card overpayment refused", async () => {
  const o = await store.openOrder({ type: "takeaway" });
  await store.addItem(o.order.id, { menuItemId: M.tikka.id }); // 900 + 16% = 1044
  const part = await store.pay(o.order.id, { payments: [{ method: "cash", amount: 500 }] });
  assert.equal(part.finalized, false);
  assert.equal(part.order.payment_status, "partial");
  await assert.rejects(store.addItem(o.order.id, { menuItemId: M.cola.id }), /partly paid/);
  await assert.rejects(store.pay(o.order.id, { payments: [{ method: "card", amount: 900 }] }), /can't exceed/);
  const done = await store.pay(o.order.id, { payments: [{ method: "cash", amount: 544 }] });
  assert.ok(done.finalized);
  assert.equal(done.order.total, 1044);
});

test("Scenario H: cancel before payment, refund after; originals and audit kept", async () => {
  const bun = await store.saveIngredient({ name: "Bun", unit: "pcs" });
  await store.adjustStock(bun.id, "purchase", 10);
  await store.saveRecipe(M.burger.id, [{ ingredient_id: bun.id, qty: 1 }]);
  const c = await store.openOrder({ type: "takeaway" });
  await store.addItem(c.order.id, { menuItemId: M.burger.id });
  await store.sendToKitchen(c.order.id);
  assert.equal((await store.listIngredients())[0].stock, 9);
  await assert.rejects(store.cancelOrder(c.order.id, ""), /reason/);
  await store.cancelOrder(c.order.id, "Customer left");
  assert.equal((await store.listIngredients())[0].stock, 10, "unprepared dish returned to stock");
  const after = await store.getOrder(c.order.id);
  assert.equal(after.order.status, "cancelled");
  assert.equal(after.items[0].kitchen_status, "cancelled", "item kept, not deleted");

  const s = await store.openOrder({ type: "takeaway" });
  const burger = await store.addItem(s.order.id, { menuItemId: M.burger.id });
  await store.addItem(s.order.id, { menuItemId: M.cola.id });
  const paid = await store.pay(s.order.id, { payments: [{ method: "cash", amount: 1000 }] });
  await assert.rejects(store.cancelOrder(s.order.id, "late"), /paid/);
  const credit = await store.refund(s.order.id, { itemIds: [burger.id], reason: "Cold food", method: "cash" });
  assert.equal(credit.refund_of, s.order.id);
  assert.equal(credit.total, 556.8, "takeaway burger 480 + 16%");
  await assert.rejects(store.refund(s.order.id, { itemIds: [burger.id], reason: "again", method: "cash" }), /Nothing left|already refunded/);
  const orig = await store.getOrder(s.order.id);
  assert.equal(orig.order.status, "paid", "partly refunded original stays paid");
  assert.equal(orig.order.total, paid.order.total, "original invoice unchanged");
  await store.refund(s.order.id, { reason: "Rest of the order", method: "cash" });
  assert.equal((await store.getOrder(s.order.id)).order.status, "refunded");
  const sum = await store.salesSummary("2026-10-23", "2026-10-23");
  assert.equal(sum.collected, 0, "fully refunded sale nets to zero");
  assert.equal(sum.cancelled, 1);
  const actions = (await store.audits()).map((a) => a.action);
  for (const a of ["order.cancel", "invoice.finalize", "invoice.refund"]) assert.ok(actions.includes(a), a);
});

test("dishes sent to the kitchen can't silently change; voids need a reason and permission", async () => {
  const o = await store.openOrder({ type: "takeaway" });
  const item = await store.addItem(o.order.id, { menuItemId: M.tikka.id });
  await store.sendToKitchen(o.order.id);
  await assert.rejects(store.setItemQty(item.id, 5), /already sent/);
  session.current = ctx("R", { role: "staff", deniedActions: ["rest.void", "rest.discount", "rest.refund", "rest.settings", "rest.menu"] });
  await assert.rejects(store.cancelItem(item.id, "wrong"), /permission/);
  await assert.rejects(store.previewBill(o.order.id, { manualDiscount: 100 }), /permission/);
  await assert.rejects(store.saveMenuItem({ code: "Z", name: "Z", price: 1 }), /permission/);
  await assert.rejects(store.settings.set("pra_pos_id", "1"), /permission/);
  session.current = ctx("R");
  await assert.rejects(store.cancelItem(item.id, ""), /reason/);
  await store.cancelItem(item.id, "Wrong dish");
  assert.equal((await store.getOrder(o.order.id)).items[0].kitchen_status, "cancelled");
});

test("prices can't be injected: unknown add-ons, unavailable dishes rejected", async () => {
  const o = await store.openOrder({ type: "takeaway" });
  await assert.rejects(store.addItem(o.order.id, { menuItemId: M.burger.id, modifiers: ["Free Lobster"] }), /not an add-on/);
  await store.saveMenuItem({ ...(await store.getMenuItem(M.cola.id)), is_available: 0 });
  await assert.rejects(store.addItem(o.order.id, { menuItemId: M.cola.id }), /not available/);
  const takeaway = await store.addItem(o.order.id, { menuItemId: M.burger.id });
  assert.equal(takeaway.unit_price, 480, "takeaway price used");
  await assert.rejects(store.saveMenuItem({ code: "B1", name: "Dup", price: 1 }), /already used/);
});

test("table transfer, merge and split keep every item and free tables correctly", async () => {
  const t1 = await store.saveTable({ name: "T1" });
  const t2 = await store.saveTable({ name: "T2" });
  const t3 = await store.saveTable({ name: "T3" });
  const a = await store.openOrder({ type: "dine_in", tableId: t1.id });
  await store.addItem(a.order.id, { menuItemId: M.tikka.id });
  await store.moveOrder(a.order.id, t2.id);
  let tables = await store.listTables();
  assert.equal(tables.find((t) => t.name === "T1")!.current_order_id, null);
  assert.equal(tables.find((t) => t.name === "T2")!.current_order_id, a.order.id);
  const b = await store.openOrder({ type: "dine_in", tableId: t3.id });
  await store.addItem(b.order.id, { menuItemId: M.cola.id, qty: 2 });
  await store.mergeOrders(b.order.id, a.order.id);
  tables = await store.listTables();
  assert.equal(tables.find((t) => t.name === "T3")!.current_order_id, null);
  const merged = await store.getOrder(a.order.id);
  assert.equal(merged.items.length, 2);
  const split = await store.splitOrder(a.order.id, [merged.items.find((i) => i.name === "Cola")!.id]);
  assert.equal(split.items.length, 1);
  assert.equal((await store.getOrder(a.order.id)).items.length, 1);
  const actions = (await store.audits()).map((x) => x.action);
  assert.ok(actions.includes("table.transfer") && actions.includes("table.merge") && actions.includes("order.split"));
});

test("dashboard figures come from real records without double counting", async () => {
  const o = await store.openOrder({ type: "takeaway" });
  await store.addItem(o.order.id, { menuItemId: M.tikka.id });
  await store.pay(o.order.id, { payments: [{ method: "card", amount: 945 }] });
  const d = await store.dashboard("2026-10-23");
  assert.equal(d.summary.orders, 1);
  assert.equal(d.summary.grossSales, 900);
  assert.equal(d.summary.taxCollected, 45);
  assert.equal(d.summary.collected, 945);
  assert.equal(d.payments.card, 945);
  assert.equal(d.payments.cash, 0);
  assert.equal(d.bestSellers[0].label, "Chicken Tikka");
});
