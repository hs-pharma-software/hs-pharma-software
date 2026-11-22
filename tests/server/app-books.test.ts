/** The money pages for the Android app (src/server/appBooks.ts), run the way
 * production runs them (policy check, business/branch rewrite). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import * as br from "@/server/branches";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import { scopeStatement, type Schema, type Scope } from "@/server/tenantScope";
import { sharedCatalogGroupsFor } from "@/lib/catalogAccess";
import { addAdjustment, addCash, addExpense, cashRegister, expenses, partyBalances, partyLedger } from "@/server/appBooks";
import type { Res, Runner, Stmt } from "@/server/appDocs";

const T = "2026-11-21T08:00:00.000Z";
let db: DatabaseSync;
let schema: Schema;
let known: Set<string>;
const owner: Caller = { userId: "u-own", role: "owner", tenantId: "t1", businessType: "retail_pharmacy" };
const r = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

function seed() {
  r(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('basic', 'Basic', 0, 30, '[]', 2, ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t1', 'A', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t2', 'B', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO customers (id, tenant_id, name, phone, opening_balance, created_at, updated_at) VALUES ('c1', 't1', 'Bilal', '0300', 100, ?, ?)`, T, T);
  r(`INSERT INTO customers (id, tenant_id, name, opening_balance, created_at, updated_at) VALUES ('c2', 't1', 'Ali', 0, ?, ?)`, T, T);
  r(`INSERT INTO customers (id, tenant_id, name, opening_balance, created_at, updated_at) VALUES ('cx', 't2', 'Theirs', 500, ?, ?)`, T, T);
  r(`INSERT INTO suppliers (id, tenant_id, name, opening_balance, created_at, updated_at) VALUES ('s1', 't1', 'Distributor', 0, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, customer_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('i1', 't1', 'c1', 1, '2026-11-20', 500, 500, 200, 300, 0, 0, 0, ?, ?)`, T, T);
  r(`INSERT INTO invoices (id, tenant_id, customer_id, invoice_no, date, total, payable, paid, balance, is_return, is_memorized, is_quotation, created_at, updated_at) VALUES ('q1', 't1', 'c1', 2, '2026-11-20', 900, 900, 0, 900, 0, 0, 1, ?, ?)`, T, T);
  r(`INSERT INTO purchases (id, tenant_id, supplier_id, purchase_no, date, payable, paid_amount, balance, is_return, created_at, updated_at) VALUES ('pu1', 't1', 's1', 1, '2026-11-20', 1000, 400, 600, 0, ?, ?)`, T, T);
  r(`INSERT INTO expense_categories (id, tenant_id, name, created_at, updated_at) VALUES ('ec1', 't1', 'Rent', ?, ?)`, T, T);
  r(`INSERT INTO expense_categories (id, tenant_id, name, created_at, updated_at) VALUES ('ecx', 't2', 'Theirs', ?, ?)`, T, T);
}

async function runner(caller: Caller): Promise<Runner> {
  const branch: Scope["branch"] = await br.branchScopeFor(sqliteSql(db), caller, null).catch(() => undefined);
  const scope: Scope = { tenantId: caller.tenantId!, sharedGroups: sharedCatalogGroupsFor(caller.businessType), linkedPharmacies: [], branch };
  const exec = (s: Stmt): Res => {
    const d = authorize(analyzeSql(s.sql), caller, known);
    if (!d.ok) throw new Error(`policy: ${d.reason} :: ${s.sql.slice(0, 120)}`);
    const st = db.prepare(scopeStatement(s.sql, s.args, scope, schema));
    if (!/^\s*(SELECT|WITH)/i.test(s.sql)) {
      const info = st.run(...(s.args as never[]));
      return { columns: [], rows: [], rowsAffected: Number(info.changes) };
    }
    const rows = st.all(...(s.args as never[])) as Record<string, unknown>[];
    const columns = rows[0] ? Object.keys(rows[0]) : [];
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

test("outstanding: opening + unpaid bills (no quotations) - adjustments; this business only; an adjustment lowers it once", async () => {
  const run = await runner(owner);
  const all = await partyBalances(run, "t1", "customer", null, false);
  assert.deepEqual(all.rows.map((x) => [x.name, x.balance]), [["Ali", 0], ["Bilal", 400]]);
  const due = await partyBalances(run, "t1", "customer", null, true);
  assert.deepEqual(due.rows.map((x) => x.name), ["Bilal"]);
  assert.equal(due.total, 400);
  await addAdjustment(run, "t1", "customer", { id: ID1, partyId: "c1", amount: 150, method: "Cash", comment: "Paid at shop" });
  const again = await addAdjustment(run, "t1", "customer", { id: ID1, partyId: "c1", amount: 150 });
  assert.equal(again.duplicate, true);
  const led = await partyLedger(run, "t1", "customer", "c1");
  assert.equal(led.party.balance, 250);
  assert.deepEqual(led.bills.map((x) => x.no), [1], "the quotation is not a bill");
  assert.deepEqual(led.adjustments.map((x) => [x.amount, x.method, x.comment]), [[150, "Cash", "Paid at shop"]]);
  await assert.rejects(partyLedger(run, "t1", "customer", "cx"), /not found/);
  await assert.rejects(addAdjustment(run, "t1", "customer", { id: ID2, partyId: "c1", amount: 0 }), /paid amount/);
  const sup = await partyBalances(run, "t1", "supplier", null, true);
  assert.deepEqual(sup.rows.map((x) => [x.name, x.balance]), [["Distributor", 600]]);
});

test("cash register: Payment In / Out today, totals and closing cash; sent twice saves once", async () => {
  const run = await runner(owner);
  await addCash(run, "t1", { id: ID1, type: "in", amount: 500, description: "Opening" });
  await addCash(run, "t1", { id: ID1, type: "in", amount: 500 });
  await addCash(run, "t1", { id: ID2, type: "out", amount: 120 });
  const c = await cashRegister(run, "t1");
  assert.deepEqual([c.cashIn, c.cashOut, c.closing, c.rows.length], [500, 120, 380, 2]);
  await assert.rejects(addCash(run, "t1", { id: "33333333-3333-4333-8333-333333333333", type: "x", amount: 1 }), /Payment In or Payment Out/);
});

test("expenses: by category, total for the period; only this business's categories", async () => {
  const run = await runner(owner);
  await addExpense(run, "t1", { id: ID1, categoryId: "ec1", amount: 2500, method: "Bank", by: "Owner", description: "November rent" });
  const e = await expenses(run, "t1", {});
  assert.deepEqual(e.rows.map((x) => [x.category, x.amount, x.method, x.by]), [["Rent", 2500, "Bank", "Owner"]]);
  assert.equal(e.total, 2500);
  assert.deepEqual(e.categories.map((x) => x.name), ["Rent"]);
  await assert.rejects(addExpense(run, "t1", { id: ID2, categoryId: "ecx", amount: 5 }), /category was not found/);
  await assert.rejects(expenses(run, "t1", { from: "2026-11" }), /Invalid date/);
});
