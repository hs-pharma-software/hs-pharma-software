/** A read-only copy of this business's data (products, prices, this branch's
 * stock, customers, settings ...) with the SAME structure as the server's
 * database, so the web screens can read it with their own SQL when the
 * internet is down. It is a cache: refreshed from the server, never the source
 * of truth. Sales made offline on this computer are laid over it (their
 * stock taken, their invoices listed) until the server's copy includes them.
 *
 * The page may only run one SELECT, on a separate read-only connection. */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { SalePayload } from "../../../src/offline/protocol";

export interface LocalSale { payload: SalePayload; status: string; serverInvoiceNo: number | null }
export type FetchPage = (table: string, offset: number, since?: string | null) => Promise<{ rows: Record<string, unknown>[]; next: number | null; cutoff?: string | null }>;

/** History items and the document they belong to (items leave with it). */
const HISTORY_PARENT: Record<string, { table: string; column: string }> = {
  invoice_items: { table: "invoices", column: "invoice_id" },
  purchase_items: { table: "purchases", column: "purchase_id" },
};

const WRITE = /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/** Only one SELECT (or WITH ... SELECT); string literals and comments are ignored when checking. */
export function readOnlySql(sql: string): boolean {
  const body = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:[^']|'')*'/g, "''").trim().replace(/;\s*$/, "");
  if (body.includes(";")) return false;
  if (!/^(SELECT|WITH)\b/i.test(body)) return false;
  return !WRITE.test(body);
}

export class Mirror {
  private rw: DatabaseSync;
  private ro: DatabaseSync;
  readonly path: string;

  constructor(path: string, schemaSql: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    const version = createHash("sha256").update(schemaSql).digest("hex").slice(0, 16);
    // A new app version with a new structure: the cache is simply rebuilt.
    if (existsSync(path)) {
      const probe = new DatabaseSync(path);
      let same = false;
      try { same = (probe.prepare(`SELECT value FROM mirror_meta WHERE key = 'schema'`).get() as { value?: string } | undefined)?.value === version; } catch { same = false; }
      probe.close();
      if (!same) for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) unlinkSync(f);
    }
    const fresh = !existsSync(path);
    this.rw = new DatabaseSync(path);
    // A cache refreshed table by table: no foreign-key checks (the server's database has them).
    this.rw.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;");
    if (fresh) {
      this.rw.exec(schemaSql);
      // A cache of the server's rows: the server's triggers (change logs) have no job here.
      for (const t of this.rw.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`).all() as { name: string }[]) this.rw.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
      this.rw.exec(`CREATE TABLE IF NOT EXISTS mirror_meta (key TEXT PRIMARY KEY, value TEXT)`);
      this.rw.prepare(`INSERT OR REPLACE INTO mirror_meta (key, value) VALUES ('schema', ?)`).run(version);
    }
    // Rows this computer laid over the copy (its own unsent sales), so only those are ever replaced.
    this.rw.exec(`CREATE TABLE IF NOT EXISTS mirror_overlay (tbl TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (tbl, id))`);
    this.ro = new DatabaseSync(path, { readOnly: true });
  }

  close() { try { this.ro.close(); } catch { /* closed */ } try { this.rw.close(); } catch { /* closed */ } }

  meta(key: string): string | null {
    return ((this.rw.prepare(`SELECT value FROM mirror_meta WHERE key = ?`).get(key) as { value?: string } | undefined)?.value) ?? null;
  }
  setMeta(key: string, value: string) { this.rw.prepare(`INSERT OR REPLACE INTO mirror_meta (key, value) VALUES (?, ?)`).run(key, value); }

  /** The tables this copy's structure has. */
  tableNames(): Set<string> {
    return new Set((this.rw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name.toLowerCase()));
  }

  /** Server rows into a table, and keys removed from it, in one local transaction (local copy, Phase 1). */
  applyChanges(upserts: Record<string, Record<string, unknown>[]>, deletes: Record<string, string[]>, keyOf: (table: string) => string, after?: () => void) {
    const known = this.tableNames();
    this.tx(() => {
      for (const [t, rows] of Object.entries(upserts)) if (known.has(t)) this.upsert(t, rows);
      for (const [t, ids] of Object.entries(deletes)) {
        if (!known.has(t)) continue;
        const del = this.rw.prepare(`DELETE FROM ${t} WHERE ${keyOf(t)} = ?`);
        for (const id of ids) del.run(id);
      }
      after?.();
    });
  }

  /** Empties a table before its first full copy. */
  clearTable(table: string) {
    if (!this.tableNames().has(table)) return;
    this.tx(() => {
      this.rw.prepare(`DELETE FROM ${table}`).run();
      this.rw.prepare(`DELETE FROM mirror_overlay WHERE tbl = ?`).run(table);
    });
  }

  /** The page's read: one SELECT on the read-only connection. */
  query(sql: string, params: unknown[]): Record<string, unknown>[] {
    if (!readOnlySql(sql)) throw new Error("Only reading is possible offline.");
    const args = (Array.isArray(params) ? params : []).map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
    return (this.ro.prepare(sql).all(...(args as never[])) as Record<string, unknown>[]).map((r) => ({ ...r }));
  }

  private info(t: string) { return this.rw.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[]; }

  /** Writes server rows into a table (columns this copy does not have are
   * dropped; required ones the server never sends, such as secrets, get an
   * empty placeholder). Rows taken from the server stop being overlay rows. */
  private upsert(table: string, rows: Record<string, unknown>[]) {
    const info = this.info(table);
    const known = new Set(info.map((c) => c.name));
    const fill = info.filter((c) => c.notnull && c.dflt_value == null).map((c) => [c.name, /INT|REAL|NUM/i.test(c.type) ? 0 : ""] as const);
    const untrack = this.rw.prepare(`DELETE FROM mirror_overlay WHERE tbl = ? AND id = ?`);
    for (const raw of rows) {
      const r: Record<string, unknown> = { ...raw };
      for (const [k, v] of fill) if (r[k] == null) r[k] = v;
      const keys = Object.keys(r).filter((k) => known.has(k));
      if (!keys.length) continue;
      this.rw.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k] ?? null) as never[]));
      if (r.id != null) untrack.run(table, String(r.id));
    }
  }

  /** Every page of one table (null: the server does not know this table yet, e.g. an older server). */
  private async fetchAll(table: string, fetchPage: FetchPage, since?: string | null) {
    const rows: Record<string, unknown>[] = [];
    let cutoff: string | null = null;
    for (let offset: number | null = 0; offset !== null;) {
      let page;
      try { page = await fetchPage(table, offset, since); } catch (e) {
        if (/Unknown table/i.test(e instanceof Error ? e.message : String(e))) return null;
        throw e;
      }
      rows.push(...page.rows);
      cutoff = page.cutoff ?? cutoff;
      offset = page.next;
    }
    return { rows, cutoff };
  }

  /** Replaces the cached tables with the server's current rows (each table in one go). */
  async refresh(tables: string[], fetchPage: FetchPage, now = new Date()) {
    for (const table of tables) {
      const got = await this.fetchAll(table, fetchPage);
      if (!got) continue;
      this.tx(() => {
        this.rw.prepare(`DELETE FROM ${table}`).run();
        this.rw.prepare(`DELETE FROM mirror_overlay WHERE tbl = ?`).run(table);
        this.upsert(table, got.rows);
      });
    }
    this.setMeta("refreshed_at", now.toISOString());
  }

  /** Recent history (sales, purchases, cash ...): only rows changed since the
   * last check (a few minutes' margin for other devices' clocks), once a day
   * everything again. Rows deleted on the server leave; rows older than the
   * server's window are dropped, and items whose document left go too. */
  async refreshHistory(tables: string[], fetchPage: FetchPage, now = new Date(), o: { fullEveryMs?: number; marginMs?: number } = {}) {
    const fullEvery = o.fullEveryMs ?? 24 * 3_600_000;
    const margin = o.marginMs ?? 10 * 60_000;
    for (const table of tables) {
      const lastFull = this.meta(`hist_full:${table}`);
      const seen = this.meta(`hist_since:${table}`);
      const full = !lastFull || !seen || now.getTime() - Date.parse(lastFull) >= fullEvery;
      const since = full ? null : new Date(Date.parse(seen!) - margin).toISOString();
      const got = await this.fetchAll(table, fetchPage, since);
      if (!got) continue;
      const cols = new Set(this.info(table).map((c) => c.name));
      this.tx(() => {
        if (full) {
          this.rw.prepare(`DELETE FROM ${table}`).run();
          this.rw.prepare(`DELETE FROM mirror_overlay WHERE tbl = ?`).run(table);
        }
        const gone = got.rows.filter((r) => r.deleted_at != null);
        const del = this.rw.prepare(`DELETE FROM ${table} WHERE id = ?`);
        for (const r of gone) del.run(String(r.id));
        this.upsert(table, got.rows.filter((r) => r.deleted_at == null));
        if (got.cutoff && cols.has("date")) this.rw.prepare(`DELETE FROM ${table} WHERE date < ?`).run(got.cutoff);
        const parent = HISTORY_PARENT[table];
        if (parent) this.rw.prepare(`DELETE FROM ${table} WHERE ${parent.column} NOT IN (SELECT id FROM ${parent.table})`).run();
        const newest = got.rows.reduce<string | null>((m, r) => (typeof r.updated_at === "string" && (!m || r.updated_at > m) ? r.updated_at : m), null);
        const keep = [seen, newest].filter((x): x is string => !!x).sort().pop();
        this.setMeta(`hist_since:${table}`, keep ?? new Date(0).toISOString());
        if (full) this.setMeta(`hist_full:${table}`, now.toISOString());
      });
    }
    this.setMeta("history_at", now.toISOString());
  }

  private tx(fn: () => void) {
    this.rw.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.rw.exec("COMMIT");
    } catch (e) {
      this.rw.exec("ROLLBACK");
      throw e;
    }
  }

  /** Sales made on this computer that MAVIN.pk does not have as invoices yet
   * (not sent, or held / refused), laid over the copy and marked as this
   * device's; sales the server has come from its own rows. Each batch's stock
   * is set to what the offline engine sells from (its server figure minus
   * sales the server has not included yet), so the screens and offline sales
   * never disagree, however old this copy's own figures are. Batches the
   * engine does not know keep the copy's figure. */
  overlay(sales: LocalSale[], stock: Map<string, number>, tenantId: string, branchId: string) {
    this.rw.exec("BEGIN IMMEDIATE");
    try {
      // Last time's overlay rows out (only those: never the server's own).
      for (const t of ["invoice_items", "invoices"]) this.rw.prepare(`DELETE FROM ${t} WHERE id IN (SELECT id FROM mirror_overlay WHERE tbl = ?)`).run(t);
      this.rw.prepare(`DELETE FROM mirror_overlay`).run();
      const track = this.rw.prepare(`INSERT OR IGNORE INTO mirror_overlay (tbl, id) VALUES (?, ?)`);
      const onServer = this.rw.prepare(`SELECT 1 AS x FROM invoices WHERE id = ?`);
      for (const s of sales) {
        if (s.status === "applied" || s.status === "conflict") continue;
        const p = s.payload;
        // A new sale the server already has: its own rows show. An edit not yet
        // accepted there replaces the copy's version (a refused one does not).
        if (p.edit ? s.status === "rejected" : onServer.get(p.saleId)) continue;
        const t = p.totals;
        const label = `${p.edit ? "Edited" : "Saved"} on this device · ${s.status === "pending" ? "Pending sync" : s.status}`;
        if (p.edit) this.rw.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).run(p.saleId);
        track.run("invoices", p.saleId);
        for (const l of p.lines) track.run("invoice_items", l.lineId);
        this.rw.prepare(
          `INSERT OR REPLACE INTO invoices (id, invoice_no, date, inv_on, invoice_type, description, customer_id, customer_name, customer_phone, total, charges, discount_pct, discount_rs, tax_pct, payable, paid, balance,
             is_return, is_memorized, is_quotation, tenant_id, branch_id, offline_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'retail', ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`,
        ).run(p.saleId, s.serverInvoiceNo ?? p.edit?.invoiceNo ?? null, p.date, p.payment.method, label, p.customerId ?? null, p.customerName, p.customerPhone,
          t.total, t.charges ?? 0, t.billDiscountRs ?? 0, t.payable, t.paid, t.balance, tenantId, branchId, p.offlineRef, p.occurredAt, p.occurredAt);
        for (const l of p.lines) {
          this.rw.prepare(
            `INSERT OR REPLACE INTO invoice_items (id, invoice_id, product_id, batch_no, packing, avail_qty, qty, bonus_qty, purchase_price, sale_price, tax_pct, further_tax_pct, tax_rs, discount_pct, discount_rs, total, tenant_id, branch_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(l.lineId, p.saleId, l.productId, l.batchNo, l.packing, l.qtyPacks, l.bonusPacks ?? 0, l.purchasePrice, l.pricePerPack, l.taxPct, l.taxRs, l.discountPct, l.discountRs, l.total, tenantId, branchId, p.occurredAt, p.occurredAt);
        }
      }
      const set = this.rw.prepare(`UPDATE product_batches SET qty = ? WHERE id = ?`);
      for (const [id, qty] of stock) set.run(Math.round(qty * 1e6) / 1e6, id);
      this.rw.exec("COMMIT");
    } catch (e) {
      this.rw.exec("ROLLBACK");
      throw e;
    }
  }
}
