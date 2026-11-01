/** Business Wise Profit/Loss: memorized (draft) invoices are not sales; their
 * total and profit are shown on their own rows. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo } from "@/lib/repo/products";
import { invoicesRepo, invoiceItemsRepo } from "@/lib/repo/invoices";
import { getBusinessProfitLoss } from "@/lib/repo/reports";

const tenant: SessionTenant = {
  id: "store-a", name: "Store", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "general_store",
};

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: "store-a", permissions: null }, currentTenant: tenant });
});

async function bill(no: number, productId: string, qty: number, memorized: number) {
  const inv = await invoicesRepo.create({
    invoice_no: no, date: "2026-11-01", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null,
    total: qty * 100, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: qty * 100, paid: 0, balance: qty * 100,
    is_return: 0, is_memorized: memorized, converted_invoice_id: null,
  } as never);
  await invoiceItemsRepo.create({
    invoice_id: inv.id, product_id: productId, batch_no: null, packing: 1, uom_id: null, avail_qty: null, qty, bonus_qty: 0,
    purchase_price: 60, sale_price: 100, tax_pct: 0, further_tax_pct: 0, tax_rs: 0, discount_pct: 0, discount_rs: 0, total: qty * 100,
  } as never);
}

test("drafts stay out of sales and show their own total and profit", async () => {
  const p = await productsRepo.create({ name: "Soap", packing: 1 } as never);
  await bill(1, p.id, 10, 0);
  await bill(2, p.id, 4, 1);
  const rows = await getBusinessProfitLoss("2026-11-01", "2026-11-01");
  const get = (m: string) => rows.find((r) => r.metric.startsWith(m))!.amount;
  assert.equal(get("Net Sales"), 1000);
  assert.equal(get("Cost of Goods Sold"), 600);
  assert.equal(get("Net Profit / Loss"), 400);
  assert.equal(get("Memorized Invoices Total"), 400);
  assert.equal(get("Memorized Invoices Profit"), 160);
  assert.match(rows.find((r) => r.metric.startsWith("Memorized Invoices Total"))!.metric, /1 draft,/);
});
