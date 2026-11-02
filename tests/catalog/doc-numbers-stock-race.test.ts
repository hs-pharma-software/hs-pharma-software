/** Bill numbers are never reused or shared, and stock changes made at the
 * same moment add up (one statement each, no lost update). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo, productBatchesRepo } from "@/lib/repo/products";
import { deductStock, restoreStock, receiveStock } from "@/lib/repo/stock";
import { invoicesRepo, nextInvoiceNo } from "@/lib/repo/invoices";
import { purchasesRepo, nextPurchaseNo } from "@/lib/repo/purchases";

const tenant: SessionTenant = {
  id: "ph-a", name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: "ph-a", permissions: null }, currentTenant: tenant });
});

const bill = (no: number) => invoicesRepo.create({
  invoice_no: no, date: "2026-11-02", inv_on: "cash", invoice_type: "retail", description: null, salesman_id: null, customer_id: null,
  total: 1, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: 1, paid: 1, balance: 0, is_return: 0, is_memorized: 0, converted_invoice_id: null,
} as never);

test("a deleted bill's number is not given out again", async () => {
  await bill(await nextInvoiceNo());
  const second = await bill(await nextInvoiceNo());
  assert.equal(second.invoice_no, 2);
  await invoicesRepo.remove(second.id);
  assert.equal(await nextInvoiceNo(), 3);
});

test("two bills saved with the same number: the later one takes the next", async () => {
  const no = await nextInvoiceNo();
  const [a, b] = await Promise.all([bill(no), bill(no)]);
  assert.notEqual(a.invoice_no, b.invoice_no);
  assert.deepEqual([Number(a.invoice_no), Number(b.invoice_no)].sort(), [1, 2]);
  const stored = await invoicesRepo.list();
  assert.equal(new Set(stored.map((i) => i.invoice_no)).size, 2);
});

test("purchase numbers likewise", async () => {
  const mk = (no: number) => purchasesRepo.create({ purchase_no: no, supplier_id: null, date: "2026-11-02", payable: 0, paid_amount: 0, balance: 0, is_return: 0 } as never);
  const no = await nextPurchaseNo();
  const [a, b] = await Promise.all([mk(no), mk(no)]);
  assert.notEqual(a.purchase_no, b.purchase_no);
  await purchasesRepo.remove(b.id);
  assert.equal(await nextPurchaseNo(), 3);
});

test("stock taken and put back at the same moment adds up; never below zero", async () => {
  const p = await productsRepo.create({ name: "Panadol", packing: 1 } as never);
  const b = await productBatchesRepo.create({ product_id: p.id, batch_no: "B1", expiry_date: null, qty: 10, location: null, purchase_price: 5 });
  const takes = await Promise.allSettled(Array.from({ length: 15 }, () => deductStock(b.id, 1)));
  assert.equal(takes.filter((t) => t.status === "fulfilled").length, 10);
  assert.equal((await productBatchesRepo.get(b.id))?.qty, 0);
  await Promise.all([restoreStock(b.id, 2), restoreStock(b.id, 3)]);
  assert.equal((await productBatchesRepo.get(b.id))?.qty, 5);
  const again = await receiveStock({ productId: p.id, batchNo: "B1", qty: 4, purchasePrice: 6, expiryDate: "2028-01-31", location: null });
  assert.equal(again.qty, 9);
  assert.equal(again.purchase_price, 6);
  assert.equal(again.expiry_date, "2028-01-31");
});

test("orders, bookings, lab visits and tokens saved at the same moment get their own numbers", async () => {
  const { savePatient, saveAppointment, doctorsRepo } = await import("@/lib/repo/clinic");
  const { saveClinicService, addClinicOrder } = await import("@/lib/repo/clinicServices");
  const { saveConsultation } = await import("@/lib/repo/clinic");
  const p = await savePatient(null, { name: "A" });
  const d = await doctorsRepo.create({ name: "Dr. X" });
  const [a1, a2] = await Promise.all([
    saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: "2026-11-02", status: "scheduled", type: "routine" }),
    saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: "2026-11-02", status: "scheduled", type: "routine" }),
  ]);
  assert.notEqual(a1.token_no, a2.token_no, "tokens");
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: d.id, date: "2026-11-02" });
  const s = await saveClinicService(null, { name: "Hb", category: "lab", rate: 100 });
  const [o1, o2] = await Promise.all([addClinicOrder({ consultationId: c.id, serviceId: s.id }), addClinicOrder({ consultationId: c.id, serviceId: s.id })]);
  assert.notEqual(o1.order_no, o2.order_no, "clinic orders");
});
