/** The v29 catalog ownership migration on legacy data (catalog rows without
 * a tenant, as every existing database has before it runs). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { applyCatalogOwnership, cloneId, planCatalogOwnership, rollbackCatalogOwnership, type OwnDb } from "@/lib/catalogOwnership";
import { useAuthStore } from "@/store/authStore";
import { productsRepo, listProductsForGrid } from "@/lib/repo/products";

const T1 = "t1-pharmacy";
const T2 = "t2-pharmacy";
const T3 = "t3-restaurant";

function legacy(): DatabaseSync {
  const sql = fullSchemaDb();
  const ins = (table: string, r: Record<string, unknown>) => {
    const v = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...r };
    const k = Object.keys(v);
    sql.prepare(`INSERT INTO ${table} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => v[x as keyof typeof v]) as never[]));
  };
  for (const t of [T1, T2, T3]) ins("tenants", { id: t, name: t, business_type: t === T3 ? "restaurant" : "retail_pharmacy" });
  // Legacy shared catalog: no tenant_id anywhere.
  ins("uoms", { id: "U1", name: "PCS" });
  ins("uoms", { id: "U2", name: "Unused unit" });
  ins("categories", { id: "C1", name: "Tablets" });
  ins("categories", { id: "C2", name: "Syrups" });
  ins("categories", { id: "C3", name: "Never used" });
  ins("sub_categories", { id: "S1", category_id: "C1", name: "Painkillers" });
  ins("products", { id: "P1", name: "Calpol Syrup", category_id: "C2", base_unit_id: "U1", description: "Paracetamol" });
  ins("products", { id: "P2", name: "Panadol", category_id: "C1", sub_category_id: "S1", base_unit_id: "U1", description: "Paracetamol" });
  ins("products", { id: "P3", name: "Nobody uses this" });
  ins("products", { id: "P4", name: "Stock without tenant" });
  ins("generic_names", { id: "gn-PARA", name: "Paracetamol" });
  ins("generic_names", { id: "gn-UNUSED", name: "Unused generic" });
  // Evidence: T1 stocked P1 and P2 first; T2 sold P2 later; P4 has an untenanted batch.
  ins("product_batches", { id: "B1", tenant_id: T1, product_id: "P1", qty: 10, created_at: "2026-02-01T00:00:00.000Z" });
  ins("product_batches", { id: "B2", tenant_id: T1, product_id: "P2", qty: 20, created_at: "2026-02-01T00:00:00.000Z" });
  ins("product_batches", { id: "B3", tenant_id: null, product_id: "P4", qty: 1 });
  ins("invoices", { id: "I2", tenant_id: T2, invoice_no: 1, date: "2026-03-01" });
  ins("invoice_items", { id: "L2", tenant_id: T2, invoice_id: "I2", product_id: "P2", uom_id: "U1", qty: 3, created_at: "2026-03-01T00:00:00.000Z" });
  ins("price_list", { id: "PL2", tenant_id: T2, product_id: "P2", sale_price: 50, created_at: "2026-03-01T00:00:00.000Z" });
  return sql;
}

function port(sql: DatabaseSync): OwnDb {
  return {
    async select(q, p = []) {
      return sql.prepare(q).all(...(p as never[])) as never[];
    },
    async execute(q, p = []) {
      return { changes: Number(sql.prepare(q).run(...(p as never[])).changes) };
    },
  };
}
const one = <T>(sql: DatabaseSync, q: string, ...p: unknown[]) => sql.prepare(q).get(...(p as never[])) as T;
const as = (tenantId: string) =>
  useAuthStore.setState({
    currentUser: { id: "u", username: "u", displayName: "U", role: "owner", tenantId, permissions: null },
    currentTenant: { id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 1, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy" },
  });

async function migrate(sql: DatabaseSync) {
  const db = port(sql);
  const plan = await planCatalogOwnership(db);
  const runId = "run-1";
  const counts = await applyCatalogOwnership(db, plan, { runId, now: "2026-10-23T12:00:00.000Z", newId: randomUUID });
  return { plan, counts, runId, db };
}

test("before the migration, legacy catalog rows are invisible to every tenant (fail closed)", async () => {
  const sql = legacy();
  setTestDb(sql);
  for (const t of [T1, T2, T3]) {
    as(t);
    assert.deepEqual(await productsRepo.list(), []);
  }
});

test("single-tenant rows are assigned, shared rows copied, unused rows quarantined", async () => {
  const sql = legacy();
  const { plan, counts } = await migrate(sql);
  const tenantOf = (t: string, id: string) => one<{ tenant_id: string | null } | undefined>(sql, `SELECT tenant_id FROM ${t} WHERE id = ?`, id)?.tenant_id;
  assert.equal(tenantOf("products", "P1"), T1);
  assert.equal(tenantOf("products", "P2"), T1, "first user keeps the original id");
  assert.equal(tenantOf("products", cloneId("P2", T2)), T2);
  assert.equal(tenantOf("products", "P3"), null, "no evidence -> quarantined");
  assert.equal(tenantOf("products", "P4"), null, "untenanted evidence -> quarantined");
  assert.equal(tenantOf("categories", "C1"), T1);
  assert.equal(tenantOf("categories", cloneId("C1", T2)), T2);
  assert.equal(tenantOf("categories", "C2"), T1);
  assert.equal(tenantOf("categories", "C3"), null);
  assert.equal(tenantOf("sub_categories", cloneId("S1", T2)), T2);
  assert.equal(tenantOf("uoms", "U1"), T1);
  assert.equal(tenantOf("uoms", cloneId("U1", T2)), T2);
  assert.equal(tenantOf("uoms", "U2"), null);
  assert.equal(tenantOf("generic_names", "gn-PARA"), T1);
  assert.equal(tenantOf("generic_names", cloneId("gn-PARA", T2)), T2);
  assert.equal(tenantOf("generic_names", "gn-UNUSED"), null);
  // The copy points at T2's own category / sub category / unit.
  const copy = one<{ category_id: string; sub_category_id: string; base_unit_id: string; name: string }>(sql, `SELECT * FROM products WHERE id = ?`, cloneId("P2", T2));
  assert.deepEqual([copy.category_id, copy.sub_category_id, copy.base_unit_id, copy.name], [cloneId("C1", T2), cloneId("S1", T2), cloneId("U1", T2), "Panadol"]);
  assert.equal(one<{ category_id: string }>(sql, `SELECT category_id FROM sub_categories WHERE id = ?`, cloneId("S1", T2)).category_id, cloneId("C1", T2));
  // T2's own lines now use T2's copy; T1's lines are untouched; nothing deleted.
  assert.deepEqual({ ...one<object>(sql, `SELECT product_id, uom_id, qty FROM invoice_items WHERE id = 'L2'`) }, { product_id: cloneId("P2", T2), uom_id: cloneId("U1", T2), qty: 3 });
  assert.equal(one<{ product_id: string }>(sql, `SELECT product_id FROM price_list WHERE id = 'PL2'`).product_id, cloneId("P2", T2));
  assert.equal(one<{ product_id: string }>(sql, `SELECT product_id FROM product_batches WHERE id = 'B2'`).product_id, "P2");
  assert.equal(one<{ n: number }>(sql, `SELECT COUNT(*) n FROM products WHERE id IN ('P1','P2','P3','P4')`).n, 4);
  assert.equal(counts.quarantined, plan.decisions.filter((d) => !d.owner).length);
  assert.ok(one<{ n: number }>(sql, `SELECT COUNT(*) n FROM catalog_ownership_log WHERE run_id = 'run-1'`).n > 10);
});

test("after the migration each tenant sees exactly its own catalog; the restaurant sees none of it", async () => {
  const sql = legacy();
  await migrate(sql);
  setTestDb(sql);
  as(T1);
  assert.deepEqual((await productsRepo.list({ orderBy: "id" })).map((p) => p.id), ["P1", "P2"]);
  as(T2);
  const grid = await listProductsForGrid();
  assert.deepEqual(grid.map((g) => [g.id, g.category_name, g.base_unit_name, g.sale_price]), [[cloneId("P2", T2), "Tablets", "PCS", 50]]);
  as(T3);
  assert.deepEqual(await productsRepo.list(), []);
});

test("the migration is idempotent", async () => {
  const sql = legacy();
  const { db } = await migrate(sql);
  const again = await planCatalogOwnership(db);
  assert.ok(again.decisions.every((d) => !d.owner), "only quarantined rows are reconsidered");
  assert.deepEqual([again.repoints.length, again.catalogRepoints.length], [0, 0]);
  const counts = await applyCatalogOwnership(db, again, { runId: "run-2", now: "2026-10-24T00:00:00.000Z", newId: randomUUID });
  assert.deepEqual([counts.assigned, counts.copied, counts.repointed], [0, 0, 0]);
});

test("a run can be rolled back exactly", async () => {
  const sql = legacy();
  const snapshot = (q: string) => JSON.stringify(sql.prepare(q).all());
  const before = ["products", "categories", "sub_categories", "uoms", "generic_names", "invoice_items", "price_list", "product_batches"].map((t) =>
    snapshot(`SELECT * FROM ${t} ORDER BY id`).replace(/"updated_at":"[^"]*"/g, "")
  );
  const { db, runId } = await migrate(sql);
  await rollbackCatalogOwnership(db, runId, "2026-10-25T00:00:00.000Z");
  const after = ["products", "categories", "sub_categories", "uoms", "generic_names", "invoice_items", "price_list", "product_batches"].map((t) =>
    snapshot(`SELECT * FROM ${t} ORDER BY id`).replace(/"updated_at":"[^"]*"/g, "")
  );
  assert.deepEqual(after, before);
});
