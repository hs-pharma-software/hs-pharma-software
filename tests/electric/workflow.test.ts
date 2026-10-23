/** Electric / Electronics / Solar store workflows on the real schema. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ctx, makeDb, makeStore, seed } from "./harness.ts";

let env: ReturnType<typeof makeDb>;
let store: ReturnType<typeof makeStore>["store"];
let session: ReturnType<typeof makeStore>["session"];
let S: Awaited<ReturnType<typeof seed>>;
let supplier = "";
let customer = "";

beforeEach(async () => {
  env = makeDb();
  ({ store, session } = makeStore(env.db, ctx("E")));
  S = await seed(store);
  supplier = env.addParty("suppliers", "E", "Pak Cables Ltd");
  customer = env.addParty("customers", "E", "علی احمد", { phone: "03211234567" });
});

const stock = async (id: string) => (await store.getProduct(id)).stock;

test("cable bought by the roll, sold by the metre: exact stock, no double deduction", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.cable.id, unit: "purchase", qty: 2, cost: 9000 }], payments: [{ method: "cash", amount: 18000 }] });
  assert.equal(await stock(S.cable.id), 200);
  assert.equal((await store.getProduct(S.cable.id)).avg_cost, 90, "9000 per 100 m roll = 90 per metre");
  for (const q of [37.5, 12.25, 0.1, 0.2]) await store.createSale({ lines: [{ productId: S.cable.id, qty: q }], payments: [{ method: "cash", amount: 10000 }] });
  assert.equal(await stock(S.cable.id), 149.95);
  await assert.rejects(store.createSale({ lines: [{ productId: S.cable.id, qty: 150 }], payments: [{ method: "cash", amount: 99999 }] }), /in stock/);
  const moves = await store.stockMoves(S.cable.id);
  assert.equal(moves.filter((m) => m.reason === "sale").length, 4);
});

test("negative stock only when the store enables it", async () => {
  await assert.rejects(store.createSale({ lines: [{ productId: S.cable.id, qty: 5 }], payments: [{ method: "cash", amount: 1000 }] }), /in stock/);
  await store.settings.set("es_allow_negative", "true");
  await store.createSale({ lines: [{ productId: S.cable.id, qty: 5 }], payments: [{ method: "cash", amount: 1000 }] });
  assert.equal(await stock(S.cable.id), -5);
});

test("serial-numbered inverter: purchase serials, sell exact serial, warranty dates", async () => {
  await assert.rejects(store.createPurchase({ supplierId: supplier, lines: [{ productId: S.inverter.id, qty: 2, cost: 150000, serials: ["INV-1"] }] }), /exactly 2 serial/);
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.inverter.id, qty: 2, cost: 150000, serials: ["inv-1", "INV-2"] }] });
  assert.equal(await stock(S.inverter.id), 2);
  await assert.rejects(store.createPurchase({ supplierId: supplier, lines: [{ productId: S.inverter.id, qty: 1, cost: 1, serials: ["INV-2"] }] }), /already recorded/);
  await assert.rejects(store.createSale({ lines: [{ productId: S.inverter.id, qty: 1 }], payments: [{ method: "cash", amount: 300000 }] }), /serial/);
  await assert.rejects(store.createSale({ lines: [{ productId: S.inverter.id, qty: 1, serials: ["NOPE"] }], payments: [{ method: "cash", amount: 300000 }] }), /does not belong/);
  const sale = await store.createSale({ customerId: customer, lines: [{ productId: S.inverter.id, qty: 1, serials: ["INV-1"] }], payments: [{ method: "card", amount: 218300 }] });
  assert.equal(sale.doc.total, 218300, "185000 + 18%");
  assert.equal(sale.items[0].warranty_end, "2028-10-22", "24 months from 2026-10-23");
  const [s1] = await store.lookupSerial("INV-1");
  assert.equal(s1.status, "sold");
  assert.equal(s1.customer_name, "علی احمد");
  assert.equal(s1.warranty_end, "2028-10-22");
  assert.equal(s1.seller_warranty_end, "2027-10-22");
  await assert.rejects(store.createSale({ lines: [{ productId: S.inverter.id, qty: 1, serials: ["INV-1"] }], payments: [{ method: "cash", amount: 300000 }] }), /not in stock/);
  const claim = await store.openClaim({ serialId: s1.id, issue: "No output on battery mode" });
  await store.updateClaim(claim.id, "sent_to_supplier");
  assert.equal((await store.listClaims())[0].status, "sent_to_supplier");
});

test("two counters selling the last unit at once: only one succeeds", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.cable.id, qty: 10, cost: 90 }] });
  const sell = () => store.createSale({ lines: [{ productId: S.cable.id, qty: 10 }], payments: [{ method: "cash", amount: 1200 }] });
  const r = await Promise.allSettled([sell(), sell()]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(await stock(S.cable.id), 0, "never negative");
});

test("quotation converts once into an invoice at the quoted price", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.cable.id, qty: 100, cost: 90 }] });
  const q = await store.createQuotation({ customerId: customer, lines: [{ productId: S.cable.id, qty: 50, price: 115 }], validUntil: "2026-11-01" });
  assert.equal(q.doc.total, 5750);
  assert.equal(await stock(S.cable.id), 100, "quotation does not touch stock");
  await store.saveProduct({ ...(await store.getProduct(S.cable.id)), price: 140, min_price: 130 } as never);
  const sale = await store.convertQuotation(q.doc.id, { payments: [{ method: "cash", amount: 5750 }] });
  assert.equal(sale.doc.total, 5750, "quoted price kept");
  assert.equal(await stock(S.cable.id), 50);
  await assert.rejects(store.convertQuotation(q.doc.id, { payments: [] }), /already converted|not valid/);
});

test("credit sale, part payment, customer balance and supplier balance", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.cable.id, unit: "purchase", qty: 1, cost: 9000 }], payments: [{ method: "bank", amount: 4000 }] });
  await assert.rejects(store.createSale({ lines: [{ productId: S.cable.id, qty: 10 }], payments: [] }), /saved customer/);
  const sale = await store.createSale({ customerId: customer, lines: [{ productId: S.cable.id, qty: 20 }], payments: [{ method: "cash", amount: 1000 }] });
  assert.equal(sale.doc.balance, 1400);
  let cust = (await store.balances("customer"))[0];
  assert.equal(cust.balance, 1400);
  await assert.rejects(store.receivePayment({ partyType: "customer", partyId: customer, amount: 2000, method: "cash", docId: sale.doc.id }), /Only Rs 1400/);
  await store.receivePayment({ partyType: "customer", partyId: customer, amount: 1400, method: "digital", docId: sale.doc.id });
  cust = (await store.balances("customer"))[0];
  assert.equal(cust.balance, 0);
  assert.equal((await store.getDoc(sale.doc.id)).doc.balance, 0);
  assert.equal((await store.balances("supplier"))[0].balance, 5000);
});

test("returns: never more than sold; serial goes back to stock; refund reduces balance correctly", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.inverter.id, qty: 1, cost: 150000, serials: ["X1"] }, { productId: S.cable.id, qty: 100, cost: 90 }] });
  const sale = await store.createSale({ customerId: customer, lines: [{ productId: S.inverter.id, qty: 1, serials: ["X1"] }, { productId: S.cable.id, qty: 30 }], payments: [{ method: "cash", amount: 222000 }] });
  const cableLine = sale.items.find((i) => i.product_id === S.cable.id)!;
  const invLine = sale.items.find((i) => i.product_id === S.inverter.id)!;
  await assert.rejects(store.createReturn({ originalId: sale.doc.id, lines: [{ itemId: cableLine.id, qty: 31 }], reason: "x" }), /can still be returned/);
  const r1 = await store.createReturn({ originalId: sale.doc.id, lines: [{ itemId: cableLine.id, qty: 10 }, { itemId: invLine.id, qty: 1, serials: ["X1"] }], reason: "Faulty", refund: { method: "cash", amount: 1200 } });
  assert.equal(r1.doc.doc_type, "sale_return");
  assert.equal(await stock(S.cable.id), 80);
  assert.equal((await store.lookupSerial("X1"))[0].status, "in_stock");
  await assert.rejects(store.createReturn({ originalId: sale.doc.id, lines: [{ itemId: cableLine.id, qty: 21 }], reason: "again" }), /can still be returned/);
  await store.createReturn({ originalId: sale.doc.id, lines: [{ itemId: cableLine.id, qty: 20 }], reason: "rest" });
  // Customer: 221900 billed - 221900 returned - (222000 - 100 change kept... paid 221900 - 1200 refund)
  const bal = (await store.balances("customer"))[0];
  assert.equal(bal.balance, -(221900 - 1200), "store owes the customer the unrefunded returns");
});

test("purchase return takes stock and serials back out", async () => {
  // Paid in full, then one unit returned and refunded by the supplier.
  const p = await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.inverter.id, qty: 2, cost: 150000, serials: ["P1", "P2"] }], payments: [{ method: "bank", amount: 300000 }] });
  await store.createReturn({ originalId: p.doc.id, lines: [{ itemId: p.items[0].id, qty: 1, serials: ["P2"] }], reason: "Damaged on arrival", refund: { method: "bank", amount: 150000 } });
  assert.equal(await stock(S.inverter.id), 1);
  assert.equal((await store.lookupSerial("P2"))[0].status, "returned_to_supplier");
  // owed 300000 - returned 150000 - (paid 300000 - refund 150000) = 0
  assert.equal((await store.balances("supplier"))[0].balance, 0);
  await assert.rejects(store.createReturn({ originalId: p.doc.id, lines: [{ itemId: p.items[0].id, qty: 1, serials: ["P2"] }], reason: "again" }), /not in stock|serial/i);
});

test("permissions: below-minimum price and discounts need permission", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.cable.id, qty: 100, cost: 90 }] });
  session.current = ctx("E", { role: "staff", deniedActions: ["es.discount", "es.catalog", "es.settings"] });
  await assert.rejects(store.createSale({ lines: [{ productId: S.cable.id, qty: 1, price: 100 }], payments: [{ method: "cash", amount: 200 }] }), /below Rs 110/);
  await assert.rejects(store.createSale({ lines: [{ productId: S.cable.id, qty: 1, discount: 5 }], payments: [{ method: "cash", amount: 200 }] }), /discounts/);
  await assert.rejects(store.saveProduct({ sku: "Z", name: "Z", unit: "pcs", price: 1 }), /permission/);
  await assert.rejects(store.settings.set("es_allow_negative", "true"), /permission/);
  await store.settings.setUserLang("ur"); // own language is always allowed
  const ok = await store.createSale({ lines: [{ productId: S.cable.id, qty: 1, price: 115 }], payments: [{ method: "cash", amount: 200 }] });
  assert.equal(ok.change, 85);
});

test("finalised invoice keeps its snapshot after the product changes", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.cable.id, qty: 100, cost: 90 }] });
  const sale = await store.createSale({ customerId: customer, lines: [{ productId: S.cable.id, qty: 10 }], payments: [{ method: "cash", amount: 1200 }] });
  await store.saveProduct({ ...(await store.getProduct(S.cable.id)), name: "Renamed Cable", name_ur: "نیا نام", price: 200, min_price: 150 } as never);
  const again = await store.getDoc(sale.doc.id);
  assert.equal(again.items[0].name, "Copper Cable 2.5mm");
  assert.equal(again.items[0].name_ur, "تانبے کی تار 2.5 ملی میٹر");
  assert.equal(again.items[0].price, 120);
  assert.equal(again.doc.total, 1200);
});

test("invoice language never changes the amounts; Urdu text round-trips intact", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.inverter.id, qty: 2, cost: 150000, serials: ["L1", "L2"] }] });
  const en = await store.createSale({ customerId: customer, lang: "en", lines: [{ productId: S.inverter.id, qty: 1, serials: ["L1"] }], payments: [{ method: "card", amount: 218300 }] });
  const ur = await store.createSale({ customerId: customer, lang: "ur", lines: [{ productId: S.inverter.id, qty: 1, serials: ["L2"] }], payments: [{ method: "card", amount: 218300 }] });
  for (const k of ["gross", "discount", "tax", "total", "paid", "balance"] as const) assert.equal(en.doc[k], ur.doc[k], k);
  assert.equal(ur.doc.party_name, "علی احمد");
  assert.equal(ur.items[0].name_ur, "سولر انورٹر 5kW — Model ABC-5000");
});

test("gross profit uses weighted average cost and nets out returns", async () => {
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.cable.id, qty: 100, cost: 80 }] });
  await store.createPurchase({ supplierId: supplier, lines: [{ productId: S.cable.id, qty: 100, cost: 100 }] });
  assert.equal((await store.getProduct(S.cable.id)).avg_cost, 90);
  const sale = await store.createSale({ lines: [{ productId: S.cable.id, qty: 10 }], payments: [{ method: "cash", amount: 1200 }] });
  let s = await store.summary("2026-10-23", "2026-10-23");
  assert.equal(s.grossProfit, 1200 - 900);
  await store.createReturn({ originalId: sale.doc.id, lines: [{ itemId: sale.items[0].id, qty: 5 }], reason: "x" });
  s = await store.summary("2026-10-23", "2026-10-23");
  assert.equal(s.grossProfit, 600 - 450);
  assert.equal(s.sales, 600);
});

test("product codes and barcodes are unique per store; spec fields validated", async () => {
  await assert.rejects(store.saveProduct({ sku: "CBL-2.5", name: "Dup", unit: "m", price: 1 }), /already used/);
  await assert.rejects(store.saveProduct({ sku: "NEW", barcode: "8960001", name: "Dup", unit: "m", price: 1 }), /already used/);
  await assert.rejects(store.saveProduct({ sku: "NEW2", name: "Panel", product_type: "solar_panel", unit: "pcs", price: 1, specs: { watt: -1 } }), /must be a number/);
  await assert.rejects(store.saveProduct({ sku: "NEW3", name: "X", unit: "pcs", price: 10, min_price: 20 }), /Minimum price/);
  const cable = await store.getProduct(S.cable.id);
  assert.deepEqual(JSON.parse(cable.specs!), { cores: 1, size_mm2: 2.5, conductor: "Copper", roll_length_m: 100 }, "irrelevant spec (watt) dropped");
  const panel = await store.saveProduct({ sku: "PNL-585", name: "Solar Panel 585W", product_type: "solar_panel", unit: "pcs", price: 30000, opening: { qty: 2, unitCost: 25000, serials: ["S-1", "S-2"] } });
  assert.equal(panel.serial_tracked, 1, "panels default to serial tracking");
  assert.equal(panel.stock, 2);
});
