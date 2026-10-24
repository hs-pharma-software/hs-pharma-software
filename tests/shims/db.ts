/** Test stand-in for src/lib/db.ts (the Tauri / Turso client): the app's
 * repositories run unchanged against an in-memory node:sqlite database
 * that a test installs with setTestDb(). Statements run on that one database
 * whatever `opts.system` says; routing itself is tested in dbRouting.test.ts
 * and the split with two real databases in dbSplit.test.ts. */
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

export async function dbSelect<T = Record<string, unknown>>(sql: string, params: unknown[] = [], _opts?: unknown): Promise<T[]> {
  return db().prepare(sql).all(...norm(params)) as T[];
}

export async function dbExecute(sql: string, params: unknown[] = [], _opts?: unknown): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const r = db().prepare(sql).run(...norm(params));
  return { rowsAffected: Number(r.changes) };
}

export const rawSelect = (_system: unknown, sql: string, params: unknown[] = []) => dbSelect(sql, params);
export const rawExecute = (_system: unknown, sql: string, params: unknown[] = []) => dbExecute(sql, params);
export function tursoConfigFor(): { url: string; authToken: string } | null {
  return null;
}
