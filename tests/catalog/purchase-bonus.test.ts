/** Purchase bonus and withholding tax: bonus units are free, so the cost of
 * one unit in stock is the amount over quantity + bonus; sales tax and WHT
 * are both added to what is payable; deleting a purchase takes the bonus
 * back out of stock too. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { purchaseLineMath } from "@/lib/purchaseMath";
import { purchasesRepo, purchaseItemsRepo, deletePurchaseWithStockReversal } from "@/lib/repo/purchases";
import { receiveStock } from "@/lib/repo/stock";
import { productBatchesRepo } from "@/lib/repo/products";
import type { Purchase, PurchaseItem } from "@/lib/types2";

const T = "pharm-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  db.prepare(`INSERT INTO products (id, tenant_id, name, created_at, updated_at) VALUES ('p1', ?, 'Panadol', 'x', 'x')`).run(T);
  db.prepare(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES ('s1', ?, 'Ali Traders', 'x', 'x')`).run(T);
});

test("85 with 1 bonus costs 42.50 a unit; ST and WHT are both added", () => {
  assert.equal(purchaseLineMath(85, 1, 1, 0, 0).netRate, 42.5);
  assert.equal(purchaseLineMath(100, 10, 2, 0, 0).netRate.toFixed(4), (1000 / 12).toFixed(4));
  assert.equal(purchaseLineMath(85, 1, 0, 0, 0).netRate, 85);
  const m = purchaseLineMath(100, 10, 2, 17, 1);
  assert.deepEqual([m.amount, m.st, m.wht, m.total], [1000, 170, 10, 1180]);
});

test("a purchase with bonus: stock gets qty + bonus at the net rate; deleting takes both back out", async () => {
  const pu = await purchasesRepo.create({ purchase_no: 1, date: "2026-10-31", supplier_id: "s1", payable: 1010, paid_amount: 0, balance: 1010, is_return: 0 } as Partial<Purchase>);
  const batch = await receiveStock({ productId: "p1", batchNo: "A1", qty: 12, purchasePrice: purchaseLineMath(100, 10, 2, 0, 0).netRate, expiryDate: null, location: null });
  await purchaseItemsRepo.create({ purchase_id: pu.id, product_id: "p1", batch_no: "A1", purchase_price: 100, booked_qty: 10, received_qty: 10, bonus_qty: 2, amount: 1000, st_pct: 0, wht_pct: 1, total: 1010 } as Partial<PurchaseItem>);
  assert.equal((await productBatchesRepo.get(batch.id))!.qty, 12);
  assert.equal(Number((await productBatchesRepo.get(batch.id))!.purchase_price.toFixed(2)), 83.33);
  await deletePurchaseWithStockReversal(pu.id, "test");
  assert.equal((await productBatchesRepo.get(batch.id))!.qty, 0);
});
