/** Adding and editing products in the shared catalogs, through the real repo
 * on the complete schema. General stores could not save a product at all, and
 * edits to any shared product were silently lost. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo, productBatchesRepo, priceListRepo, createSharedProduct, getLatestPrice } from "@/lib/repo/products";
import { uomsRepo } from "@/lib/repo/uoms";
import { categoriesRepo } from "@/lib/repo/categories";
import type { Product } from "@/lib/types";

let sql: DatabaseSync;
const TYPES: Record<string, string> = { "gs-1": "general_store", "gs-2": "general_store", "ph-1": "retail_pharmacy", "rest-1": "restaurant" };

function loginAs(tenantId: string) {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: TYPES[tenantId],
  };
  useAuthStore.setState({ currentUser: { id: `${tenantId}-u`, username: "u", displayName: "U", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

beforeEach(() => {
  sql = fullSchemaDb();
  setTestDb(sql);
});

async function handsFree(catalog_group: string) {
  const unit = await uomsRepo.create({ name: "No", description: null });
  const cat = await categoriesRepo.create({ name: "Mobile Accessories", flat_discount_pct: 0, description: null, image_url: null } as never);
  return createSharedProduct({
    name: "Erorex Handfree M21", company_name: "Erorex", description: "Handfree", base_unit_id: unit.id, category_id: cat.id, packing: 1,
    fbr_sale_rate: 18, catalog_group, product_classification: catalog_group,
  } as Partial<Product>);
}

test("a general store saves a product with its opening stock and prices (the reported bug)", async () => {
  loginAs("gs-1");
  const p = await handsFree("general_store");
  const back = await productsRepo.get(p.id);
  assert.equal(back?.name, "Erorex Handfree M21");
  assert.equal(back?.catalog_group, "general_store");
  const batch = await productBatchesRepo.create({ product_id: p.id, batch_no: null, expiry_date: null, qty: 10, location: null, purchase_price: 180 });
  await priceListRepo.create({ product_id: p.id, batch_no: null, sale_price: 250, wholesale_price: 250, mrp: 300, comment: null });
  assert.equal((await productBatchesRepo.get(batch.id))?.qty, 10);
  assert.equal((await getLatestPrice(p.id))?.salePrice, 250);
  assert.ok((await productsRepo.list()).some((x) => x.id === p.id), "listed on the Products screen");

  // Another general store sees the shared product but not this store's stock.
  loginAs("gs-2");
  assert.ok(await productsRepo.get(p.id));
  assert.equal((await productBatchesRepo.list()).length, 0);
});

test("who may add to which shared catalog", async () => {
  loginAs("gs-1");
  await assert.rejects(handsFree("pharma"), /cannot add products to that shared catalog/);
  loginAs("ph-1");
  assert.ok(await handsFree("pharma"));
  assert.ok(await handsFree("general_store"));
  loginAs("rest-1");
  await assert.rejects(handsFree("general_store"), /cannot add products to that shared catalog/);
});

test("editing a shared product is saved (it used to be silently lost)", async () => {
  loginAs("gs-1");
  const p = await handsFree("general_store");
  const updated = await productsRepo.update(p.id, { name: "Erorex Handfree M22", gst_rate_pct: 5 });
  assert.equal(updated?.name, "Erorex Handfree M22");
  const row = sql.prepare(`SELECT name, gst_rate_pct, tenant_id, catalog_group FROM products WHERE id = ?`).get(p.id) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { name: "Erorex Handfree M22", gst_rate_pct: 5, tenant_id: null, catalog_group: "general_store" });

  // A pharmacy editing a shared pharma product.
  loginAs("ph-1");
  const med = await handsFree("pharma");
  await productsRepo.update(med.id, { name: "Panadol 500mg" });
  assert.equal((await productsRepo.get(med.id))?.name, "Panadol 500mg");

  // An edit cannot move the row out of the store's catalogs or claim it.
  loginAs("gs-1");
  await productsRepo.update(p.id, { catalog_group: "pharma", tenant_id: "gs-1" } as Partial<Product>);
  const after = sql.prepare(`SELECT tenant_id, catalog_group FROM products WHERE id = ?`).get(p.id) as Record<string, unknown>;
  assert.deepEqual({ ...after }, { tenant_id: null, catalog_group: "general_store" });
  // And a general store cannot reach a pharma-only product at all.
  await assert.rejects(productsRepo.update(med.id, { name: "x" }), /Product not found/);
});
