/** The website's reports for the Android app (src/server/appReports.ts), run
 * the way production runs them (policy check, business/branch rewrite). The
 * numbers follow the web's rules: returns subtract, drafts are not sales, a
 * line takes its share of the bill discount. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import * as br from "@/server/branches";
import { analyzeSql, authorize, costHidden, type Caller } from "@/server/sqlPolicy";
import { scopeStatement, type Schema, type Scope } from "@/server/tenantScope";
import { sharedCatalogGroupsFor } from "@/lib/catalogAccess";
import { appReport, REPORTS } from "@/server/appReports";
import { requireModule, type Res, type Runner, type Stmt } from "@/server/appDocs";

const T = "2026-11-21T08:00:00.000Z";
let db: DatabaseSync;
let schema: Schema;
let known: Set<string>;
const owner: Caller = { userId: "u-own", role: "owner", tenantId: "t1", businessType: "retail_pharmacy" };
const r = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));

function seed() {
  r(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('basic', 'Basic', 0, 30, '[]', 2, ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t1', 'Al-Shifa Pharmacy', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t2', 'Other', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO categories (id, tenant_id, name, created_at, updated_at) VALUES ('cat1', 't1', 'Tablets', ?, ?)`, T, T);
  r(`INSERT INTO products (id, name, tenant_id, packing, category_id, company_name, created_at, updated_at) VALUES ('p1', 'Panadol', 't1', 10, 'cat1', 'GSK', ?, ?)`, T, T);
  r(`INSERT INTO products (id, name, tenant_id, packing, created_at, updated_at) VALUES ('p2', 'Risek', 't1', 14, ?, ?)`, T, T);
  r(`INSERT INTO customers (id, tenant_id, name, opening_balance, created_at, updated_at) VALUES ('c1', 't1', 'Bilal', 0, ?, ?)`, T, T);
  const inv = (id: string, no: number, date: string, total: number, disc: number, ret: number, memo: number, customer: string | null) =>
    r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, customer_id, total, discount_rs, payable, paid, balance, tax_pct, is_return, is_memorized, is_quotation, created_at, updated_at)
       VALUES (?, 't1', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, ?, ?)`, id, no, date, customer, total, disc, total - disc, total - disc, ret, memo, T, T);
  const item = (id: string, invId: string, p: string, qty: number, price: number, cost: number, tax = 0, bonus = 0, disc = 0) =>
    r(`INSERT INTO invoice_items (id, invoice_id, product_id, tenant_id, qty, bonus_qty, sale_price, purchase_price, tax_rs, discount_rs, total, created_at, updated_at)
       VALUES (?, ?, ?, 't1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, invId, p, qty, bonus, price, cost, tax, disc, qty * price - disc, T, T);
  // Nov: Panadol 2 x 100 (cost 70) and Risek 1 x 300 (cost 200), Rs 50 bill discount; a return of 1 Panadol; a draft.
  inv("i1", 1, "2026-11-10", 500, 50, 0, 0, "c1");
  item("ii1", "i1", "p1", 2, 100, 70, 17, 1);
  item("ii2", "i1", "p2", 1, 300, 200);
  inv("i2", 2, "2026-11-12", 100, 0, 1, 0, "c1");
  item("ii3", "i2", "p1", 1, 100, 70);
  inv("i3", 3, "2026-11-15", 1000, 0, 0, 1, null);
  item("ii4", "i3", "p2", 2, 500, 200);
  // October: outside the range.
  inv("i0", 9, "2026-10-01", 900, 0, 0, 0, null);
  item("ii0", "i0", "p1", 9, 100, 70);
  r(`INSERT INTO expenses (id, tenant_id, date, amount, created_at, updated_at) VALUES ('e1', 't1', '2026-11-11', 40, ?, ?)`, T, T);
  r(`INSERT INTO revenues (id, tenant_id, date, amount, created_at, updated_at) VALUES ('rv1', 't1', '2026-11-11', 15, ?, ?)`, T, T);
  r(`INSERT INTO cash_register_entries (id, tenant_id, date, transaction_type, amount, created_at, updated_at) VALUES ('cr1', 't1', '2026-11-10', 'in', 450, ?, ?)`, T, T);
  r(`INSERT INTO product_batches (id, product_id, tenant_id, batch_no, qty, purchase_price, created_at, updated_at) VALUES ('b1', 'p1', 't1', 'A', 10, 70, ?, ?)`, T, T);
  // Another business's sale must never count.
  r(`INSERT INTO products (id, name, tenant_id, packing, created_at, updated_at) VALUES ('px', 'Theirs', 't2', 1, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('ix', 't2', 1, '2026-11-10', 9999, 9999, 0, 0, 0, ?, ?)`, T, T);
}

async function runner(caller: Caller): Promise<Runner> {
  const branch: Scope["branch"] = await br.branchScopeFor(sqliteSql(db), caller, null).catch(() => undefined);
  const scope: Scope = { tenantId: caller.tenantId!, sharedGroups: sharedCatalogGroupsFor(caller.businessType), linkedPharmacies: [], branch };
  const hide = costHidden(caller);
  const exec = (s: Stmt): Res => {
    const d = authorize(analyzeSql(s.sql), caller, known);
    if (!d.ok) throw new Error(`policy: ${d.reason} :: ${s.sql.slice(0, 120)}`);
    const rows = db.prepare(scopeStatement(s.sql, s.args, scope, schema)).all(...(s.args as never[])) as Record<string, unknown>[];
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

const FROM = "2026-11-01";
const TO = "2026-11-30";

test("every report runs through the policy and answers columns and rows", async () => {
  const run = await runner(owner);
  for (const { key, title } of REPORTS) {
    const rep = await appReport(run, "t1", key, FROM, TO);
    assert.equal(rep.title, title);
    assert.ok(rep.columns.length >= 2, key);
    for (const row of rep.rows) for (const c of rep.columns) assert.ok(c.key in row, `${key}: ${c.key}`);
  }
  await assert.rejects(appReport(run, "t1", "nope", null, null), /not found/);
  await assert.rejects(appReport(run, "t1", "tax", "2026-11", null), /Invalid date/);
});

test("business profit/loss: net sales after discounts and returns, cost, expenses, other revenue, drafts apart", async () => {
  const rep = await appReport(await runner(owner), "t1", "business-profit-loss", FROM, TO);
  const v = Object.fromEntries(rep.rows.map((x) => [String(x.metric), Number(x.amount)]));
  // Sales 500 - 50 bill discount = 450; return 100: net 350. Cost 140 + 200 - 70 = 270.
  assert.equal(v["Net Sales"], 350);
  assert.equal(v["Cost of Goods Sold"], 270);
  assert.equal(v["Gross Profit"], 80);
  assert.equal(v["Expenses"], 40);
  assert.equal(v["Other Revenue"], 15);
  assert.equal(v["Net Profit / Loss"], 55);
  assert.equal(v["Memorized Invoices Total (1 draft, not in sales)"], 1000);
});

test("product profit/loss and sales: the bill discount shared by line value, returns subtract, other months and businesses left out", async () => {
  const run = await runner(owner);
  const pl = await appReport(run, "t1", "product-profit-loss", FROM, TO);
  const pan = pl.rows.find((x) => x.name === "Panadol")!;
  // Panadol: 200 less its share of 50 (200/500 = 20) = 180, less the return 100 = 80; qty 2 - 1 = 1; cost 140 - 70 = 70.
  assert.deepEqual([pan.qty, pan.sales, pan.cogs, pan.profit], [1, 80, 70, 10]);
  assert.equal(pl.totals!.sales, 350);
  const sales = await appReport(run, "t1", "product-sales", FROM, TO);
  assert.deepEqual(sales.rows.map((x) => [x.name, x.sales]), [["Risek", 270], ["Panadol", 80]]);
  const company = await appReport(run, "t1", "company-profit-loss", FROM, TO);
  assert.deepEqual(company.rows.map((x) => x.name).sort(), ["GSK", "Unspecified"]);
});

test("tax, bonus/discount, trial balance and balance sheet", async () => {
  const run = await runner(owner);
  const tax = await appReport(run, "t1", "tax", FROM, TO);
  assert.deepEqual(tax.rows, [{ month: "2026-11", sales_tax: 17, wht_collected: 0 }]);
  const bonus = await appReport(run, "t1", "bonus-discount", FROM, TO);
  assert.deepEqual(bonus.rows.map((x) => [x.name, x.bonus_qty, x.bonus_value]), [["Panadol", 1, 100]]);
  const tb = await appReport(run, "t1", "trial-balance", null, null);
  assert.equal(tb.dates, "none");
  assert.deepEqual(tb.rows.find((x) => x.account === "Cash In Hand"), { account: "Cash In Hand", debit: 450, credit: 0 });
  const bs = await appReport(run, "t1", "balance-sheet", null, TO);
  const v = Object.fromEntries(bs.rows.map((x) => [String(x.account), Number(x.amount)]));
  assert.equal(v["Stock Value"], 700);
  assert.equal(v["Total Assets"], v["Cash In Hand"] + v["Cash In Bank"] + v["Accounts Receivable"] + v["Stock Value"]);
});

test("staff need the Reports section", () => {
  const cashier: Caller = { userId: "u", role: "staff", tenantId: "t1", businessType: "retail_pharmacy", permissions: ["invoices"], actions: [] };
  assert.throws(() => requireModule(cashier, "reports"), /no access to Reports/);
  assert.doesNotThrow(() => requireModule({ ...cashier, permissions: ["reports"] }, "reports"));
});
