/** Public website SEO text stays within what search results show, every page
 * and product has it, and "Popular searches" lists only relevant keywords. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PAGE_SEO, PRODUCT_SEO, SITE_NAME } from "@/config/siteSeo";
import { SITE_PAGES } from "@/config/site";
import { SITE_PRODUCTS } from "@/config/siteProducts";
import { popularSearches, resetPopularSearches } from "@/server/seo/popular";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";

const shown = (t: string) => (t.includes(SITE_NAME) ? t : `${t} | ${SITE_NAME}`);

test("every public page and product has a search title under 60 and a description of 70 to 160 characters", () => {
  for (const p of SITE_PAGES) assert.ok(PAGE_SEO[p], `missing SEO for ${p}`);
  for (const p of SITE_PRODUCTS) assert.ok(PRODUCT_SEO[p.slug], `missing SEO for product ${p.slug}`);
  const all = [...Object.entries(PAGE_SEO), ...Object.entries(PRODUCT_SEO)];
  for (const [k, v] of all) {
    assert.ok(shown(v.title).length <= 60, `${k}: title ${shown(v.title).length} chars`);
    assert.ok(v.description.length >= 70 && v.description.length <= 160, `${k}: description ${v.description.length} chars`);
  }
  const titles = all.map(([, v]) => v.title);
  assert.equal(new Set(titles).size, titles.length, "titles are unique");
});

test("popular searches: strongest relevant keywords, no brand or ignored ones, at most 24, linked to their page", async () => {
  const db = fullSchemaDb();
  const sql = sqliteSql(db);
  const T = new Date().toISOString();
  const add = (k: string, priority: number, intent: string, product: string | null, notes = '{"sources":["seed"]}') =>
    db.prepare(`INSERT INTO seo_keywords (id, keyword, product, intent, priority, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), k, product, intent, priority, notes, T, T);
  add("pharmacy pos pakistan", 95, "commercial", "/products/retail-pharmacy-pos");
  add("mavin pos login", 99, "navigational", null);
  add("pharmacy jobs", 90, "informational", null, '{"sources":["seed"],"ignored":true}');
  add("billing software pakistan", 80, "commercial", null);
  add("free pharmacy software download", 98, "transactional", "/products/retail-pharmacy-pos");
  for (let i = 0; i < 40; i++) add(`software keyword ${i}`, 50, "commercial", "/products");
  resetPopularSearches();
  const items = await popularSearches(sql);
  assert.equal(items.length, 24);
  assert.deepEqual(items[0], { keyword: "pharmacy pos pakistan", href: "/products/retail-pharmacy-pos" });
  assert.deepEqual(items[1], { keyword: "billing software pakistan", href: "/products" });
  assert.ok(!items.some((i) => /mavin|jobs|free|download/.test(i.keyword)), "no brand, ignored or misleading phrases");
});
