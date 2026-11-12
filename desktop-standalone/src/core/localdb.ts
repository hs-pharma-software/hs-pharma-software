/** Mavin Pharmacy Offline: the local database (one SQLite file per Windows
 * user) and the guard every page statement passes through.
 *
 * The page runs MAVIN's own Pharmacy screens; their SQL is executed here.
 * The guard:
 * - one statement per call; no ATTACH/DETACH, VACUUM, schema changes or
 *   PRAGMA writes from the page;
 * - the desktop's own tables (standalone_*) are never reachable from the page;
 * - password columns are never returned, and never written by the page
 *   (the desktop stores scrypt hashes itself);
 * - with an expired license, nothing is written except settings and logins:
 *   records, reports and backups stay available, new transactions do not. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Row = Record<string, unknown>;

/** The desktop's own tables (added to the server schema). */
const STANDALONE_SCHEMA = `
CREATE TABLE IF NOT EXISTS standalone_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS standalone_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS standalone_catalogue_rows (
  tbl TEXT NOT NULL, row_id TEXT NOT NULL, source_hash TEXT NOT NULL, source_updated_at TEXT, imported_at TEXT NOT NULL,
  PRIMARY KEY (tbl, row_id)
);
CREATE TABLE IF NOT EXISTS standalone_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
`;

/** Local schema changes after the first release (version, SQL). Append only. */
export const STANDALONE_MIGRATIONS: [number, string][] = [
  [1, "SELECT 1"],
];

const NOT_FOR_PAGE = /\b(standalone_[a-z_]+|sqlite_master|sqlite_schema|sqlite_sequence)\b/i;
const FORBIDDEN = /^\s*(ATTACH|DETACH|VACUUM|CREATE|DROP|ALTER|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const PASSWORD_WRITE = /\bpassword_(hash|salt)\b/i;
const HIDDEN = new Set(["password_hash", "password_salt"]);
/** Written even with an expired license (keeps the pharmacy manageable). */
const WRITABLE_WHEN_EXPIRED = new Set(["settings", "users"]);

export class GuardError extends Error {}

/** Strings and comments removed, so keywords inside them do not count. */
function mask(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

export function verbOf(sql: string): "select" | "insert" | "update" | "delete" | "pragma" | "other" {
  const masked = mask(sql);
  // A WITH statement is a write when it contains one (its target is then not recognised and refused).
  if (/^\s*WITH\b/i.test(masked)) {
    const w = /\b(INSERT|REPLACE|UPDATE|DELETE)\b/i.exec(masked);
    return w ? (w[1].toLowerCase() === "replace" ? "insert" : (w[1].toLowerCase() as "insert" | "update" | "delete")) : "select";
  }
  const m = /^\s*(SELECT|INSERT|REPLACE|UPDATE|DELETE|PRAGMA)\b/i.exec(masked);
  const v = (m?.[1] ?? "").toLowerCase();
  if (v === "replace") return "insert";
  return (["select", "insert", "update", "delete", "pragma"].includes(v) ? v : "other") as ReturnType<typeof verbOf>;
}

/** The table a write statement changes. */
export function writeTarget(sql: string): string | null {
  const m = mask(sql);
  const r = /^\s*(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?INTO\s+["`[]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(m)
    ?? /^\s*UPDATE\s+(?:OR\s+\w+\s+)?["`[]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(m)
    ?? /^\s*DELETE\s+FROM\s+["`[]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(m);
  return r ? r[1].toLowerCase() : null;
}

export interface GuardOptions { licenseActive: boolean }

/** Throws unless the page may run this statement. */
export function guard(sql: string, o: GuardOptions): "select" | "insert" | "update" | "delete" | "pragma" {
  if (typeof sql !== "string" || !sql.trim()) throw new GuardError("Empty statement.");
  const m = mask(sql);
  if (/;\s*\S/.test(m)) throw new GuardError("Send one statement at a time.");
  if (FORBIDDEN.test(m)) throw new GuardError("This statement is not allowed.");
  if (NOT_FOR_PAGE.test(m)) throw new GuardError("This table is managed by the desktop.");
  const verb = verbOf(sql);
  if (verb === "other") throw new GuardError("This statement is not allowed.");
  if (verb === "pragma" && !/^\s*PRAGMA\s+(table_info|index_list|foreign_key_list)\s*\(/i.test(m)) throw new GuardError("This PRAGMA is not allowed.");
  if (verb === "insert" || verb === "update" || verb === "delete") {
    const target = writeTarget(sql);
    if (!target) throw new GuardError("Unrecognised write.");
    // Passwords are set by the desktop only; a new login is inserted with the placeholder "!".
    if (verb === "update" && PASSWORD_WRITE.test(m)) throw new GuardError("Passwords are changed through the desktop.");
    if (!o.licenseActive && !WRITABLE_WHEN_EXPIRED.has(target)) {
      throw new GuardError("The license of this installation has expired. Records, reports and backups stay available; renew the license in Settings > Mavin Pharmacy Offline to enter new transactions.");
    }
  }
  return verb;
}

const plain = (v: unknown) => (typeof v === "bigint" ? Number(v) : v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v);
const arg = (v: unknown) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v) as string | number | null;

export class LocalDb {
  readonly db: DatabaseSync;
  readonly file: string;
  constructor(file: string, serverSchema: string) {
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;");
    this.db.exec(STANDALONE_SCHEMA);
    if (!this.meta("schema_applied_at")) {
      // A new installation: MAVIN's full schema (every server migration, in order).
      this.db.exec("BEGIN");
      try {
        this.db.exec(serverSchema);
        this.setMeta("schema_applied_at", new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    for (const [v, sql] of STANDALONE_MIGRATIONS) {
      if (this.db.prepare(`SELECT 1 FROM standalone_migrations WHERE version = ?`).get(v)) continue;
      this.tx(() => {
        this.db.exec(sql);
        this.db.prepare(`INSERT INTO standalone_migrations (version, applied_at) VALUES (?, ?)`).run(v, new Date().toISOString());
      });
    }
  }

  meta(key: string): string | null {
    const r = this.db.prepare(`SELECT value FROM standalone_meta WHERE key = ?`).get(key) as { value: string | null } | undefined;
    return r?.value ?? null;
  }
  setMeta(key: string, value: string | null) {
    if (value === null) this.db.prepare(`DELETE FROM standalone_meta WHERE key = ?`).run(key);
    else this.db.prepare(`INSERT INTO standalone_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, new Date().toISOString());
  }
  audit(actor: string | null, action: string, detail?: unknown) {
    this.db.prepare(`INSERT INTO standalone_audit (at, actor, action, detail) VALUES (?, ?, ?, ?)`).run(new Date().toISOString(), actor, action, detail === undefined ? null : JSON.stringify(detail));
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ── The page's statements ──
  pageSelect(sql: string, params: unknown[], o: GuardOptions): Row[] {
    const verb = guard(sql, o);
    if (verb !== "select" && verb !== "pragma") throw new GuardError("Use execute for writes.");
    const rows = this.db.prepare(sql).all(...params.map(arg)) as Row[];
    return rows.map((r) => {
      const out: Row = {};
      for (const [k, v] of Object.entries(r)) if (!HIDDEN.has(k.toLowerCase())) out[k] = plain(v);
      return out;
    });
  }
  pageExecute(sql: string, params: unknown[], o: GuardOptions): { rowsAffected: number; lastInsertId?: number } {
    const verb = guard(sql, o);
    if (verb === "select" || verb === "pragma") {
      this.db.prepare(sql).all(...params.map(arg));
      return { rowsAffected: 0 };
    }
    const r = this.db.prepare(sql).run(...params.map(arg));
    return { rowsAffected: Number(r.changes), lastInsertId: Number((r as { lastInsertRowid?: number | bigint }).lastInsertRowid ?? 0) };
  }
  /** All statements in one transaction: all or nothing. */
  pageBatch(statements: { sql: string; params?: unknown[] }[], o: GuardOptions): void {
    if (!Array.isArray(statements) || statements.length > 500) throw new GuardError("Too many statements.");
    for (const s of statements) guard(s.sql, o);
    this.tx(() => { for (const s of statements) this.db.prepare(s.sql).run(...(s.params ?? []).map(arg)); });
  }

  close() { try { this.db.close(); } catch { /* closed */ } }
}
