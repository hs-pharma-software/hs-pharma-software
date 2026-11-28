/** Shared catalogue prices (schema v114): the usual price from a shared
 * pharmacy product, "has the retail price gone up?", the week's proposals,
 * and that a business's own price changes only by its own action. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { answerPrice, catalogDefaults, priceNotices, priceQuestions, proposePrices } from "@/server/catalogPrices";
import { shareToCatalog } from "@/server/catalogShare";
import type { Caller } from "@/server/sqlPolicy";

let db: DatabaseSync;
const T = "2026-11-20T10:00:00.000Z";
const NOW = new Date("2026-11-28T10:00:00.000Z");
const later = (days: number) => new Date(NOW.getTime() + days * 864e5);
const sql = () => sqliteSql(db);
const sa: Caller = { userId: "sa", role: "super_admin", tenantId: null, permissions: null };
const owner = (t: string, type = "retail_pharmacy"): Caller => ({ userId: `u-${t}`, role: "owner", tenantId: t, permissions: null, businessType: type });
const [A, B, C, D] = ["a", "b", "c", "d"].map((t) => owner(t));
const shop = owner("shop", "general_store");

let n = 0;
function price(tenant: string, product: string, sale: number, at = T, mrp = 0) {
  db.prepare(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, wholesale_price, mrp, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(`pl${++n}`, product, tenant, sale, mrp, at, at);
}
const myPrice = (tenant: string, product = "p1") =>
  Number((db.prepare(`SELECT sale_price FROM price_list WHERE tenant_id = ? AND product_id = ? ORDER BY created_at DESC LIMIT 1`).get(tenant, product) as { sale_price?: number } | undefined)?.sale_price ?? 0);
const usual = async (c: Caller = B) => (await catalogDefaults(sql(), c, ["p1"])).p1?.salePrice ?? null;

/** Pharmacy A raises p1 from 100 to 110 in a purchase and says the retail price went up. */
async function aRaises() {
  price("a", "p1", 110, NOW.toISOString());
  const q = await priceQuestions(sql(), A, [{ productId: "p1", price: 110, previousPrice: 100 }], NOW);
  assert.equal(q.length, 1);
  assert.deepEqual(await proposePrices(sql(), A, [{ productId: "p1", price: 110, previousPrice: 100 }], NOW), { proposed: 1, sentForReview: 0 });
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  for (const id of ["a", "b", "c", "d", "shop"]) {
    db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, `Business ${id}`, id === "shop" ? "general_store" : "retail_pharmacy", T, T);
  }
  db.prepare(`INSERT INTO products (id, tenant_id, name, catalog_group, packing, created_at, updated_at) VALUES ('p1', NULL, 'PANADOL 500MG TAB', 'pharma', 10, ?, ?)`).run(T, T);
  for (const t of ["a", "b", "c", "d"]) price(t, "p1", 100);
});

test("a shared product takes the source pharmacy's price and MRP as the usual ones", async () => {
  db.prepare(`INSERT INTO products (id, tenant_id, name, packing, created_at, updated_at) VALUES ('own', 'a', 'NEW SYRUP 120ML', 1, ?, ?)`).run(T, T);
  price("a", "own", 250, T, 260);
  await shareToCatalog(sql(), sa, { tenantId: "a", target: "pharma", productIds: ["own"] });
  assert.deepEqual((await catalogDefaults(sql(), B, ["own"])).own, { salePrice: 250, mrp: 260 });
  assert.deepEqual(await catalogDefaults(sql(), shop, ["own"]), {}, "a general store does not see the pharmacy catalogue");
});

test("asked only when a shared product's price goes above the last one", async () => {
  const ask = (c: Caller, p: number, previousPrice: number) => priceQuestions(sql(), c, [{ productId: "p1", price: p, previousPrice }], NOW);
  assert.equal((await ask(A, 90, 100))[0].direction, "down", "lower: asked, for the Super Admin");
  assert.equal((await ask(A, 100, 100)).length, 0, "unchanged");
  assert.equal((await ask(shop, 110, 100)).length, 0, "another catalogue");
  assert.equal((await ask(A, 110, 100))[0].name, "PANADOL 500MG TAB");
  const clerk: Caller = { ...A, role: "staff", permissions: ["invoices"] };
  assert.equal((await ask(clerk, 110, 100)).length, 0, "a login without purchases or products");
});

test("only a price the business itself saved can be proposed", async () => {
  assert.deepEqual(await proposePrices(sql(), A, [{ productId: "p1", price: 500 }], NOW), { proposed: 0, sentForReview: 0 });
});

test("two other pharmacies confirming (one by Yes, one by saving the price) make it the usual price; others keep theirs", async () => {
  await aRaises();
  assert.equal((await priceNotices(sql(), A, NOW)).length, 0, "not asked about its own");
  const [forB] = await priceNotices(sql(), B, NOW);
  assert.deepEqual([forB.myPrice, forB.newPrice, forB.accepted], [100, 110, false]);
  assert.equal(myPrice("c"), 100, "asking changes nothing");
  assert.deepEqual(await answerPrice(sql(), B, forB.id, "yes", NOW), { ok: true, accepted: false });
  assert.equal(myPrice("b"), 110);
  assert.equal(await usual(), null, "one confirmation is not enough");
  // C buys it at the new rate: that counts, and no question is asked.
  price("c", "p1", 110, later(1).toISOString());
  assert.equal((await priceQuestions(sql(), C, [{ productId: "p1", price: 110, previousPrice: 100 }], later(1))).length, 0);
  assert.equal(await usual(), 110);
  assert.equal(myPrice("d"), 100, "a business that did not act keeps its price");
  const [forD] = await priceNotices(sql(), D, later(2));
  assert.deepEqual([forD.accepted, forD.confirmations], [true, 2], "still asked during the week");
});

test("the proposer saving it again, or answering twice, does not count as more businesses", async () => {
  await aRaises();
  price("a", "p1", 110, later(1).toISOString());
  const [forB] = await priceNotices(sql(), B, later(1));
  await answerPrice(sql(), B, forB.id, "yes", later(1));
  price("b", "p1", 110, later(2).toISOString());
  assert.equal((await priceNotices(sql(), C, later(2)))[0].confirmations, 1);
  assert.equal(await usual(), null);
});

test("No keeps the price and is not asked again", async () => {
  await aRaises();
  const [forB] = await priceNotices(sql(), B, NOW);
  await answerPrice(sql(), B, forB.id, "no", NOW);
  assert.equal(myPrice("b"), 100);
  assert.equal((await priceNotices(sql(), B, NOW)).length, 0);
});

test("nobody confirms within 7 days: the price stays only with the business that raised it", async () => {
  await aRaises();
  const [forB] = await priceNotices(sql(), B, NOW);
  assert.equal((await priceNotices(sql(), C, later(8))).length, 0);
  await assert.rejects(answerPrice(sql(), B, forB.id, "yes", later(8)), /no longer open/);
  assert.equal(await usual(), null);
  assert.deepEqual([myPrice("a"), myPrice("b")], [110, 100]);
});

test("businesses of another catalogue and products a business does not use are not asked", async () => {
  await aRaises();
  assert.equal((await priceNotices(sql(), shop, NOW)).length, 0);
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES ('e', 'Business e', 'retail_pharmacy', ?, ?)`).run(T, T);
  assert.equal((await priceNotices(sql(), owner("e"), NOW)).length, 0);
});
