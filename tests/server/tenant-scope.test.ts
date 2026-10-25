/** Step 3b: the server's rewrite keeps every statement inside the caller's
 * business. Checked by running the rewritten SQL on a real two-hospital
 * database, including statements written to break out. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { scopeStatement, ScopeError, type Schema, type Scope } from "@/server/tenantScope";

let db: DatabaseSync;
let schema: Schema;
const A: Scope = { tenantId: "hosp-a", sharedGroups: [], linkedPharmacies: [] };
const NOW = "2026-10-25T00:00:00.000Z";

function seed() {
  db = fullSchemaDb();
  const ins = (t: string, r: Record<string, unknown>) => {
    const k = Object.keys(r);
    db.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => r[x]) as never[]));
  };
  for (const [id, bt] of [["hosp-a", "hospital"], ["hosp-b", "hospital"], ["pharm-x", "hospital_pharmacy"], ["pharm-y", "retail_pharmacy"]]) ins("tenants", { id, name: id, business_type: bt, created_at: NOW, updated_at: NOW });
  for (const [id, t, n] of [["pa", "hosp-a", "Ali (A)"], ["pb", "hosp-b", "Bano (B)"]]) ins("hospital_patients", { id, tenant_id: t, mr_no: id, name: n, gender: "Male", created_at: NOW, updated_at: NOW });
  for (const [id, t, g, n] of [["p-x", "pharm-x", null, "Panadol (X)"], ["p-y", "pharm-y", null, "Brufen (Y)"], ["p-shared", null, "pharma", "Augmentin (shared)"]]) ins("products", { id, tenant_id: t, catalog_group: g, name: n, created_at: NOW, updated_at: NOW });
  ins("settings", { key: "hosp-a::hospital.profile", value: "A", updated_at: NOW });
  ins("settings", { key: "hosp-b::hospital.profile", value: "B", updated_at: NOW });
  ins("settings", { key: "billori_api_key", value: "k", updated_at: NOW });
  ins("settings", { key: "secret_global", value: "s", updated_at: NOW });
  schema = new Map();
  for (const r of db.prepare(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`).all() as { t: string; c: string }[]) {
    if (!schema.has(r.t)) schema.set(r.t, new Set());
    schema.get(r.t)!.add(r.c);
  }
}
beforeEach(seed);

const run = (sql: string, args: unknown[] = [], s: Scope = A) => (db.prepare(scopeStatement(sql, args, s, schema)).all(...(args as never[])) as Record<string, unknown>[]).map((r) => ({ ...r }));
const exec = (sql: string, args: unknown[] = [], s: Scope = A) => Number(db.prepare(scopeStatement(sql, args, s, schema)).run(...(args as never[])).changes);
const names = (rows: Record<string, unknown>[]) => rows.map((r) => r.name).sort();

test("reads see only the caller's rows, whatever the WHERE says", () => {
  assert.deepEqual(names(run("SELECT * FROM hospital_patients")), ["Ali (A)"]);
  assert.deepEqual(names(run("SELECT * FROM hospital_patients WHERE tenant_id = ?", ["hosp-b"])), [], "asking for B by name returns nothing");
  assert.deepEqual(names(run("SELECT * FROM hospital_patients WHERE tenant_id = ? OR 1=1", ["hosp-a"])), ["Ali (A)"], "OR 1=1 does not escape");
  assert.deepEqual(names(run("SELECT name FROM hospital_patients p WHERE p.id IN (SELECT id FROM hospital_patients)")), ["Ali (A)"], "subqueries are filtered too");
  assert.deepEqual(names(run("SELECT name FROM tenants UNION SELECT name FROM hospital_patients")), ["Ali (A)", "hosp-a", "pharm-x"], "UNION: only A's patients and the allowed tenants");
  assert.deepEqual(run("SELECT p.name, e.id FROM hospital_patients p LEFT JOIN hospital_episodes e ON e.patient_id = p.id"), [{ name: "Ali (A)", id: null }], "joins and aliases keep working");
  assert.equal((run("SELECT COUNT(*) AS n FROM hospital_patients")[0] as { n: number }).n, 1);
  assert.deepEqual(run("SELECT hospital_patients.name FROM hospital_patients"), [{ name: "Ali (A)" }], "table-qualified columns still resolve");
});

test("writes reach only the caller's rows; records cannot move to another business", () => {
  assert.equal(exec("UPDATE hospital_patients SET name = 'x'"), 1, "an update without WHERE touches only A's row");
  assert.deepEqual(names(db.prepare("SELECT name FROM hospital_patients WHERE tenant_id = 'hosp-b'").all() as never), ["Bano (B)"]);
  assert.equal(exec("UPDATE hospital_patients SET name = 'y' WHERE id = ? OR 1=1", ["pb"]), 1);
  assert.equal((db.prepare("SELECT name FROM hospital_patients WHERE id = 'pb'").get() as { name: string }).name, "Bano (B)");
  assert.equal(exec("DELETE FROM hospital_patients WHERE id = ?", ["pb"]), 0, "B's row cannot be deleted");
  assert.throws(() => exec("UPDATE hospital_patients SET tenant_id = 'hosp-a' WHERE id = ?", ["pb"]), ScopeError);
  assert.throws(() => exec("WITH x AS (SELECT 1) UPDATE hospital_patients SET name = 'z'"), /without a WITH/);
});

test("inserts must belong to the caller", () => {
  const cols = "(id, tenant_id, mr_no, name, gender, created_at, updated_at)";
  assert.equal(exec(`INSERT INTO hospital_patients ${cols} VALUES (?, ?, ?, ?, ?, ?, ?)`, ["n1", "hosp-a", "MR-9", "New", "Male", NOW, NOW]), 1);
  assert.throws(() => exec(`INSERT INTO hospital_patients ${cols} VALUES (?, ?, ?, ?, ?, ?, ?)`, ["n2", "hosp-b", "MR-9", "Planted", "Male", NOW, NOW]), /your own business/);
  assert.throws(() => exec(`INSERT INTO hospital_patients ${cols} VALUES ('n3', 'hosp-b', 'MR', 'P', 'M', '${NOW}', '${NOW}')`), /your own business/, "a literal tenant too");
  assert.throws(() => exec("INSERT INTO hospital_patients (id, mr_no, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ["n4", "x", "x", NOW, NOW]), /which business/);
  assert.throws(() => exec("INSERT OR REPLACE INTO hospital_patients (id, tenant_id) VALUES (?, ?)", ["pb", "hosp-a"]), /plain insert/, "replace could overwrite B's row");
  assert.throws(() => exec("INSERT INTO users (id, tenant_id, username) VALUES (?, ?, ?)", ["u", "hosp-a", "x"]), /through the server/);
  assert.throws(() => exec("INSERT INTO tenants (id, name) VALUES (?, ?)", ["t", "x"]), /Super Admin/);
});

test("shared catalogue: pharmacies see shared rows; a hospital sees only its linked pharmacy's products, read-only", () => {
  const Y: Scope = { tenantId: "pharm-y", sharedGroups: ["pharma", "general_store"], linkedPharmacies: [] };
  assert.deepEqual(names(run("SELECT * FROM products", [], Y)), ["Augmentin (shared)", "Brufen (Y)"]);
  assert.equal(exec("INSERT INTO products (id, tenant_id, catalog_group, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["p-new", null, "pharma", "New shared", NOW, NOW], Y), 1, "a pharmacy adds to the shared catalogue");
  assert.deepEqual(names(run("SELECT * FROM products")), [], "a hospital without a linked pharmacy sees no products");
  const linked: Scope = { ...A, linkedPharmacies: ["pharm-x"] };
  assert.deepEqual(names(run("SELECT * FROM products", [], linked)), ["Augmentin (shared)", "New shared", "Panadol (X)"], "linked pharmacy and the shared pharma catalogue");
  assert.equal(exec("UPDATE products SET name = 'hacked' WHERE id = ?", ["p-x"], linked), 0, "but cannot change the pharmacy's products");
  assert.throws(() => exec("INSERT INTO products (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ["p2", null, "x", NOW, NOW]), /your own business/, "a hospital cannot add shared rows");
});

test("mailbox, settings and the tenant list", () => {
  const cols = "(id, pharmacy_tenant_id, clinic_tenant_id, clinic_name, prescription_id, patient_name, patient_id, doctor_name, rx_date, created_at, updated_at)";
  assert.equal(exec(`INSERT INTO pharmacy_rx_notifications ${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ["m1", "pharm-x", "hosp-a", "Hospital A", "rx1", "Ali", "pa", "Dr S", "2026-10-25", NOW, NOW]), 1);
  assert.throws(() => exec(`INSERT INTO pharmacy_rx_notifications ${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ["m2", "pharm-x", "hosp-b", "Hospital B", "rx2", "Bano", "pb", "Dr T", "2026-10-25", NOW, NOW]), /your own business/, "cannot send as B");
  const X: Scope = { tenantId: "pharm-x", sharedGroups: ["pharma", "general_store"], linkedPharmacies: [] };
  assert.equal(run("SELECT * FROM pharmacy_rx_notifications", [], X).length, 1, "the recipient sees it");
  assert.equal(run("SELECT * FROM pharmacy_rx_notifications", [], { ...A, tenantId: "hosp-b" }).length, 0, "an outsider does not");
  assert.throws(() => exec("UPDATE pharmacy_rx_notifications SET clinic_tenant_id = 'hosp-b'", [], X), /cannot be changed/);

  assert.deepEqual(run("SELECT key FROM settings ORDER BY key").map((r) => r.key), ["billori_api_key", "hosp-a::hospital.profile"], "own keys and the global keys the app reads");
  assert.throws(() => exec("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["hosp-b::hospital.profile", "x", NOW]), /own business's settings/);
  exec("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["hosp-a::hospital.profile", "A2", NOW]);
  assert.equal((db.prepare("SELECT value FROM settings WHERE key = 'hosp-a::hospital.profile'").get() as { value: string }).value, "A2");
  assert.equal(exec("UPDATE settings SET value = 'x' WHERE key = ?", ["hosp-b::hospital.profile"]), 0);
  assert.equal(exec("UPDATE settings SET value = 'x' WHERE key = ?", ["billori_api_key"]), 0, "global settings are read-only");

  assert.deepEqual(names(run("SELECT * FROM tenants")), ["hosp-a", "pharm-x"], "own record and hospital pharmacies only");
});

test("anything unrecognised is refused rather than passed through", () => {
  assert.throws(() => run("SELECT * FROM sync_outbox"), ScopeError);
  assert.throws(() => run("SELECT * FROM hospital_patients WHERE id = ?1", ["pa"]), /plain \? parameters/);
  assert.throws(() => run("SELECT * FROM no_such_table"), ScopeError);
});
