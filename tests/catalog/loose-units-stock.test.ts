/** Selling the last loose units of a pack: 2 of 30 tablets is 0.0666... of
 * a pack; rounding must not refuse the sale. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo, productBatchesRepo } from "@/lib/repo/products";
import { deductStock, listAvailableBatches } from "@/lib/repo/stock";
import { allocateBatches } from "@/lib/batchAllocation";
import { toBaseUnitQty } from "@/lib/uom";

const tenant: SessionTenant = {
  id: "ph-a", name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: "ph-a", permissions: null }, currentTenant: tenant });
});

test("the last 2 tablets of a 30-tablet pack can be sold", async () => {
  const p = await productsRepo.create({ name: "RIGIX 10MG TAB", packing: 30 } as never);
  const left = 2 / 30;
  await productBatchesRepo.create({ product_id: p.id, batch_no: "H5702", expiry_date: null, qty: left, location: null, purchase_price: 300 });
  const batches = await listAvailableBatches(p.id);
  const { parts, short } = allocateBatches(batches, toBaseUnitQty(2, true, 30), 0);
  assert.equal(short, 0);
  assert.ok(parts[0].qty > left, "rounded a hair above the stock");
  await deductStock(parts[0].batch.id, parts[0].qty);
  assert.equal((await productBatchesRepo.get(parts[0].batch.id))?.qty, 0);
  await assert.rejects(deductStock(parts[0].batch.id, 0.01), /Not enough stock/, "real shortages are still refused");
});

test("the last 10 tablets of a 30-tablet pack stored as 0.333333 can be sold", async () => {
  const p = await productsRepo.create({ name: "LOPRIN 75MG TAB", packing: 30 } as never);
  await productBatchesRepo.create({ product_id: p.id, batch_no: "260933", expiry_date: null, qty: 0.333333, location: null, purchase_price: 80 });
  const batches = await listAvailableBatches(p.id);
  const want = toBaseUnitQty(10, true, 30);
  assert.ok(want > 0.333333, "entered amount is a hair above the stored stock");
  const { parts, short } = allocateBatches(batches, want, 0);
  assert.equal(short, 0, "not a shortage");
  await deductStock(parts[0].batch.id, parts[0].qty);
  assert.equal((await productBatchesRepo.get(parts[0].batch.id))?.qty, 0);
  const { short: realShort } = allocateBatches(batches, toBaseUnitQty(11, true, 30), 0);
  assert.ok(realShort > 0, "one tablet more is a real shortage");
});
