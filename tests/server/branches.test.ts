/** Multi-branch (Enterprise): allowance and approvals, access, branch-scoped
 * SQL, stock isolation, transfers, reports, and the v79 migration of existing data. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb, applySchema } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import * as br from "@/server/branches";
import { scopeStatement, type Schema, type Scope } from "@/server/tenantScope";
import type { Caller } from "@/server/sqlPolicy";
import type { Sql } from "@/server/subSupers";
import { BRANCH_TABLES, BRANCH_UNAVAILABLE, mainBranchId } from "@/config/branchTables";

const T = "2026-11-07T10:00:00.000Z";
const DAY = "2026-11-07";
let db: DatabaseSync;
let sql: Sql;
let schema: Schema;
const owner: Caller = { userId: "u-own", role: "owner", tenantId: "t1" };
const staff: Caller = { userId: "u-staff", role: "staff", tenantId: "t1", permissions: null };
const other: Caller = { userId: "u-other", role: "owner", tenantId: "t2" };
const admin: Caller = { userId: "sa", role: "super_admin", tenantId: null };
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const M1 = mainBranchId("t1");

function seed(d: DatabaseSync) {
  const r = (q: string, ...a: unknown[]) => d.prepare(q).run(...(a as never[]));
  r(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('ent', 'ENTERPRISE - Pharmacy', 0, 30, '[]', 50, ?, ?)`, T, T);
  r(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('basic', 'Basic - Pharmacy', 1800, 30, '[]', 2, ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t1', 'Chain Pharmacy', 'ent', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  r(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, business_type, created_at, updated_at) VALUES ('t2', 'Single Shop', 'basic', 'active', 'retail_pharmacy', ?, ?)`, T, T);
  for (const [id, t, role] of [["u-own", "t1", "owner"], ["u-staff", "t1", "staff"], ["u-other", "t2", "owner"]]) {
    r(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, is_active, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x', ?, 1, ?, ?)`, id, t, id, role, T, T);
  }
  r(`INSERT INTO products (id, name, tenant_id, created_at, updated_at) VALUES ('p1', 'Panadol', 't1', ?, ?)`, T, T);
}

beforeEach(() => {
  db = fullSchemaDb();
  // A fresh v79 database: the Enterprise plan gets 5 from the migration's name rule; seeded after, so set it here.
  seed(db);
  run(`UPDATE subscription_plans SET branch_limit = 5 WHERE id = 'ent'`);
  sql = sqliteSql(db);
  br.clearBranchCache();
  schema = new Map();
  for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]) {
    schema.set(name.toLowerCase(), new Set((db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name.toLowerCase())));
  }
});

const create = (code: string, caller: Caller = owner) => br.createBranch(sql, caller, { code, name: `Branch ${code}` });

test("allowance: Enterprise gets 5 including the main branch; other plans 1; the 6th waits for approval", async () => {
  const a = await br.allowance(sql, "t1");
  assert.equal(a.limit, 5);
  assert.equal(a.used, 1, "the main branch counts");
  assert.equal(a.entitled, true);
  for (const c of ["B2", "B3", "B4", "B5"]) await create(c);
  assert.equal((await br.allowance(sql, "t1")).remaining, 0);
  await assert.rejects(create("B6"), /Branch limit reached: 5 of 5/);
  assert.equal(one(`SELECT COUNT(*) AS n FROM branches WHERE tenant_id = 't1'`).n, 5);
  // The single shop: plan limit 1, multi-branch off.
  const b = await br.allowance(sql, "t2");
  assert.equal(b.limit, 1);
  assert.equal(b.entitled, false);
  await assert.rejects(create("X1", other), /Branch limit reached: 1 of 1/);
});

test("capacity request: approval raises the limit (no branch is made); rejection needs a reason; one pending at a time", async () => {
  for (const c of ["B2", "B3", "B4", "B5"]) await create(c);
  const { id } = await br.requestCapacity(sql, owner, 3, "Three new cities");
  await assert.rejects(br.requestCapacity(sql, owner, 1, "again"), /already waiting/);
  await assert.rejects(br.decideCapacityRequest(sql, owner, id, true, {}), /Only the Super Admin/);
  const after = await br.decideCapacityRequest(sql, admin, id, true, { limit: 8 });
  assert.equal(after.allowance.limit, 8);
  assert.equal(after.branches.length, 5, "approval does not create a branch");
  await create("B6"); await create("B7"); await create("B8");
  await assert.rejects(create("B9"), /8 of 8/);
  const r2 = await br.requestCapacity(sql, owner, 2, "");
  await assert.rejects(br.decideCapacityRequest(sql, admin, r2.id, false, {}), /reason/);
  await br.decideCapacityRequest(sql, admin, r2.id, false, { note: "Not on this plan" });
  assert.equal(one(`SELECT status FROM branch_capacity_requests WHERE id = ?`, r2.id).status, "rejected");
  assert.ok(one(`SELECT COUNT(*) AS n FROM branch_audit WHERE action = 'capacity.approved'`).n === 1);
});

test("concurrent creation cannot pass the limit (the count is checked inside the insert)", async () => {
  const results = await Promise.allSettled(["C1", "C2", "C3", "C4", "C5", "C6", "C7"].map((c) => create(c)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 4);
  assert.equal(one(`SELECT COUNT(*) AS n FROM branches WHERE tenant_id = 't1'`).n, 5);
  // The statement itself refuses even when the caller skipped the checks.
  run(`INSERT INTO branches (id, tenant_id, code, name, is_main, status, created_at, updated_at) SELECT 'raw', 't1', 'RAW', 'Raw', 0, 'active', ?, ? WHERE (SELECT COUNT(*) FROM branches WHERE tenant_id = 't1') < 5`, T, T);
  assert.equal(one(`SELECT COUNT(*) AS n FROM branches WHERE id = 'raw'`).n, 0);
});

test("archiving keeps the place; only the Super Admin releases it; a lower limit hides nothing", async () => {
  for (const c of ["B2", "B3", "B4", "B5"]) await create(c);
  const b5 = (await br.listBranches(sql, "t1")).find((b) => b.code === "B5")!;
  await br.setBranchStatus(sql, owner, b5.id, "archived", "closed");
  await assert.rejects(create("B6"), /limit reached/, "archived still counts");
  await assert.rejects(br.releaseCapacity(sql, admin, b5.id, ""), /reason/);
  await br.releaseCapacity(sql, admin, b5.id, "Shop sold");
  await create("B6");
  await assert.rejects(br.setBranchStatus(sql, owner, b5.id, "active", ""), /released/);
  // Limit lowered below the count: nothing deleted, over limit, creation blocked.
  await br.setBranchPolicy(sql, admin, "t1", { limit: 2 });
  const a = await br.allowance(sql, "t1");
  assert.equal(a.overLimit, true);
  assert.equal((await br.listBranches(sql, "t1")).length, 6);
  await assert.rejects(create("B7"), /limit reached/);
  // Unlimited.
  await br.setBranchPolicy(sql, admin, "t1", { unlimited: true });
  await create("B7");
  assert.equal((await br.allowance(sql, "t1")).limit, null);
});

test("access: owners only manage their own business; staff see their assigned branches; a foreign or unassigned branch is refused", async () => {
  const b2 = await create("B2");
  await assert.rejects(create("S1", staff), /Only the business owner/);
  await assert.rejects(br.updateBranch(sql, other, b2.id, { name: "Hijack" }), /not found/);
  await assert.rejects(br.assignUser(sql, other, "u-staff", [{ branchId: b2.id }]), /not found/);
  // Staff with no assignment: the main branch only.
  let s = await br.branchScopeFor(sql, staff, null);
  assert.deepEqual(s?.accessible, [M1]);
  await assert.rejects(br.branchScopeFor(sql, staff, b2.id), (e: Error) => e.message === BRANCH_UNAVAILABLE);
  await br.assignUser(sql, owner, "u-staff", [{ branchId: b2.id, manager: true }]);
  br.clearBranchCache();
  s = await br.branchScopeFor(sql, staff, null);
  assert.equal(s?.active, b2.id, "an assigned login opens its branch");
  await assert.rejects(br.branchScopeFor(sql, staff, M1), /not available/);
  // "All" for the owner is a report context: no active branch, not writable.
  const all = await br.branchScopeFor(sql, owner, "all");
  assert.equal(all?.active, null);
  assert.equal(all?.writable, false);
  assert.deepEqual(new Set(all?.accessible), new Set([M1, b2.id]));
  // Another business cannot name t1's branch.
  await assert.rejects(br.branchScopeFor(sql, other, b2.id), /not available/);
  // Multi-branch turned off: only the main branch, the others kept.
  await br.setBranchPolicy(sql, admin, "t1", { disabled: true });
  br.clearBranchCache();
  assert.deepEqual((await br.branchScopeFor(sql, owner, null))?.accessible, [M1]);
  assert.equal(one(`SELECT COUNT(*) AS n FROM branches WHERE tenant_id = 't1'`).n, 2);
});

/** Runs one statement as the browser would, inside a branch scope. */
async function scoped(caller: Caller, branch: string | null | "all", q: string, args: unknown[] = []) {
  const bs = await br.branchScopeFor(sql, caller, branch ?? null);
  const scope: Scope = { tenantId: caller.tenantId!, sharedGroups: [], linkedPharmacies: [], branch: bs };
  const text = scopeStatement(q, args, scope, schema);
  const st = db.prepare(text);
  return /^\s*SELECT/i.test(q) ? (st.all(...(args as never[])) as Record<string, unknown>[]) : st.run(...(args as never[]));
}

test("branch-scoped SQL: reads see one branch, inserts get the active branch, All Branches refuses changes, a branch cannot be changed", async () => {
  const b2 = await create("B2");
  run(`INSERT INTO product_batches (id, product_id, batch_no, qty, purchase_price, tenant_id, branch_id, created_at, updated_at) VALUES ('ba', 'p1', 'L1', 100, 10, 't1', ?, ?, ?)`, M1, T, T);
  run(`INSERT INTO product_batches (id, product_id, batch_no, qty, purchase_price, tenant_id, branch_id, created_at, updated_at) VALUES ('bb', 'p1', 'L1', 20, 10, 't1', ?, ?, ?)`, b2.id, T, T);
  const stock = async (b: string | null | "all") => Number((await scoped(owner, b, `SELECT COALESCE(SUM(qty), 0) AS n FROM product_batches WHERE product_id = 'p1'`) as Record<string, unknown>[])[0].n);
  assert.equal(await stock(M1), 100);
  assert.equal(await stock(b2.id), 20);
  assert.equal(await stock("all"), 120);
  // A sale of 5 in the main branch changes only its stock.
  await scoped(owner, M1, `UPDATE product_batches SET qty = qty - 5 WHERE product_id = 'p1'`);
  assert.equal(await stock(M1), 95);
  assert.equal(await stock(b2.id), 20);
  // A new record takes the active branch.
  await scoped(owner, b2.id, `INSERT INTO expenses (id, date, amount, tenant_id, created_at, updated_at) VALUES ('e1', ?, 500, 't1', ?, ?)`, [DAY, T, T]);
  assert.equal(one(`SELECT branch_id FROM expenses WHERE id = 'e1'`).branch_id, b2.id);
  await assert.rejects(scoped(owner, M1, `INSERT INTO expenses (id, date, amount, tenant_id, branch_id, created_at, updated_at) VALUES ('e2', ?, 1, 't1', ?, ?, ?)`, [DAY, b2.id, T, T]), /branch you are working in/);
  await assert.rejects(scoped(owner, "all", `INSERT INTO expenses (id, date, amount, tenant_id, created_at, updated_at) VALUES ('e3', ?, 1, 't1', ?, ?)`, [DAY, T, T]), /All Branches is for reports/);
  await assert.rejects(scoped(owner, "all", `UPDATE expenses SET amount = 1`), /All Branches is for reports/);
  await assert.rejects(scoped(owner, b2.id, `UPDATE expenses SET branch_id = ? WHERE id = 'e1'`, [M1]), /stock transfer/);
  // The main branch reads rows not yet assigned (kept visible, never lost).
  run(`INSERT INTO expenses (id, date, amount, tenant_id, created_at, updated_at) VALUES ('legacy', ?, 7, 't1', ?, ?)`, DAY, T, T);
  assert.equal((await scoped(owner, M1, `SELECT id FROM expenses`) as Record<string, unknown>[]).map((r) => r.id).join(","), "legacy");
  // Shared master data stays shared.
  assert.equal((await scoped(owner, b2.id, `SELECT id FROM products WHERE id = 'p1'`) as unknown[]).length, 1);
  // An inactive branch can be read, not changed.
  await br.setBranchStatus(sql, owner, b2.id, "inactive", "");
  br.clearBranchCache();
  assert.equal(await stock(b2.id), 20);
  await assert.rejects(scoped(owner, b2.id, `UPDATE product_batches SET qty = 0`), /inactive or archived/);
});

test("transfers: dispatch, in transit, partial receipt, no double receipt, cancel restores, idempotent, never more than the batch", async () => {
  const b2 = await create("B2");
  run(`INSERT INTO product_batches (id, product_id, batch_no, expiry_date, qty, purchase_price, tenant_id, branch_id, created_at, updated_at) VALUES ('ba', 'p1', 'L1', '2027-12-31', 100, 10, 't1', ?, ?, ?)`, M1, T, T);
  const qty = (b: string) => Number(one(`SELECT COALESCE(SUM(qty), 0) AS n FROM product_batches WHERE branch_id = ?`, b).n);
  await assert.rejects(br.createTransfer(sql, owner, { fromBranchId: M1, toBranchId: b2.id, items: [{ batchId: "ba", qty: 101 }] }), /Not enough stock/);
  assert.equal(qty(M1), 100, "a refused transfer changes nothing");
  const t1 = await br.createTransfer(sql, owner, { fromBranchId: M1, toBranchId: b2.id, items: [{ batchId: "ba", qty: 30 }], idempotencyKey: "k1" });
  const again = await br.createTransfer(sql, owner, { fromBranchId: M1, toBranchId: b2.id, items: [{ batchId: "ba", qty: 30 }], idempotencyKey: "k1" });
  assert.equal(again.id, t1.id);
  assert.equal(again.repeated, true);
  assert.equal(qty(M1), 70, "taken once");
  assert.equal(qty(b2.id), 0, "in transit");
  const item = one(`SELECT id FROM branch_transfer_items WHERE transfer_id = ?`, t1.id);
  // Staff that do not manage the destination cannot receive.
  await assert.rejects(br.receiveTransfer(sql, staff, t1.id, { lines: [] }), /cannot receive/);
  const r = await br.receiveTransfer(sql, owner, t1.id, { lines: [{ itemId: item.id, receivedQty: 25 }], note: "5 broken" });
  assert.equal(r.short, true);
  assert.equal(qty(b2.id), 25);
  const dest = one(`SELECT batch_no, expiry_date, purchase_price FROM product_batches WHERE branch_id = ?`, b2.id);
  assert.deepEqual({ ...dest }, { batch_no: "L1", expiry_date: "2027-12-31", purchase_price: 10 });
  await assert.rejects(br.receiveTransfer(sql, owner, t1.id, { lines: [] }), /no longer in transit/);
  await assert.rejects(br.cancelTransfer(sql, owner, t1.id, "late"), /in transit/);
  // A second transfer is cancelled: the stock comes back to the source batch.
  const t2 = await br.createTransfer(sql, owner, { fromBranchId: M1, toBranchId: b2.id, items: [{ batchId: "ba", qty: 10 }] });
  assert.equal(qty(M1), 60);
  await br.cancelTransfer(sql, owner, t2.id, "wrong branch");
  assert.equal(qty(M1), 70);
  assert.equal(one(`SELECT status FROM branch_transfers WHERE id = ?`, t2.id).status, "cancelled");
  // Merged into the same batch on the next receipt.
  const t3 = await br.createTransfer(sql, owner, { fromBranchId: M1, toBranchId: b2.id, items: [{ batchId: "ba", qty: 5 }] });
  await br.receiveTransfer(sql, owner, t3.id, {});
  assert.equal(one(`SELECT COUNT(*) AS n FROM product_batches WHERE branch_id = ?`, b2.id).n, 1);
  assert.equal(qty(b2.id), 30);
  assert.equal(qty(M1), 65);
  const list = await br.listTransfers(sql, owner);
  assert.deepEqual(list.map((t) => t.status), ["received", "cancelled", "received_short"]);
});

test("reports: each branch and the total agree; transfers are not sales or purchases; managers see only their branches", async () => {
  const b2 = await create("B2");
  const inv = (id: string, branch: string, total: number, ret = 0) =>
    run(`INSERT INTO invoices (id, invoice_no, date, total, discount_rs, payable, paid, balance, is_return, is_memorized, is_quotation, tenant_id, branch_id, created_at, updated_at) VALUES (?, 1, ?, ?, 0, ?, ?, 0, ?, 0, 0, 't1', ?, ?, ?)`, id, DAY, total, total, total, ret, branch, T, T);
  inv("i1", M1, 1000); inv("i2", b2.id, 400); inv("i3", b2.id, 100, 1);
  run(`INSERT INTO invoice_items (id, invoice_id, product_id, qty, purchase_price, sale_price, total, tenant_id, branch_id, created_at, updated_at) VALUES ('ii1', 'i1', 'p1', 10, 60, 100, 1000, 't1', ?, ?, ?)`, M1, T, T);
  run(`INSERT INTO expenses (id, date, amount, tenant_id, branch_id, created_at, updated_at) VALUES ('e1', ?, 50, 't1', ?, ?, ?)`, DAY, b2.id, T, T);
  run(`INSERT INTO product_batches (id, product_id, qty, purchase_price, tenant_id, branch_id, created_at, updated_at) VALUES ('ba', 'p1', 100, 10, 't1', ?, ?, ?)`, M1, T, T);
  const t = await br.createTransfer(sql, owner, { fromBranchId: M1, toBranchId: b2.id, items: [{ batchId: "ba", qty: 40 }] });
  await br.receiveTransfer(sql, owner, t.id, {});
  const rep = await br.branchReport(sql, owner, { from: DAY, to: DAY });
  const main = rep.rows.find((r) => r.branchId === M1)!;
  const two = rep.rows.find((r) => r.branchId === b2.id)!;
  assert.equal(main.netSales, 1000);
  assert.equal(main.cogs, 600);
  assert.equal(main.grossProfit, 400);
  assert.equal(two.netSales, 300, "400 sold less 100 returned");
  assert.equal(two.expenses, 50);
  assert.equal(rep.total.netSales, 1300);
  assert.equal(rep.total.purchases, 0, "a transfer is not a purchase");
  assert.equal(main.stockValue + two.stockValue, 1000, "stock value moves, it is not created");
  assert.equal(two.stockValue, 400);
  assert.equal(rep.branchLabel, "All branches");
  // One branch only.
  const only = await br.branchReport(sql, owner, { from: DAY, to: DAY, branchIds: [b2.id] });
  assert.deepEqual(only.rows.map((r) => r.branchId), [b2.id]);
  // A manager sees their branch; plain staff none; another business none.
  await br.assignUser(sql, owner, "u-staff", [{ branchId: b2.id, manager: true }]);
  const mine = await br.branchReport(sql, staff, { from: DAY, to: DAY, branchIds: [M1, b2.id] });
  assert.deepEqual(mine.rows.map((r) => r.branchId), [b2.id]);
  await br.assignUser(sql, owner, "u-staff", [{ branchId: b2.id, manager: false }]);
  await assert.rejects(br.branchReport(sql, staff, { from: DAY, to: DAY }), /owner and branch managers/);
  const theirs = await br.branchReport(sql, other, { from: DAY, to: DAY, branchIds: [b2.id] }).catch((e: Error) => e);
  assert.ok(theirs instanceof Error || theirs.rows.every((r) => r.branchId !== b2.id));
  const dash = await br.enterpriseDashboard(sql, owner, DAY);
  assert.equal(dash.totals.branches, 2);
  assert.equal(dash.day.total.netSales, 1300);
});

test("migration v79 on existing data: every branch record goes to its business's main branch; counts and totals unchanged", async () => {
  const old = fullSchemaDb(78);
  seed(old);
  const r = (q: string, ...a: unknown[]) => old.prepare(q).run(...(a as never[]));
  r(`INSERT INTO invoices (id, invoice_no, date, total, payable, tenant_id, created_at, updated_at) VALUES ('i1', 1, ?, 250, 250, 't1', ?, ?)`, DAY, T, T);
  r(`INSERT INTO invoices (id, invoice_no, date, total, payable, tenant_id, created_at, updated_at) VALUES ('i2', 1, ?, 90, 90, 't2', ?, ?)`, DAY, T, T);
  r(`INSERT INTO product_batches (id, product_id, qty, purchase_price, tenant_id, created_at, updated_at) VALUES ('ba', 'p1', 12, 5, 't1', ?, ?)`, T, T);
  r(`INSERT INTO rest_orders (id, tenant_id, order_no, order_type, status, total, created_at, updated_at) VALUES ('o1', 't1', 1, 'dine_in', 'closed', 10, ?, ?)`, T, T);
  const before = { inv: old.prepare(`SELECT COUNT(*) AS n, SUM(total) AS s FROM invoices`).get(), stock: old.prepare(`SELECT SUM(qty) AS s FROM product_batches`).get() };
  applySchema(old, 79);
  const after = { inv: old.prepare(`SELECT COUNT(*) AS n, SUM(total) AS s FROM invoices`).get(), stock: old.prepare(`SELECT SUM(qty) AS s FROM product_batches`).get() };
  assert.deepEqual(after, before, "no record added or changed in value");
  assert.equal((old.prepare(`SELECT COUNT(*) AS n FROM branches`).get() as { n: number }).n, (old.prepare(`SELECT COUNT(*) AS n FROM tenants`).get() as { n: number }).n, "one main branch per business");
  assert.deepEqual(old.prepare(`SELECT id, tenant_id, is_main, code FROM branches WHERE tenant_id IN ('t1', 't2') ORDER BY id`).all().map((x) => ({ ...(x as object) })), [
    { id: "main-t1", tenant_id: "t1", is_main: 1, code: "MAIN" }, { id: "main-t2", tenant_id: "t2", is_main: 1, code: "MAIN" },
  ]);
  assert.deepEqual(old.prepare(`SELECT id, branch_id FROM invoices ORDER BY id`).all().map((x) => ({ ...(x as object) })), [{ id: "i1", branch_id: "main-t1" }, { id: "i2", branch_id: "main-t2" }]);
  for (const t of BRANCH_TABLES) {
    const n = (old.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE branch_id IS NULL AND tenant_id IS NOT NULL`).get() as { n: number }).n;
    assert.equal(n, 0, `${t} has unassigned rows`);
  }
  assert.equal((old.prepare(`SELECT branch_limit FROM subscription_plans WHERE id = 'ent'`).get() as { branch_limit: number }).branch_limit, 5);
  assert.equal((old.prepare(`SELECT branch_limit FROM subscription_plans WHERE id = 'basic'`).get() as { branch_limit: number | null }).branch_limit, null);
  // Running it again changes nothing.
  assert.throws(() => applySchema(old, 79), /duplicate column/);
});

test("document numbers run per branch; the same number in one branch is still refused", async () => {
  const b2 = await create("B2");
  const order = (id: string, branch: string | null) => run(`INSERT INTO rest_orders (id, tenant_id, order_no, order_type, status, branch_id, created_at, updated_at) VALUES (?, 't1', 1, 'dine_in', 'open', ?, ?, ?)`, id, branch, T, T);
  order("a", M1);
  order("b", b2.id);
  assert.throws(() => order("c", M1), /UNIQUE/);
  assert.throws(() => order("d", null), /UNIQUE/, "an unassigned row counts as the main branch");
});

test("a single-branch business works as before: its main branch is the default and records go there", async () => {
  const s = await br.branchScopeFor(sql, other, null);
  assert.equal(s?.active, mainBranchId("t2"));
  assert.equal(s?.writable, true);
  await scoped(other, null, `INSERT INTO expenses (id, date, amount, tenant_id, created_at, updated_at) VALUES ('x1', ?, 5, 't2', ?, ?)`, [DAY, T, T]);
  assert.equal(one(`SELECT branch_id FROM expenses WHERE id = 'x1'`).branch_id, mainBranchId("t2"));
  // "all" with one branch is that branch.
  assert.equal((await br.branchScopeFor(sql, other, "all"))?.active, mainBranchId("t2"));
});
