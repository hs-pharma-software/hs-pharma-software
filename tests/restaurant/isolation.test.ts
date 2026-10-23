/** Release-blocking tenant isolation tests. Restaurant A must never see or
 * use Restaurant B's data, nor any other business type's products. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { ctx, makeDb, makeStore, seedMenu } from "./harness.ts";

const env = makeDb();
const { store, session } = makeStore(env.db, ctx("A"));
let A: Awaited<ReturnType<typeof seedMenu>>;
let B: Awaited<ReturnType<typeof seedMenu>>;
let bOrderId = "";
let bTableId = "";

const asA = () => (session.current = ctx("A"));
const asB = () => (session.current = ctx("B"));

before(async () => {
  // A pharmacy's shared-catalog product with a name a restaurant might search.
  env.sql.prepare(`INSERT INTO products (id, name, tenant_id) VALUES ('p1', 'Chicken Burger Pharmacy Item', NULL)`).run();
  asA();
  A = await seedMenu(store, "");
  await store.saveTable({ name: "A-T1", capacity: 4 });
  asB();
  B = await seedMenu(store, "B-");
  const t = await store.saveTable({ name: "B-T1", capacity: 2 });
  bTableId = t.id;
  const o = await store.openOrder({ type: "dine_in", tableId: t.id });
  bOrderId = o.order.id;
  await store.addItem(bOrderId, { menuItemId: B.tikka.id });
  await store.pay(bOrderId, { payments: [{ method: "cash", amount: 5000 }] });
  await store.settings.set("pra_pos_id", "999999");
  asA();
});

test("Restaurant A sees only its own categories and dishes", async () => {
  asA();
  const items = await store.listMenuItems({ includeUnavailable: true });
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.tenant_id === "A"));
  const cats = await store.listCategories(true);
  assert.deepEqual(cats.map((c) => c.name).sort(), ["BBQ", "Burgers", "Drinks"]);
});

test("search and code lookup never return another restaurant's dish", async () => {
  asA();
  assert.equal((await store.listMenuItems({ search: "B-Chicken" })).length, 0);
  assert.equal((await store.listMenuItems({ search: "B-T1" })).length, 0, "item code of B");
});

test("products of other business types never appear in restaurant search", async () => {
  asA();
  const hits = await store.listMenuItems({ search: "Pharmacy Item", includeUnavailable: true });
  assert.equal(hits.length, 0);
});

test("guessing another tenant's ids fails as not found", async () => {
  asA();
  await assert.rejects(store.getMenuItem(B.burger.id), /not found/);
  await assert.rejects(store.getOrder(bOrderId), /not found/);
  await assert.rejects(store.saveMenuItem({ id: B.burger.id, code: "X", name: "Hijack", price: 1 }), /not found/);
  await assert.rejects(store.deleteMenuItem(B.burger.id), /not found/);
  await assert.rejects(store.openOrder({ type: "dine_in", tableId: bTableId }), /not found/);
  await assert.rejects(store.refund(bOrderId, { reason: "x", method: "cash" }), /not found/);
  // B's data is untouched.
  asB();
  assert.equal((await store.getMenuItem(B.burger.id)).name, "B-Chicken Burger");
});

test("another tenant's dish, deal or offer can't be added to an order", async () => {
  asA();
  const o = await store.openOrder({ type: "takeaway" });
  await assert.rejects(store.addItem(o.order.id, { menuItemId: B.burger.id }), /not found/);
  asB();
  const dealId = await store.saveDeal({ code: "BDEAL", name: "B Deal", price: 100, items: [{ menu_item_id: B.cola.id, qty: 1 }] });
  await store.saveOffer({ code: "BOFF", name: "B Offer", type: "percent", value: 50 });
  asA();
  await assert.rejects(store.addDeal(o.order.id, dealId), /not found/);
  await store.addItem(o.order.id, { menuItemId: A.cola.id });
  await assert.rejects(store.previewBill(o.order.id, { offerCodes: ["BOFF"] }), /not found/);
  // A deal can't be built from B's dishes either.
  await assert.rejects(store.saveDeal({ code: "X", name: "X", price: 1, items: [{ menu_item_id: B.cola.id, qty: 1 }] }), /not found/);
  await assert.rejects(store.saveOffer({ code: "Y", name: "Y", type: "percent", value: 5, applies_to: "items", target_ids: [B.cola.id] }), /not found/);
});

test("reports, dashboard, kitchen and PRA queue only show own data", async () => {
  asA();
  const day = "2026-10-23";
  const dishes = await store.salesBy("dish", day, day);
  assert.ok(!dishes.some((d) => d.label.startsWith("B-")));
  const sum = await store.salesSummary(day, day);
  assert.equal(sum.orders, 0, "B's paid order is not counted for A");
  assert.equal((await store.kitchenQueue()).filter((k) => k.tenant_id !== "A").length, 0);
  assert.equal((await store.praSubmissions()).length, 0);
  assert.equal((await store.listTables()).length, 1);
  assert.equal((await store.audits()).filter((a) => (a as unknown as { tenant_id: string }).tenant_id !== "A").length, 0);
});

test("settings (incl. PRA config) are per tenant", async () => {
  asA();
  assert.equal(await store.settings.get("pra_pos_id"), null);
  asB();
  assert.equal(await store.settings.get("pra_pos_id"), "999999");
});

test("signed-out sessions and non-restaurant tenants are refused", async () => {
  session.current = ctx(null);
  await assert.rejects(store.listMenuItems(), /Sign in/);
  session.current = ctx("P", { businessType: "retail_pharmacy" });
  await assert.rejects(store.listMenuItems(), /not a restaurant/);
  await assert.rejects(store.getOrder(bOrderId), /not a restaurant/);
});

test("tenant id comes from the session, not from the caller's data", async () => {
  asA();
  // Passing tenant_id in the payload must not write into B.
  const cat = await store.saveCategory({ name: "Sneaky", tenant_id: "B" } as never);
  assert.equal(cat.tenant_id, "A");
  asB();
  assert.ok(!(await store.listCategories(true)).some((c) => c.name === "Sneaky"));
});
