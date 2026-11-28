/** Shared catalogue changes the Super Admin decides (schema v114): a lower
 * retail price and a new pack size, the guard that keeps a shared product's
 * pack size, and the conversion that keeps every business's tablet counts and
 * money totals. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { allNotices, catalogDefaults, catalogPricesAction, priceQuestions, proposePrices } from "@/server/catalogPrices";
import { decideReview, listReviews, requestPacking, type ChangeNotice } from "@/server/catalogChanges";
import { NOT_PER_PACK, PER_PACK, toCurrentPacking } from "@/server/catalogPacking";
import { scopeStatement, type Scope } from "@/server/tenantScope";
import type { Caller } from "@/server/sqlPolicy";

let db: DatabaseSync;
const T = "2026-11-20T10:00:00.000Z";
const NOW = new Date("2026-11-28T10:00:00.000Z");
const sql = () => sqliteSql(db);
const sa: Caller = { userId: "sa", role: "super_admin", tenantId: null, permissions: null };
const owner = (t: string): Caller => ({ userId: `u-${t}`, role: "owner", tenantId: t, permissions: null, businessType: "retail_pharmacy" });
const [A, B] = [owner("a"), owner("b")];
const one = (q: string, ...args: (string | number)[]) => db.prepare(q).get(...args) as Record<string, number | string | null>;
const near = (a: unknown, b: number) => assert.ok(Math.abs(Number(a) - b) < 1e-6, `${a} is not ${b}`);

let n = 0;
function price(tenant: string, sale: number, at = T) {
  db.prepare(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, wholesale_price, mrp, created_at, updated_at) VALUES (?, 'p1', ?, ?, 0, 0, ?, ?)`).run(`pl${++n}`, tenant, sale, at, at);
}
const myPrice = (tenant: string) => Number(one(`SELECT sale_price FROM price_list WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`, tenant).sale_price);

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  for (const id of ["a", "b"]) db.prepare(`INSERT INTO tenants (id, name, phone, business_type, created_at, updated_at) VALUES (?, ?, ?, 'retail_pharmacy', ?, ?)`).run(id, `Pharmacy ${id.toUpperCase()}`, id === "a" ? "0300-1111111" : "0300-2222222", T, T);
  db.prepare(`INSERT INTO uoms (id, tenant_id, name, created_at, updated_at) VALUES ('u-pack', NULL, 'Pack', ?, ?), ('u-tab', NULL, 'Tablet', ?, ?)`).run(T, T, T, T);
  db.prepare(`INSERT INTO products (id, tenant_id, name, catalog_group, base_unit_id, secondary_unit_id, packing, max_stock_qty, created_at, updated_at) VALUES ('p1', NULL, 'PANADOL 500MG TAB', 'pharma', 'u-pack', 'u-tab', 10, 70, ?, ?)`).run(T, T);
  price("a", 100);
  price("b", 100);
  db.prepare(`INSERT INTO catalog_prices (product_id, sale_price, mrp, updated_at) VALUES ('p1', 100, 110, ?)`).run(T);
  db.prepare(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, qty, purchase_price, created_at, updated_at) VALUES ('ba', 'p1', 'a', 'B1', 7, 80, ?, ?), ('bb', 'p1', 'b', 'B2', 3, 82, ?, ?)`).run(T, T, T, T);
  db.prepare(`INSERT INTO invoices (id, invoice_no, date, invoice_type, tenant_id, total, payable, created_at, updated_at) VALUES ('i1', 1, '2026-11-20', 'retail', 'b', 30, 30, ?, ?)`).run(T, T);
  // 3 loose tablets of a pack of 10.
  db.prepare(`INSERT INTO invoice_items (id, invoice_id, product_id, tenant_id, packing, qty, bonus_qty, purchase_price, sale_price, total, created_at, updated_at) VALUES ('l1', 'i1', 'p1', 'b', 10, 0.3, 0, 82, 100, 30, ?, ?)`).run(T, T);
});

test("every table holding a product's quantities or prices is converted or deliberately left", () => {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name);
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("product_id")) continue;
    assert.ok(PER_PACK[t] || NOT_PER_PACK.has(t), `${t}: add it to PER_PACK or NOT_PER_PACK (src/server/catalogPacking.ts)`);
    for (const c of [...(PER_PACK[t]?.qty ?? []), ...(PER_PACK[t]?.price ?? [])]) assert.ok(cols.includes(c), `${t}.${c} exists`);
  }
});

test("a lower retail price is asked about, goes to the Super Admin with name and mobile, and each business applies it itself", async () => {
  price("a", 90, NOW.toISOString());
  const [q] = await priceQuestions(sql(), A, [{ productId: "p1", price: 90, previousPrice: 100 }], NOW);
  assert.equal(q.direction, "down");
  assert.deepEqual(await proposePrices(sql(), A, [{ productId: "p1", price: 90, previousPrice: 100 }], NOW), { proposed: 0, sentForReview: 1 });
  assert.equal((await allNotices(sql(), B, NOW)).length, 0, "nothing reaches others before approval");
  await assert.rejects(listReviews(sql(), B, "pending"), /platform owner/);
  const [r] = await listReviews(sql(), sa, "pending");
  assert.deepEqual([r.businessName, r.mobile, r.oldPrice, r.newPrice, r.stockHolders], ["Pharmacy A", "0300-1111111", 100, 90, 2]);
  await decideReview(sql(), sa, { id: r.id, approve: true }, NOW);
  assert.equal((await catalogDefaults(sql(), B, ["p1"])).p1.salePrice, 90);
  assert.equal(myPrice("b"), 100, "approval alone changes no business's price");
  const [forB] = await allNotices(sql(), B, NOW);
  assert.deepEqual([forB.kind, forB.myPrice, forB.newPrice], ["decrease", 100, 90]);
  assert.equal((await allNotices(sql(), A, NOW)).length, 0, "the reporter is not asked");
  await catalogPricesAction(sql(), B, { action: "answer", id: forB.id, answer: "yes" });
  assert.equal(myPrice("b"), 90);
  assert.equal((await allNotices(sql(), B, NOW)).length, 0);
  await assert.rejects(decideReview(sql(), sa, { id: r.id, approve: true }, NOW), /already decided/);
});

test("rejecting changes nothing", async () => {
  await requestPacking(sql(), A, { productId: "p1", newPacking: 14 }, NOW);
  const [r] = await listReviews(sql(), sa, "pending");
  await decideReview(sql(), sa, { id: r.id, approve: false, note: "wrong" }, NOW);
  assert.equal(Number(one(`SELECT packing FROM products WHERE id = 'p1'`).packing), 10);
  assert.equal((await allNotices(sql(), B, NOW)).length, 0);
});

test("an approved pack size converts every business's stock and records: same tablets, same money", async () => {
  await requestPacking(sql(), A, { productId: "p1", newPacking: 14 }, NOW);
  assert.equal(Number(one(`SELECT packing FROM products WHERE id = 'p1'`).packing), 10, "a report changes nothing");
  const [r] = await listReviews(sql(), sa, "pending");
  await decideReview(sql(), sa, { id: r.id, approve: true, salePrice: "150" }, NOW);
  const p = one(`SELECT packing, max_stock_qty FROM products WHERE id = 'p1'`);
  assert.equal(Number(p.packing), 14);
  near(p.max_stock_qty, 50);
  for (const [id, packs, cost] of [["ba", 7, 80], ["bb", 3, 82]] as const) {
    const s = one(`SELECT qty, purchase_price FROM product_batches WHERE id = ?`, id);
    near(Number(s.qty) * 14, packs * 10);
    near(Number(s.qty) * Number(s.purchase_price), packs * cost);
  }
  const l = one(`SELECT qty, sale_price, packing, total FROM invoice_items WHERE id = 'l1'`);
  near(Number(l.qty) * 14, 3);
  near(Number(l.qty) * Number(l.sale_price), 30);
  assert.deepEqual([Number(l.packing), Number(l.total)], [14, 30]);
  // Each business's own price grows with the pack; the published price is offered, not forced.
  near(myPrice("b"), 140);
  assert.equal((await catalogDefaults(sql(), B, ["p1"])).p1.salePrice, 150);
  const [forA] = (await allNotices(sql(), A, NOW)) as ChangeNotice[];
  assert.deepEqual([forA.kind, forA.oldPacking, forA.newPacking, forA.newPrice], ["packing", 10, 14, 150]);
});

test("a shared product's pack size cannot be changed by a business; its own products and the first-time setup still can", () => {
  const scope: Scope = { tenantId: "a", sharedGroups: ["pharma", "general_store"], linkedPharmacies: [] };
  const schema = new Map((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[])
    .map((t) => [t.name, new Set((db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]).map((c) => c.name))]));
  const update = (id: string, packing: number) => {
    const q = `UPDATE products SET name = ?, packing = ?, updated_at = ? WHERE id = ?`;
    const args = [`name ${packing}`, packing, T, id];
    db.prepare(scopeStatement(q, args, scope, schema)).run(...args);
    return one(`SELECT name, packing FROM products WHERE id = ?`, id);
  };
  assert.deepEqual({ ...update("p1", 14) }, { name: "name 14", packing: 10 }, "the rest of the edit is saved, the pack size kept");
  db.prepare(`INSERT INTO products (id, tenant_id, name, base_unit_id, secondary_unit_id, packing, created_at, updated_at) VALUES ('own', 'a', 'OWN', 'u-pack', 'u-tab', 10, ?, ?)`).run(T, T);
  assert.equal(Number(update("own", 14).packing), 14);
  db.prepare(`INSERT INTO products (id, tenant_id, name, catalog_group, packing, created_at, updated_at) VALUES ('new', NULL, 'NO UNITS YET', 'pharma', 1, ?, ?)`).run(T, T);
  assert.equal(Number(update("new", 20).packing), 20);
});

test("a sale an offline computer made with the old pack size is booked in the new one", async () => {
  const line = { productId: "p1", packing: 10, qtyPacks: 1, bonusPacks: 0, pricePerPack: 100, purchasePrice: 80 };
  assert.deepEqual(await toCurrentPacking(sql(), [line]), [line], "nothing changed yet");
  await requestPacking(sql(), A, { productId: "p1", newPacking: 14 }, NOW);
  await decideReview(sql(), sa, { id: (await listReviews(sql(), sa, "pending"))[0].id, approve: true }, NOW);
  const [c] = await toCurrentPacking(sql(), [line]);
  assert.equal(c.packing, 14);
  near(c.qtyPacks * 14, 10);
  near(c.qtyPacks * c.pricePerPack, 100);
  assert.deepEqual(await toCurrentPacking(sql(), [c]), [c], "never converted twice");
});
