/** Orders: products that ran out of stock are ordered from the supplier of
 * their last purchase (once, while an order is open); orders can be edited
 * and deleted; converting fills the purchase and links it, after which the
 * order is not edited or converted again. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import {
  createStockOutOrders, listOrdersWithStatus, saveOrder, deleteOrder, orderForPurchase, orderItemsRepo, AUTO_ORDER_TYPE,
} from "@/lib/repo/orders";

const T = "pharm-a";
const DAY = "2026-10-31";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  db.prepare(`INSERT INTO products (id, tenant_id, name, packing, created_at, updated_at) VALUES ('p1', ?, 'Panadol', 10, 'x', 'x'), ('p2', ?, 'Brufen', 1, 'x', 'x'), ('p3', ?, 'Augmentin', 1, 'x', 'x')`).run(T, T, T);
  db.prepare(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES ('s1', ?, 'Ali Traders', 'x', 'x'), ('s2', ?, 'Medi Co', 'x', 'x')`).run(T, T);
});

let n = 0;
const bought = (supplier: string, date: string, product: string, qty: number, price: number) => {
  const id = `pu${++n}`;
  db.prepare(`INSERT INTO purchases (id, tenant_id, date, supplier_id, is_return, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`).run(id, T, date, supplier, date, date);
  db.prepare(`INSERT INTO purchase_items (id, tenant_id, purchase_id, product_id, purchase_price, received_qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 'x')`).run(`${id}-i`, T, id, product, price, qty);
  return id;
};
const stock = (product: string, qty: number) =>
  db.prepare(`INSERT INTO product_batches (id, tenant_id, product_id, batch_no, qty, created_at, updated_at) VALUES (?, ?, ?, 'B', ?, 'x', 'x')`).run(`b-${product}-${++n}`, T, product, qty);

test("sold-out products are ordered from their last supplier, once", async () => {
  bought("s1", "2026-09-01", "p1", 5, 400);
  bought("s2", "2026-10-01", "p1", 3, 420);
  bought("s1", "2026-10-02", "p2", 10, 30);
  bought("s1", "2026-10-03", "p3", 2, 500);
  stock("p1", 0);
  stock("p3", 4);
  assert.deepEqual(await createStockOutOrders(DAY), { products: 2, orders: 2 });
  const orders = await listOrdersWithStatus();
  assert.deepEqual(orders.map((o) => [o.supplier_name, o.order_type, o.item_count, o.purchase_id]).sort(), [
    ["Ali Traders", AUTO_ORDER_TYPE, 1, null], ["Medi Co", AUTO_ORDER_TYPE, 1, null],
  ]);
  const medi = orders.find((o) => o.supplier_name === "Medi Co")!;
  assert.equal(medi.estimated_price, 3 * 420, "last purchase's quantity and rate");
  assert.deepEqual(await createStockOutOrders(DAY), { products: 0, orders: 0 }, "already on an open order");

  stock("p3", -4);
  assert.deepEqual(await createStockOutOrders(DAY), { products: 1, orders: 0 }, "joins the supplier's open stock-out order");
  const ali = (await listOrdersWithStatus()).find((o) => o.supplier_name === "Ali Traders")!;
  assert.equal(ali.item_count, 2);
});

test("edit, convert (purchase linked, then locked) and delete", async () => {
  const o = await saveOrder(null, { supplierId: "s1", orderType: "Manual Order", advancePayment: 0, paymentMethod: "Cash", description: "x" },
    [{ productId: "p1", packing: 10, uomId: null, qty: 2, purchasePrice: 400 }], DAY);
  assert.equal(o.order_no, 1);
  await saveOrder(o.id, { supplierId: "s2", orderType: "Manual Order", advancePayment: 100, paymentMethod: "Cash", description: null },
    [{ productId: "p2", packing: 1, uomId: null, qty: 5, purchasePrice: 30 }], DAY);
  const conv = await orderForPurchase(o.id);
  assert.deepEqual([conv.supplierId, conv.lines], ["s2", [{ productId: "p2", qty: 5, purchasePrice: 30 }]]);
  assert.equal((await orderItemsRepo.list({ where: "order_id = ?", params: [o.id] })).length, 1, "edit replaces the lines");

  db.prepare(`INSERT INTO purchases (id, tenant_id, purchase_no, date, supplier_id, order_id, is_return, created_at, updated_at) VALUES ('px', ?, 7, ?, 's2', ?, 0, 'x', 'x')`).run(T, DAY, o.id);
  const row = (await listOrdersWithStatus())[0];
  assert.deepEqual([row.purchase_id, row.purchase_no], ["px", 7]);
  await assert.rejects(orderForPurchase(o.id), /already converted/);
  await assert.rejects(saveOrder(o.id, { supplierId: "s2", orderType: "x", advancePayment: 0, paymentMethod: "Cash", description: null },
    [{ productId: "p2", packing: 1, uomId: null, qty: 1, purchasePrice: 1 }], DAY), /already converted/);

  await deleteOrder(o.id, "done");
  assert.deepEqual(await listOrdersWithStatus(), []);
});

test("two checks at once order a product only once; existing duplicate stock-out orders are merged", async () => {
  bought("s1", "2026-10-01", "p1", 5, 400);
  bought("s1", "2026-10-02", "p2", 10, 30);
  stock("p1", 0);
  stock("p2", 0);
  const [a, b] = await Promise.all([createStockOutOrders(DAY), createStockOutOrders(DAY)]);
  assert.deepEqual(a, b, "the second call shares the first run");
  let orders = await listOrdersWithStatus();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].item_count, 2);

  // Duplicates made before this fix: a second open stock-out order for the same supplier.
  const dup = await saveOrder(null, { supplierId: "s1", orderType: AUTO_ORDER_TYPE, advancePayment: 0, paymentMethod: "Cash", description: null },
    [{ productId: "p1", packing: 10, uomId: null, qty: 5, purchasePrice: 400 }, { productId: "p3", packing: 1, uomId: null, qty: 2, purchasePrice: 500 }], DAY);
  assert.equal((await listOrdersWithStatus()).length, 2);
  await createStockOutOrders(DAY);
  orders = await listOrdersWithStatus();
  assert.equal(orders.length, 1, "merged into the oldest");
  assert.notEqual(orders[0].id, dup.id);
  assert.equal(orders[0].item_count, 3, "p1 kept once, p3 moved over");
  assert.equal(orders[0].estimated_price, 5 * 400 + 10 * 30 + 2 * 500);
});
