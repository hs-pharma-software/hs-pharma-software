/** Contractor "Add stock" on the products list: the first top-up creates a
 * stock row, later ones add to it. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { addProductStock } from "@/lib/repo/stock";

const T = "con-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Contractor", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "contractor",
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  db.prepare(`INSERT INTO products (id, tenant_id, name, packing, created_at, updated_at) VALUES ('p1', ?, 'Cannula', 1, 'x', 'x')`).run(T);
});

test("first top-up creates a stock row, the next adds to it", async () => {
  await addProductStock("p1", 10, 50);
  await addProductStock("p1", 5);
  const rows = db.prepare(`SELECT qty, purchase_price FROM product_batches WHERE product_id = 'p1' AND tenant_id = ? AND deleted_at IS NULL`).all(T) as { qty: number; purchase_price: number }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 15);
  assert.equal(rows[0].purchase_price, 50);
  await assert.rejects(addProductStock("p1", 0), /greater than 0/);
});
