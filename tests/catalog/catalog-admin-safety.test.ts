/** Super Admin > Catalog Review: moving a shared product that other
 * businesses use is refused (it would vanish from their lists while their
 * stock and invoices still point at it), and copies are not made for
 * businesses that already see the product in the shared catalog. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore } from "@/store/authStore";
import { bulkAssignByClassification, giveProductsToTenant } from "@/lib/repo/catalogAdmin";

const NOW = "2026-11-05T09:00:00.000Z";
let db: DatabaseSync;
const ins = (t: string, r: Record<string, unknown>) => {
  const k = Object.keys(r);
  db.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => r[x]) as never[]));
};
const owner = (id: string) => (db.prepare(`SELECT tenant_id FROM products WHERE id = ?`).get(id) as { tenant_id: string | null }).tenant_id;

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  for (const [id, bt] of [["syn-pharm-a", "retail_pharmacy"], ["syn-pharm-b", "medical_store"], ["syn-rest", "restaurant"]]) {
    ins("tenants", { id, name: id, business_type: bt, created_at: NOW, updated_at: NOW });
  }
  ins("products", { id: "sh-used", tenant_id: null, catalog_group: "pharma", name: "Shared, stocked by B", packing: 1, created_at: NOW, updated_at: NOW });
  ins("products", { id: "sh-free", tenant_id: null, catalog_group: "pharma", name: "Shared, unused", packing: 1, created_at: NOW, updated_at: NOW });
  ins("product_batches", { id: "b1", tenant_id: "syn-pharm-b", product_id: "sh-used", batch_no: "X", qty: 5, created_at: NOW, updated_at: NOW });
  useAuthStore.setState({ currentUser: { id: "sa", username: "sa", displayName: "Admin", role: "super_admin", tenantId: null, permissions: null }, currentTenant: null });
});

test("a shared product another business uses cannot be moved; an unused one can", async () => {
  const r = await giveProductsToTenant(["sh-used", "sh-free", "gone"], "syn-pharm-a", "move");
  assert.deepEqual(r.done, ["sh-free"]);
  assert.deepEqual(r.skipped.map((s) => s.id), ["sh-used", "gone"]);
  assert.match(r.skipped[0].reason, /Used by 1 other business/);
  assert.equal(owner("sh-used"), null, "still shared, so business B keeps it");
  assert.equal(owner("sh-free"), "syn-pharm-a");
});

test("the business already using it may take it over", async () => {
  const r = await giveProductsToTenant(["sh-used"], "syn-pharm-b", "move");
  assert.deepEqual(r.done, ["sh-used"]);
});

test("no copy for a business that already sees it; a restaurant gets one", async () => {
  const toPharmacy = await giveProductsToTenant(["sh-free"], "syn-pharm-a", "copy");
  assert.deepEqual(toPharmacy.done, []);
  assert.match(toPharmacy.skipped[0].reason, /already sees it/);
  const toRestaurant = await giveProductsToTenant(["sh-free"], "syn-rest", "copy");
  assert.deepEqual(toRestaurant.done, ["sh-free"]);
  const copies = db.prepare(`SELECT tenant_id FROM products WHERE id LIKE 'sh-free~%'`).all() as { tenant_id: string }[];
  assert.deepEqual(copies.map((c) => c.tenant_id), ["syn-rest"]);
});

test("bulk assign no longer duplicates the shared catalog into pharmacies", async () => {
  await bulkAssignByClassification();
  const copies = db.prepare(`SELECT tenant_id FROM products WHERE id LIKE 'sh-%~%'`).all() as { tenant_id: string }[];
  assert.ok(!copies.some((c) => c.tenant_id.startsWith("syn-pharm")), "pharmacies already see these products");
});
