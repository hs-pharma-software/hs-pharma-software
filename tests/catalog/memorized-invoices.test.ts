/** Memorized (draft) invoices hold no stock: converting one takes its items
 * from stock (all or nothing) and dates it today; deleting one puts nothing back. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { invoicesRepo, invoiceItemsRepo, convertMemorizedInvoice, deleteMemorizedInvoice, listInvoicesForGrid } from "@/lib/repo/invoices";
import { productBatchesRepo } from "@/lib/repo/products";
import type { Invoice, InvoiceItem } from "@/lib/types2";

const T = "pharm-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
  db.prepare(`INSERT INTO products (id, tenant_id, name, created_at, updated_at) VALUES ('p1', ?, 'Panadol', 'x', 'x'), ('p2', ?, 'Brufen', 'x', 'x')`).run(T, T);
  db.prepare(`INSERT INTO product_batches (id, tenant_id, product_id, batch_no, qty, created_at, updated_at) VALUES ('b1', ?, 'p1', 'A1', 10, 'x', 'x'), ('b2', ?, 'p2', 'B1', 3, 'x', 'x')`).run(T, T);
});

async function draft(lines: [string, string, number, number][]) {
  const inv = await invoicesRepo.create({
    invoice_no: 5, date: "2026-10-01", inv_on: "cash", invoice_type: "retail", total: 100, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0,
    payable: 100, paid: 100, balance: 0, is_return: 0, is_memorized: 1, is_quotation: 0,
  } as Partial<Invoice>);
  for (const [product_id, batch_no, qty, bonus_qty] of lines) {
    await invoiceItemsRepo.create({ invoice_id: inv.id, product_id, batch_no, packing: 1, qty, bonus_qty, purchase_price: 5, sale_price: 10, tax_pct: 0, further_tax_pct: 0, tax_rs: 0, discount_pct: 0, discount_rs: 0, total: qty * 10 } as Partial<InvoiceItem>);
  }
  return inv;
}
const qty = async (id: string) => (await productBatchesRepo.get(id))!.qty;

test("converting takes the items from stock and dates the invoice today", async () => {
  const d = await draft([["p1", "A1", 4, 1], ["p2", "B1", 2, 0]]);
  assert.equal((await listInvoicesForGrid({ isMemorized: true })).length, 1);
  const inv = await convertMemorizedInvoice(d.id, "2026-10-31");
  assert.deepEqual([inv.is_memorized, inv.date], [0, "2026-10-31"]);
  assert.deepEqual([await qty("b1"), await qty("b2")], [5, 1]);
  assert.equal((await listInvoicesForGrid({ isMemorized: true })).length, 0);
  await assert.rejects(convertMemorizedInvoice(d.id, "2026-10-31"), /already converted/);
});

test("not enough stock for one line: nothing is taken and the draft stays", async () => {
  const d = await draft([["p1", "A1", 4, 0], ["p2", "B1", 5, 0]]);
  await assert.rejects(convertMemorizedInvoice(d.id, "2026-10-31"), /Not enough stock.*Brufen \(batch B1\): need 5, in stock 3/);
  assert.deepEqual([await qty("b1"), await qty("b2")], [10, 3]);
  assert.equal((await invoicesRepo.get(d.id))!.is_memorized, 1);
});

test("deleting a draft puts no stock back", async () => {
  const d = await draft([["p1", "A1", 4, 0]]);
  await deleteMemorizedInvoice(d.id, "duplicate");
  assert.equal(await qty("b1"), 10);
  assert.equal(await invoicesRepo.get(d.id).then((x) => x?.deleted_at != null), true);
});
