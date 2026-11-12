/** Security phase 1 (audit C1, C2, M1): /api/db's policy and business rewrite
 * on a real two-business SQLite database with branches and several roles.
 * Every statement goes through the same path as /api/db (checkStatements:
 * policy, then rewrite) and the rewritten SQL is executed. Synthetic data only. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { checkStatements, guardInvoiceDeletes, shape, COST_COLUMNS, HttpError } from "@/server/db";
import { costHidden, type Caller } from "@/server/sqlPolicy";
import type { Schema, Scope } from "@/server/tenantScope";

const T = "2026-11-12T00:00:00.000Z";
let db: DatabaseSync;
let schema: Schema;
let known: Set<string>;

const owner = (t = "t1"): Caller => ({ userId: `owner-${t}`, role: "owner", tenantId: t, permissions: null, actions: [], tenantDeniedActions: [], businessType: "retail_pharmacy" });
const staff = (permissions: string[], actions: string[] = [], t = "t1"): Caller => ({ userId: "staff-1", role: "staff", tenantId: t, permissions, actions, tenantDeniedActions: [], businessType: "retail_pharmacy" });
const cashier = staff(["dashboard", "invoices", "customers"]);
const BR_A: Scope["branch"] = { active: "br-a", accessible: ["br-a"], mainId: "br-a", writable: true };

function seed() {
  db = fullSchemaDb();
  db.exec("PRAGMA foreign_keys = OFF");
  const ins = (t: string, r: Record<string, unknown>) => {
    const k = Object.keys(r);
    db.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => r[x]) as never[]));
  };
  for (const t of ["t1", "t2"]) {
    ins("tenants", { id: t, name: `Pharmacy ${t}`, business_type: "retail_pharmacy", created_at: T, updated_at: T });
    ins("users", { id: `owner-${t}`, tenant_id: t, username: `owner_${t}`, password_hash: "h", password_salt: "s", role: "owner", is_active: 1, created_at: T, updated_at: T });
    ins("products", { id: `p-${t}`, tenant_id: t, name: `Med ${t}`, created_at: T, updated_at: T });
    ins("product_batches", { id: `b-${t}`, product_id: `p-${t}`, tenant_id: t, branch_id: t === "t1" ? "br-a" : null, batch_no: "B1", qty: 10, purchase_price: 80, created_at: T, updated_at: T });
    ins("invoices", { id: `inv-${t}`, tenant_id: t, branch_id: t === "t1" ? "br-a" : null, invoice_no: 1, date: "2026-11-12", payable: 100, created_at: T, updated_at: T });
    ins("purchases", { id: `pur-${t}`, tenant_id: t, branch_id: t === "t1" ? "br-a" : null, purchase_no: 1, date: "2026-11-12", payable: 800, created_at: T, updated_at: T });
    ins("settings", { key: `${t}::pharmacy_name`, value: `Name ${t}`, updated_at: T });
    ins("settings", { key: `${t}::fbr_production_token`, value: "secret-token", updated_at: T });
  }
  ins("users", { id: "staff-1", tenant_id: "t1", username: "cashier", password_hash: "h", password_salt: "s", role: "staff", is_active: 1, created_at: T, updated_at: T });
  ins("users", { id: "sa", tenant_id: null, username: "root", password_hash: "h", password_salt: "s", role: "super_admin", is_active: 1, created_at: T, updated_at: T });
  // Branch B of t1, and a quotation and a memorized draft of t1.
  ins("invoices", { id: "inv-t1-b", tenant_id: "t1", branch_id: "br-b", invoice_no: 2, date: "2026-11-12", payable: 50, created_at: T, updated_at: T });
  ins("invoices", { id: "quo-t1", tenant_id: "t1", branch_id: "br-a", is_quotation: 1, quotation_no: 1, date: "2026-11-12", payable: 10, created_at: T, updated_at: T });
  ins("invoices", { id: "draft-t1", tenant_id: "t1", branch_id: "br-a", is_memorized: 1, invoice_no: 3, date: "2026-11-12", payable: 10, created_at: T, updated_at: T });
  schema = new Map();
  for (const r of db.prepare(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`).all() as { t: string; c: string }[]) {
    if (!schema.has(r.t)) schema.set(r.t, new Set());
    schema.get(r.t)!.add(r.c);
  }
  known = new Set(schema.keys());
}
beforeEach(seed);

/** Runs statements exactly as /api/db would (policy, rewrite, invoice delete check), then the result shaping. */
// Rows for a read, the changed-row count for a write (loosely typed for the assertions).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(caller: Caller, sql: string, args: unknown[] = [], branch: Scope["branch"] = BR_A): Promise<any> {
  const checked = checkStatements(caller, [{ sql, args }], known, schema, branch);
  await guardInvoiceDeletes(caller, checked, schema, branch, async (q, a) => Number((db.prepare(q).get(...(a as never[])) as { n: number }).n));
  const { sql: run } = checked[0];
  const st = db.prepare(run);
  const params = args.map((v) => (v === undefined ? null : v)) as never[];
  if (/^\s*(SELECT|WITH)/i.test(run)) {
    const rows = st.all(...params) as Record<string, unknown>[];
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    const shaped = shape({ columns, rows: rows.map((r) => columns.map((c) => r[c])) as never, rowsAffected: 0, lastInsertRowid: undefined as never }, costHidden(caller) ? COST_COLUMNS : null);
    return shaped.rows.map((r) => Object.fromEntries(shaped.columns.map((c, i) => [c, r[i]])));
  }
  return Number(st.run(...params).changes);
}
/** One row of a direct check on the test database. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const one = (sql: string): Record<string, any> => db.prepare(sql).get() as Record<string, unknown>;
const refused = (p: Promise<unknown>, re?: RegExp) => assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === 403 && (!re || re.test(e.message)));
const ids = (rows: unknown) => (rows as Record<string, unknown>[]).map((r) => String(r.id)).sort();

// ── C1: reads cannot leave the business ──

test("C1: quoted, bracketed and back-quoted table names are refused", async () => {
  for (const sql of ["SELECT id FROM [invoices]", "SELECT id FROM \"invoices\"", "SELECT id FROM `invoices`", "SELECT [id] FROM invoices", "SELECT * FROM [settings]", "SELECT * FROM [users]"]) {
    await refused(api(cashier, sql), /Quoted or bracketed/);
  }
});

test("C1: comma joins, parenthesised tables and CTEs named like tables are refused", async () => {
  await refused(api(cashier, "SELECT i.id FROM customers c, invoices i"), /form of query/);
  await refused(api(cashier, "SELECT * FROM (invoices)"), /form of query/);
  await refused(api(cashier, "SELECT * FROM customers JOIN (invoices) ON 1=1"), /form of query/);
  await refused(api(cashier, "WITH invoices AS (SELECT 1 AS id) SELECT * FROM invoices"), /WITH name cannot be a table name/);
});

test("C1: every supported form stays in the business and the branch", async () => {
  assert.deepEqual(ids(await api(cashier, "SELECT id FROM invoices WHERE COALESCE(is_quotation, 0) = 0 AND COALESCE(is_memorized, 0) = 0")), ["inv-t1"], "branch A only, t1 only");
  assert.deepEqual(ids(await api(cashier, "SELECT id FROM INVOICES WHERE id IN ('inv-t2', 'inv-t1-b') OR 1=1 ORDER BY id")), ["draft-t1", "inv-t1", "quo-t1"]);
  assert.deepEqual(ids(await api(cashier, "SELECT id FROM/**/invoices WHERE id = 'inv-t2'")), []);
  assert.deepEqual(ids(await api(cashier, "SELECT id FROM\ninvoices\nWHERE tenant_id = 't2'")), []);
  assert.deepEqual(ids(await api(cashier, "SELECT id FROM invoices i WHERE EXISTS (SELECT 1 FROM invoices x WHERE x.tenant_id = 't2') AND i.id = 'inv-t1'")), [], "a subquery sees only t1 too");
  assert.deepEqual(ids(await api(cashier, "SELECT id FROM customers UNION SELECT id FROM invoices WHERE id = 'inv-t2'")), []);
  const all = owner();
  assert.deepEqual(ids(await api(all, "SELECT id FROM invoices WHERE id IN ('inv-t1', 'inv-t1-b')", [], { active: null, accessible: ["br-a", "br-b"], mainId: "br-a", writable: false })), ["inv-t1", "inv-t1-b"], "All Branches: every branch the login may open");
  const settings = await api(cashier, "SELECT key FROM settings");
  assert.deepEqual(settings.map((r: { key: string }) => r.key), ["t1::pharmacy_name"], "own settings only, never a token");
  const users = await api(owner(), "SELECT * FROM users");
  assert.deepEqual(ids(users), ["owner-t1", "staff-1"]);
  assert.ok(users.every((u: object) => !("password_hash" in u)), "no password columns");
});

// ── C2: protected fields cannot be changed through generic writes ──

test("C2: a login's role, platform role, username, business and password cannot be changed here", async () => {
  for (const sql of [
    "UPDATE users SET role = 'super_admin' WHERE id = 'owner-t1'",
    "UPDATE users SET [role] = 'super_admin' WHERE id = 'owner-t1'",
    "UPDATE users SET \"role\" = 'super_admin' WHERE id = 'owner-t1'",
    "UPDATE users SET (role) = ('super_admin') WHERE id = 'owner-t1'",
    "UPDATE users SET (display_name, role) = ('x', 'super_admin') WHERE id = 'owner-t1'",
    "UPDATE users SET platform_role = 'distributor' WHERE id = 'owner-t1'",
    "UPDATE users SET username = 'root' WHERE id = 'owner-t1'",
    "UPDATE users SET tenant_id = 't2' WHERE id = 'owner-t1'",
    "UPDATE users SET (tenant_id) = ('t2') WHERE id = 'owner-t1'",
    "UPDATE users SET password_hash = 'x' WHERE id = 'owner-t1'",
  ]) await refused(api(owner(), sql), undefined);
  const row = db.prepare("SELECT role, tenant_id, username FROM users WHERE id = 'owner-t1'").get() as Record<string, string>;
  assert.deepEqual([row.role, row.tenant_id, row.username], ["owner", "t1", "owner_t1"]);
  assert.equal(one("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'").n, 1);
});

test("C2: records cannot be moved to another business or branch, in any assignment form", async () => {
  for (const sql of [
    "UPDATE invoices SET tenant_id = 't2' WHERE id = 'inv-t1'",
    "UPDATE invoices SET (payable, tenant_id) = (1, 't2') WHERE id = 'inv-t1'",
    "UPDATE invoices SET branch_id = 'br-b' WHERE id = 'inv-t1'",
    "UPDATE invoices SET (branch_id) = ('br-b') WHERE id = 'inv-t1'",
    "INSERT INTO invoices (id, tenant_id, invoice_no, date, created_at, updated_at) VALUES ('x', 't2', 9, '2026-11-12', 'x', 'x')",
    "INSERT INTO invoices (id, tenant_id, branch_id, invoice_no, date, created_at, updated_at) VALUES ('x', 't1', 'br-b', 9, '2026-11-12', 'x', 'x')",
    "INSERT OR REPLACE INTO invoices (id, tenant_id, invoice_no, date, created_at, updated_at) VALUES ('inv-t2', 't1', 9, '2026-11-12', 'x', 'x')",
    "INSERT INTO users (id, tenant_id, username, role) VALUES ('u9', 't1', 'x', 'owner')",
  ]) await refused(api(owner(), sql));
  assert.equal(await api(owner(), "UPDATE invoices SET payable = 1 WHERE id IN ('inv-t2', 'inv-t1-b')"), 0, "another business's or branch's rows are not reached");
  assert.equal(await api(owner(), "DELETE FROM customers WHERE 1=1"), 0);
  assert.equal(one("SELECT tenant_id FROM invoices WHERE id = 'inv-t1'").tenant_id, "t1");
});

test("C2: the owner's intended changes to logins still work (name, active, permissions)", async () => {
  assert.equal(await api(owner(), "UPDATE users SET display_name = ?, is_active = ?, permissions = ?, denied_actions = ?, updated_at = ? WHERE id = ?", ["Cashier", 0, '["invoices"]', '["invoice.delete"]', T, "staff-1"]), 1);
  assert.equal(await api(owner(), "UPDATE users SET deleted_at = ? WHERE id = ?", [T, "staff-1"]), 1);
  await refused(api(cashier, "UPDATE users SET display_name = 'x' WHERE id = 'staff-1'"), /Only the owner manages logins/);
});

// ── M1: Pharmacy staff permissions on the server ──

test("M1: purchases are read by staff with Purchase, Suppliers or Reports only; written with Purchase only", async () => {
  await refused(api(cashier, "SELECT * FROM purchases"), /no access to purchases/);
  await refused(api(cashier, "SELECT pi.* FROM purchase_items pi"), /no access to purchases/);
  await refused(api(cashier, "SELECT c.id FROM customers c LEFT JOIN purchases p ON p.id = c.id"), /no access to purchases/);
  assert.deepEqual(ids(await api(staff(["suppliers"]), "SELECT id FROM purchases")), ["pur-t1"]);
  assert.deepEqual(ids(await api(staff(["reports"]), "SELECT id FROM purchases")), ["pur-t1"]);
  await refused(api(staff(["suppliers"]), "UPDATE purchases SET payable = 1"), /no access to purchases/);
  assert.equal(await api(staff(["purchase"]), "UPDATE purchases SET payable = ? WHERE id = ?", [900, "pur-t1"]), 1);
  assert.deepEqual(ids(await api(owner(), "SELECT id FROM purchases")), ["pur-t1"], "the owner as before");
});

test("M1: purchase prices are removed for staff without them, and cannot be read another way", async () => {
  assert.equal(costHidden(cashier), true);
  const rows = await api(cashier, "SELECT id, batch_no, qty, purchase_price FROM product_batches");
  assert.deepEqual(rows, [{ id: "b-t1", batch_no: "B1", qty: 10 }], "billing still gets the batch, without its cost");
  assert.ok(!("purchase_price" in (await api(cashier, "SELECT * FROM product_batches"))[0]));
  for (const sql of [
    "SELECT SUM(purchase_price) AS s FROM product_batches",
    "SELECT id FROM product_batches WHERE purchase_price > 50",
    "SELECT purchase_price AS c FROM product_batches",
    "SELECT purchase_price + 0 FROM product_batches",
    "SELECT id FROM product_batches WHERE id IN (SELECT id FROM product_batches WHERE purchase_price > 1)",
    "SELECT id, qty FROM customers UNION SELECT id, purchase_price FROM product_batches",
    "WITH b(a1, a2, a3, a4, a5, a6, a7) AS (SELECT * FROM product_batches) SELECT a7 FROM b",
    "SELECT * FROM product_batches ORDER BY 7",
    "UPDATE product_batches SET purchase_price = 1",
  ]) await refused(api(cashier, sql), /Purchase prices are not available|no access/);
  // With the permission (or the Purchase / Reports section, or as owner) nothing is removed.
  for (const c of [staff(["invoices"], ["+invoice.purchase_rate"]), staff(["purchase"]), staff(["reports"]), owner()]) {
    assert.equal((await api(c, "SELECT purchase_price FROM product_batches"))[0].purchase_price, 80);
  }
});

test("M1: a sale line's cost is still recorded for staff without purchase prices (taken from the batch)", async () => {
  const sql = "INSERT INTO invoice_items (id, invoice_id, product_id, batch_no, qty, sale_price, purchase_price, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  assert.equal(await api(cashier, sql, ["ii-1", "inv-t1", "p-t1", "B1", 2, 100, null, "t1", T, T]), 1);
  assert.equal(one("SELECT purchase_price FROM invoice_items WHERE id = 'ii-1'").purchase_price, 80, "cost from the batch");
  assert.equal(await api(cashier, sql, ["ii-2", "inv-t1", "p-t1", "B1", 1, 100, 1, "t1", T, T]), 1);
  assert.equal(one("SELECT purchase_price FROM invoice_items WHERE id = 'ii-2'").purchase_price, 80, "a value sent by the page is not trusted");
  assert.equal(await api(cashier, "INSERT INTO invoice_items (id, invoice_id, product_id, batch_no, qty, sale_price, tenant_id, created_at, updated_at) VALUES ('ii-3', 'inv-t1', 'p-t1', 'B1', 1, 100, 't1', 'x', 'x')"), 1);
  assert.equal(one("SELECT purchase_price FROM invoice_items WHERE id = 'ii-3'").purchase_price, 80);
  assert.equal(await api(owner(), sql, ["ii-4", "inv-t1", "p-t1", "B1", 1, 100, 77, "t1", T, T]), 1);
  assert.equal(one("SELECT purchase_price FROM invoice_items WHERE id = 'ii-4'").purchase_price, 77, "the owner's own value as before");
});

test("M1: deleting a sale invoice needs 'Delete invoices'; quotations and drafts keep their own rules; never a hard delete", async () => {
  const denied = staff(["invoices", "quotation"], ["invoice.delete"]);
  await refused(api(denied, "UPDATE invoices SET deleted_at = ?, updated_at = ? WHERE id = ?", [T, T, "inv-t1"]), /permission to delete invoices/);
  assert.equal(one("SELECT deleted_at FROM invoices WHERE id = 'inv-t1'").deleted_at, null);
  await refused(api(denied, "UPDATE invoices SET deleted_at = ? WHERE id IN (?, ?)", [T, "quo-t1", "inv-t1"]), /permission to delete invoices/); // one real invoice among them refuses all
  assert.equal(await api(denied, "UPDATE invoices SET deleted_at = ?, updated_at = ? WHERE id = ?", [T, T, "quo-t1"]), 1, "a quotation");
  assert.equal(await api(denied, "UPDATE invoices SET deleted_at = ?, updated_at = ? WHERE id = ?", [T, T, "draft-t1"]), 1, "a memorized draft");
  assert.equal(await api(denied, "UPDATE invoices SET payable = ? WHERE id = ?", [99, "inv-t1"]), 1, "editing is not deleting");
  await refused(api(denied, "UPDATE invoices SET deleted_at = ?", [T]), /permission to delete invoices/); // no WHERE: every invoice is checked
  // Allowed staff and the owner delete as before; nobody hard-deletes as staff.
  assert.equal(await api(staff(["invoices"]), "UPDATE invoices SET deleted_at = ?, updated_at = ? WHERE id = ?", [T, T, "inv-t1"]), 1);
  await refused(api(staff(["invoices"]), "DELETE FROM invoices WHERE id = 'inv-t1'"), /permission/);
  await refused(api(staff(["invoices"]), "DELETE FROM invoice_items WHERE invoice_id = 'inv-t1'"), /permission/);
});

test("normal Pharmacy reads and writes still work through the same path", async () => {
  assert.equal(await api(cashier, "INSERT INTO customers (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ["c1", "t1", "Ali", T, T]), 1);
  assert.deepEqual(ids(await api(cashier, "SELECT id FROM customers WHERE name = ?", ["Ali"])), ["c1"]);
  assert.equal(await api(cashier, "INSERT INTO invoices (id, tenant_id, invoice_no, date, payable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["inv-new", "t1", 4, "2026-11-12", 50, T, T]), 1);
  assert.equal(one("SELECT branch_id FROM invoices WHERE id = 'inv-new'").branch_id, "br-a", "the active branch is added");
  assert.equal(await api(cashier, "UPDATE product_batches SET qty = qty - ?, updated_at = ? WHERE id = ?", [2, T, "b-t1"]), 1);
  assert.equal(one("SELECT qty FROM product_batches WHERE id = 'b-t1'").qty, 8);
  assert.deepEqual((await api(cashier, "SELECT p.name, b.qty FROM product_batches b JOIN products p ON p.id = b.product_id")), [{ name: "Med t1", qty: 8 }]);
  assert.equal(await api(owner(), "INSERT INTO purchases (id, tenant_id, purchase_no, date, payable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["pur-new", "t1", 2, "2026-11-12", 10, T, T]), 1);
  assert.equal(await api(owner(), "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["t1::pharmacy_name", "New", T]), 1);
  assert.equal(one("SELECT value FROM settings WHERE key = 't1::pharmacy_name'").value, "New");
});
