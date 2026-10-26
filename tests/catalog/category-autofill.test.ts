/** Category suggestion from the description: the business's own products with
 * the same description come first; with no AI key nothing is guessed. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});

test("same description as another product: its category and sub category, without asking Gemini", async () => {
  const cat = await categoriesRepo.create({ name: "Depressant / Psychotropic Agents", description: null, flat_discount_pct: 0, image_url: null });
  const sub = await subCategoriesRepo.create({ category_id: cat.id, name: "Benzodiazepines", description: null, image_url: null });
  const other = await categoriesRepo.create({ name: "PAIN KILLER", description: null, flat_discount_pct: 0, image_url: null });
  await productsRepo.create({ name: "Xanax 0.5mg", description: "Alprazolam", category_id: cat.id, sub_category_id: sub.id, packing: 1 });
  const input = {
    name: "Alp 0.25mg", categories: [cat, other].map((c) => ({ id: c.id, name: c.name })),
    loadSubCategories: async () => [{ id: sub.id, name: sub.name }],
  };
  const s = await suggestCategory({ ...input, description: "  alprazolam " });
  assert.deepEqual(s && [s.source, s.categoryId, s.subCategoryId], ["catalog", cat.id, sub.id]);
  assert.equal(await suggestCategory({ ...input, description: "Paracetamol" }), null, "no match and no AI key: nothing is guessed");
  assert.equal(await suggestCategory({ ...input, description: "" }), null);
});
