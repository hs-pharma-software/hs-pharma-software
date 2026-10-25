/** Test stand-in for src/lib/db.ts (the Tauri / Turso client): the app's
 * repositories run unchanged against an in-memory node:sqlite database
 * that a test installs with setTestDb(). */
import type { DatabaseSync } from "node:sqlite";

let current: DatabaseSync | null = null;
export function setTestDb(db: DatabaseSync) {
  current = db;
}
function db(): DatabaseSync {
  if (!current) throw new Error("No test database installed (setTestDb).");
  return current;
}
const norm = (params: unknown[]) => params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : p)) as never[];

export async function dbSelect<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  policyAudit(sql);
  return db().prepare(scoped(sql, params)).all(...norm(params)) as T[];
}

export async function dbExecute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  policyAudit(sql);
  const r = db().prepare(scoped(sql, params)).run(...norm(params));
  return { rowsAffected: Number(r.changes) };
}

export async function dbBatch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
  const d = db();
  d.exec("BEGIN");
  try {
    for (const s of statements) {
      policyAudit(s.sql);
      d.prepare(scoped(s.sql, s.params ?? [])).run(...norm(s.params ?? []));
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

// ── Optional: check every statement against the server policy ─────────────
// POLICY_AUDIT=<file> npm test  writes each statement the server would refuse
// (as the logged-in test user) to <file>, one JSON line each.
import { appendFileSync } from "node:fs";
import { analyzeSql, authorize, type Caller } from "../../src/server/sqlPolicy";
import { useAuthStore } from "../../src/store/authStore";

function policyAudit(sql: string) {
  const file = process.env.POLICY_AUDIT;
  if (!file || !current) return;
  const u = useAuthStore.getState().currentUser;
  if (!u) return;
  const caller: Caller = { userId: u.id, role: u.role, tenantId: u.tenantId };
  const known = new Set((current.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view')`).all() as { name: string }[]).map((r) => r.name.toLowerCase()));
  const d = authorize(analyzeSql(sql), caller, known);
  if (!d.ok) appendFileSync(file, JSON.stringify({ role: caller.role, reason: d.reason, sql: sql.replace(/\s+/g, " ").slice(0, 300) }) + "\n");
}

// ── Optional: run every statement through the server's tenant rewrite ─────
// TENANT_SCOPE=1 npm test  executes the SQL exactly as /api/db would after
// src/server/tenantScope.ts rewrote it for the logged-in test user.
import { scopeStatement, type Schema } from "../../src/server/tenantScope";
import { sharedCatalogGroupsFor } from "../../src/lib/catalogAccess";

function scoped(sql: string, params: unknown[]): string {
  if (process.env.TENANT_SCOPE !== "1" || !current) return sql;
  const { currentUser, currentTenant } = useAuthStore.getState();
  if (!currentUser || currentUser.role === "super_admin" || !currentUser.tenantId) return sql;
  // Logins are created by /api/auth/users on the server, not through /api/db.
  if (/^\s*INSERT\s+INTO\s+users\b/i.test(sql)) return sql;
  const schema: Schema = new Map();
  for (const r of current.prepare(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`).all() as { t: string; c: string }[]) {
    const k = r.t.toLowerCase();
    if (!schema.has(k)) schema.set(k, new Set());
    schema.get(k)!.add(r.c.toLowerCase());
  }
  const linked = (current.prepare(`SELECT pharmacy_tenant_id AS p FROM clinic_pharmacy_link WHERE clinic_tenant_id = ? AND is_active = 1`).all(currentUser.tenantId) as { p: string }[]).map((r) => r.p);
  return scopeStatement(sql, params, { tenantId: currentUser.tenantId, sharedGroups: sharedCatalogGroupsFor(currentTenant?.businessType), linkedPharmacies: linked }, schema);
}
