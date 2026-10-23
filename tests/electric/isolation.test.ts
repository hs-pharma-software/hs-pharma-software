/** Release-blocking isolation tests for Electric / Electronics / Solar stores. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { ctx, makeDb, makeStore, seed } from "./harness.ts";

const env = makeDb();
const { store, session } = makeStore(env.db, ctx("A"));
let A: Awaited<ReturnType<typeof seed>>;
let B: Awaited<ReturnType<typeof seed>>;
let bSaleId = "";
let bCustomer = "";
const asA = () => (session.current = ctx("A"));
const asB = () => (session.current = ctx("B"));

before(async () => {
  env.sql.prepare(`INSERT INTO products (id, name, barcode) VALUES ('ph1', 'Copper Cable Pharmacy Item', '8960001')`).run();
  env.sql.prepare(`INSERT INTO rest_menu_items (id, tenant_id, code, name, price, created_at, updated_at) VALUES ('m1', 'R', 'B1', 'Solar Burger', 500, 'x', 'x')`).run();
  asA();
  A = await seed(store);
  asB();
  // Same names and codes as A on purpose: independent records.
  B = await seed(store);
  bCustomer = env.addParty("customers", "B", "B Customer");
  await store.adjustStock(B.cable.id, "adjustment", 500, "opening");
  const s = await store.createSale({ customerId: bCustomer, lines: [{ productId: B.cable.id, qty: 10 }], payments: [{ method: "cash", amount: 1200 }] });
  bSaleId = s.doc.id;
  asA();
});

test("each store sees only its own products and categories", async () => {
  asA();
  const list = await store.listProducts({ includeInactive: true });
  assert.equal(list.length, 2);
  assert.ok(list.every((p) => p.tenant_id === "A"));
  assert.equal((await store.listCategories()).length, 25);
});

test("same names/codes in two stores keep separate stock and prices", async () => {
  asB();
  assert.equal((await store.getProduct(B.cable.id)).stock, 490);
  asA();
  assert.equal((await store.getProduct(A.cable.id)).stock, 0);
  assert.notEqual(A.cable.id, B.cable.id);
});

test("search and barcode lookup never return another store's or another business type's items", async () => {
  asA();
  const hits = await store.listProducts({ search: "Copper Cable" });
  assert.deepEqual(hits.map((h) => h.id), [A.cable.id]);
  assert.equal((await store.listProducts({ search: "Pharmacy" })).length, 0);
  assert.equal((await store.listProducts({ search: "Burger" })).length, 0);
  const byCode = await store.findByCode("8960001");
  assert.equal(byCode?.id, A.cable.id, "own barcode, not the pharmacy product");
});

test("guessed ids are not found: products, invoices, customers", async () => {
  asA();
  await assert.rejects(store.getProduct(B.cable.id), /not found/);
  await assert.rejects(store.getDoc(bSaleId), /not found/);
  await assert.rejects(store.invoiceForOutput(bSaleId, "pdf"), /not found/, "unauthorized download rejected");
  await assert.rejects(store.saveProduct({ id: B.cable.id, sku: "X", name: "Hijack", unit: "m", price: 1 }), /not found/);
  await assert.rejects(store.ledger("customer", bCustomer), /not found/);
  await assert.rejects(store.createSale({ lines: [{ productId: B.cable.id, qty: 1 }], payments: [{ method: "cash", amount: 200 }] }), /not found/);
  await assert.rejects(store.createSale({ customerId: bCustomer, lines: [{ productId: A.cable.id, qty: 1 }] }), /not found/);
  await assert.rejects(store.createReturn({ originalId: bSaleId, lines: [], reason: "x" }), /not found/);
  asB();
  assert.equal((await store.getProduct(B.cable.id)).name, "Copper Cable 2.5mm", "B unchanged");
});

test("reports, dashboard and balances only include own records", async () => {
  asA();
  const s = await store.summary("2026-10-01", "2026-10-31");
  assert.equal(s.salesCount, 0);
  const d = await store.dashboard("2026-10-23");
  assert.equal(d.recentSales.length, 0);
  assert.equal((await store.balances("customer")).length, 0);
  assert.equal((await store.stockMoves()).every((m) => [A.cable.id, A.inverter.id].includes(m.product_id)), true);
  assert.equal((await store.audits()).length > 0, true);
});

test("language preference is per user and per store", async () => {
  asA();
  await store.settings.setUserLang("ur");
  assert.equal(await store.settings.getUserLang(), "ur");
  asB();
  assert.equal(await store.settings.getUserLang(), "en", "store B unaffected");
  session.current = ctx("A", { userId: "A-cashier" });
  assert.equal(await store.settings.getUserLang(), "en", "another user of store A unaffected");
});

test("signed-out sessions and other business types are refused", async () => {
  session.current = ctx(null);
  await assert.rejects(store.listProducts(), /Sign in/);
  session.current = ctx("R", { businessType: "restaurant" });
  await assert.rejects(store.listProducts(), /not an Electric/);
  session.current = ctx("P", { businessType: "retail_pharmacy" });
  await assert.rejects(store.getDoc(bSaleId), /not an Electric/);
});

test("tenant id in the payload is ignored", async () => {
  asA();
  const c = await store.saveCategory({ name: "Sneaky", tenant_id: "B" } as never);
  assert.equal(c.tenant_id, "A");
});
