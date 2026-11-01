/** Mobile shop (handsets by IMEI) and cloth store (custom sizes book). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo, productBatchesRepo } from "@/lib/repo/products";
import {
  receiveImeis, availableImeis, sellImeis, imeisOfInvoice, releaseInvoiceImeis, returnSoldImeis, removePurchaseImeis,
  returnImeisToSupplier, addImeisToStock, searchImeiRegister, imeiListProblem, parseImeis, imeiTrackedIds,
} from "@/lib/repo/imei";
import { saveMeasurement, searchMeasurements, touchMeasurement, measurementSummary } from "@/lib/cloth";

let db: DatabaseSync;
const tenant = (id: string, businessType: string): SessionTenant => ({
  id, name: id, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType,
});
const as = (id: string, type: string) =>
  useAuthStore.setState({ currentUser: { id: `${id}-owner`, username: "o", displayName: "Owner", role: "owner", tenantId: id, permissions: null }, currentTenant: tenant(id, type) });

const I = (n: number) => `35${String(n).padStart(13, "0")}`;

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  as("shop-a", "mobile_shop");
});

async function phone(name = "Galaxy A15 128GB") {
  return productsRepo.create({ name, packing: 1, track_imei: 1 } as never);
}

test("IMEI lists: 15 digits, one per unit, typed loosely", () => {
  assert.deepEqual(parseImeis(` ${I(1)}\n${I(2)}, ${I(1)} `), [I(1), I(2)]);
  assert.match(imeiListProblem(["123"], 1, "A15")!, /15-digit/);
  assert.match(imeiListProblem([I(1)], 2, "A15")!, /2 handsets, 1 IMEI entered/);
  assert.equal(imeiListProblem([I(1), I(2)], 2, "A15"), null);
});

test("bought, sold to a buyer, back on return; one IMEI never in stock twice", async () => {
  const p = await phone();
  const acc = await productsRepo.create({ name: "Charger", packing: 1 } as never);
  assert.deepEqual([...(await imeiTrackedIds([p.id, acc.id]))], [p.id]);
  await receiveImeis({ productId: p.id, imeis: [I(1), I(2), I(3)], purchaseId: "pur-1", price: 40000 });
  await assert.rejects(receiveImeis({ productId: p.id, imeis: [I(2)], purchaseId: "pur-2", price: 1 }), /already in stock/);
  assert.equal((await availableImeis(p.id)).length, 3);
  assert.deepEqual((await availableImeis(p.id, "0002")).map((u) => u.imei), [I(2)]);

  const buyer = { name: "Ali", mobile: "03001234567", cnic: "3520112345671" };
  await sellImeis("inv-1", [{ productId: p.id, productName: p.name, imeis: [I(1), I(2)] }], buyer);
  assert.deepEqual((await imeisOfInvoice("inv-1")).get(p.id), [I(1), I(2)]);
  await assert.rejects(sellImeis("inv-2", [{ productId: p.id, productName: p.name, imeis: [I(1)] }], buyer), /already sold/);
  await assert.rejects(sellImeis("inv-2", [{ productId: acc.id, productName: "Charger", imeis: [I(3)] }], buyer), /not a Charger in stock/);
  const sold = await searchImeiRegister("3520112345671");
  assert.equal(sold.length, 2);
  assert.equal(sold[0].customer_name, "Ali");

  // Editing the bill: its handsets go back first, then the new choice is sold.
  await sellImeis("inv-1", [{ productId: p.id, productName: p.name, imeis: [I(3)] }], buyer);
  assert.deepEqual((await imeisOfInvoice("inv-1")).get(p.id), [I(3)]);
  assert.equal((await availableImeis(p.id)).length, 2);

  await returnSoldImeis([I(3)]);
  assert.equal((await availableImeis(p.id)).length, 3);
  await assert.rejects(returnSoldImeis([I(3)]), /not a sold handset/);

  await sellImeis("inv-3", [{ productId: p.id, productName: p.name, imeis: [I(1)] }], buyer);
  await releaseInvoiceImeis("inv-3");
  assert.equal((await availableImeis(p.id)).length, 3, "a deleted bill puts its handsets back");
});

test("purchase reversal refused once a handset is sold; supplier return; bought again later", async () => {
  const p = await phone();
  await receiveImeis({ productId: p.id, imeis: [I(1), I(2)], purchaseId: "pur-1", price: 40000 });
  await sellImeis("inv-1", [{ productId: p.id, productName: p.name, imeis: [I(1)] }], { name: "A", mobile: null, cnic: null });
  await assert.rejects(removePurchaseImeis("pur-1"), /sold already/);
  await releaseInvoiceImeis("inv-1");
  await removePurchaseImeis("pur-1");
  assert.equal((await availableImeis(p.id)).length, 0);
  await receiveImeis({ productId: p.id, imeis: [I(1)], purchaseId: "pur-2", price: 39000 });
  await returnImeisToSupplier([I(1)]);
  assert.equal((await searchImeiRegister(I(1), "returned")).length, 1);
  await receiveImeis({ productId: p.id, imeis: [I(1)], purchaseId: "pur-3", price: 38000 });
  assert.equal((await availableImeis(p.id))[0].purchase_id, "pur-3");
});

test("IMEIs for opening stock: never more than the stock", async () => {
  const p = await phone();
  await productBatchesRepo.create({ product_id: p.id, batch_no: null, expiry_date: null, qty: 2, location: null, purchase_price: 41000 });
  await assert.rejects(addImeisToStock(p.id, [I(1), I(2), I(3)]), /at most 2 more/);
  await addImeisToStock(p.id, [I(1), I(2)]);
  assert.equal((await availableImeis(p.id))[0].purchase_price, 41000);
  const acc = await productsRepo.create({ name: "Cover", packing: 1 } as never);
  await assert.rejects(addImeisToStock(acc.id, [I(5)]), /does not track IMEIs/);
});

test("handsets are per shop", async () => {
  const p = await phone();
  await receiveImeis({ productId: p.id, imeis: [I(1)], purchaseId: null, price: 1 });
  as("shop-b", "mobile_shop");
  assert.equal((await searchImeiRegister("")).length, 0);
  const q = await phone();
  await receiveImeis({ productId: q.id, imeis: [I(1)], purchaseId: null, price: 1 });
  assert.equal((await searchImeiRegister(I(1))).length, 1, "the same IMEI in another shop is that shop's own");
});

test("cloth store: custom sizes saved, found by name or mobile, latest use first", async () => {
  as("cloth-a", "cloth_store");
  await assert.rejects(saveMeasurement(null, { customer_name: " ", garment: "Kurta", values: { Chest: "40" } }), /name/);
  await assert.rejects(saveMeasurement(null, { customer_name: "Bilal", mobile: "12345", garment: "Kurta", values: { Chest: "40" } }), /03001234567/);
  await assert.rejects(saveMeasurement(null, { customer_name: "Bilal", garment: "Kurta", values: { Chest: " " } }), /at least one/);
  const a = await saveMeasurement(null, { customer_name: "Bilal Ahmed", mobile: "0300-1234567", garment: "Shalwar Kameez", values: { Length: "42", Chest: "40", Collar: "" } });
  assert.equal(a.mobile, "03001234567");
  assert.equal(measurementSummary(a), "Length 42 · Chest 40");
  const b = await saveMeasurement(null, { customer_name: "Sana", mobile: "03211234567", garment: "Ladies Suit", values: { Bust: "34" } });
  assert.deepEqual((await searchMeasurements("bilal")).map((m) => m.id), [a.id]);
  assert.deepEqual((await searchMeasurements("0321")).map((m) => m.id), [b.id]);
  await touchMeasurement(a.id);
  assert.equal((await searchMeasurements(""))[0].id, a.id);
  const edited = await saveMeasurement(a.id, { customer_name: "Bilal Ahmed", mobile: "03001234567", garment: "Shalwar Kameez", values: { Length: "43" } });
  assert.equal(measurementSummary(edited), "Length 43");
  as("cloth-b", "cloth_store");
  assert.equal((await searchMeasurements("")).length, 0, "another store's book is its own");
});
