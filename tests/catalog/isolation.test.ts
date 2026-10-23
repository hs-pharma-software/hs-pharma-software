/** Tenant isolation of the shared screens' catalog (products, categories,
 * units) and of the lines that use it, through the app's real repositories
 * on the full v29 schema. Two restaurants and one pharmacy. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo, searchProductsByNameOrBarcode, listProductsForGrid, productBatchesRepo, assertOwnProducts } from "@/lib/repo/products";
import { categoriesRepo, subCategoriesRepo } from "@/lib/repo/categories";
import { uomsRepo, seedStarterUoms } from "@/lib/repo/uoms";
import { invoiceItemsRepo } from "@/lib/repo/invoices";
import { orderItemsRepo } from "@/lib/repo/orders";
import { getLowStockProducts } from "@/lib/repo/dashboard";
import { addGenericName, listGenericNames } from "@/lib/repo/genericNames";
import { hasModuleAccess } from "@/lib/moduleAccess";
import { mayPush } from "@/lib/sync/engine";
import type { Product } from "@/lib/types";

const RA = "rest-a";
const RB = "rest-b";
const PH = "pharm-1";
const TYPES: Record<string, string> = { [RA]: "restaurant", [RB]: "restaurant", [PH]: "retail_pharmacy" };

let sql: DatabaseSync;

function as(tenantId: string | null, allowed: string[] = []) {
  if (!tenantId) return useAuthStore.setState({ currentUser: null, currentTenant: null });
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: allowed, maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: TYPES[tenantId],
  };
  useAuthStore.setState({ currentUser: { id: `${tenantId}-u`, username: "u", displayName: "U", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

/** Inserts a row filling NOT NULL columns without defaults (parent records for FKs). */
function row(table: string, values: Record<string, unknown>) {
  const cols = sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: unknown }[];
  const now = "2026-10-23T10:00:00.000Z";
  const r: Record<string, unknown> = { created_at: now, updated_at: now, ...values };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in r)) r[c.name] = c.name.endsWith("_at") || c.name === "date" ? now : 0;
  const keys = Object.keys(r);
  sql.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k]) as never[]));
}

async function catalogFor(tenant: string, prefix: string) {
  as(tenant);
  const unit = await uomsRepo.create({ name: `${prefix} PCS`, description: null });
  const cat = await categoriesRepo.create({ name: `${prefix} Category`, flat_discount_pct: 0, description: null, image_url: null } as never);
  const sub = await subCategoriesRepo.create({ category_id: cat.id, name: `${prefix} Sub`, flat_discount_pct: 0 } as never);
  const product = await productsRepo.create({ name: `${prefix} Item`, barcode: `${prefix}-BC`, category_id: cat.id, sub_category_id: sub.id, base_unit_id: unit.id, packing: 1, max_stock_qty: 100 } as Partial<Product>);
  return { unit, cat, sub, product };
}

let A: Awaited<ReturnType<typeof catalogFor>>;
let B: Awaited<ReturnType<typeof catalogFor>>;
let P: Awaited<ReturnType<typeof catalogFor>>;

beforeEach(async () => {
  sql = fullSchemaDb();
  setTestDb(sql);
  for (const t of [RA, RB, PH]) row("tenants", { id: t, name: t, business_type: TYPES[t] });
  A = await catalogFor(RA, "Burger");
  B = await catalogFor(RB, "Karahi");
  P = await catalogFor(PH, "Panadol");
});

test("each tenant lists only its own products, categories and units", async () => {
  for (const [t, own] of [[RA, A], [RB, B], [PH, P]] as const) {
    as(t);
    assert.deepEqual((await productsRepo.list()).map((p) => p.id), [own.product.id]);
    assert.deepEqual((await categoriesRepo.list()).map((c) => c.id), [own.cat.id]);
    assert.deepEqual((await subCategoriesRepo.list()).map((c) => c.id), [own.sub.id]);
    assert.deepEqual((await uomsRepo.list()).map((u) => u.id), [own.unit.id]);
    assert.deepEqual((await listProductsForGrid()).map((p) => p.id), [own.product.id]);
  }
});

test("a restaurant never sees the pharmacy's medicines (the reported bug)", async () => {
  as(RA);
  const names = [...(await productsRepo.list()), ...(await searchProductsByNameOrBarcode(""))].map((p) => p.name);
  assert.ok(!names.some((n) => n.includes("Panadol") || n.includes("Karahi")), names.join(","));
  assert.deepEqual((await getLowStockProducts()).map((r) => r.name), ["Burger Item"]);
});

test("search and autocomplete are tenant-specific", async () => {
  as(RA);
  assert.deepEqual(await searchProductsByNameOrBarcode("Karahi"), []);
  assert.deepEqual(await searchProductsByNameOrBarcode("Panadol-BC"), []);
  assert.equal((await searchProductsByNameOrBarcode("Burger"))[0]?.id, A.product.id);
});

test("direct id access to another tenant's product returns nothing", async () => {
  as(RA);
  assert.equal(await productsRepo.get(B.product.id), null);
  assert.equal(await categoriesRepo.get(B.cat.id), null);
  assert.equal(await uomsRepo.get(P.unit.id), null);
});

test("another tenant's product cannot be edited or deleted", async () => {
  as(RA);
  assert.equal(await productsRepo.update(B.product.id, { name: "HACKED" }), null);
  await productsRepo.remove(B.product.id);
  as(RB);
  const p = await productsRepo.get(B.product.id);
  assert.equal(p?.name, "Karahi Item");
  assert.equal(p?.deleted_at, null);
});

test("a product cannot use another tenant's category, sub category or unit", async () => {
  as(RA);
  await assert.rejects(() => productsRepo.create({ name: "X", category_id: B.cat.id } as Partial<Product>), /Category not found in this business/);
  await assert.rejects(() => productsRepo.create({ name: "X", sub_category_id: P.sub.id } as Partial<Product>), /Sub category not found/);
  await assert.rejects(() => productsRepo.create({ name: "X", base_unit_id: B.unit.id } as Partial<Product>), /Base unit not found/);
  await assert.rejects(() => productsRepo.update(A.product.id, { category_id: P.cat.id }), /Category not found/);
  await assert.rejects(() => subCategoriesRepo.create({ category_id: B.cat.id, name: "S" } as never), /Category not found/);
});

test("another tenant's product cannot be added to an invoice, order or stock", async () => {
  as(RA);
  row("invoices", { id: "inv-a", tenant_id: RA });
  row("orders", { id: "ord-a", tenant_id: RA });
  await assert.rejects(() => invoiceItemsRepo.create({ invoice_id: "inv-a", product_id: P.product.id, qty: 1 } as never), /Product not found in this business/);
  await assert.rejects(() => orderItemsRepo.create({ order_id: "ord-a", product_id: B.product.id, qty: 1 } as never), /Product not found/);
  await assert.rejects(() => invoiceItemsRepo.create({ invoice_id: "inv-a", product_id: A.product.id, uom_id: P.unit.id, qty: 1 } as never), /Unit not found/);
  await assert.rejects(() => productBatchesRepo.create({ product_id: B.product.id, qty: 5 } as never), /Product not found/);
  await assert.rejects(() => assertOwnProducts([A.product.id, B.product.id]), /Product not found/);
  // Own product works.
  const line = await invoiceItemsRepo.create({ invoice_id: "inv-a", product_id: A.product.id, uom_id: A.unit.id, qty: 2 } as never);
  assert.equal(line.tenant_id, RA);
});

test("invoice lines and order history do not leak across tenants", async () => {
  as(RB);
  row("invoices", { id: "inv-b", tenant_id: RB });
  await invoiceItemsRepo.create({ invoice_id: "inv-b", product_id: B.product.id, qty: 3 } as never);
  as(RA);
  assert.deepEqual(await invoiceItemsRepo.list(), []);
  assert.equal(await invoiceItemsRepo.get((sql.prepare(`SELECT id FROM invoice_items`).get() as { id: string }).id), null);
});

test("a client-supplied tenant id does not grant access", async () => {
  as(RA);
  await assert.rejects(() => productsRepo.create({ name: "Smuggled", tenant_id: RB } as Partial<Product>), /belongs to another business/);
  assert.equal((sql.prepare(`SELECT COUNT(*) n FROM products WHERE name = 'Smuggled'`).get() as { n: number }).n, 0);
  // Updates ignore a tenant_id in the patch.
  await productsRepo.update(A.product.id, { tenant_id: RB } as Partial<Product>);
  assert.equal((sql.prepare(`SELECT tenant_id FROM products WHERE id = ?`).get(A.product.id) as { tenant_id: string }).tenant_id, RA);
});

test("missing tenant context fails closed", async () => {
  as(null);
  await assert.rejects(() => productsRepo.list(), /No tenant is logged in/);
  assert.deepEqual(await searchProductsByNameOrBarcode("Burger"), []);
  assert.deepEqual(await listProductsForGrid(), []);
  await assert.rejects(() => productsRepo.create({ name: "X" } as Partial<Product>), /No tenant is logged in/);
  assert.equal(hasModuleAccess("products"), false);
});

test("generic names and starter units are per tenant", async () => {
  as(PH);
  await addGenericName("Paracetamol", await listGenericNames());
  as(RA);
  assert.deepEqual(await listGenericNames(), []);
  await addGenericName("Paracetamol", []); // same name, own row
  assert.deepEqual(await listGenericNames(), ["Paracetamol"]);
  assert.ok((await seedStarterUoms()) > 5);
  as(RB);
  assert.deepEqual((await uomsRepo.list()).map((u) => u.name), ["Karahi PCS"]);
});

test("restaurant and solar tenants cannot open pharmacy catalog screens, pharmacies can", () => {
  as(RA, ["products", "invoices", "stock", "customers"]);
  assert.equal(hasModuleAccess("products"), false);
  assert.equal(hasModuleAccess("invoices"), false);
  assert.equal(hasModuleAccess("stock"), false);
  assert.equal(hasModuleAccess("customers"), true);
  assert.equal(hasModuleAccess("restaurant_menu"), true);
  as(PH, ["products", "invoices"]);
  assert.equal(hasModuleAccess("products"), true);
  assert.equal(hasModuleAccess("restaurant_menu"), false);
});

test("sync push refuses rows of another tenant", () => {
  const sA = { tenantId: RA, superAdmin: false };
  assert.equal(mayPush("products", "update", { id: "x", tenant_id: RA }, sA), true);
  assert.equal(mayPush("products", "update", { id: "x", tenant_id: RB }, sA), false);
  assert.equal(mayPush("products", "insert", { id: "x", tenant_id: null }, sA), false);
  assert.equal(mayPush("invoice_items", "insert", { id: "x", tenant_id: PH }, sA), false);
  assert.equal(mayPush("products", "update", { id: "x", name: "pre-v29 entry" }, sA), true);
  assert.equal(mayPush("invoices", "update", { id: "x", name: "no tenant" }, sA), false);
  assert.equal(mayPush("products", "insert", { id: "x", tenant_id: RA }, { tenantId: null, superAdmin: false }), false);
  const admin = { tenantId: null, superAdmin: true };
  assert.equal(mayPush("products", "insert_if_absent", { id: "x", tenant_id: RA }, admin), true);
  assert.equal(mayPush("invoices", "insert", { id: "x", tenant_id: RA }, admin), false);
});

test("existing pharmacy workflow still works: product, stock, invoice line", async () => {
  as(PH);
  const unit = (await uomsRepo.list())[0];
  const p = await productsRepo.create({ name: "Brufen 400", category_id: P.cat.id, base_unit_id: unit.id, packing: 10 } as Partial<Product>);
  await productBatchesRepo.create({ product_id: p.id, batch_no: "B1", qty: 50, purchase_price: 5 } as never);
  row("invoices", { id: "inv-p", tenant_id: PH });
  await invoiceItemsRepo.create({ invoice_id: "inv-p", product_id: p.id, uom_id: unit.id, qty: 2 } as never);
  const grid = await listProductsForGrid();
  assert.equal(grid.find((g) => g.id === p.id)?.avail_qty, 50);
  assert.equal(grid.find((g) => g.id === p.id)?.category_name, "Panadol Category");
});
