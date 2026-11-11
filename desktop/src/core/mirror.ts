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
export type FetchPage = (table: string, offset: number) => Promise<{ rows: Record<string, unknown>[]; next: number | null }>;

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
      this.rw.exec(`CREATE TABLE IF NOT EXISTS mirror_meta (key TEXT PRIMARY KEY, value TEXT)`);
      this.rw.prepare(`INSERT OR REPLACE INTO mirror_meta (key, value) VALUES ('schema', ?)`).run(version);
    }
    this.ro = new DatabaseSync(path, { readOnly: true });
  }

  close() { try { this.ro.close(); } catch { /* closed */ } try { this.rw.close(); } catch { /* closed */ } }

  meta(key: string): string | null {
    return ((this.rw.prepare(`SELECT value FROM mirror_meta WHERE key = ?`).get(key) as { value?: string } | undefined)?.value) ?? null;
  }
  private setMeta(key: string, value: string) { this.rw.prepare(`INSERT OR REPLACE INTO mirror_meta (key, value) VALUES (?, ?)`).run(key, value); }

  /** The page's read: one SELECT on the read-only connection. */
  query(sql: string, params: unknown[]): Record<string, unknown>[] {
    if (!readOnlySql(sql)) throw new Error("Only reading is possible offline.");
    const args = (Array.isArray(params) ? params : []).map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
    return (this.ro.prepare(sql).all(...(args as never[])) as Record<string, unknown>[]).map((r) => ({ ...r }));
  }

  /** Replaces the cached tables with the server's current rows (each table in one go). */
  async refresh(tables: string[], fetchPage: FetchPage, now = new Date()) {
    const info = (t: string) => this.rw.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
    const cols = (t: string) => new Set(info(t).map((c) => c.name));
    // Required columns the server never sends (password hashes and other secrets): an empty placeholder.
    const placeholders = (t: string) => info(t).filter((c) => c.notnull && c.dflt_value == null).map((c) => [c.name, /INT|REAL|NUM/i.test(c.type) ? 0 : ""] as const);
    for (const table of tables) {
      const rows: Record<string, unknown>[] = [];
      for (let offset: number | null = 0; offset !== null;) {
        const page = await fetchPage(table, offset);
        rows.push(...page.rows);
        offset = page.next;
      }
      const known = cols(table);
      const fill = placeholders(table);
      this.rw.exec("BEGIN IMMEDIATE");
      try {
        this.rw.prepare(`DELETE FROM ${table}`).run();
        for (const raw of rows) {
          const r: Record<string, unknown> = { ...raw };
          for (const [k, v] of fill) if (r[k] == null) r[k] = v;
          const keys = Object.keys(r).filter((k) => known.has(k));
          if (!keys.length) continue;
          this.rw.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k] ?? null) as never[]));
        }
        this.rw.exec("COMMIT");
      } catch (e) {
        this.rw.exec("ROLLBACK");
        throw e;
      }
    }
    this.setMeta("refreshed_at", now.toISOString());
  }

  /** Sales made on this computer, laid over the copy: their invoices listed
   * (marked as this device's), and each batch's stock set to what the offline
   * engine sells from (its server figure minus sales the server has not
   * included yet), so the screens and offline sales never disagree, however
   * old this copy's own figures are. Batches the engine does not know keep
   * the copy's figure. */
  overlay(sales: LocalSale[], stock: Map<string, number>, tenantId: string, branchId: string) {
    this.rw.exec("BEGIN IMMEDIATE");
    try {
      this.rw.prepare(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE offline_ref IS NOT NULL)`).run();
      this.rw.prepare(`DELETE FROM invoices WHERE offline_ref IS NOT NULL`).run();
      for (const s of sales) {
        const p = s.payload;
        const t = p.totals;
        this.rw.prepare(
          `INSERT OR REPLACE INTO invoices (id, invoice_no, date, inv_on, invoice_type, description, customer_name, customer_phone, total, charges, discount_pct, discount_rs, tax_pct, payable, paid, balance,
             is_return, is_memorized, is_quotation, tenant_id, branch_id, offline_ref, created_at, updated_at)
           VALUES (?, ?, ?, 'cash', 'retail', ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?)`,
        ).run(p.saleId, s.serverInvoiceNo, p.date, `Saved on this device · ${s.status === "pending" ? "Pending sync" : s.status}`, p.customerName, p.customerPhone,
          t.total, t.discountRs, t.payable, t.paid, tenantId, branchId, p.offlineRef, p.occurredAt, p.occurredAt);
        for (const l of p.lines) {
          this.rw.prepare(
            `INSERT OR REPLACE INTO invoice_items (id, invoice_id, product_id, batch_no, packing, avail_qty, qty, bonus_qty, purchase_price, sale_price, tax_pct, further_tax_pct, tax_rs, discount_pct, discount_rs, total, tenant_id, branch_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(l.lineId, p.saleId, l.productId, l.batchNo, l.packing, l.qtyPacks, l.purchasePrice, l.pricePerPack, l.taxPct, l.taxRs, l.discountPct, l.discountRs, l.total, tenantId, branchId, p.occurredAt, p.occurredAt);
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
