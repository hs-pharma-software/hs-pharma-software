/** Companies: listed from product company names (own and visible shared
 * catalog), one entry per company whatever the spelling case; renaming
 * changes only the business's own products. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo } from "@/lib/repo/products";
import { listCompanies, companyNames, renameCompany } from "@/lib/repo/companies";

const T = "pharm-a";
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
let db: DatabaseSync;
const NOW = "2026-10-26T00:00:00.000Z";

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});

test("one entry per company, counts, and rename only on own products", async () => {
  await productsRepo.create({ name: "Panadol 500", company_name: "GSK", packing: 1 });
  await productsRepo.create({ name: "Augmentin 625", company_name: "gsk ", packing: 1 });
  await productsRepo.create({ name: "Brufen 400", company_name: "Abbott", packing: 1 });
  await productsRepo.create({ name: "No company", company_name: null, packing: 1 });
  db.prepare(`INSERT INTO products (id, tenant_id, catalog_group, name, company_name, created_at, updated_at) VALUES ('shared-1', NULL, 'pharma', 'Calpol', 'GSK', ?, ?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO products (id, tenant_id, catalog_group, name, company_name, created_at, updated_at) VALUES ('other-1', 'pharm-b', NULL, 'Hidden', 'Other Co', ?, ?)`).run(NOW, NOW);

  const rows = await listCompanies();
  assert.deepEqual(rows, [{ name: "Abbott", products: 1, own: 1 }, { name: "GSK", products: 3, own: 2 }], "another business's companies are not listed");
  assert.deepEqual(await companyNames(), ["Abbott", "GSK"]);

  const r = await renameCompany("gsk", "GlaxoSmithKline");
  assert.deepEqual(r, { changed: 2, sharedLeft: 1 });
  assert.equal((db.prepare(`SELECT company_name FROM products WHERE id = 'shared-1'`).get() as { company_name: string }).company_name, "GSK", "the shared catalog is not changed");
  assert.deepEqual((await listCompanies()).map((c) => [c.name, c.products]), [["Abbott", 1], ["GlaxoSmithKline", 2], ["GSK", 1]]);
});
