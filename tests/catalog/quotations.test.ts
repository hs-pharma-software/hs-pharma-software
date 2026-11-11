/** Quotations list actions: delete removes a quotation and its lines (soft,
 * with the reason in the delete history); one already turned into an
 * invoice is kept. Real repos on the complete schema. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { invoicesRepo, invoiceItemsRepo, deleteQuotation, listQuotations, listItemsForInvoice } from "@/lib/repo/invoices";
import { productsRepo } from "@/lib/repo/products";
import type { Product } from "@/lib/types";

let sql: DatabaseSync;
function loginAs(tenantId: string) {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "general_store",
  };
  useAuthStore.setState({ currentUser: { id: `${tenantId}-u`, username: "u", displayName: "Owner", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

async function quotation(no: number, converted: string | null = null) {
  const p = await productsRepo.create({ name: `Item ${no}`, packing: 1 } as Partial<Product>);
  const q = await invoicesRepo.create({
    invoice_no: null, quotation_no: no, date: "2026-11-11", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null,
    total: 100, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: 100, paid: 0, balance: 100, is_return: 0, is_memorized: 0, is_quotation: 1,
    converted_invoice_id: converted, original_invoice_id: null,
  } as never);
  await invoiceItemsRepo.create({ invoice_id: q.id, product_id: p.id, batch_no: null, packing: 1, uom_id: null, avail_qty: null, qty: 1, bonus_qty: 0, purchase_price: 0, sale_price: 100, tax_pct: 0, further_tax_pct: 0, tax_rs: 0, discount_pct: 0, discount_rs: 0, total: 100 } as never);
  return q;
}

beforeEach(() => {
  sql = fullSchemaDb();
  setTestDb(sql);
  loginAs("t1");
});

test("deleting a quotation removes it and its lines, with the reason kept", async () => {
  const q = await quotation(1);
  await deleteQuotation(q.id, "Customer cancelled");
  assert.equal((await listQuotations()).length, 0);
  assert.equal((await listItemsForInvoice(q.id)).length, 0);
  const h = sql.prepare(`SELECT delete_from, reason FROM delete_history`).get() as Record<string, unknown>;
  assert.deepEqual({ ...h }, { delete_from: "Quotation", reason: "Customer cancelled" });
  assert.ok((sql.prepare(`SELECT deleted_at FROM invoices WHERE id = ?`).get(q.id) as { deleted_at: string | null }).deleted_at, "soft delete: the row is kept");
});

test("a quotation already turned into an invoice cannot be deleted; another business's cannot either", async () => {
  const q = await quotation(2, "some-invoice");
  await assert.rejects(deleteQuotation(q.id, "x"), /already turned into an invoice/);
  const mine = await quotation(3);
  loginAs("t2");
  await assert.rejects(deleteQuotation(mine.id, "x"), /not found/);
  loginAs("t1");
  assert.equal((await listQuotations()).length, 2);
});
