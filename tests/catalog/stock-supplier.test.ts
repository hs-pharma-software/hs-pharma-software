/** Stock list supplier: the supplier of the latest purchase of that product
 * and batch, else of the product's latest purchase; returns and other
 * businesses' purchases do not count. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { stockSupplierNames, supplierOf } from "@/lib/repo/stock";

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
  db.prepare(`INSERT INTO products (id, tenant_id, name, created_at, updated_at) VALUES ('p1', NULL, 'Panadol', 'x', 'x')`).run();
});

const purchase = (id: string, tenantId: string, supplier: string, date: string, isReturn: number, product: string, batch: string | null) => {
  db.prepare(`INSERT OR IGNORE INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')`).run(`s-${supplier}`, tenantId, supplier);
  db.prepare(`INSERT INTO purchases (id, tenant_id, date, supplier_id, is_return, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, tenantId, date, `s-${supplier}`, isReturn, date, date);
  db.prepare(`INSERT INTO purchase_items (id, tenant_id, purchase_id, product_id, batch_no, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')`).run(`${id}-i`, tenantId, id, product, batch);
};

test("supplier per batch, falling back to the product's latest supplier", async () => {
  purchase("pu1", T, "Ali Traders", "2026-09-01", 0, "p1", "A1");
  purchase("pu2", T, "Medi Distributors", "2026-10-01", 0, "p1", "B2");
  purchase("pu3", T, "Return Co", "2026-10-20", 1, "p1", "A1");
  purchase("pu4", "pharm-b", "Other Shop Supplier", "2026-10-25", 0, "p1", "A1");
  const m = await stockSupplierNames();
  assert.equal(supplierOf(m, "p1", "A1"), "Ali Traders");
  assert.equal(supplierOf(m, "p1", " B2 "), "Medi Distributors");
  assert.equal(supplierOf(m, "p1", "ZZ"), "Medi Distributors", "unknown batch: the product's latest supplier");
  assert.equal(supplierOf(m, "p9", "A1"), null);
});
