import { isTauriShell as isTauri } from "./platform";
import { createClient, type Client } from "@libsql/client/web";
import { resolveSystem, SYSTEM_DB_FILE, type DbSystem } from "./dbRouting";
import { copyTenantData, type SqlRunner } from "./dbSplit";
import { explainMissingTable } from "./dbErrors";
import { businessType } from "../config/businessTypes";
import { useAuthStore } from "../store/authStore";

/** Where a query runs: the Hospital database, the Clinic database, or the
 * platform database (see dbRouting.ts for the rules). Callers normally pass
 * nothing and the logged-in tenant's business type decides; `system` forces
 * one, for the few reads that cross over (the pharmacy mailbox). */
export interface DbOpts {
  system?: DbSystem;
}

function sessionTypeId(): string | null {
  const raw = useAuthStore.getState().currentTenant?.businessType;
  return raw ? businessType(raw).id : null;
}

function systemOf(sql: string, opts?: DbOpts): DbSystem {
  return resolveSystem(sql, sessionTypeId(), opts?.system);
}

// ── Turso (browser / Vercel web version) ─────────────────────────────
// Hospital and Clinic can have their own Turso database. Until their URL and
// token are set, they use the platform database exactly as before.
// (Each NEXT_PUBLIC_ variable is written out in full: Next inlines them only so.)
export function tursoConfigFor(system: DbSystem): { url: string; authToken: string } | null {
  const own =
    system === "hospital"
      ? { url: process.env.NEXT_PUBLIC_TURSO_HOSPITAL_DATABASE_URL, authToken: process.env.NEXT_PUBLIC_TURSO_HOSPITAL_AUTH_TOKEN }
      : system === "clinic"
        ? { url: process.env.NEXT_PUBLIC_TURSO_CLINIC_DATABASE_URL, authToken: process.env.NEXT_PUBLIC_TURSO_CLINIC_AUTH_TOKEN }
        : { url: undefined, authToken: undefined };
  if (own.url && own.authToken) return { url: own.url, authToken: own.authToken };
  const url = process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const authToken = process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
  return url && authToken ? { url, authToken } : null;
}

const tursoClients = new Map<string, Client>();

function getTursoClient(system: DbSystem): Client {
  const cfg = tursoConfigFor(system);
  if (!cfg)
    throw new Error("Turso not configured — set NEXT_PUBLIC_TURSO_DATABASE_URL and NEXT_PUBLIC_TURSO_AUTH_TOKEN");
  let c = tursoClients.get(cfg.url);
  if (!c) {
    c = createClient(cfg);
    tursoClients.set(cfg.url, c);
  }
  return c;
}

// ── Tauri SQLite (desktop app) ────────────────────────────────────────
// One SQLite file per system, each migrated with the full schema by the Rust
// side. Dynamically imported so the browser bundle never loads the plugin.
type TauriDb = import("@tauri-apps/plugin-sql").default;
const tauriDbs = new Map<DbSystem, Promise<TauriDb>>();

function getTauriDb(system: DbSystem): Promise<TauriDb> {
  let p = tauriDbs.get(system);
  if (!p) {
    p = import("@tauri-apps/plugin-sql").then((m) => m.default.load(`sqlite:${SYSTEM_DB_FILE[system]}`));
    tauriDbs.set(system, p);
  }
  return p;
}

function explain(err: unknown): never {
  throw explainMissingTable(err) ?? err;
}

// ── Raw access to one named system (no routing, no first-use copy) ────

export async function rawSelect<T = Record<string, unknown>>(system: DbSystem, sql: string, params: unknown[] = []): Promise<T[]> {
  if (isTauri()) {
    const db = await getTauriDb(system);
    return db.select<T[]>(sql, params).catch(explain);
  }
  const result = await getTursoClient(system).execute({ sql, args: params as never[] }).catch(explain);
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}

export async function rawExecute(
  system: DbSystem,
  sql: string,
  params: unknown[] = []
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  if (isTauri()) {
    const db = await getTauriDb(system);
    return db.execute(sql, params).catch(explain);
  }
  const result = await getTursoClient(system).execute({ sql, args: params as never[] }).catch(explain);
  return {
    rowsAffected: result.rowsAffected,
    lastInsertId: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
  };
}

// ── First use of a Hospital / Clinic database on the desktop ─────────
// Existing data of the tenant still sits in the platform file. It is copied
// (never moved or deleted) into the tenant's own database once.
const ready = new Map<string, Promise<void>>();

function ensureSystemReady(system: DbSystem): Promise<void> {
  if (system === "platform" || !isTauri()) return Promise.resolve();
  const tenantId = useAuthStore.getState().currentTenant?.id;
  if (!tenantId) return Promise.resolve();
  const key = `${system}:${tenantId}`;
  let p = ready.get(key);
  if (!p) {
    const source: SqlRunner = { select: (s, a) => rawSelect("platform", s, a), execute: (s, a) => rawExecute("platform", s, a) };
    const target: SqlRunner = { select: (s, a) => rawSelect(system, s, a), execute: (s, a) => rawExecute(system, s, a) };
    p = copyTenantData(source, target, tenantId).then(() => undefined);
    ready.set(key, p);
    // A failed copy must not leave an empty database looking like "no data":
    // forget it so the next query retries, and let this one fail loudly.
    p.catch(() => ready.delete(key));
  }
  return p;
}

// ── Public API ────────────────────────────────────────────────────────

export async function dbSelect<T = Record<string, unknown>>(sql: string, params: unknown[] = [], opts?: DbOpts): Promise<T[]> {
  const system = systemOf(sql, opts);
  await ensureSystemReady(system);
  return rawSelect<T>(system, sql, params);
}

export async function dbExecute(
  sql: string,
  params: unknown[] = [],
  opts?: DbOpts
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const system = systemOf(sql, opts);
  await ensureSystemReady(system);
  return rawExecute(system, sql, params);
}
