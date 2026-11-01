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

async function bill(no: number, productId: string, qty: number, memorized: number, paid = 0) {
  const inv = await invoicesRepo.create({
    invoice_no: no, date: "2026-11-01", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null,
    total: qty * 100, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: qty * 100, paid, balance: qty * 100 - paid,
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
  await bill(2, p.id, 4, 1, 100);
  const rows = await getBusinessProfitLoss("2026-11-01", "2026-11-01");
  const get = (m: string) => rows.find((r) => r.metric.startsWith(m))!.amount;
  assert.equal(get("Net Sales"), 1000);
  assert.equal(get("Cost of Goods Sold"), 600);
  assert.equal(get("Net Profit / Loss"), 400);
  assert.equal(get("Memorized Invoices Total"), 400);
  assert.equal(get("Memorized Invoices Profit"), 160);
  assert.equal(get("Memorized Invoices Paid"), 100);
  assert.equal(get("Profit on Paid Amount"), 40, "a quarter paid: a quarter of the profit");
  assert.match(rows.find((r) => r.metric.startsWith("Memorized Invoices Total"))!.metric, /1 draft,/);
});

test("net sales are after the line discounts and the bill discount", async () => {
  const p = await productsRepo.create({ name: "Shampoo", packing: 1 } as never);
  const inv = await invoicesRepo.create({
    invoice_no: 5, date: "2026-11-01", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null,
    total: 1000, charges: 0, discount_pct: 0, discount_rs: 50, tax_pct: 0, payable: 850, paid: 850, balance: 0,
    is_return: 0, is_memorized: 0, converted_invoice_id: null,
  } as never);
  await invoiceItemsRepo.create({
    invoice_id: inv.id, product_id: p.id, batch_no: null, packing: 1, uom_id: null, avail_qty: null, qty: 10, bonus_qty: 0,
    purchase_price: 60, sale_price: 100, tax_pct: 0, further_tax_pct: 0, tax_rs: 0, discount_pct: 10, discount_rs: 100, total: 900,
  } as never);
  const rows = await getBusinessProfitLoss("2026-11-01", "2026-11-01");
  const get = (m: string) => rows.find((r) => r.metric.startsWith(m))!.amount;
  assert.equal(get("Net Sales"), 850, "1000 - 100 line discount - 50 bill discount");
  assert.equal(get("Gross Profit"), 250);
});

test("product, company and customer reports are after discounts too, and add up to net sales", async () => {
  const { getProductProfitLoss, getProductWiseSales } = await import("@/lib/repo/reports");
  const a = await productsRepo.create({ name: "A", packing: 1 } as never);
  const b = await productsRepo.create({ name: "B", packing: 1 } as never);
  const inv = await invoicesRepo.create({
    invoice_no: 7, date: "2026-11-01", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null,
    total: 1000, charges: 0, discount_pct: 0, discount_rs: 90, tax_pct: 0, payable: 810, paid: 810, balance: 0,
    is_return: 0, is_memorized: 0, converted_invoice_id: null,
  } as never);
  const item = (productId: string, qty: number, disc: number) => invoiceItemsRepo.create({
    invoice_id: inv.id, product_id: productId, batch_no: null, packing: 1, uom_id: null, avail_qty: null, qty, bonus_qty: 0,
    purchase_price: 50, sale_price: 100, tax_pct: 0, further_tax_pct: 0, tax_rs: 0, discount_pct: 0, discount_rs: disc, total: qty * 100 - disc,
  } as never);
  await item(a.id, 6, 0);
  await item(b.id, 4, 100);
  const rows = await getProductProfitLoss("2026-11-01", "2026-11-01");
  const sales = (n: string) => Math.round(rows.find((r) => r.name === n)!.sales * 100) / 100;
  // Lines 600 and 300 (after B's own 100); the bill's 90 split 2 : 1.
  assert.equal(sales("A"), 540);
  assert.equal(sales("B"), 270);
  assert.equal(Math.round(rows.reduce((t, r) => t + r.sales, 0)), 810);
  assert.equal(Math.round(rows.find((r) => r.name === "A")!.profit), 240);
  const wise = await getProductWiseSales("2026-11-01", "2026-11-01");
  assert.equal(Math.round(wise.reduce((t, r) => t + Number(r.sales), 0)), 810);
});
