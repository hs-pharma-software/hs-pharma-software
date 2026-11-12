import { isTauriShell as isTauri } from "./platform";
import { createClient, type Client } from "@libsql/client/web";
import { explainMissingTable } from "./dbErrors";
import { SERVER_DB, serverJson, ServerRequestError } from "./serverMode";
import { desktopBridge, desktopOffline, NeedsInternetError } from "./desktopBridge";
import { localBridge, unwrap } from "./edition";

/** MAVIN desktop app, offline: reads from its read-only copy of this business's data. */
async function desktopCopy(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const r = await desktopBridge()!.query({ sql, params });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const noConnection = (e: unknown) => e instanceof ServerRequestError && e.status === 0;

type ServerResult = { columns: string[]; rows: unknown[][]; rowsAffected: number; lastInsertRowid: number | null };

/** Web version through the server: the statements go to /api/db with the session cookie. */
async function viaServer(statements: { sql: string; args: unknown[] }[], batch: boolean): Promise<ServerResult[]> {
  try {
    return (await serverJson<{ results: ServerResult[] }>("/api/db/", { statements, batch })).results;
  } catch (e) {
    return explain(e);
  }
}

// One database for the whole ecosystem (Pharmacy POS, Hospital, Clinic):
// the existing Turso database, and on the desktop its local SQLite copy
// (pharmacy.db) kept in step by the sync engine (lib/sync/engine.ts).

// ── Turso client (browser / Vercel web version) ──────────────────────
// When running in a browser (deployed on Vercel), every read/write goes
// directly to the Turso cloud DB — no local SQLite, no sync delay.
let tursoClient: Client | null = null;

function getTursoClient(): Client {
  if (!tursoClient) {
    const url = process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
    const authToken = process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
    if (!url || !authToken)
      throw new Error(
        "Turso not configured — set NEXT_PUBLIC_TURSO_DATABASE_URL and NEXT_PUBLIC_TURSO_AUTH_TOKEN"
      );
    tursoClient = createClient({ url, authToken });
  }
  return tursoClient;
}

// ── Tauri SQLite (desktop app) ────────────────────────────────────────
// Dynamically imported so the browser bundle never tries to load the
// Tauri plugin (which only exists inside the desktop shell).
let dbPromise: Promise<import("@tauri-apps/plugin-sql").default> | null = null;

async function getTauriDb(): Promise<import("@tauri-apps/plugin-sql").default> {
  if (!dbPromise) {
    dbPromise = import("@tauri-apps/plugin-sql").then((m) => m.default.load("sqlite:pharmacy.db"));
  }
  return dbPromise;
}

/** A missing table means the database was not brought up to date: say so plainly. */
function explain(err: unknown): never {
  throw explainMissingTable(err) ?? err;
}

// ── Public API ────────────────────────────────────────────────────────

export async function dbSelect<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  // Mavin Pharmacy Offline: its own local database, through the desktop.
  const local = localBridge();
  if (local) return (await unwrap(local.select({ sql, params })).catch(explain)) as T[];
  if (isTauri()) {
    const db = await getTauriDb();
    return db.select<T[]>(sql, params).catch(explain);
  }
  if (SERVER_DB) {
    // Desktop app without a connection: the same query on its read-only copy.
    if (desktopBridge() && desktopOffline()) return (await desktopCopy(sql, params)) as T[];
    try {
      const [r] = await viaServer([{ sql, args: params }], false);
      return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])) as T);
    } catch (e) {
      if (desktopBridge() && noConnection(e)) return (await desktopCopy(sql, params)) as T[];
      throw e;
    }
  }
  // Browser / Vercel: query Turso directly
  const result = await getTursoClient().execute({ sql, args: params as never[] }).catch(explain);
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}

export async function dbExecute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const local = localBridge();
  if (local) return unwrap(local.execute({ sql, params })).catch(explain);
  if (isTauri()) {
    const db = await getTauriDb();
    return db.execute(sql, params).catch(explain);
  }
  if (SERVER_DB) {
    if (desktopBridge() && desktopOffline()) throw new NeedsInternetError("Saving this change");
    try {
      const [r] = await viaServer([{ sql, args: params }], false);
      return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertRowid ?? undefined };
    } catch (e) {
      if (desktopBridge() && noConnection(e)) throw new NeedsInternetError("Saving this change");
      throw e;
    }
  }
  // Browser / Vercel: write to Turso directly
  const result = await getTursoClient().execute({ sql, args: params as never[] }).catch(explain);
  return {
    rowsAffected: result.rowsAffected,
    lastInsertId: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
  };
}

/** Several writes that belong together (a record and its audit row), applied
 * all or nothing on Turso (one write batch). On the desktop the SQL plugin
 * cannot hold one transaction across calls, so they run in order there. */
export async function dbBatch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
  // Standalone: one local transaction (all or nothing).
  const local = localBridge();
  if (local) { await unwrap(local.batch({ statements })).catch(explain); return; }
  if (isTauri()) {
    const db = await getTauriDb();
    for (const s of statements) await db.execute(s.sql, s.params ?? []).catch(explain);
    return;
  }
  if (SERVER_DB) {
    if (desktopBridge() && desktopOffline()) throw new NeedsInternetError("Saving this change");
    try {
      await viaServer(statements.map((s) => ({ sql: s.sql, args: s.params ?? [] })), true);
    } catch (e) {
      if (desktopBridge() && noConnection(e)) throw new NeedsInternetError("Saving this change");
      throw e;
    }
    return;
  }
  await getTursoClient().batch(statements.map((s) => ({ sql: s.sql, args: (s.params ?? []) as never[] })), "write").catch(explain);
}
