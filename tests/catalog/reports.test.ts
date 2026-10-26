/** Sales reports: lines for shared catalog products are counted (they were
 * dropped), the bonus / category queries run (they failed on ambiguous
 * columns), and missing prices give 0, never an empty value. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { invoicesRepo, invoiceItemsRepo } from "@/lib/repo/invoices";
import { categoriesRepo } from "@/lib/repo/categories";
import {
  getProductProfitLoss, getCompanyProfitLoss, getCategoryProfitLoss, getSubCategoryProfitLoss, getCustomerProfitLoss,
  getProductWiseSales, getCategoryWiseSales, getBonusAndDiscountReport, getTaxReport, getTrialBalance,
} from "@/lib/repo/reports";
import type { Invoice, InvoiceItem } from "@/lib/types2";

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

test("every sales report works for a pharmacy selling shared catalog products", async () => {
  const cat = await categoriesRepo.create({ name: "PAIN KILLER", description: null, flat_discount_pct: 0, image_url: null });
  db.prepare(`INSERT INTO products (id, tenant_id, catalog_group, name, company_name, category_id, created_at, updated_at) VALUES ('shared-panadol', NULL, 'pharma', 'Panadol', 'GSK', ?, ?, ?)`).run(cat.id, NOW, NOW);
  db.prepare(`INSERT INTO products (id, tenant_id, catalog_group, name, company_name, created_at, updated_at) VALUES ('shared-brufen', NULL, 'pharma', 'Brufen', NULL, ?, ?)`).run(NOW, NOW);
  const inv = await invoicesRepo.create({
    invoice_no: 1, date: "2026-10-26", inv_on: "2026-10-26", invoice_type: "sale", total: 1300, charges: 0, discount_pct: 0, discount_rs: 50, tax_pct: 0,
    payable: 1250, paid: 1250, balance: 0, is_return: 0, is_memorized: 0, is_quotation: 0,
  } as Partial<Invoice>);
  const line = (product_id: string, qty: number, sale: number, purchase: number | null, extra: Partial<InvoiceItem> = {}) =>
    invoiceItemsRepo.create({ invoice_id: inv.id, product_id, packing: 1, qty, bonus_qty: 0, purchase_price: purchase as number, sale_price: sale, tax_pct: 0, further_tax_pct: 0, tax_rs: 0, discount_pct: 0, discount_rs: 0, total: qty * sale, ...extra } as Partial<InvoiceItem>);
  await line("shared-panadol", 10, 100, 70, { bonus_qty: 2, discount_rs: 20 });
  await line("shared-brufen", 1, 300, null);

  const pl = await getProductProfitLoss("", "");
  assert.deepEqual(pl.map((r) => [r.name, r.qty, r.sales, r.cogs, r.profit]).sort(), [["Brufen", 1, 300, 0, 300], ["Panadol", 10, 1000, 700, 300]]);
  assert.deepEqual((await getCompanyProfitLoss("", "")).map((r) => [r.id, r.name]).sort(), [["GSK", "GSK"], ["Unspecified", "Unspecified"]]);
  assert.deepEqual((await getCategoryProfitLoss("", "")).map((r) => r.name).sort(), ["PAIN KILLER", "Uncategorized"]);
  assert.equal((await getSubCategoryProfitLoss("", "")).length, 1);
  assert.deepEqual((await getCustomerProfitLoss("", "")).map((r) => [r.id, r.name]), [["walk-in", "Walk-in"]]);
  assert.equal((await getProductWiseSales("", "")).reduce((s, r) => s + r.sales, 0), 1300);
  assert.deepEqual((await getCategoryWiseSales("", "")).map((r) => [r.name, r.sales]).sort(), [["PAIN KILLER", 1000], ["Uncategorized", 300]]);
  assert.deepEqual((await getBonusAndDiscountReport("", "")).map((r) => [r.name, r.bonus_qty, r.bonus_value, r.discount_rs]), [["Panadol", 2, 200, 20]]);
  assert.equal((await getTaxReport("", ""))[0].sales_tax, 0);
  assert.ok((await getTrialBalance()).length >= 5);
  for (const r of pl) for (const v of [r.qty, r.sales, r.cogs, r.profit]) assert.equal(typeof v, "number", "no empty totals");
});
