/** The device's own database (SQLite through Node's built-in node:sqlite).
 * One file per business and branch, kept in the user's app-data folder
 * (never the install folder), so updates and uninstalls do not touch it.
 * WAL + synchronous=FULL: a saved sale survives a power cut. */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LocalDb {
  run(sql: string, ...args: unknown[]): { changes: number };
  get<T = Record<string, unknown>>(sql: string, ...args: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, ...args: unknown[]): T[];
  /** All or nothing. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T;
  close(): void;
  path: string;
}

/** Local schema versions. Never edit one that has shipped: add the next. */
const MIGRATIONS: string[] = [
  // 1: pilot
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, verifier TEXT, updated_at TEXT NOT NULL);
  CREATE UNIQUE INDEX ux_users_username ON users (username);
  CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, barcode TEXT, packing REAL NOT NULL, tax_pct REAL NOT NULL, is_narcotic INTEGER NOT NULL, track_imei INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX idx_products_barcode ON products (barcode);
  CREATE TABLE prices (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sale_price REAL NOT NULL, created_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX idx_prices_product ON prices (product_id, created_at);
  CREATE TABLE batches (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, batch_no TEXT, expiry_date TEXT, server_qty REAL NOT NULL, purchase_price REAL NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX idx_batches_product ON batches (product_id);
  CREATE TABLE sales (
    id TEXT PRIMARY KEY, offline_ref TEXT NOT NULL UNIQUE, date TEXT NOT NULL, occurred_at TEXT NOT NULL, user_id TEXT NOT NULL,
    customer_name TEXT, customer_phone TEXT, payable REAL NOT NULL, tendered REAL NOT NULL, change_due REAL NOT NULL, payload TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'pending', server_invoice_no INTEGER, server_note TEXT
  );
  CREATE TABLE stock_moves (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, op_id TEXT NOT NULL, batch_id TEXT NOT NULL, qty REAL NOT NULL, applied_seq INTEGER, reflected INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX idx_moves_batch ON stock_moves (batch_id, reflected);
  CREATE TABLE outbox (
    op_id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, kind TEXT NOT NULL, entity_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT, acked_at TEXT, result TEXT
  );
  CREATE INDEX idx_outbox_status ON outbox (status, seq);
  `,
];

export function openDb(path: string, opts: { backupDir?: string; now?: () => Date } = {}): LocalDb {
  mkdirSync(dirname(path), { recursive: true });
  const fresh = !existsSync(path);
  const d = new DatabaseSync(path);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  let depth = 0;
  const db: LocalDb = {
    path,
    run: (sql, ...args) => ({ changes: Number(d.prepare(sql).run(...(args as never[])).changes) }),
    get: (sql, ...args) => d.prepare(sql).get(...(args as never[])) as never,
    all: (sql, ...args) => d.prepare(sql).all(...(args as never[])) as never,
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      d.exec("BEGIN IMMEDIATE");
      try {
        const r = fn();
        d.exec("COMMIT");
        return r;
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => d.close(),
  };
  const version = Number((db.get<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0);
  if (version > MIGRATIONS.length) {
    d.close();
    throw new Error(`This data was written by a newer MAVIN desktop version (${version}). Install the newer version; nothing was changed.`);
  }
  if (version < MIGRATIONS.length) {
    // A copy before changing the structure of a database that has data.
    if (!fresh && opts.backupDir) backupTo(db, opts.backupDir, `before-v${version + 1}`, opts.now);
    for (let v = version; v < MIGRATIONS.length; v++) {
      db.tx(() => {
        d.exec(MIGRATIONS[v]);
        d.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }
  return db;
}

/** A consistent copy of the database (VACUUM INTO), keeping the newest 10. */
export function backupTo(db: LocalDb, dir: string, label: string, now: () => Date = () => new Date()): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `mavin-${now().toISOString().replace(/[:.]/g, "-")}-${label}.db`);
  db.run(`VACUUM INTO ?`, file);
  const old = readdirSync(dir).filter((f) => /^mavin-.*\.db$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 10))) unlinkSync(join(dir, f));
  return file;
}

export const meta = {
  get: (db: LocalDb, key: string) => db.get<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)?.value ?? null,
  set: (db: LocalDb, key: string, value: string | null) => {
    if (value === null) db.run(`DELETE FROM meta WHERE key = ?`, key);
    else db.run(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);
  },
};
