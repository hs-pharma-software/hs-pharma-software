/** Category from the description: the business's own products with the same
 * description first; else Gemini picks from the list; else Gemini searches
 * online and the category it names is created (an existing one with the same
 * name is reused). Gemini is replaced by canned answers here. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo } from "@/lib/repo/products";
import { categoriesRepo, subCategoriesRepo } from "@/lib/repo/categories";
import { suggestCategory } from "@/lib/categoryAutofill";

const T = "pharm-a";
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
let db: DatabaseSync;
const realFetch = globalThis.fetch;

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});
afterEach(() => { globalThis.fetch = realFetch; });

/** Gemini replaced by a queue of answers; records each request body. */
function fakeGemini(answers: string[]) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('billori_api_key', 'test-key', '2026-10-26')`).run();
  const requests: { tools?: unknown[] }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")));
    const text = answers.shift() ?? "";
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] }), { status: 200 });
  }) as typeof fetch;
  return requests;
}

const named = (rows: { id: string; name: string }[]) => rows.map((c) => ({ id: c.id, name: c.name }));
const callbacks = {
  loadSubCategories: async (id: string) => named(await subCategoriesRepo.list({ where: "category_id = ?", params: [id] })),
  createCategory: async (n: string) => (await categoriesRepo.create({ name: n, description: null, flat_discount_pct: 0, image_url: null })).id,
  createSubCategory: async (c: string, n: string) => (await subCategoriesRepo.create({ category_id: c, name: n, description: null, image_url: null })).id,
};

test("same description as another product: its category, without asking Gemini; no key means no guess", async () => {
  const cat = await categoriesRepo.create({ name: "Depressant / Psychotropic Agents", description: null, flat_discount_pct: 0, image_url: null });
  const sub = await subCategoriesRepo.create({ category_id: cat.id, name: "Benzodiazepines", description: null, image_url: null });
  await productsRepo.create({ name: "Xanax 0.5mg", description: "Alprazolam", category_id: cat.id, sub_category_id: sub.id, packing: 1 });
  const input = { name: "Alp", categories: named([cat]), ...callbacks };
  const s = await suggestCategory({ ...input, description: "  alprazolam " });
  assert.deepEqual(s && [s.source, s.categoryId, s.subCategoryId], ["catalog", cat.id, sub.id]);
  assert.equal(await suggestCategory({ ...input, description: "Paracetamol" }), null, "no match and no AI key: nothing is guessed");
});

test("from the list: Gemini picks an existing category and sub category", async () => {
  const pain = await categoriesRepo.create({ name: "PAIN KILLER", description: null, flat_discount_pct: 0, image_url: null });
  const nsaid = await subCategoriesRepo.create({ category_id: pain.id, name: "NSAID", description: null, image_url: null });
  const req = fakeGemini([`{"index":0,"reason":"Ibuprofen is an NSAID."}`, `{"index":0,"reason":"NSAID."}`]);
  const s = await suggestCategory({ name: "Brufen", description: "Ibuprofen", categories: named([pain]), ...callbacks });
  assert.deepEqual(s && [s.source, s.categoryId, s.subCategoryId, s.createdCategoryId], ["ai", pain.id, nsaid.id, null]);
  assert.ok(req.every((r) => !r.tools), "no online search when the list has a fit");
});

test("nothing fits: Gemini searches online and the category and sub category are created and selected", async () => {
  const pain = await categoriesRepo.create({ name: "PAIN KILLER", description: null, flat_discount_pct: 0, image_url: null });
  const req = fakeGemini([
    `{"index":-1,"reason":"None fits."}`,
    "NAME: anti anxiety\nWHY: Alprazolam is a benzodiazepine (CNS depressant).",
    "NAME: Benzodiazepines\nWHY: Short-acting benzodiazepine.",
  ]);
  const s = await suggestCategory({ name: "Xanax", description: "Alprazolam", categories: named([pain]), ...callbacks });
  assert.equal(s?.source, "web");
  assert.ok(s?.createdCategoryId && s.createdCategoryId === s.categoryId);
  assert.equal((await categoriesRepo.get(s!.categoryId!))!.name, "ANTI ANXIETY");
  assert.equal((await subCategoriesRepo.get(s!.subCategoryId!))!.name, "BENZODIAZEPINES");
  assert.match(s!.reason, /benzodiazepine/);
  assert.ok(req[1].tools && JSON.stringify(req[1].tools).includes("googleSearch"), "the online step uses Google Search");
});

test("an online answer that matches an existing category reuses it instead of creating a duplicate", async () => {
  const anx = await categoriesRepo.create({ name: "Anti Anxiety", description: null, flat_discount_pct: 0, image_url: null });
  fakeGemini([`{"index":-1,"reason":"x"}`, "NAME: ANTI ANXIETY\nWHY: y", "NAME: BENZODIAZEPINES\nWHY: z"]);
  const s = await suggestCategory({ name: "Xanax", description: "Alprazolam", categories: named([anx]), ...callbacks });
  assert.equal(s?.categoryId, anx.id);
  assert.equal(s?.createdCategoryId, null);
  assert.equal((await categoriesRepo.list()).length, 1);
  assert.ok(s?.createdSubCategoryId, "the sub category it named was new");
});
