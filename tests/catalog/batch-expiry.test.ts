/** Stock expiry: expired / expiring within 6 months / fine, and correcting a
 * wrongly entered expiry at most 3 times per batch, each correction kept. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productBatchesRepo } from "@/lib/repo/products";
import { correctBatchExpiry, expiryStatus, expiryCorrectionCounts, listExpiryChanges } from "@/lib/repo/batchExpiry";

const T = "pharm-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "u1", username: "ali", displayName: "Ali", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  db.prepare(`INSERT INTO products (id, tenant_id, name, created_at, updated_at) VALUES ('p1', ?, 'Panadol', 'x', 'x')`).run(T);
  db.prepare(`INSERT INTO product_batches (id, tenant_id, product_id, batch_no, expiry_date, qty, created_at, updated_at) VALUES ('b1', ?, 'p1', 'B-1', '2026-11-30', 10, 'x', 'x')`).run(T);
});

test("expiry colour: expired on or before today, soon within 180 days, otherwise fine", () => {
  const today = "2026-10-31";
  assert.equal(expiryStatus("2026-10-31", today).status, "expired");
  assert.equal(expiryStatus("2025-01-01", today).status, "expired");
  assert.deepEqual(expiryStatus("2026-11-30", today), { status: "soon", days: 30 });
  assert.equal(expiryStatus("2027-04-29", today).status, "soon");
  assert.equal(expiryStatus("2027-05-30", today).status, "ok");
  assert.equal(expiryStatus(null, today).status, "none");
});

test("an expiry can be corrected 3 times, with a reason, and every correction is kept", async () => {
  await assert.rejects(correctBatchExpiry("b1", "2028-11-30", " "), /why/);
  await assert.rejects(correctBatchExpiry("b1", "30/11/2028", "typo"), /correct expiry date/);
  await assert.rejects(correctBatchExpiry("b1", "2026-11-30", "typo"), /already the batch's expiry/);
  assert.deepEqual(await correctBatchExpiry("b1", "2028-11-30", "Typed 2026 for 2028"), { left: 2 });
  assert.equal((await productBatchesRepo.get("b1"))!.expiry_date, "2028-11-30");
  await correctBatchExpiry("b1", "2028-10-30", "Wrong month");
  assert.deepEqual(await correctBatchExpiry("b1", "2028-10-31", "Last day of month"), { left: 0 });
  await assert.rejects(correctBatchExpiry("b1", "2029-01-01", "again"), /already been corrected 3 times/);
  assert.equal((await productBatchesRepo.get("b1"))!.expiry_date, "2028-10-31");
  const h = await listExpiryChanges("b1");
  assert.deepEqual(h.map((x) => [x.old_expiry, x.new_expiry, x.changed_by_name]), [
    ["2026-11-30", "2028-11-30", "Ali"], ["2028-11-30", "2028-10-30", "Ali"], ["2028-10-30", "2028-10-31", "Ali"],
  ]);
  assert.equal((await expiryCorrectionCounts()).get("b1"), 3);
});

test("before the v60 database update, correcting says so and the stock list still loads", async () => {
  db.exec(`DROP TABLE product_batch_expiry_changes`);
  assert.deepEqual(await expiryCorrectionCounts(), new Map());
  await assert.rejects(correctBatchExpiry("b1", "2028-11-30", "typo"), /database update \(v60\)/);
  assert.equal((await productBatchesRepo.get("b1"))!.expiry_date, "2026-11-30");
});
