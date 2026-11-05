/** Tenant isolation regressions with two synthetic businesses (Synthetic
 * Pharmacy A and B) that share the pharma catalogue: dashboard totals,
 * direct access to another business's records by id, the desktop sync's
 * write path through the server, and the action permissions the server
 * enforces. Dashboard figures are checked both as the app writes the SQL and
 * after the server's tenant rewrite (what /api/db runs). */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import * as dash from "@/lib/repo/dashboard";
import { scopeStatement, type Schema, type Scope } from "@/server/tenantScope";
import { analyzeSql, authorize, callerCan, type Caller } from "@/server/sqlPolicy";
import { can } from "@/lib/actionPermissions";
import { ROLE_PRESETS, presetActions, presetModules } from "@/lib/rolePresets";
import { sharedCatalogGroupsFor } from "@/lib/catalogAccess";

const A = "syn-a";
const B = "syn-b";
const DAY = "2026-11-04";
const NOW = `${DAY}T09:00:00.000Z`;
let db: DatabaseSync;
let schema: Schema;

const tenant = (id: string): SessionTenant => ({
  id, name: id === A ? "Synthetic Pharmacy A" : "Synthetic Pharmacy B", subscriptionStatus: "active", subscriptionExpiresAt: null,
  allowedModules: [], maxStaffLogins: 5, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
});
const signIn = (id: string) =>
  useAuthStore.setState({ currentUser: { id: `owner-${id}`, username: id, displayName: "Owner", role: "owner", tenantId: id, permissions: null }, currentTenant: tenant(id) });
const scopeOf = (id: string): Scope => ({ tenantId: id, sharedGroups: sharedCatalogGroupsFor("retail_pharmacy"), linkedPharmacies: [] });

function ins(t: string, r: Record<string, unknown>) {
  const k = Object.keys(r);
  db.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => r[x]) as never[]));
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  for (const id of [A, B]) ins("tenants", { id, name: tenant(id).name, business_type: "retail_pharmacy", created_at: NOW, updated_at: NOW });
  // Shared catalogue product both sell, plus one private product each.
  ins("products", { id: "p-shared", tenant_id: null, catalog_group: "pharma", name: "Panadol 500mg (shared)", packing: 1, created_at: NOW, updated_at: NOW });
  ins("products", { id: "p-a", tenant_id: A, name: "A private syrup", packing: 1, created_at: NOW, updated_at: NOW });
  ins("products", { id: "p-b", tenant_id: B, name: "B private cream", packing: 1, created_at: NOW, updated_at: NOW });
  // Stock: A has 4 of the shared product, B has 500.
  ins("product_batches", { id: "bat-a", tenant_id: A, product_id: "p-shared", batch_no: "A1", qty: 4, purchase_price: 10, created_at: NOW, updated_at: NOW });
  ins("product_batches", { id: "bat-b", tenant_id: B, product_id: "p-shared", batch_no: "B1", qty: 500, purchase_price: 10, created_at: NOW, updated_at: NOW });
  ins("customers", { id: "cust-a", tenant_id: A, name: "A customer", created_at: NOW, updated_at: NOW });
  ins("customers", { id: "cust-b", tenant_id: B, name: "B customer", created_at: NOW, updated_at: NOW });
  // Today's sales: A sells 2 x 100, B sells 50 x 100.
  for (const [id, t, qty] of [["inv-a", A, 2], ["inv-b", B, 50]] as const) {
    ins("invoices", { id, tenant_id: t, invoice_no: id, date: DAY, customer_id: t === A ? "cust-a" : "cust-b", total: qty * 100, paid: qty * 100, is_return: 0, is_memorized: 0, is_quotation: 0, created_at: NOW, updated_at: NOW });
    ins("invoice_items", { id: `${id}-1`, tenant_id: t, invoice_id: id, product_id: "p-shared", qty, sale_price: 100, total: qty * 100, created_at: NOW, updated_at: NOW });
  }
  ins("expenses", { id: "exp-a", tenant_id: A, date: DAY, amount: 30, created_at: NOW, updated_at: NOW });
  ins("expenses", { id: "exp-b", tenant_id: B, date: DAY, amount: 9000, created_at: NOW, updated_at: NOW });
  schema = new Map();
  for (const r of db.prepare(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`).all() as { t: string; c: string }[]) {
    if (!schema.has(r.t)) schema.set(r.t, new Set());
    schema.get(r.t)!.add(r.c);
  }
  signIn(A);
});

const savedScope = process.env.TENANT_SCOPE;
afterEach(() => {
  if (savedScope === undefined) delete process.env.TENANT_SCOPE;
  else process.env.TENANT_SCOPE = savedScope;
});

for (const mode of ["as written", "after the server rewrite"] as const) {
  test(`dashboard totals contain only the signed-in business (${mode})`, async () => {
    process.env.TENANT_SCOPE = mode === "as written" ? "0" : "1";
    const today = await dash.getTodaySummary(DAY);
    assert.equal(today.sales, 200, "B's 5,000 of sales must not be counted");
    assert.equal(today.invoiceCount, 1);
    assert.equal(today.expenses, 30, "B's expenses must not be counted");

    const top = await dash.getTopSellingProducts();
    assert.deepEqual(top.map((r) => [r.name, r.qty]), [["Panadol 500mg (shared)", 2]], "B's 50 units must not be added to the shared product");

    const low = await dash.getLowStockProducts(20);
    const shared = low.find((r) => r.id === "p-shared");
    assert.equal(shared?.avail_qty, 4, "stock of a shared product is this business's own stock only");
    assert.ok(!low.some((r) => r.id === "p-b"), "B's private product is not listed");

    const count = await dash.countProducts();
    assert.equal(count, 2, "own product + shared catalogue, not B's private product");

    signIn(B);
    assert.equal((await dash.getTodaySummary(DAY)).sales, 5000);
    assert.equal((await dash.getLowStockProducts(20)).find((r) => r.id === "p-shared"), undefined, "B's 500 units are above the low-stock line");
  });
}

test("records of another business cannot be read, changed or deleted by id", () => {
  const run = (sql: string, args: unknown[]) => db.prepare(scopeStatement(sql, args, scopeOf(A), schema)).all(...(args as never[]));
  const exec = (sql: string, args: unknown[]) => Number(db.prepare(scopeStatement(sql, args, scopeOf(A), schema)).run(...(args as never[])).changes);
  for (const [table, id] of [["invoices", "inv-b"], ["invoice_items", "inv-b-1"], ["customers", "cust-b"], ["product_batches", "bat-b"], ["expenses", "exp-b"], ["products", "p-b"]]) {
    assert.deepEqual(run(`SELECT * FROM ${table} WHERE id = ?`, [id]), [], `${table} read`);
    assert.deepEqual(run(`SELECT * FROM ${table} WHERE id = ? OR 1 = 1`, [id]).filter((r) => (r as { id: string }).id === id), [], `${table} OR 1=1`);
    assert.equal(exec(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, [NOW, id]), 0, `${table} update`);
    assert.equal(exec(`DELETE FROM ${table} WHERE id = ?`, [id]), 0, `${table} delete`);
  }
  // A join through A's own invoice cannot reach B's lines either.
  assert.deepEqual(run(`SELECT ii.id FROM invoices i JOIN invoice_items ii ON ii.invoice_id = 'inv-b'`, []), []);
  assert.equal((db.prepare(`SELECT total FROM invoices WHERE id = 'inv-b'`).get() as { total: number }).total, 5000, "B's invoice is untouched");
});

test("desktop sync through the server cannot overwrite another business's row", () => {
  // The desktop pushes an update-then-insert (lib/sync/engine.ts pushRowViaServer).
  const exec = (sql: string, args: unknown[]) => Number(db.prepare(scopeStatement(sql, args, scopeOf(A), schema)).run(...(args as never[])).changes);
  assert.equal(exec(`UPDATE invoices SET total = ? WHERE id = ?`, [1, "inv-b"]), 0, "the update does not see B's row");
  assert.throws(() => exec(`INSERT INTO invoices (id, tenant_id, invoice_no, date, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, ["inv-b", A, "x", DAY, 1, NOW, NOW]), /UNIQUE/, "and the insert fails on the taken id");
  assert.throws(() => scopeStatement(`INSERT INTO invoices (id, tenant_id, invoice_no, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, ["new", B, "x", DAY, NOW, NOW], scopeOf(A), schema), /own business/, "a row cannot be pushed into B");
  assert.throws(() => scopeStatement(`UPDATE invoices SET tenant_id = ? WHERE id = ?`, [B, "inv-a"], scopeOf(A), schema), /another business/);
  assert.equal((db.prepare(`SELECT total FROM invoices WHERE id = 'inv-b'`).get() as { total: number }).total, 5000);
});

test("refund, export, restore, FBR submit and financial close are opt-in for staff, on the server too", () => {
  const known = new Set(schema.keys());
  const staff = (actions: string[]): Caller => ({ userId: "s", role: "staff", tenantId: A, permissions: ["invoices"], actions });
  const closing = analyzeSql(`INSERT INTO financial_closings (id, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?)`);
  assert.equal(authorize(closing, staff([]), known).ok, false, "a staff login without Financial closing is refused");
  assert.equal(authorize(closing, staff(["+finance.close"]), known).ok, true);
  assert.equal(authorize(closing, { userId: "o", role: "owner", tenantId: A }, known).ok, true, "the owner may close");
  assert.equal(authorize(closing, { userId: "o", role: "owner", tenantId: A, tenantDeniedActions: ["finance.close"] }, known).ok, false, "unless the Super Admin turned it off");

  for (const action of ["invoice.refund", "data.export", "data.restore", "invoice.fbr_submit", "finance.close"] as const) {
    assert.equal(callerCan(staff([]), action), false, `${action}: off by default on the server`);
    assert.equal(callerCan(staff([`+${action}`]), action), true);
    useAuthStore.setState({ currentUser: { id: "s", username: "s", displayName: "s", role: "staff", tenantId: A, permissions: ["invoices"], deniedActions: [] } });
    assert.equal(can(action), false, `${action}: off by default in the app`);
    useAuthStore.setState({ currentUser: { id: "s", username: "s", displayName: "s", role: "staff", tenantId: A, permissions: ["invoices"], deniedActions: [`+${action}`] } });
    assert.equal(can(action), true);
  }
  // Ordinary actions stay allowed unless denied (existing staff keep them).
  assert.equal(callerCan(staff([]), "invoice.edit"), true);
  assert.equal(callerCan(staff(["invoice.edit"]), "invoice.edit"), false);
});

test("role presets: a new staff login starts as a Cashier, never with every section", () => {
  const available = ["dashboard", "invoices", "customers", "products", "stock", "purchase", "reports", "staff", "settings", "utilities"];
  const [cashier, , accountant, manager] = ROLE_PRESETS;
  assert.deepEqual(presetModules(cashier, available), ["dashboard", "invoices", "customers"]);
  assert.deepEqual(presetActions(cashier), [], "a cashier cannot refund, export, restore, submit to FBR or close");
  assert.deepEqual(presetModules(accountant, available), ["dashboard", "customers", "reports"]);
  assert.ok(presetActions(accountant).includes("+finance.close"));
  assert.ok(!presetModules(manager, available).some((k) => ["staff", "settings", "utilities"].includes(k)), "a manager does not manage logins, settings or backups");
});
