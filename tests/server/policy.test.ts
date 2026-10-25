/** The server layer's rules: what the browser may send to /api/db, and the
 * signed session. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import { issueSession, verifySession, readCookie, sessionCookie } from "@/server/session";

const KNOWN = new Set(["hospital_patients", "hospital_episodes", "users", "tenants", "subscription_plans", "products", "invoices", "settings", "hospital_form_records", "schema_migrations", "dist_loc_points"]);
const owner: Caller = { userId: "u1", role: "owner", tenantId: "t1" };
const staff: Caller = { userId: "u2", role: "staff", tenantId: "t1" };
const admin: Caller = { userId: "u0", role: "super_admin", tenantId: null };
const ok = (sql: string, c: Caller = owner) => authorize(analyzeSql(sql), c, KNOWN);

test("statements the app sends are allowed", () => {
  for (const sql of [
    "SELECT * FROM hospital_patients WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name",
    "SELECT e.*, p.name AS patient_name FROM hospital_episodes e LEFT JOIN hospital_patients p ON p.id = e.patient_id WHERE e.tenant_id = ?",
    "INSERT INTO hospital_form_records (id, tenant_id, data) VALUES (?, ?, ?)",
    "UPDATE hospital_patients SET name = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
    "DELETE FROM dist_loc_points WHERE tenant_id = ? AND recorded_at < ?",
    "WITH recent AS (SELECT id FROM invoices WHERE tenant_id = ?) SELECT COUNT(*) FROM recent",
  ]) assert.deepEqual(ok(sql), { ok: true }, sql);
  assert.deepEqual(ok("SELECT value FROM settings WHERE key = 'it''s; fine'"), { ok: true }, "semicolons inside strings are not a second statement");
  assert.deepEqual(ok("SELECT MAX(version) AS v FROM schema_migrations"), { ok: true });
});

test("schema changes, several statements, internal and unknown tables are refused", () => {
  assert.deepEqual(ok("DROP TABLE hospital_patients"), { ok: false, reason: "Schema changes run only from the migration script." });
  for (const sql of ["ALTER TABLE users ADD COLUMN x TEXT", "CREATE TABLE x (id TEXT)", "PRAGMA table_info(users)", "ATTACH DATABASE 'x' AS y", "VACUUM"]) {
    assert.equal(ok(sql).ok, false, sql);
  }
  assert.equal(ok("SELECT 1; DROP TABLE users").ok, false, "piggy-backed statement");
  assert.equal(ok("SELECT * FROM sqlite_master").ok, false);
  assert.equal(ok("SELECT * FROM server_audit_log").ok, false);
  assert.equal(ok("SELECT * FROM no_such_table").ok, false);
  assert.equal(ok("SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) p").ok, false, "schema introspection is not for the browser");
});

test("password columns never reach the browser; logins and passwords go through the server", () => {
  assert.equal(ok("SELECT password_hash FROM users WHERE id = ?").ok, false);
  assert.equal(ok("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").ok, false);
  assert.equal(ok("SELECT * FROM users WHERE id = ?").ok, true, "the server strips the hash from the result");
  assert.equal(ok("UPDATE users SET permissions = ? WHERE id = ?").ok, true, "the owner edits a login's access");
  assert.equal(ok("UPDATE users SET permissions = ? WHERE id = ?", staff).ok, false, "staff cannot edit logins");
});

test("only the Super Admin writes tenants and plans", () => {
  assert.equal(ok("UPDATE tenants SET subscription_status = 'active' WHERE id = ?").ok, false);
  assert.equal(ok("INSERT INTO subscription_plans (id) VALUES (?)").ok, false);
  assert.equal(ok("UPDATE tenants SET subscription_status = 'active' WHERE id = ?", admin).ok, true);
  assert.equal(ok("SELECT * FROM tenants WHERE id = ?").ok, true, "reading the own tenant is allowed");
});

test("analysis: verbs, CTEs and quoted names", () => {
  assert.equal(analyzeSql("WITH x AS (SELECT 1) UPDATE products SET name = ? WHERE id IN (SELECT * FROM x)").verb, "update");
  assert.deepEqual(analyzeSql(`SELECT * FROM "hospital_patients" p JOIN [hospital_episodes] e ON 1`).tables.sort(), ["hospital_episodes", "hospital_patients"]);
  assert.deepEqual(analyzeSql("WITH a AS (SELECT * FROM invoices), b AS (SELECT * FROM a) SELECT * FROM b").tables, ["invoices"]);
  assert.equal(analyzeSql("-- DROP TABLE users\nSELECT 1 FROM products").verb, "select");
});

test("sessions: signed, expiring, tamper-proof; cookie is httpOnly", () => {
  const secret = "x".repeat(40);
  const { token } = issueSession("user-1", secret, 1_000);
  assert.equal(verifySession(token, secret, 2_000)?.u, "user-1");
  assert.equal(verifySession(token, secret, 1_000 + 13 * 3600_000), null, "expired after 12 hours");
  assert.equal(verifySession(token, "y".repeat(40), 2_000), null, "another secret");
  const [body, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "admin", exp: 9e15 })).toString("base64url");
  assert.equal(verifySession(`${forged}.${mac}`, secret, 2_000), null, "changed claims");
  assert.equal(verifySession(`${body}.`, secret, 2_000), null);
  assert.equal(verifySession(null, secret), null);
  const cookie = sessionCookie(token, 3600, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(readCookie(`a=1; hs_session=${token}; b=2`), token);
});

test("a staff login without any hospital section cannot reach hospital records", () => {
  const cashier: Caller = { userId: "u3", role: "staff", tenantId: "t1", permissions: ["invoices", "products"] };
  const nurse: Caller = { userId: "u4", role: "staff", tenantId: "t1", permissions: ["hospital_patients", "hospital_episodes"] };
  const full: Caller = { userId: "u5", role: "staff", tenantId: "t1", permissions: null };
  const sql = "SELECT * FROM hospital_patients WHERE tenant_id = ?";
  assert.equal(ok(sql, cashier).ok, false);
  assert.equal(ok(sql, nurse).ok, true);
  assert.equal(ok(sql, full).ok, true, "a staff login with full access");
  assert.equal(ok("SELECT * FROM products WHERE tenant_id = ?", cashier).ok, true);
});
