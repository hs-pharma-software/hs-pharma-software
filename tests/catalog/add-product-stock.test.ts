/** Contractor "Add stock" on the products list: the first top-up creates a
 * stock row, later ones add to it. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { addProductStock } from "@/lib/repo/stock";
import { groupUnbatchedStockRows, type StockDisplayRow } from "@/lib/stockDisplay";

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

test("stock display groups identical unbatched contractor receipts but preserves distinct batches and costs", () => {
  const row = (id: string, qty: number, overrides: Partial<StockDisplayRow> = {}): StockDisplayRow => ({
    id, product_id: "p1", barcode: null, product_name: "Smoke Detector", company_name: null, supplier_name: null,
    location: null, category_name: null, uom_name: "No", secondary_unit_id: null, secondary_unit_name: null,
    packing: 1, avail_qty: qty, batch_no: null, expiry_date: null, mrp: 0, sale_price: 4500, purchase_price: 3000,
    ...overrides,
  });
  const displayed = groupUnbatchedStockRows([
    row("r1", 5),
    row("r2", 15),
    row("r3", 5, { purchase_price: 3200 }),
    row("r4", 20, { batch_no: "B-1" }),
  ]);
  assert.equal(displayed.length, 3);
  assert.equal(displayed[0].avail_qty, 20);
  assert.equal(displayed[0].entryCount, 2);
  assert.equal(displayed[0].isSummary, true);
  assert.equal(displayed[1].avail_qty, 5);
  assert.equal(displayed[2].batch_no, "B-1");
});
