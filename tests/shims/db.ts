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
  return db().prepare(sql).all(...norm(params)) as T[];
}

export async function dbExecute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  policyAudit(sql);
  const r = db().prepare(sql).run(...norm(params));
  return { rowsAffected: Number(r.changes) };
}

export async function dbBatch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
  const d = db();
  d.exec("BEGIN");
  try {
    for (const s of statements) {
      policyAudit(s.sql);
      d.prepare(s.sql).run(...norm(s.params ?? []));
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
