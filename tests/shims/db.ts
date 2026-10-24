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
  return db().prepare(sql).all(...norm(params)) as T[];
}

export async function dbExecute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const r = db().prepare(sql).run(...norm(params));
  return { rowsAffected: Number(r.changes) };
}
