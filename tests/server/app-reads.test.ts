/** What the Android app reads (src/server/appReads.ts): the start-up bundle and
 * products, run the way production runs them (policy check, business/branch
 * rewrite, purchase prices removed for logins without them). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import * as br from "@/server/branches";
import { analyzeSql, authorize, costHidden, type Caller } from "@/server/sqlPolicy";
import { scopeStatement, type Schema, type Scope } from "@/server/tenantScope";
import { sharedCatalogGroupsFor } from "@/lib/catalogAccess";
import { appBootstrap, appDashboard, createParty, invoiceDetail, listInvoices, listProducts, productDetail, searchParties } from "@/server/appReads";
import { requireModule } from "@/server/appDocs";
import type { Res, Runner, Stmt } from "@/server/appDocs";

const T = "2026-11-21T08:00:00.000Z";
let db: DatabaseSync;
let schema: Schema;
let known: Set<string>;
const owner: Caller = { userId: "u-own", role: "owner", tenantId: "t1", businessType: "retail_pharmacy" };
// A cashier: Invoices and Stock only, no purchase prices.
const cashier: Caller = { userId: "u-cash", role: "staff", tenantId: "t1", businessType: "retail_pharmacy", permissions: ["dashboard", "invoices", "stock"], actions: [] };
const r = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));

function seed() {
  r(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('basic', 'Basic', 0, 30, '[]', 2, ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t1', 'Al-Shifa Pharmacy', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t2', 'Other', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO users (id, tenant_id, username, display_name, password_hash, password_salt, role, is_active, created_at, updated_at) VALUES ('u-own', 't1', 'own', 'Ahmed', 'x', 'x', 'owner', 1, ?, ?)`, T, T);
  r(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, is_active, permissions, created_at, updated_at) VALUES ('u-cash', 't1', 'cash', 'x', 'x', 'staff', 1, '["dashboard","invoices","stock"]', ?, ?)`, T, T);
  r(`INSERT INTO settings (key, value, updated_at) VALUES ('t1::billori_enabled', 'false', ?)`, T);
  r(`INSERT INTO settings (key, value, updated_at) VALUES ('t1::print_logo', 'data:image/png;base64,iVBORw0KGgo=', ?)`, T);
  const names = ["Panadol", "Risek", "Augmentin", "Brufen", "Calpol"];
  names.forEach((n, i) => r(`INSERT INTO products (id, name, tenant_id, packing, barcode, created_at, updated_at) VALUES (?, ?, 't1', 10, ?, ?, ?)`, `p${i}`, n, `89600${i}`, T, T));
  r(`INSERT INTO products (id, name, tenant_id, packing, created_at, updated_at) VALUES ('p-other', 'Not ours', 't2', 1, ?, ?)`, T, T);
  r(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, created_at, updated_at) VALUES ('pl1', 'p0', 't1', 300, '2026-01-01', '2026-01-01')`);
  r(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, created_at, updated_at) VALUES ('pl2', 'p0', 't1', 350, '2026-06-01', '2026-06-01')`);
  r(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES ('b1', 'p0', 't1', 'PN-B', '2028-05-31', 30, 300, ?, ?)`, T, T);
  r(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES ('b2', 'p0', 't1', 'PN-A', '2027-11-30', 18, 290, ?, ?)`, T, T);
  r(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES ('b3', 'p0', 't1', 'PN-0', '2027-01-31', 0, 280, ?, ?)`, T, T);
}

async function runner(caller: Caller): Promise<Runner> {
  const branch: Scope["branch"] = await br.branchScopeFor(sqliteSql(db), caller, null).catch(() => undefined);
  const scope: Scope = { tenantId: caller.tenantId!, sharedGroups: sharedCatalogGroupsFor(caller.businessType), linkedPharmacies: [], branch };
  const hide = costHidden(caller);
  const exec = (s: Stmt): Res => {
    const d = authorize(analyzeSql(s.sql), caller, known);
    if (!d.ok) throw new Error(`policy: ${d.reason} :: ${s.sql.slice(0, 120)}`);
    const rows = db.prepare(scopeStatement(s.sql, s.args, scope, schema)).all(...(s.args as never[])) as Record<string, unknown>[];
    // As runForCaller: purchase prices leave the answer for logins without them.
    const columns = rows[0] ? Object.keys(rows[0]).filter((c) => !(hide && c === "purchase_price")) : [];
    return { columns, rows: rows.map((row) => columns.map((c) => row[c])), rowsAffected: 0 };
  };
  return async (stmts) => stmts.map(exec);
}

beforeEach(() => {
  db = fullSchemaDb();
  seed();
  br.clearBranchCache();
  schema = new Map();
  for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]) {
    schema.set(name.toLowerCase(), new Set((db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name.toLowerCase())));
  }
  known = new Set(schema.keys());
});

test("products: a page at a time by name, quantity from batches with stock, the newest sale price, never another business's", async () => {
  const run = await runner(owner);
  const first = await listProducts(run, "t1", { limit: 2 });
  assert.deepEqual(first.rows.map((x) => x.name), ["Augmentin", "Brufen"]);
  assert.equal(first.nextOffset, 2);
  const last = await listProducts(run, "t1", { offset: 4, limit: 2 });
  assert.deepEqual(last.rows.map((x) => x.name), ["Risek"]);
  assert.equal(last.nextOffset, null);
  const pan = (await listProducts(run, "t1", { search: "pana" })).rows;
  assert.deepEqual(pan.map((x) => [x.name, x.qty, x.salePrice]), [["Panadol", 48, 350]]);
  assert.deepEqual((await listProducts(run, "t1", { search: "896003" })).rows.map((x) => x.name), ["Brufen"], "by barcode");
  assert.equal((await listProducts(run, "t1", { search: "Not ours" })).rows.length, 0);
});

test("product detail: batches with stock, earliest expiry first; purchase prices only for logins allowed to see them", async () => {
  const own = await productDetail(await runner(owner), "t1", "p0");
  assert.equal(own.qty, 48);
  assert.deepEqual(own.batches.map((b) => [b.batchNo, b.qty, b.purchasePrice]), [["PN-A", 18, 290], ["PN-B", 30, 300]]);
  const cash = await productDetail(await runner(cashier), "t1", "p0");
  assert.deepEqual(cash.batches.map((b) => b.purchasePrice), [null, null]);
  await assert.rejects(productDetail(await runner(owner), "t1", "p-other"), /not found/i);
  await assert.rejects(productDetail(await runner(owner), "t1", "x' OR 1=1"), /Invalid product/);
});

test("bootstrap: the business, the login's own menu (native screens marked), branches and settings", async () => {
  const sql = sqliteSql(db);
  const b = await appBootstrap(sql, owner, null);
  assert.equal(b.business.name, "Al-Shifa Pharmacy");
  assert.equal(b.business.type, "retail_pharmacy");
  assert.equal(b.user.name, "Ahmed");
  assert.equal(b.business.logo, "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(b.settings.billoriEnabled, false, "Billori off follows the business setting");
  const keys = b.sections.map((s) => s.key);
  assert.ok(keys.includes("invoices") && keys.includes("purchase"));
  assert.equal(b.sections.find((s) => s.key === "invoices")!.native, true);
  assert.ok(b.sections.some((s) => !s.native), "other sections open the web screens");
  assert.equal(b.costHidden, false);
  assert.equal(b.branches.list.length >= 1, true);

  const c = await appBootstrap(sql, cashier, null);
  assert.deepEqual(c.sections.map((s) => s.key).filter((k) => ["purchase", "invoices", "stock"].includes(k)).sort(), ["invoices", "stock"], "a cashier sees only the sections allowed");
  assert.equal(c.costHidden, true);
});

test("home: today's sales and money in/out, low stock, expiring batches, recent invoices; staff need the Dashboard section", async () => {
  r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('i1', 't1', 1, '2026-11-21', 1000, 1000, 1000, 0, 0, 0, 0, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('i2', 't1', 2, '2026-11-21', 500, 500, 200, 300, 0, 0, 0, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('i-old', 't1', 3, '2026-11-20', 9999, 9999, 9999, 0, 0, 0, 0, '2026-11-20', '2026-11-20')`);
  r(`INSERT INTO expenses (id, tenant_id, date, amount, created_at, updated_at) VALUES ('e1', 't1', '2026-11-21', 150, ?, ?)`, T, T);
  const d = await appDashboard(await runner(owner), owner, "2026-11-21");
  assert.deepEqual(d.summary, { sales: 1500, invoiceCount: 2, expenses: 150, cashIn: 1200, cashOut: 150 });
  assert.ok(d.lowStock.some((x) => x.name === "Risek" && x.qty === 0), "a product with no stock is low");
  assert.ok(!d.lowStock.some((x) => x.name === "Panadol"), "48 in stock is not low");
  assert.deepEqual(d.expiring.map((x) => x.batchNo), [], "nothing expires within 180 days of the 21st");
  assert.deepEqual(d.recentInvoices.slice(0, 2).map((x) => x.invoiceNo).sort(), [1, 2]);
  // No customers or suppliers yet: nothing owed; 5 products of this business.
  assert.deepEqual(d.totals, { receivable: 0, payable: 0, products: 5, customers: 0, suppliers: 0 });
  await assert.rejects(appDashboard(await runner({ ...cashier, permissions: ["invoices"] }), { ...cashier, permissions: ["invoices"] }, "2026-11-21"), /no access to the Dashboard/);
});

test("sales: newest first, by invoice number or customer, no returns or other businesses; one invoice with its items", async () => {
  r(`INSERT INTO customers (id, tenant_id, name, phone, created_at, updated_at) VALUES ('c1', 't1', 'Bilal Medical', '03001234567', ?, ?)`, T, T);
  const inv = (id: string, t: string, no: number, extra: string, at: string) =>
    r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, customer_id, customer_name, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES (?, ?, ?, '2026-11-21', ${extra}, 500, 500, 200, 300, ?, 0, 0, ?, ?)`, id, t, no, id === "i-ret" ? 1 : 0, at, at);
  inv("i1", "t1", 1, "NULL, 'Ali'", "2026-11-21T08:00:00Z");
  inv("i2", "t1", 2, "'c1', NULL", "2026-11-21T09:00:00Z");
  inv("i-ret", "t1", 3, "NULL, NULL", "2026-11-21T10:00:00Z");
  inv("i-other", "t2", 9, "NULL, 'Ali'", "2026-11-21T11:00:00Z");
  r(`INSERT INTO invoice_items (id, invoice_id, product_id, tenant_id, batch_no, qty, packing, sale_price, discount_rs, tax_rs, total, created_at, updated_at) VALUES ('ii1', 'i2', 'p0', 't1', 'PN-A', 0.2, 10, 350, 0, 0, 70, ?, ?)`, T, T);
  const run = await runner(owner);
  const all = await listInvoices(run, "t1", {});
  assert.deepEqual(all.rows.map((x) => [x.invoiceNo, x.customer]), [[2, "Bilal Medical"], [1, "Ali"]]);
  assert.equal(all.nextOffset, null);
  assert.deepEqual((await listInvoices(run, "t1", { search: "#1" })).rows.map((x) => x.invoiceNo), [1]);
  assert.deepEqual((await listInvoices(run, "t1", { search: "bilal" })).rows.map((x) => x.invoiceNo), [2]);
  assert.deepEqual((await listInvoices(run, "t1", { search: "0300123" })).rows.map((x) => x.invoiceNo), [2]);
  const d = await invoiceDetail(run, "t1", "i2");
  assert.equal(d.phone, "03001234567");
  assert.equal(d.balance, 300);
  assert.deepEqual(d.items.map((i) => [i.product, i.qty, i.packing, i.total]), [["Panadol", 0.2, 10, 70]]);
  await assert.rejects(invoiceDetail(run, "t1", "i-other"), /not found/);
  await assert.rejects(invoiceDetail(run, "t1", "x' OR 1=1"), /Invalid invoice/);
  assert.throws(() => requireModule({ ...cashier, permissions: ["stock"] }, "invoices"), /no access to Invoices/);
  assert.doesNotThrow(() => requireModule(cashier, "invoices"));
});

test("customers and suppliers: by name or phone, this business only", async () => {
  r(`INSERT INTO customers (id, tenant_id, name, phone, created_at, updated_at) VALUES ('c1', 't1', 'Bilal Medical', '03001234567', ?, ?)`, T, T);
  r(`INSERT INTO customers (id, tenant_id, name, phone, created_at, updated_at) VALUES ('c2', 't2', 'Bilal Other', '0300', ?, ?)`, T, T);
  r(`INSERT INTO suppliers (id, tenant_id, name, company_name, created_at, updated_at) VALUES ('s1', 't1', 'Muller & Phipps', 'M&P', ?, ?)`, T, T);
  const run = await runner(owner);
  assert.deepEqual((await searchParties(run, "t1", "customer", "bilal")).map((x) => x.id), ["c1"]);
  assert.deepEqual((await searchParties(run, "t1", "customer", "0300123")).map((x) => x.id), ["c1"]);
  assert.deepEqual((await searchParties(run, "t1", "supplier", null)).map((x) => [x.name, x.detail]), [["Muller & Phipps", "M&P"]]);
  r(`INSERT INTO salesmen (id, tenant_id, name, phone, created_at, updated_at) VALUES ('sm1', 't1', 'Imran', '0300', ?, ?)`, T, T);
  assert.deepEqual((await searchParties(run, "t1", "salesman", null)).map((x) => x.name), ["Imran"]);
  // The invoice form's "+": a new customer and salesman of this business.
  const c = await createParty(run, "t1", "customer", { name: " Hamza ", phone: "03211234567" });
  assert.equal(c.name, "Hamza");
  assert.equal((db.prepare(`SELECT tenant_id FROM customers WHERE id = ?`).get(c.id) as { tenant_id?: string } | undefined)?.tenant_id, "t1");
  await createParty(run, "t1", "salesman", { name: "Zain" });
  assert.deepEqual((await searchParties(run, "t1", "salesman", null)).map((x) => x.name), ["Imran", "Zain"]);
  await assert.rejects(createParty(run, "t1", "customer", { name: "" }), /Enter the name/);
  await assert.rejects(createParty(run, "t1", "customer", { name: "X", phone: "12" }), /03XXXXXXXXX/);
});

test("home: what customers owe and what is owed to suppliers (opening balance + unpaid bills - payments), top selling", async () => {
  r(`INSERT INTO customers (id, tenant_id, name, opening_balance, created_at, updated_at) VALUES ('c1', 't1', 'Bilal', 100, ?, ?)`, T, T);
  r(`INSERT INTO suppliers (id, tenant_id, name, opening_balance, created_at, updated_at) VALUES ('s1', 't1', 'Distributor', 0, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, customer_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('i1', 't1', 'c1', 1, '2026-11-21', 500, 500, 200, 300, 0, 0, 0, ?, ?)`, T, T);
  r(`INSERT INTO invoice_items (id, invoice_id, product_id, tenant_id, qty, sale_price, total, created_at, updated_at) VALUES ('ii1', 'i1', 'p0', 't1', 2, 250, 500, ?, ?)`, T, T);
  r(`INSERT INTO ledger_adjustments (id, tenant_id, party_type, party_id, paid_amount, date, created_at, updated_at) VALUES ('la1', 't1', 'customer', 'c1', 50, '2026-11-21', ?, ?)`, T, T);
  r(`INSERT INTO purchases (id, tenant_id, supplier_id, purchase_no, date, balance, is_return, created_at, updated_at) VALUES ('pu1', 't1', 's1', 1, '2026-11-21', 1200, 0, ?, ?)`, T, T);
  const d = await appDashboard(await runner(owner), owner, "2026-11-21");
  assert.equal(d.totals.receivable, 350);
  assert.equal(d.totals.payable, 1200);
  assert.equal(d.totals.customers, 1);
  assert.deepEqual(d.topSelling.map((x) => [x.name, x.qty, x.sales]), [["Panadol", 2, 500]]);
});
