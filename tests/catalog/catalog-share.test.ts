/** Super Admin > Catalog Review > Pharmacies (own): a pharmacy's own products
 * shared to the shared Pharmacy catalogue in place (its stock stays on the
 * same product, nothing shows twice); one the catalogue already has is merged
 * into it; units and categories become shared ones of the same name. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { shareToCatalog, type ShareResult } from "@/server/catalogShare";
import { sharedCatalogGroupsFor, sharedCatalogWhereClause } from "@/lib/catalogAccess";
import type { Caller } from "@/server/sqlPolicy";

let db: DatabaseSync;
const sa: Caller = { userId: "sa", role: "super_admin", tenantId: null, permissions: null };
const T = "2026-11-27T10:00:00.000Z";
const share = (body: Record<string, unknown>, c: Caller = sa) => shareToCatalog(sqliteSql(db), c, body) as Promise<ShareResult>;

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES ('ph', 'City Pharmacy', 'retail_pharmacy', ?, ?), ('ph2', 'Other Pharmacy', 'medical_store', ?, ?), ('shop', 'Corner Shop', 'general_store', ?, ?)`).run(T, T, T, T, T, T);
  // Shared already: a unit and a product.
  db.prepare(`INSERT INTO uoms (id, tenant_id, name, created_at, updated_at) VALUES ('u-strip-shared', NULL, 'Strip', ?, ?)`).run(T, T);
  db.prepare(`INSERT INTO products (id, tenant_id, name, catalog_group, packing, created_at, updated_at) VALUES ('s-panadol', NULL, 'PANADOL 500MG TAB', 'pharma', 1, ?, ?)`).run(T, T);
  // The pharmacy's own: its own units and category.
  db.prepare(`INSERT INTO uoms (id, tenant_id, name, created_at, updated_at) VALUES ('u-strip-ph', 'ph', 'strip', ?, ?), ('u-tab-ph', 'ph', 'Tablet', ?, ?)`).run(T, T, T, T);
  db.prepare(`INSERT INTO categories (id, tenant_id, name, created_at, updated_at) VALUES ('c-anti-ph', 'ph', 'Antibiotics', ?, ?)`).run(T, T);
  db.prepare(`INSERT INTO products (id, tenant_id, name, base_unit_id, secondary_unit_id, packing, category_id, created_at, updated_at) VALUES
    ('o-aug', 'ph', 'Augmentin 625mg Tab', 'u-strip-ph', 'u-tab-ph', 6, 'c-anti-ph', ?, ?),
    ('o-pan', 'ph', 'Panadol 500 mg Tablets', NULL, NULL, 1, NULL, ?, ?),
    ('o-brufen', 'ph', 'Brufen 400mg Tab', NULL, NULL, 1, NULL, ?, ?)`).run(T, T, T, T, T, T);
  db.prepare(`INSERT INTO product_batches (id, tenant_id, product_id, batch_no, qty, purchase_price, created_at, updated_at) VALUES ('b1', 'ph', 'o-aug', 'A1', 20, 30, ?, ?), ('b2', 'ph', 'o-pan', 'P1', 50, 2, ?, ?)`).run(T, T, T, T);
});

/** What the pharmacy's product list shows (its own + the catalogues it sees). */
function seenBy(tenantId: string, type: string): string[] {
  const s = sharedCatalogWhereClause(tenantId, sharedCatalogGroupsFor(type));
  return (db.prepare(`SELECT name FROM products WHERE deleted_at IS NULL AND ${s.clause} ORDER BY name`).all(...(s.params as string[])) as { name: string }[]).map((r) => r.name);
}

test("one product: shared in place, its stock stays on it, units and category become shared ones of the same name", async () => {
  const r = await share({ tenantId: "ph", productIds: ["o-aug"] });
  assert.deepEqual([r.shared, r.merged, r.remaining], [1, 0, 0]);
  const p = db.prepare(`SELECT tenant_id, catalog_group, base_unit_id, secondary_unit_id, category_id FROM products WHERE id = 'o-aug'`).get() as Record<string, string | null>;
  assert.deepEqual([p.tenant_id, p.catalog_group, p.base_unit_id], [null, "pharma", "u-strip-shared"], "the shared Strip is used, not a second one");
  const tab = db.prepare(`SELECT tenant_id, name FROM uoms WHERE id = ?`).get(p.secondary_unit_id) as Record<string, string | null>;
  assert.deepEqual([tab.tenant_id, tab.name], [null, "Tablet"]);
  const cat = db.prepare(`SELECT tenant_id, name, catalog_group FROM categories WHERE id = ?`).get(p.category_id) as Record<string, string | null>;
  assert.deepEqual([cat.tenant_id, cat.name, cat.catalog_group], [null, "Antibiotics", "pharma"]);
  assert.equal((db.prepare(`SELECT product_id FROM product_batches WHERE id = 'b1'`).get() as { product_id: string }).product_id, "o-aug");
  // Shown once to the pharmacy, and now to other pharmacies too.
  assert.equal(seenBy("ph", "retail_pharmacy").filter((n) => n.startsWith("Augmentin")).length, 1);
  assert.ok(seenBy("ph2", "medical_store").includes("Augmentin 625mg Tab"));
});

test("all products: one the catalogue already has is merged into it (stock moves), the rest shared; nothing shows twice", async () => {
  const r = await share({ tenantId: "ph", all: true });
  assert.deepEqual([r.shared, r.merged, r.remaining, r.skipped.length], [2, 1, 0, 0]);
  assert.equal((db.prepare(`SELECT product_id FROM product_batches WHERE id = 'b2'`).get() as { product_id: string }).product_id, "s-panadol");
  assert.deepEqual(seenBy("ph", "retail_pharmacy"), ["Augmentin 625mg Tab", "Brufen 400mg Tab", "PANADOL 500MG TAB"]);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM products WHERE tenant_id = 'ph' AND deleted_at IS NULL`).get() as { n: number }).n, 0);
  // Again: nothing left to share.
  assert.deepEqual(await share({ tenantId: "ph", all: true }), { shared: 0, merged: 0, skipped: [], remaining: 0 });
});

test("only the Super Admin, only to a catalogue the business uses", async () => {
  db.prepare(`INSERT INTO products (id, tenant_id, name, packing, created_at, updated_at) VALUES ('shop-1', 'shop', 'Surf Excel', 1, ?, ?)`).run(T, T);
  await assert.rejects(share({ tenantId: "shop", productIds: ["shop-1"], target: "pharma" }), /does not use/);
  const r = await share({ tenantId: "shop", productIds: ["shop-1"], target: "general_store" });
  assert.equal(r.shared, 1);
  await assert.rejects(share({ tenantId: "ph", all: true }, { userId: "o", role: "owner", tenantId: "ph", permissions: null }), /platform owner/);
  await assert.rejects(share({ tenantId: "ph" }), /Choose the products/);
});
