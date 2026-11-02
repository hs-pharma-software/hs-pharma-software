/** Products > Import CSV: rows are read by header name, existing products
 * and repeats are skipped, missing categories / units are created, prices
 * kept, and opening stock only when asked. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { parseCsv, planImport, readImportRows, runImport } from "@/lib/productImport";
import { getLatestPrice } from "@/lib/repo/products";

const T = "con-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Contractor", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "contractor",
};

const CSV = [
  "﻿Name*,Barcode,Company,Category,Sub Category,UOM*,Purchase Price,Sale Price,Wholesale Price,MRP,HS Code,Packing (units per box),Opening Qty",
  'inf Gelofusine,,B Braun Pharma,Medicine,,Each,860.00,1350.00,,,,1,42',
  '"Bandage 4"", Crepe",,,Surgical,,No,65,220,,,,1,0',
  'NG Tube 8 No,,,Surgical,,No,10,150,,,,1,5',
  'INF GELOFUSINE,,,Medicine,,Each,1,2,,,,1,1',
].join("\r\n");

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  db.prepare(`INSERT INTO uoms (id, tenant_id, name, created_at, updated_at) VALUES ('u-no', ?, 'NO', 'x', 'x')`).run(T);
  db.prepare(`INSERT INTO products (id, tenant_id, name, packing, created_at, updated_at) VALUES ('p-ng', ?, 'NG Tube 8 No', 1, 'x', 'x')`).run(T);
});

test("imports new products, skips existing and repeated ones", async () => {
  const { rows } = readImportRows(parseCsv(CSV));
  assert.equal(rows.length, 4);
  assert.equal(rows[1].name, 'Bandage 4", Crepe');
  const plan = await planImport(rows);
  assert.deepEqual(plan.add.map((r) => r.name), ["inf Gelofusine", 'Bandage 4", Crepe']);
  assert.deepEqual(plan.skip.map((s) => s.reason), ["already in your products", "twice in the file"]);
  assert.deepEqual(plan.newCategories.sort(), ["Medicine", "Surgical"]);
  assert.deepEqual(plan.newUoms, ["Each"]); // "No" matches the existing "NO"

  const r = await runImport(plan, { openingStock: false });
  assert.equal(r.created, 2);
  assert.deepEqual(r.failed, []);
  const gelo = db.prepare(`SELECT id, base_unit_id FROM products WHERE tenant_id = ? AND name = 'inf Gelofusine'`).get(T) as { id: string; base_unit_id: string };
  assert.equal((await getLatestPrice(gelo.id))?.salePrice, 1350);
  const batch = db.prepare(`SELECT qty, purchase_price FROM product_batches WHERE product_id = ?`).get(gelo.id) as { qty: number; purchase_price: number };
  assert.deepEqual({ ...batch }, { qty: 0, purchase_price: 860 });
  const bandage = db.prepare(`SELECT base_unit_id FROM products WHERE tenant_id = ? AND name LIKE 'Bandage%'`).get(T) as { base_unit_id: string };
  assert.equal(bandage.base_unit_id, "u-no");
});

test("opening stock is added only when asked", async () => {
  const plan = await planImport(readImportRows(parseCsv(CSV)).rows);
  await runImport(plan, { openingStock: true });
  const q = db.prepare(`SELECT b.qty FROM product_batches b JOIN products p ON p.id = b.product_id WHERE p.name = 'inf Gelofusine'`).get() as { qty: number };
  assert.equal(q.qty, 42);
});

test("the generated Hadayat Ullah & Sons file reads cleanly", async () => {
  const fs = await import("node:fs");
  const file = "imports/hadayatullahsons-products.csv";
  if (!fs.existsSync(file)) return; // local-only data
  const { rows, problems } = readImportRows(parseCsv(fs.readFileSync(file, "utf8")));
  assert.equal(rows.length, 321);
  assert.deepEqual(problems, []);
  const plan = await planImport(rows);
  const r = await runImport(plan, { openingStock: false });
  assert.equal(r.failed.length, 0, JSON.stringify(r.failed.slice(0, 3)));
  assert.equal(r.created + plan.skip.length, 321);
});
