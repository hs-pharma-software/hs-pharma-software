/** The website's list pages and Submit to FBR for the Android app
 * (src/server/appLists.ts, appFbr.ts), run the way production runs them. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import * as br from "@/server/branches";
import { analyzeSql, authorize, costHidden, type Caller } from "@/server/sqlPolicy";
import { scopeStatement, type Schema, type Scope } from "@/server/tenantScope";
import { sharedCatalogGroupsFor } from "@/lib/catalogAccess";
import { appList, LIST_KEYS, purchaseDetail } from "@/server/appLists";
import { appFbrSubmit, fbrAvailable } from "@/server/appFbr";
import type { Res, Runner, Stmt } from "@/server/appDocs";

const T = "2026-11-21T08:00:00.000Z";
let db: DatabaseSync;
let schema: Schema;
let known: Set<string>;
const owner: Caller = { userId: "u-own", role: "owner", tenantId: "t1", businessType: "retail_pharmacy" };
const r = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));

function seed() {
  r(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('basic', 'Basic', 0, 30, '[]', 2, ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t1', 'A', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t2', 'B', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES ('s1', 't1', 'Distributor', ?, ?)`, T, T);
  r(`INSERT INTO products (id, name, tenant_id, packing, company_name, is_narcotic, created_at, updated_at) VALUES ('p1', 'Tramal', 't1', 10, 'Searle', 1, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, customer_name, customer_phone, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('i1', 't1', 1, '2026-11-20', 'Ali', '03001234567', 100, 100, 100, 0, 0, 0, 0, ?, ?)`, T, T);
  r(`INSERT INTO invoice_items (id, invoice_id, product_id, tenant_id, qty, sale_price, total, created_at, updated_at) VALUES ('ii1', 'i1', 'p1', 't1', 0.2, 500, 100, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('i2', 't1', 2, '2026-11-20', 50, 50, 50, 0, 1, 0, 0, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('ix', 't2', 1, '2026-11-20', 50, 50, 50, 0, 1, 0, 0, ?, ?)`, T, T);
  r(`INSERT INTO purchases (id, tenant_id, supplier_id, purchase_no, date, supplier_invoice_no, payable, paid_amount, balance, is_return, created_at, updated_at) VALUES ('pu1', 't1', 's1', 1, '2026-11-20', 'D-77', 1000, 400, 600, 0, ?, ?)`, T, T);
  r(`INSERT INTO purchase_items (id, tenant_id, purchase_id, product_id, batch_no, received_qty, purchase_price, total, created_at, updated_at) VALUES ('pi1', 't1', 'pu1', 'p1', 'B1', 2, 500, 1000, ?, ?)`, T, T);
  r(`INSERT INTO banks (id, tenant_id, name, account_no, opening_balance, created_at, updated_at) VALUES ('bk1', 't1', 'HBL', '0012', 1000, ?, ?)`, T, T);
  r(`INSERT INTO bank_ledger_entries (id, tenant_id, bank_id, date, transaction_type, amount, created_at, updated_at) VALUES ('bl1', 't1', 'bk1', '2026-11-20', 'deposit', 500, ?, ?)`, T, T);
  r(`INSERT INTO bank_ledger_entries (id, tenant_id, bank_id, date, transaction_type, amount, created_at, updated_at) VALUES ('bl2', 't1', 'bk1', '2026-11-20', 'withdraw', 200, ?, ?)`, T, T);
}

async function runner(caller: Caller): Promise<Runner> {
  const branch: Scope["branch"] = await br.branchScopeFor(sqliteSql(db), caller, null).catch(() => undefined);
  const scope: Scope = { tenantId: caller.tenantId!, sharedGroups: sharedCatalogGroupsFor(caller.businessType), linkedPharmacies: [], branch };
  const hide = costHidden(caller);
  const exec = (s: Stmt): Res => {
    const d = authorize(analyzeSql(s.sql), caller, known);
    if (!d.ok) throw new Error(`policy: ${d.reason} :: ${s.sql.slice(0, 160)}`);
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

test("every list page runs through the policy with its search and period", async () => {
  const run = await runner(owner);
  for (const key of LIST_KEYS) {
    const page = await appList(run, owner, key, { search: "a", from: "2026-11-01", to: "2026-11-30" });
    assert.ok(page.columns.length >= 2, key);
    const all = await appList(run, owner, key, {});
    for (const row of all.rows) for (const c of all.columns) assert.ok(c.key in row, `${key}: ${c.key}`);
  }
  await assert.rejects(appList(run, owner, "nope", {}), /not found/);
});

test("lists: returns of this business only, purchases with totals and detail, bank balance, narcotics, companies", async () => {
  const run = await runner(owner);
  const ret = await appList(run, owner, "invoice-returns", {});
  assert.deepEqual(ret.rows.map((x) => x.no), ["2"]);
  assert.equal(ret.opens, "invoice");
  const pur = await appList(run, owner, "purchases", { search: "D-77" });
  assert.deepEqual(pur.rows.map((x) => [x.supplier, x.payable, x.balance]), [["Distributor", 1000, 600]]);
  assert.deepEqual(pur.totals, { payable: 1000, paid: 400, balance: 600 });
  const det = await purchaseDetail(run, owner, "pu1");
  assert.deepEqual(det.items.map((i) => [i.product, i.batchNo, i.qty, i.price]), [["Tramal", "B1", 2, 500]]);
  const banks = await appList(run, owner, "banks", {});
  assert.equal(banks.rows[0].balance, 1300);
  const narc = await appList(run, owner, "narcotics", {});
  assert.deepEqual(narc.rows.map((x) => [x.customer, x.phone, x.product]), [["Ali", "03001234567", "Tramal"]]);
  const comp = await appList(run, owner, "companies", {});
  assert.deepEqual(comp.rows.map((x) => [x.name, x.products]), [["Searle", 1]]);
  const staff: Caller = { userId: "u", role: "staff", tenantId: "t1", businessType: "retail_pharmacy", permissions: ["invoices"], actions: [] };
  await assert.rejects(appList(run, staff, "purchases", {}), /no access/);
});

test("Submit to FBR: hidden and refused until FBR is switched on for the business", async () => {
  const sql = sqliteSql(db);
  assert.equal(await fbrAvailable(sql, owner), false);
  await assert.rejects(appFbrSubmit(sql, owner, "i1", undefined), /not enabled/);
  r(`INSERT INTO settings (key, value, updated_at) VALUES ('t1::fbr_enabled', 'true', ?)`, T);
  assert.equal(await fbrAvailable(sql, owner), true);
  // Seller details missing: the website's payload check says what to fix, nothing is sent.
  await assert.rejects(appFbrSubmit(sql, owner, "i1", undefined), /Seller NTN/);
  await assert.rejects(appFbrSubmit(sql, owner, "ix", undefined), /not found/);
});
