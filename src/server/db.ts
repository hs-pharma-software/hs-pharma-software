/** The server's connection to the shared Turso database, the caller check,
 * and running the statements the browser sends (after sqlPolicy allows them). */
import { createClient, type Client, type InStatement, type ResultSet } from "@libsql/client/web";
import { createHash, randomUUID } from "node:crypto";
import { serverConfig } from "./config";
import { verifySession, readCookie } from "./session";
import { analyzeSql, authorize, personalScope, HIDDEN_COLUMNS, type Caller } from "./sqlPolicy";
import { scopeStatement, ScopeError, type Schema } from "./tenantScope";
import { sharedCatalogGroupsFor } from "../lib/catalogAccess";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

let client: Client | null = null;
export function serverDb(): Client {
  if (!client) {
    const c = serverConfig();
    client = createClient({ url: c.tursoUrl, authToken: c.tursoToken });
  }
  return client;
}

let cache: { at: number; names: Set<string>; schema: Schema } | null = null;
/** The database's tables and their columns, refreshed every 5 minutes (a migration adds them). */
async function schemaInfo(): Promise<{ names: Set<string>; schema: Schema }> {
  if (cache && Date.now() - cache.at < 300_000) return cache;
  const rs = await serverDb().execute(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table', 'view')`);
  const schema: Schema = new Map();
  for (const r of rs.rows) {
    const t = String(r.t).toLowerCase();
    if (!schema.has(t)) schema.set(t, new Set());
    schema.get(t)!.add(String(r.c).toLowerCase());
  }
  cache = { at: Date.now(), names: new Set(schema.keys()), schema };
  return cache;
}
export async function knownTables(): Promise<Set<string>> {
  return (await schemaInfo()).names;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The logged-in, active user behind a request. */
export async function callerOf(req: Request): Promise<Caller> {
  const claims = verifySession(readCookie(req.headers.get("cookie")), serverConfig().sessionSecret);
  if (!claims) throw new HttpError(401, "Your session has ended. Log in again.");
  const rs = await serverDb().execute({
    sql: `SELECT u.id, u.role, u.tenant_id, u.is_active, u.permissions, t.business_type,
                 (SELECT group_concat(l.pharmacy_tenant_id) FROM clinic_pharmacy_link l WHERE l.clinic_tenant_id = u.tenant_id AND l.is_active = 1) AS linked
          FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ? AND u.deleted_at IS NULL`,
    args: [claims.u],
  });
  const u = rs.rows[0];
  if (!u || !Number(u.is_active)) throw new HttpError(401, "This login is no longer active.");
  let permissions: string[] | null = null;
  if (u.permissions != null && String(u.role) === "staff") {
    try {
      const p = JSON.parse(String(u.permissions));
      permissions = Array.isArray(p) ? p.map(String) : [];
    } catch {
      permissions = [];
    }
  }
  return {
    userId: String(u.id), role: String(u.role) as Caller["role"], tenantId: u.tenant_id == null ? null : String(u.tenant_id),
    permissions, businessType: u.business_type == null ? null : String(u.business_type),
    linkedPharmacies: u.linked ? String(u.linked).split(",").filter(Boolean) : [],
  };
}

export interface ClientStatement { sql: string; args?: unknown[] }

const MAX_STATEMENTS = 200;

/** Checks every statement, then runs them (several together as one atomic batch). */
export async function runForCaller(caller: Caller, statements: ClientStatement[], batch: boolean, ip: string | null) {
  if (!Array.isArray(statements) || statements.length === 0) throw new HttpError(400, "No statement.");
  if (statements.length > MAX_STATEMENTS) throw new HttpError(400, "Too many statements in one request.");
  const { names: known, schema } = await schemaInfo();
  if (caller.role !== "super_admin" && !caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
  const checked = statements.map((s) => {
    if (typeof s?.sql !== "string" || (s.args != null && !Array.isArray(s.args))) throw new HttpError(400, "Malformed statement.");
    const a = analyzeSql(s.sql);
    const d = authorize(a, caller, known);
    if (!d.ok) throw new HttpError(403, d.reason);
    // Every statement of a business login is rewritten to stay inside that business (tenantScope.ts).
    let sql = s.sql;
    if (caller.role !== "super_admin") {
      try {
        sql = scopeStatement(s.sql, s.args ?? [], {
          tenantId: caller.tenantId!, sharedGroups: sharedCatalogGroupsFor(caller.businessType), linkedPharmacies: caller.linkedPharmacies ?? [], personal: personalScope(caller),
        }, schema);
      } catch (e) {
        if (e instanceof ScopeError) throw new HttpError(403, e.message);
        throw e;
      }
    }
    return { s, a, sql };
  });
  const stmts: InStatement[] = checked.map(({ s, sql }) => ({ sql, args: (s.args ?? []).map(toArg) }));
  const results: ResultSet[] = batch || stmts.length > 1 ? await serverDb().batch(stmts, "write") : [await serverDb().execute(stmts[0])];

  const writes = checked.filter((c) => c.a.verb !== "select");
  if (writes.length) {
    const now = new Date().toISOString();
    await serverDb().batch(writes.map(({ s, a }) => ({
      sql: `INSERT INTO server_audit_log (id, user_id, tenant_id, role, verb, tables, statement, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), caller.userId, caller.tenantId, caller.role, a.verb, a.tables.join(","), s.sql.slice(0, 500), ip, now],
    })), "write").catch(() => undefined); // never fail the user's write because the log row could not be added
  }
  return results.map(shape);
}

/** Values the browser may send: JSON has no bigint / blob, so numbers, strings, booleans and null. */
function toArg(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  throw new HttpError(400, "Unsupported value type in a statement.");
}

function shape(r: ResultSet) {
  const keep = r.columns.map((c) => !HIDDEN_COLUMNS.has(c.toLowerCase()));
  return {
    columns: r.columns.filter((_, i) => keep[i]),
    rows: r.rows.map((row) => r.columns.map((_, i) => row[i]).filter((_, i) => keep[i]).map((v) => (typeof v === "bigint" ? Number(v) : v))),
    rowsAffected: r.rowsAffected,
    lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid),
  };
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Same scheme the app has always used (lib/auth.ts), so existing passwords keep working. */
export const passwordHash = (password: string, salt: string) => sha256(`${salt}:${password}`);

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

export function jsonError(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  const name = (e as Error)?.constructor?.name;
  if (name === "ConfigError") return Response.json({ error: (e as Error).message }, { status: 500 });
  // Database messages can echo SQL; they never include argument values.
  const msg = e instanceof Error ? e.message : String(e);
  return Response.json({ error: msg.replace(/\s+/g, " ").slice(0, 300) }, { status: 400 });
}
