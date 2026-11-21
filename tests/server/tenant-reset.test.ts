/** Super Admin: emptying a business after testing. Only that business's
 * records go; its logins, settings and (when asked) its setup stay. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { resetTenant, tenantTables, RESET_KEEP, RESET_SETUP } from "@/server/tenantReset";
import type { Caller } from "@/server/sqlPolicy";

let db: DatabaseSync;
const T0 = "2026-11-01";
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const count = (table: string, tenant: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`).get(tenant) as { n: number }).n);
const ADMIN: Caller = { userId: "sa", role: "super_admin", tenantId: null, permissions: null } as Caller;

function business(id: string) {
  run(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, 'radiology_center', ?, ?)`, id, `Centre ${id}`, T0, T0);
  run(`INSERT INTO users (id, tenant_id, username, role, password_hash, password_salt, is_active, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'x', 'x', 1, ?, ?)`, `u-${id}`, id, `owner-${id}`, T0, T0);
  run(`INSERT INTO settings (key, value, updated_at) VALUES (?, '{"name":"x"}', ?)`, `${id}::hospital.profile`, T0);
  run(`INSERT INTO hospital_services (id, tenant_id, code, name, category, rate, is_active, created_at, updated_at) VALUES (?, ?, 'IMG-001', 'X-Ray', 'imaging', 800, 1, ?, ?)`, `s-${id}`, id, T0, T0);
  run(`INSERT INTO hospital_patients (id, tenant_id, mr_no, name, gender, created_at, updated_at) VALUES (?, ?, 'MR-000001', 'Test', 'Male', ?, ?)`, `p-${id}`, id, T0, T0);
  run(`INSERT INTO hospital_episodes (id, tenant_id, episode_no, type, patient_id, date, status, created_at, updated_at) VALUES (?, ?, 'OPD-1', 'opd', ?, '2026-11-01', 'open', ?, ?)`, `e-${id}`, id, `p-${id}`, T0, T0);
  run(`INSERT INTO hospital_payments (id, tenant_id, episode_id, type, amount, method, received_at, created_at, updated_at) VALUES (?, ?, ?, 'payment', 800, 'cash', ?, ?, ?)`, `pay-${id}`, id, `e-${id}`, T0, T0, T0);
}

beforeEach(() => {
  db = fullSchemaDb();
  business("a");
  business("b");
});

test("a reset empties only that business; logins, settings and (by default here) setup stay", async () => {
  const r = await resetTenant(sqliteSql(db), ADMIN, { tenantId: "a", confirmName: "Centre a", keepSetup: true });
  assert.equal(r.keptSetup, true);
  for (const t of ["hospital_patients", "hospital_episodes", "hospital_payments"]) {
    assert.equal(count(t, "a"), 0, t);
    assert.equal(count(t, "b"), 1, `${t} of another business untouched`);
  }
  assert.equal(count("users", "a"), 1, "logins stay");
  assert.equal(count("hospital_services", "a"), 1, "setup kept");
  assert.ok(db.prepare(`SELECT 1 FROM settings WHERE key = 'a::hospital.profile'`).get(), "settings stay");
  assert.ok(db.prepare(`SELECT 1 FROM server_audit_log WHERE tenant_id = 'a' AND verb = 'RESET'`).get(), "the reset is logged");
});

test("without keeping setup the studies go too; a wrong name or a non-Super Admin changes nothing", async () => {
  await assert.rejects(resetTenant(sqliteSql(db), ADMIN, { tenantId: "a", confirmName: "Centre", keepSetup: false }), /Type the business name/);
  await assert.rejects(resetTenant(sqliteSql(db), { ...ADMIN, role: "owner", tenantId: "a" } as Caller, { tenantId: "a", confirmName: "Centre a" }), /Only the Super Admin/);
  assert.equal(count("hospital_patients", "a"), 1);
  await resetTenant(sqliteSql(db), ADMIN, { tenantId: "a", confirmName: "Centre a", keepSetup: false });
  assert.equal(count("hospital_services", "a"), 0);
  assert.equal(count("users", "a"), 1);
});

test("every kept or setup table really exists", async () => {
  const tables = new Set(await tenantTables(sqliteSql(db)));
  for (const t of [...RESET_KEEP, ...RESET_SETUP]) assert.ok(tables.has(t), t);
});
