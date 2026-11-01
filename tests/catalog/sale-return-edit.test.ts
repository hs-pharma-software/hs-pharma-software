/** Editing a sale return: stock follows the quantity, never beyond the
 * original bill, paid back within the total. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo } from "@/lib/repo/products";
import { receiveStock, listAvailableBatches } from "@/lib/repo/stock";
import { invoicesRepo, invoiceItemsRepo, editSaleReturn, listItemsForInvoice } from "@/lib/repo/invoices";

const tenant: SessionTenant = {
  id: "store-a", name: "Store", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "cloth_store",
};

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: "store-a", permissions: null }, currentTenant: tenant });
});

const stock = async (pid: string) => (await listAvailableBatches(pid)).reduce((t, b) => t + b.qty, 0);
const header = (extra: Record<string, unknown>) => ({
  date: "2026-11-01", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null, total: 0, charges: 0,
  discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: 0, paid: 0, balance: 0, is_memorized: 0, converted_invoice_id: null, ...extra,
});
const line = (invoiceId: string, productId: string, qty: number) => ({
  invoice_id: invoiceId, product_id: productId, batch_no: null, packing: 1, uom_id: null, avail_qty: null, qty, bonus_qty: 0,
  purchase_price: 1000, sale_price: 2000, tax_pct: 0, further_tax_pct: 0, tax_rs: 0, discount_pct: 0, discount_rs: 0, total: qty * 2000,
});

test("a return's quantity, date and paid back are changed; stock follows", async () => {
  const p = await productsRepo.create({ name: "Kurta - M", packing: 1 } as never);
  await receiveStock({ productId: p.id, batchNo: null, qty: 10, purchasePrice: 1000, expiryDate: null, location: null });
  const sale = await invoicesRepo.create(header({ invoice_no: 1, is_return: 0, total: 10000, payable: 10000, paid: 10000 }) as never);
  await invoiceItemsRepo.create(line(sale.id, p.id, 5) as never);
  // The return took 2 back into stock (12 now with the earlier 10 bought).
  const ret = await invoicesRepo.create(header({ invoice_no: 2, is_return: 1, original_invoice_id: sale.id, total: 4000, payable: 4000, paid: 0, balance: 4000 }) as never);
  const [item] = await Promise.all([invoiceItemsRepo.create(line(ret.id, p.id, 2) as never)]);
  await receiveStock({ productId: p.id, batchNo: null, qty: 2, purchasePrice: 1000, expiryDate: null, location: null });
  assert.equal(await stock(p.id), 12);

  await assert.rejects(editSaleReturn(ret.id, { date: "2026-11-02", paid: 0, description: null, lines: [{ itemId: item.id, qty: 6 }] }), /at most 5/);
  await assert.rejects(editSaleReturn(ret.id, { date: "2026-11-02", paid: 9000, description: null, lines: [{ itemId: item.id, qty: 3 }] }), /can't be more than the return total/);
  const r = await editSaleReturn(ret.id, { date: "2026-11-02", paid: 6000, description: "Wrong size", lines: [{ itemId: item.id, qty: 3 }] });
  assert.equal(r.total, 6000);
  assert.equal(r.balance, 0);
  assert.equal(r.date, "2026-11-02");
  assert.equal(r.description, "Wrong size");
  assert.equal(await stock(p.id), 13, "one more back in stock");
  await editSaleReturn(ret.id, { date: "2026-11-02", paid: 2000, description: null, lines: [{ itemId: item.id, qty: 1 }] });
  assert.equal(await stock(p.id), 11, "two out of stock again");
  assert.equal((await listItemsForInvoice(ret.id))[0].qty, 1);
  await assert.rejects(editSaleReturn(ret.id, { date: "2026-11-02", paid: 0, description: null, lines: [{ itemId: item.id, qty: 0 }] }), /at least one item/);
});
