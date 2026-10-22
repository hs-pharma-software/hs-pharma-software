import { isTauriShell as isTauri } from "./platform";
import { createClient, type Client } from "@libsql/client/web";

// ── Turso client (browser / Vercel web version) ──────────────────────
// When running in a browser (deployed on Vercel), every read/write goes
// directly to the Turso cloud DB \u2014 no local SQLite, no sync delay.
let tursoClient: Client | null = null;

function getTursoClient(): Client {
  if (!tursoClient) {
    const url = process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
    const authToken = process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
    if (!url || !authToken)
      throw new Error(
        "Turso not configured \u2014 set NEXT_PUBLIC_TURSO_DATABASE_URL and NEXT_PUBLIC_TURSO_AUTH_TOKEN"
      );
    tursoClient = createClient({ url, authToken });
  }
  return tursoClient;
}

// ── Tauri SQLite (desktop app) ────────────────────────────────────────
// Dynamically imported so the browser bundle never tries to load the
// Tauri plugin (which only exists inside the desktop shell).
// The sync engine (lib/sync/engine.ts) pushes local changes to Turso
// and pulls remote changes back \u2014 every 60 s and on demand.
let dbPromise: Promise<import("@tauri-apps/plugin-sql").default> | null = null;

async function getTauriDb(): Promise<import("@tauri-apps/plugin-sql").default> {
  if (!dbPromise) {
    dbPromise = import("@tauri-apps/plugin-sql").then((m) =>
      m.default.load("sqlite:pharmacy.db")
    );
  }
  return dbPromise;
}

// ── Public API ────────────────────────────────────────────────────────

export async function dbSelect<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (isTauri()) {
    const db = await getTauriDb();
    return db.select<T[]>(sql, params);
  }
  // Browser / Vercel: query Turso directly
  const client = getTursoClient();
  const result = await client.execute({ sql, args: params as never[] });
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}

export async function dbExecute(
  sql: string,
  params: unknown[] = []
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  if (isTauri()) {
    const db = await getTauriDb();
    return db.execute(sql, params);
  }
  // Browser / Vercel: write to Turso directly
  const client = getTursoClient();
  const result = await client.execute({ sql, args: params as never[] });
  return {
    rowsAffected: result.rowsAffected,
    lastInsertId:
      result.lastInsertRowid !== undefined
        ? Number(result.lastInsertRowid)
        : undefined,
  };
}
