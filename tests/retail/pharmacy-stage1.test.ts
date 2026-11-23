/** Pharmacy, after the client meeting (stage 1): the prescribing doctor on
 * narcotics invoices, a business's own flat discount per product, Stock in
 * Hand / Stock Register / Dead Stock reports, and initiated stock audits. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import type { Product } from "@/lib/types";
import { getEffectiveDiscountPct } from "@/lib/repo/categories";
import { listFlatDiscountProducts, productFlatDiscount, setFlatDiscount } from "@/lib/repo/flatDiscounts";
import { deadStock, groupRegister, groupStock, stockInHandProducts, stockRegister } from "@/lib/repo/stockReports";
import { auditCountLines, auditReport, auditsRepo, closeAudit, initiateAudit, saveAuditCounts } from "@/lib/repo/audits";
import { listNarcoticInvoices, recentDoctorNames } from "@/lib/repo/invoices";

const T = "pharm-a";
let db: DatabaseSync;
const tenant = (id: string): SessionTenant => ({
  id, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
});
const loginAs = (id: string) => useAuthStore.setState({ currentUser: { id: "u-" + id, username: "ali", displayName: "Ali", role: "owner", tenantId: id, permissions: null }, currentTenant: tenant(id) });
const run = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as never[]));

function product(id: string, name: string, company: string | null, generic: string | null, tenantId: string | null = T, extra = "") {
  run(`INSERT INTO products (id, tenant_id, name, company_name, description, created_at, updated_at${extra ? ", category_id" : ""}) VALUES (?, ?, ?, ?, ?, 'x', 'x'${extra ? ", ?" : ""})`,
    ...[id, tenantId, name, company, generic, ...(extra ? [extra] : [])]);
}
function batch(id: string, productId: string, qty: number, cost: number, expiry = "2028-01-31") {
  run(`INSERT INTO product_batches (id, tenant_id, product_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 'x')`, id, T, productId, id, expiry, qty, cost);
}
function purchase(id: string, date: string, supplierId: string, items: [string, number][], isReturn = 0) {
  run(`INSERT INTO purchases (id, tenant_id, supplier_id, date, is_return, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x')`, id, T, supplierId, date, isReturn, date);
  items.forEach(([pid, q], n) => run(`INSERT INTO purchase_items (id, tenant_id, purchase_id, product_id, received_qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')`, `${id}-${n}`, T, id, pid, q));
}
function sale(id: string, date: string, items: [string, number][], x: { isReturn?: number; doctor?: string; reg?: string } = {}) {
  run(`INSERT INTO invoices (id, tenant_id, invoice_no, date, is_return, doctor_name, doctor_reg_no, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'x')`,
    id, T, id.toUpperCase(), date, x.isReturn ?? 0, x.doctor ?? null, x.reg ?? null, date);
  items.forEach(([pid, q], n) => run(`INSERT INTO invoice_items (id, tenant_id, invoice_id, product_id, qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')`, `${id}-${n}`, T, id, pid, q));
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  loginAs(T);
  run(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES ('s1', ?, 'Muller & Phipps', 'x', 'x')`, T);
  product("pa", "Panadol 500", "GSK", "Paracetamol");
  product("pb", "Brufen 400", "Abbott", "Ibuprofen");
  product("pc", "Calpol Syrup", "GSK", "Paracetamol");
  batch("b-a1", "pa", 10, 20);
  batch("b-a2", "pa", 5, 22, "2027-03-31");
  batch("b-b1", "pb", 8, 50);
  batch("b-c1", "pc", 4, 80);
});

test("a business's own flat discount comes before the category's, 0 removes it, and other businesses don't see it", async () => {
  run(`INSERT INTO categories (id, tenant_id, name, flat_discount_pct, created_at, updated_at) VALUES ('cat', ?, 'Tablets', 5, 'x', 'x')`, T);
  run(`UPDATE products SET category_id = 'cat' WHERE id = 'pa'`);
  const pa = { id: "pa", category_id: "cat", sub_category_id: null } as unknown as Product;
  assert.equal(await getEffectiveDiscountPct(pa), 5);
  await assert.rejects(setFlatDiscount(["pa"], 120), /between 0 and 100/);
  assert.equal(await setFlatDiscount(["pa", "pb"], 12.5), 2);
  assert.equal(await setFlatDiscount(["pa"], 12.5), 0, "unchanged");
  assert.equal(await getEffectiveDiscountPct(pa), 12.5);
  const listed = await listFlatDiscountProducts({ onlyDiscounted: true });
  assert.deepEqual(listed.map((p) => [p.name, p.flat_discount_pct]), [["Brufen 400", 12.5], ["Panadol 500", 12.5]]);
  assert.equal(listed.find((p) => p.id === "pa")!.category_discount_pct, 5);

  loginAs("pharm-b");
  assert.equal(await productFlatDiscount("pa"), 0);

  loginAs(T);
  assert.equal(await setFlatDiscount(["pa"], 0), 1);
  assert.equal(await getEffectiveDiscountPct(pa), 5);
});

test("Stock in Hand: per product at cost and sale price, and by company, distributor and generic name", async () => {
  run(`INSERT INTO price_list (id, tenant_id, product_id, sale_price, created_at, updated_at) VALUES ('pl1', ?, 'pa', 25, '2026-01-01', 'x'), ('pl2', ?, 'pa', 30, '2026-06-01', 'x')`, T, T);
  purchase("pu1", "2026-10-01", "s1", [["pa", 15]]);
  const rows = await stockInHandProducts();
  const pa = rows.find((r) => r.id === "pa")!;
  assert.deepEqual([pa.qty, pa.cost, pa.retail, pa.batches, pa.nearestExpiry, pa.distributor, pa.generic], [15, 310, 450, 2, "2027-03-31", "Muller & Phipps", "Paracetamol"]);
  assert.deepEqual(groupStock(rows, "company").map((g) => [g.label, g.products, g.cost]), [["GSK", 2, 630], ["Abbott", 1, 400]]);
  assert.deepEqual(groupStock(rows, "generic").map((g) => [g.label, g.products]), [["Paracetamol", 2], ["Ibuprofen", 1]]);
  assert.deepEqual(groupStock(rows, "distributor").map((g) => g.label).sort(), ["Muller & Phipps", "No distributor"]);
  assert.deepEqual((await stockInHandProducts("ibupro")).map((r) => r.name), ["Brufen 400"]);
});

test("Stock Register: opening, received, sold, returns and closing for a period", async () => {
  // Today: Panadol 15. Oct: received 20, sold 6, sale return 1, purchase return 2. Nov (after the period): sold 3.
  purchase("pu1", "2026-10-02", "s1", [["pa", 20]]);
  purchase("pr1", "2026-10-20", "s1", [["pa", 2]], 1);
  sale("i1", "2026-10-05", [["pa", 6]]);
  sale("r1", "2026-10-06", [["pa", 1]], { isReturn: 1 });
  sale("i2", "2026-11-03", [["pa", 3]]);
  await assert.rejects(stockRegister("2026-10-31", "2026-10-01"), /before the From/);
  const rows = await stockRegister("2026-10-01", "2026-10-31");
  const pa = rows.find((r) => r.id === "pa")!;
  assert.deepEqual([pa.opening, pa.received, pa.saleReturns, pa.sold, pa.purchaseReturns, pa.closing], [5, 20, 1, 6, 2, 18]);
  const gsk = groupRegister(rows, "company").find((g) => g.label === "GSK")!;
  assert.deepEqual([gsk.products, gsk.opening, gsk.closing], [2, 9, 22]);
});

test("Dead Stock: products with stock and no sale since the date, never-sold first", async () => {
  sale("i1", "2026-10-10", [["pa", 1]]);
  sale("i2", "2026-11-15", [["pb", 1]]);
  const rows = await deadStock("2026-11-01");
  assert.deepEqual(rows.map((r) => [r.name, r.lastSale]), [["Calpol Syrup", null], ["Panadol 500", "2026-10-10"]]);
});

test("an initiated audit lists system stock, takes counts, closes, and reports the differences at cost", async () => {
  await assert.rejects(initiateAudit({ name: " " }), /audit name/);
  await assert.rejects(initiateAudit({ name: "X", company: "Nobody" }), /No product of Nobody/);
  const a = await initiateAudit({ name: "November audit", company: "GSK" });
  assert.equal(a.status, "open");
  const lines = await auditCountLines(a.id);
  assert.deepEqual(lines.map((l) => [l.product_name, l.system_qty, l.counted_qty]), [["Calpol Syrup", 4, null], ["Panadol 500", 15, null]]);
  const [calpol, panadol] = lines;
  assert.equal(panadol.unit_cost, 20.67);

  await assert.rejects(saveAuditCounts(a.id, { [panadol.id]: -1 }), /negative/);
  await saveAuditCounts(a.id, { [panadol.id]: 12 });
  await assert.rejects(closeAudit(a.id), /1 product is not counted/);
  const closed = await closeAudit(a.id, true);
  assert.deepEqual([closed.status, closed.closed_by_name], ["closed", "Ali"]);
  await assert.rejects(saveAuditCounts(a.id, { [calpol.id]: 4 }), /closed/);

  const r = await auditReport(a.id);
  assert.deepEqual([r.products, r.matched, r.short.n, r.short.qty, r.excess.n], [2, 0, 2, 7, 0]);
  assert.equal(r.short.amount, 382.01); // 3 × 20.67 + 4 × 80
  assert.equal(r.net, -382.01);
  // The audit reports; it does not change stock.
  assert.equal((await stockInHandProducts()).find((x) => x.id === "pa")!.qty, 15);
  assert.equal((await auditsRepo.get(a.id))!.audit_name, "November audit");
});

test("narcotics invoices carry the prescribing doctor, and known doctors are offered again", async () => {
  run(`UPDATE products SET is_narcotic = 1 WHERE id = 'pb'`);
  sale("i1", "2026-11-01", [["pb", 1]], { doctor: "Dr. Saima", reg: "12345-P" });
  sale("i2", "2026-11-02", [["pb", 1]], { doctor: "dr. saima " });
  sale("i3", "2026-11-03", [["pa", 1]]);
  const n = await listNarcoticInvoices();
  assert.deepEqual(n.map((x) => x.doctor_name).sort(), ["Dr. Saima", "dr. saima "]);
  const docs = await recentDoctorNames();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].regNo, "12345-P");
});
