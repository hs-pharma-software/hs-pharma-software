/** Pharmacy, after the client meeting (stage 2): the dashboard pop-up's day
 * figures and rate-change notices, and Pre Invoices (saved invoice patterns). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { pharmacyDaySummary, rateChanges } from "@/lib/repo/pharmacyDay";
import { deletePreInvoice, listPreInvoices, parsePreInvoiceLines, preInvoiceEstimate, savePreInvoice } from "@/lib/repo/preInvoices";
import { useFormTabs } from "@/store/formTabsStore";

const T = "pharm-a";
let db: DatabaseSync;
const tenant = (id: string): SessionTenant => ({
  id, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
});
const loginAs = (id: string) => useAuthStore.setState({ currentUser: { id: "u-" + id, username: "ali", displayName: "Ali", role: "owner", tenantId: id, permissions: null }, currentTenant: tenant(id) });
const run = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as never[]));

function sale(id: string, date: string, lines: [string, number, number, number][], isReturn = 0) {
  const total = lines.reduce((a, [, q, p]) => a + q * p, 0);
  run(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, is_return, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'x')`, id, T, date, total, total, isReturn, date);
  lines.forEach(([pid, q, p, cost], n) => run(`INSERT INTO invoice_items (id, tenant_id, invoice_id, product_id, qty, sale_price, purchase_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 'x')`, `${id}-${n}`, T, id, pid, q, p, cost));
}
function price(id: string, pid: string, p: number, at: string, tenantId = T) {
  run(`INSERT INTO price_list (id, tenant_id, product_id, sale_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x')`, id, tenantId, pid, p, at);
}
function purchase(id: string, date: string, pid: string, rate: number, isReturn = 0) {
  run(`INSERT INTO purchases (id, tenant_id, supplier_id, date, is_return, created_at, updated_at) VALUES (?, ?, 's1', ?, ?, ?, 'x')`, id, T, date, isReturn, `${date}T10:00:00.000Z`);
  run(`INSERT INTO purchase_items (id, tenant_id, purchase_id, product_id, purchase_price, received_qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 10, 'x', 'x')`, `${id}-0`, T, id, pid, rate);
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  loginAs(T);
  run(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES ('s1', ?, 'Muller & Phipps', 'x', 'x')`, T);
  for (const [id, name, packing] of [["pa", "Panadol 500", 10], ["pb", "Ceftriaxone 1g Inj", 1], ["pc", "Oxytocin Inj", 1]] as const) {
    run(`INSERT INTO products (id, tenant_id, name, packing, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'x')`, id, T, name, packing);
  }
});

test("today's sale and profit (returns taken off), and the last earlier day that had a sale", async () => {
  sale("i1", "2026-11-20", [["pa", 2, 100, 70]]);
  sale("i2", "2026-11-23", [["pa", 3, 100, 70], ["pb", 1, 500, 400]]);
  sale("i3", "2026-11-23", [["pa", 1, 100, 70]], 1);
  const { today, lastDay } = await pharmacyDaySummary("2026-11-23");
  assert.deepEqual([today.sales, today.profit, today.invoices], [700, 160, 1]);
  assert.deepEqual([lastDay?.date, lastDay?.sales], ["2026-11-20", 200]);
  assert.equal((await pharmacyDaySummary("2026-11-20")).lastDay, null);
});

test("rate changes: sale rates from the price history, purchase rates only when allowed, this business only", async () => {
  price("pl1", "pa", 100, "2026-10-01T09:00:00.000Z");
  price("pl2", "pa", 110, "2026-11-21T09:00:00.000Z");
  price("pl3", "pa", 110, "2026-11-22T09:00:00.000Z"); // same rate again: not a change
  price("pl4", "pb", 500, "2026-11-22T09:00:00.000Z"); // first price: not a change
  price("pl5", "pc", 90, "2026-10-01T09:00:00.000Z", "pharm-b");
  price("pl6", "pc", 95, "2026-11-22T09:00:00.000Z", "pharm-b");
  purchase("pu1", "2026-10-02", "pb", 400);
  purchase("pu2", "2026-11-22", "pb", 380);
  purchase("pr1", "2026-11-22", "pb", 350, 1); // a return: not a purchase rate

  const since = "2026-11-16T00:00:00.000Z";
  const saleOnly = await rateChanges(since, false);
  assert.deepEqual(saleOnly.map((c) => [c.productName, c.kind, c.oldRate, c.newRate]), [["Panadol 500", "sale", 100, 110]]);
  const all = await rateChanges(since, true);
  assert.deepEqual(all.map((c) => [c.productName, c.kind, c.oldRate, c.newRate, c.supplier]), [
    ["Ceftriaxone 1g Inj", "purchase", 400, 380, "Muller & Phipps"],
    ["Panadol 500", "sale", 100, 110, null],
  ]);
  assert.deepEqual(await rateChanges("2026-11-23T00:00:00.000Z", true), []);
});

test("pre invoices: saved, merged, named once, estimated at today's prices, used from the tab bar, and deleted", async () => {
  await assert.rejects(savePreInvoice({ name: " ", lines: [] }), /name/);
  await assert.rejects(savePreInvoice({ name: "Gynae", lines: [] }), /at least one product/);
  await assert.rejects(savePreInvoice({ name: "Gynae", lines: [{ productId: "pb", name: "Ceftriaxone", qty: 0, unit: "base" }] }), /quantity of Ceftriaxone/);
  const g = await savePreInvoice({
    name: "Gynae operation", description: "C-section",
    lines: [
      { productId: "pb", name: "Ceftriaxone 1g Inj", qty: 2, unit: "base" },
      { productId: "pc", name: "Oxytocin Inj", qty: 1, unit: "base" },
      { productId: "pb", name: "Ceftriaxone 1g Inj", qty: 1, unit: "base" },
      { productId: "pa", name: "Panadol 500", qty: 20, unit: "secondary" },
    ],
  });
  assert.deepEqual(g.lines.map((l) => [l.productId, l.qty, l.unit]), [["pb", 3, "base"], ["pc", 1, "base"], ["pa", 20, "secondary"]]);
  assert.equal(g.createdByName, "Ali");
  await assert.rejects(savePreInvoice({ name: "gynae operation ", lines: g.lines }), /already exists/);
  const renamed = await savePreInvoice({ id: g.id, name: "Gynae operation (C-section)", lines: g.lines });
  assert.equal(renamed.name, "Gynae operation (C-section)");

  price("pl1", "pa", 50, "2026-11-01T00:00:00.000Z");
  price("pl2", "pb", 500, "2026-11-01T00:00:00.000Z");
  price("pl3", "pc", 120, "2026-11-01T00:00:00.000Z");
  run(`INSERT INTO product_batches (id, tenant_id, product_id, qty, created_at, updated_at) VALUES ('b1', ?, 'pa', 5, 'x', 'x'), ('b2', ?, 'pb', 2, 'x', 'x')`, T, T);
  const e = await preInvoiceEstimate(renamed);
  assert.equal(e.total, 3 * 500 + 120 + 20 * 5);
  assert.deepEqual(e.outOfStock, ["Ceftriaxone 1g Inj", "Oxytocin Inj"]);

  useAuthStore.setState({ currentTenant: { ...tenant(T), allowedModules: ["invoices"] } });
  useFormTabs.setState({ tabs: [], activeId: null });
  useFormTabs.getState().openNewFromPreInvoice(g.id);
  useFormTabs.getState().openNewFromPreInvoice(g.id);
  assert.deepEqual(useFormTabs.getState().tabs.map((t) => [t.kind, t.preInvoiceId, t.seq]), [["invoice", g.id, 1], ["invoice", g.id, 2]]);

  loginAs("pharm-b");
  assert.deepEqual(await listPreInvoices(), []);
  loginAs(T);
  await deletePreInvoice(g.id);
  assert.deepEqual(await listPreInvoices(), []);
});

test("stored pre invoice lines are read defensively", () => {
  assert.deepEqual(parsePreInvoiceLines("not json"), []);
  assert.deepEqual(parsePreInvoiceLines(`[{"productId":"pa","qty":2},{"qty":1},{"productId":"pb","qty":0}]`), [{ productId: "pa", name: "", qty: 2, unit: "base" }]);
});
