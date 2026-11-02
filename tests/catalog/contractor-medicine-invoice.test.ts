/** Contractor Medicine invoices: the batch written on a line is saved and
 * read back for printing, without touching the stock batch number. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { invoicesRepo, invoiceItemsRepo, listItemsForInvoice } from "@/lib/repo/invoices";

const T = "con-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Contractor", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "contractor", medicineInvoiceAllowed: true,
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  db.prepare(`INSERT INTO products (id, tenant_id, name, packing, created_at, updated_at) VALUES ('p1', ?, 'Atropine Inj', 1, 'x', 'x')`).run(T);
});

test("a Medicine invoice line keeps its written batch apart from the stock batch", async () => {
  const inv = await invoicesRepo.create({
    invoice_no: 1, date: "2026-11-02", inv_on: "cash", invoice_type: "medicine", description: null, salesman_id: null, customer_id: null,
    customer_name: "Walk-in", total: 100, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: 100, paid: 100, balance: 0,
    is_return: 0, is_memorized: 0, converted_invoice_id: null,
  } as never);
  await invoiceItemsRepo.create({
    invoice_id: inv.id, product_id: "p1", batch_no: null, line_batch: "AT-2611", packing: 1, uom_id: null, avail_qty: null, qty: 1, bonus_qty: 0,
    purchase_price: 50, sale_price: 100, tax_pct: 0, further_tax_pct: 0, tax_rs: 0, discount_pct: 0, discount_rs: 0, total: 100,
  } as never);
  const [item] = await listItemsForInvoice(inv.id);
  assert.equal(item.line_batch, "AT-2611");
  assert.equal(item.batch_no, null);
  assert.equal((await invoicesRepo.get(inv.id))?.invoice_type, "medicine");
});
