/** Super Admin > Duplicate Products (schema v112): names that match by more
 * than half, in a shared catalogue or a business's own product against a
 * shared one (never two businesses' own); a merge moves every record of the
 * merged product to the kept one, in one transaction; "not duplicates" hides
 * a pair. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { duplicatesAction, nameSimilarity, normalizeName, numbersDiffer, type DupPair, type MergeResult } from "@/server/productDuplicates";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import { unitsSet, missingUnitLabel } from "@/lib/uom";

let db: DatabaseSync;
const sa: Caller = { userId: "sa", role: "super_admin", tenantId: null, permissions: null };
const run = (body: Record<string, unknown>, c: Caller = sa) => duplicatesAction(sqliteSql(db), c, body);
const T = "2026-11-27T10:00:00.000Z";

function product(id: string, name: string, o: { tenant?: string | null; group?: string | null; barcode?: string; units?: boolean } = {}) {
  db.prepare(`INSERT INTO products (id, tenant_id, name, catalog_group, barcode, base_unit_id, secondary_unit_id, packing, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, o.tenant ?? null, name, o.tenant ? null : (o.group ?? "pharma"), o.barcode ?? null, o.units ? "u-strip" : null, o.units ? "u-tab" : null, o.units ? 10 : 1, T, T);
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  for (const [id, type] of [["pharm-a", "retail_pharmacy"], ["pharm-b", "retail_pharmacy"], ["shop", "general_store"]]) {
    db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, id === "shop" ? "Corner Shop" : `Pharmacy ${id.slice(-1).toUpperCase()}`, type, T, T);
  }
  db.prepare(`INSERT INTO uoms (id, tenant_id, name, created_at, updated_at) VALUES ('u-strip', NULL, 'Strip', ?, ?), ('u-tab', NULL, 'Tablet', ?, ?)`).run(T, T, T, T);
  product("p1", "PANADOL 500MG TAB", { units: true });
  product("p2", "Panadol 500 mg Tablets", { barcode: "5000168002658" });
  product("p3", "BRUFEN 400MG TAB", { units: true });
  product("p4", "PANADOL 1000MG TAB", { units: true });
  product("own-a", "Panadol 500mg tab.", { tenant: "pharm-a" });
  product("own-b", "PANADOL 500MG TAB", { tenant: "pharm-b" });
  product("shop-own", "Panadol 500mg tab", { tenant: "shop" });
});

test("name matching: the same medicine written differently is a full match; another strength still matches but is flagged", () => {
  assert.equal(normalizeName("Panadol 500 mg Tablets"), "PANADOL 500MG TAB");
  assert.equal(nameSimilarity("Panadol 500 mg Tablets", "PANADOL 500MG TAB"), 1);
  assert.ok(nameSimilarity("PANADOL 500MG TAB", "PANADOL 1000MG TAB") > 0.5);
  assert.equal(numbersDiffer("PANADOL 500MG TAB", "PANADOL 1000MG TAB"), "500MG / 1000MG");
  assert.equal(numbersDiffer("Panadol 500 mg Tablets", "PANADOL 500MG TAB"), null);
  assert.ok(nameSimilarity("PANADOL 500MG TAB", "BRUFEN 400MG TAB") < 0.5);
});

test("pairs: shared with shared, and a business's own with the shared catalogue it uses; never two businesses' own products", async () => {
  const r = (await run({ action: "pairs", group: "pharma", minScore: 0.5 })) as { pairs: DupPair[]; compared: number };
  const keys = r.pairs.map((p) => [p.a.id, p.b.id].sort().join("+")).sort();
  assert.ok(keys.includes("p1+p2"));
  assert.ok(keys.includes("own-a+p1") && keys.includes("own-b+p1"));
  assert.ok(keys.includes("p1+p4"), "another strength is offered, flagged");
  assert.ok(!keys.some((k) => k.includes("own-a") && k.includes("own-b")), "never two businesses' own products");
  assert.ok(!keys.some((k) => k.includes("shop-own")), "a general store does not use the pharmacy catalogue");
  assert.ok(!keys.some((k) => k.includes("p3")));
  const p12 = r.pairs.find((p) => [p.a.id, p.b.id].sort().join("+") === "p1+p2")!;
  assert.deepEqual([p12.score, p12.numbersDiffer, p12.keep.length], [1, null, 2]);
  const own = r.pairs.find((p) => p.a.id === "own-a" || p.b.id === "own-a")!;
  assert.deepEqual(own.keep, [own.a.owner === "shared" ? "a" : "b"], "the shared product is the one kept");
  // At 90% the other strength drops out; a search narrows.
  const strict = (await run({ action: "pairs", group: "pharma", minScore: 0.9 })) as { pairs: DupPair[] };
  assert.ok(!strict.pairs.some((p) => [p.a.id, p.b.id].includes("p4")));
  const brufen = (await run({ action: "pairs", group: "pharma", q: "brufen" })) as { pairs: DupPair[] };
  assert.equal(brufen.pairs.length, 0);
  // The general store catalogue compares the shop's own products with it.
  product("g1", "Surf Excel 1kg", { group: "general_store" });
  product("g-own", "SURF EXCEL 1 KG", { tenant: "shop" });
  const g = (await run({ action: "pairs", group: "general_store" })) as { pairs: DupPair[] };
  assert.deepEqual(g.pairs.map((p) => [p.a.id, p.b.id].sort().join("+")), ["g-own+g1"]);
});

test("merge: every record of every business moves to the kept product, blanks are filled, the merged one is removed and logged", async () => {
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, paid, created_at, updated_at) VALUES ('inv1', 'pharm-a', 'INV-1', '2026-11-27', 50, 50, ?, ?)`).run(T, T);
  db.prepare(`INSERT INTO invoice_items (id, invoice_id, product_id, qty, sale_price, total, created_at, updated_at) VALUES ('ii1', 'inv1', 'p2', 10, 5, 50, ?, ?)`).run(T, T);
  db.prepare(`INSERT INTO product_batches (id, tenant_id, product_id, batch_no, qty, purchase_price, created_at, updated_at) VALUES ('b-a', 'pharm-a', 'p2', 'A1', 40, 3, ?, ?), ('b-b', 'pharm-b', 'p2', 'B1', 7, 3, ?, ?)`).run(T, T, T, T);
  // Pharmacy A has a flat discount and a website entry for both: its kept product's ones stay.
  db.prepare(`INSERT INTO product_flat_discounts (id, tenant_id, product_id, discount_pct, created_at, updated_at) VALUES ('fd1', 'pharm-a', 'p1', 5, ?, ?), ('fd2', 'pharm-a', 'p2', 8, ?, ?), ('fd3', 'pharm-b', 'p2', 3, ?, ?)`).run(T, T, T, T, T, T);
  db.prepare(`INSERT INTO web_products (tenant_id, product_id, slug, created_at, updated_at) VALUES ('pharm-a', 'p1', 'panadol', ?, ?), ('pharm-a', 'p2', 'panadol-2', ?, ?)`).run(T, T, T, T);

  const r = (await run({ action: "merge", survivorId: "p1", mergeIds: ["p2"] })) as MergeResult;
  assert.equal(r.merged, 1);
  assert.equal(r.moved.product_batches, 2);
  assert.equal(r.moved.invoice_items, 1);
  assert.deepEqual(db.prepare(`SELECT tenant_id, qty FROM product_batches WHERE product_id = 'p1' ORDER BY tenant_id`).all().map((x) => ({ ...(x as Record<string, unknown>) })), [{ tenant_id: "pharm-a", qty: 40 }, { tenant_id: "pharm-b", qty: 7 }]);
  assert.equal((db.prepare(`SELECT product_id FROM invoice_items WHERE id = 'ii1'`).get() as { product_id: string }).product_id, "p1");
  const fd = db.prepare(`SELECT id, product_id, deleted_at FROM product_flat_discounts ORDER BY id`).all() as { id: string; product_id: string; deleted_at: string | null }[];
  assert.deepEqual(fd.map((x) => [x.id, x.product_id, Boolean(x.deleted_at)]), [["fd1", "p1", false], ["fd2", "p1", true], ["fd3", "p1", false]]);
  assert.deepEqual(db.prepare(`SELECT slug FROM web_products WHERE tenant_id = 'pharm-a'`).all().map((x) => (x as { slug: string }).slug), ["panadol"]);
  const p1 = db.prepare(`SELECT barcode, deleted_at FROM products WHERE id = 'p1'`).get() as { barcode: string; deleted_at: string | null };
  assert.deepEqual([p1.barcode, p1.deleted_at], ["5000168002658", null], "blank barcode filled from the merged product");
  assert.ok((db.prepare(`SELECT deleted_at FROM products WHERE id = 'p2'`).get() as { deleted_at: string | null }).deleted_at);
  const log = (await run({ action: "log" })) as { survivorName: string; mergedName: string }[];
  assert.deepEqual(log.map((l) => [l.mergedName, l.survivorName]), [["Panadol 500 mg Tablets", "PANADOL 500MG TAB"]]);
  // The merged product is no longer offered.
  const pairs = (await run({ action: "pairs", group: "pharma" })) as { pairs: DupPair[] };
  assert.ok(!pairs.pairs.some((p) => p.a.id === "p2" || p.b.id === "p2"));
  await assert.rejects(run({ action: "merge", survivorId: "p1", mergeIds: ["p2"] }), /not found/);
});

test("a business's own product merges into the shared one (never the other way); not duplicates hides a pair; Super Admin only", async () => {
  db.prepare(`INSERT INTO product_batches (id, tenant_id, product_id, qty, purchase_price, created_at, updated_at) VALUES ('b-own', 'pharm-a', 'own-a', 12, 3, ?, ?)`).run(T, T);
  await assert.rejects(run({ action: "merge", survivorId: "own-a", mergeIds: ["p1"] }), /Keep the shared catalogue product/);
  await assert.rejects(run({ action: "merge", survivorId: "p1", mergeIds: ["shop-own"] }), /does not use this catalogue/);
  await run({ action: "merge", survivorId: "p1", mergeIds: ["own-a"] });
  assert.equal((db.prepare(`SELECT product_id FROM product_batches WHERE id = 'b-own'`).get() as { product_id: string }).product_id, "p1");
  await run({ action: "dismiss", aId: "p4", bId: "p1" });
  await run({ action: "dismiss", aId: "p1", bId: "p4" });
  const pairs = (await run({ action: "pairs", group: "pharma" })) as { pairs: DupPair[] };
  assert.ok(!pairs.pairs.some((p) => [p.a.id, p.b.id].sort().join("+") === "p1+p4"));
  const owner: Caller = { userId: "o", role: "owner", tenantId: "pharm-a", permissions: null };
  await assert.rejects(run({ action: "pairs", group: "pharma" }, owner), /platform owner/);
  const known = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((x) => x.name));
  for (const s of ["SELECT * FROM product_merges", "DELETE FROM product_duplicate_dismissals"]) assert.equal(authorize(analyzeSql(s), sa, known).ok, false, s);
});

test("units: a product needs its base unit, secondary unit and packing before it can be purchased", () => {
  assert.equal(unitsSet({ base_unit_id: "u1", secondary_unit_id: "u2", packing: 10 }), true);
  assert.equal(missingUnitLabel({ base_unit_id: null, secondary_unit_id: "u2", packing: 10 }), "no base unit");
  assert.equal(missingUnitLabel({ base_unit_id: "u1", secondary_unit_id: null, packing: 10 }), "no secondary unit");
  assert.equal(missingUnitLabel({ base_unit_id: "u1", secondary_unit_id: "u2", packing: 0 }), "no packing");
});
