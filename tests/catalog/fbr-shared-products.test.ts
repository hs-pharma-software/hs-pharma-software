/** An invoice of shared catalog products (tenant_id NULL) goes to FBR with
 * each product's HS code, sale type and UOM (it used to find no product at
 * all: "Unknown product: HS code "" ..."). FBR's server is stubbed. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { invoicesRepo, invoiceItemsRepo } from "@/lib/repo/invoices";
import { submitInvoiceToFbrById } from "@/lib/fbrSubmit";
import type { FbrSettings } from "@/lib/fbr";

const T = "ph-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
const settings: FbrSettings = {
  enabled: true, environment: "production", sandboxToken: "", productionToken: "tok", sellerNtn: "1234567", sellerName: "Pharmacy",
  sellerProvince: "Punjab", sellerAddress: "Lahore", retailer: false,
};
const realFetch = globalThis.fetch;
let posted: unknown = null;

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  posted = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (/HS_UOM/.test(String(url))) return new Response(JSON.stringify([{ uoM_ID: 13, description: "Numbers, pieces, units" }]), { status: 200 });
    posted = JSON.parse(String(init?.body ?? "null"));
    return new Response(JSON.stringify({ invoiceNumber: "FBR-123", validationResponse: { statusCode: "00", invoiceStatuses: [{ itemSNo: "1", statusCode: "00" }] } }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

test("shared catalog products carry their FBR details to the submission", async () => {
  db.prepare(`INSERT INTO products (id, tenant_id, catalog_group, name, packing, hs_code, fbr_sale_type, fbr_sale_rate, fbr_uom, created_at, updated_at)
    VALUES ('shared-1', NULL, 'pharma', 'Panadol 500mg', 1, '3004.9099', 'Goods at standard rate (default)', 18, 'Numbers, pieces, units', 'x', 'x')`).run();
  const inv = await invoicesRepo.create({
    invoice_no: 1, date: "2026-11-02", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null,
    customer_name: "Walk-in", total: 1000, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: 1000, paid: 1000, balance: 0,
    is_return: 0, is_memorized: 0, converted_invoice_id: null, buyer_province: "Punjab", buyer_registration_type: "Unregistered",
  } as never);
  await invoiceItemsRepo.create({
    invoice_id: inv.id, product_id: "shared-1", batch_no: null, packing: 1, uom_id: null, avail_qty: null, qty: 10, bonus_qty: 0,
    purchase_price: 60, sale_price: 100, tax_pct: 18, further_tax_pct: 0, tax_rs: 180, discount_pct: 0, discount_rs: 0, total: 1180,
  } as never);
  const r = await submitInvoiceToFbrById(inv.id, settings);
  assert.equal(r.error, null);
  assert.equal(r.fbrInvoiceNo, "FBR-123");
  const item = (posted as { items: { hsCode: string; productDescription: string; uoM: string }[] }).items[0];
  assert.equal(item.hsCode, "3004.9099");
  assert.equal(item.productDescription, "Panadol 500mg");
  assert.equal(item.uoM, "Numbers, pieces, units");
});

test("a contractor product's FBR article name is sent instead of its invoice name", async () => {
  db.prepare(`INSERT INTO products (id, tenant_id, name, fbr_article_name, packing, hs_code, fbr_sale_type, fbr_sale_rate, fbr_uom, created_at, updated_at)
    VALUES ('own-1', ?, 'BLOOD TRANSFUSSION SET', 'Blood transfusion set, sterile', 1, '3004.9099', 'Goods at standard rate (default)', 18, 'Numbers, pieces, units', 'x', 'x')`).run(T);
  const inv = await invoicesRepo.create({
    invoice_no: 2, date: "2026-11-02", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null,
    customer_name: "Walk-in", total: 1000, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: 1000, paid: 1000, balance: 0,
    is_return: 0, is_memorized: 0, converted_invoice_id: null, buyer_province: "Punjab", buyer_registration_type: "Unregistered",
  } as never);
  await invoiceItemsRepo.create({
    invoice_id: inv.id, product_id: "own-1", batch_no: null, packing: 1, uom_id: null, avail_qty: null, qty: 10, bonus_qty: 0,
    purchase_price: 60, sale_price: 100, tax_pct: 18, further_tax_pct: 0, tax_rs: 180, discount_pct: 0, discount_rs: 0, total: 1180,
  } as never);
  const r = await submitInvoiceToFbrById(inv.id, settings);
  assert.equal(r.error, null);
  const item = (posted as { items: { productDescription: string }[] }).items[0];
  assert.equal(item.productDescription, "Blood transfusion set, sterile");
});
