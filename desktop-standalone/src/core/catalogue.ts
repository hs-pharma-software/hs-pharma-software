/** Mavin Pharmacy Offline: the medicine catalogue.
 *
 * The approved MAVIN pharmacy catalogue (shared products, categories, units:
 * rows with tenant_id NULL, the same as on MAVIN.pk) ships with the installer
 * and is updated, download only, from MAVIN.pk's catalogue address. No login,
 * no business data leaves the computer.
 *
 * - Stable ids: a row is the same row everywhere, so updates never duplicate.
 * - A catalogue row the pharmacy edited here is kept as edited (its content no
 *   longer matches what was last imported).
 * - The pharmacy's own products, prices, stock, batches and barcodes are its
 *   own rows (tenant_id set) and are never touched.
 * - A product removed from the catalogue stays when the pharmacy uses it
 *   (stock, prices or sales).
 * - New DRAP records: Product Name = Brand Name + Strength, Description =
 *   Generic Name, Company Name = Manufacturer.
 * - One update at a time; skipped when the catalogue version is unchanged;
 *   bounded retries with growing pauses. */
import { createHash } from "node:crypto";
import type { LocalDb, Row } from "./localdb";

export const SYNC_EVERY_MS = 24 * 3600_000;
const RETRY_PAUSES_MS = [5, 15, 30, 60, 120, 240].map((m) => m * 60_000);
const MAX_PAGES = 200;

export type CatTable = "products" | "categories" | "sub_categories" | "uoms";
export const CAT_TABLES: CatTable[] = ["uoms", "categories", "sub_categories", "products"];

export interface CataloguePage {
  version: string;
  unchanged?: boolean;
  rows: Partial<Record<CatTable, Row[]>>;
  cursor: string | null;
  more: boolean;
}

export interface CatalogueStatus {
  version: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  pending: boolean;
  running: boolean;
  products: number;
  source: string;
}

const IGNORED = new Set(["created_at", "updated_at", "tenant_id"]);

function contentHash(row: Row): string {
  const keys = Object.keys(row).filter((k) => !IGNORED.has(k)).sort();
  return createHash("sha256").update(JSON.stringify(keys.map((k) => [k, row[k] ?? null]))).digest("hex");
}

/** DRAP record → MAVIN product fields (only for products imported for the first time). */
export function drapNaming(row: Row): Row {
  if (!row.drap_reg_no) return row;
  let meta: Record<string, unknown> = {};
  try { meta = typeof row.drap_meta === "string" ? JSON.parse(row.drap_meta) : ((row.drap_meta as Record<string, unknown>) ?? {}); } catch { meta = {}; }
  const s = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string).trim() : "");
  const brand = s("brandName") || s("brand") || s("productName");
  const strength = s("strength");
  const generic = s("genericName") || s("generic");
  const maker = s("manufacturer") || s("manufacturerName");
  const out = { ...row };
  if (brand) out.name = `${brand}${strength && !brand.toLowerCase().includes(strength.toLowerCase()) ? ` ${strength}` : ""}`.trim();
  if (generic) out.description = generic;
  if (maker) out.company_name = maker;
  return out;
}

export class Catalogue {
  private running: Promise<CatalogueStatus> | null = null;
  private db: LocalDb;
  private source: string;
  private fetchPage: (url: string) => Promise<CataloguePage>;
  private now: () => Date;
  constructor(db: LocalDb, source: string, fetchPage: (url: string) => Promise<CataloguePage>, now: () => Date = () => new Date()) {
    this.db = db;
    this.source = source;
    this.fetchPage = fetchPage;
    this.now = now;
  }

  private columns(t: CatTable): Set<string> {
    return new Set((this.db.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
  }

  private inUse(productId: string): boolean {
    const d = this.db.db;
    return !!(d.prepare(`SELECT 1 FROM product_batches WHERE product_id = ? AND deleted_at IS NULL LIMIT 1`).get(productId)
      ?? d.prepare(`SELECT 1 FROM price_list WHERE product_id = ? AND deleted_at IS NULL LIMIT 1`).get(productId)
      ?? d.prepare(`SELECT 1 FROM invoice_items WHERE product_id = ? LIMIT 1`).get(productId));
  }

  /** Applies catalogue rows in one transaction. Returns counts. */
  apply(rows: Partial<Record<CatTable, Row[]>>): { added: number; updated: number; keptLocalEdits: number; removed: number; keptInUse: number } {
    const c = { added: 0, updated: 0, keptLocalEdits: 0, removed: 0, keptInUse: 0 };
    const t0 = this.now().toISOString();
    this.db.tx(() => {
      for (const t of CAT_TABLES) {
        const list = rows[t] ?? [];
        if (!list.length) continue;
        const cols = this.columns(t);
        for (const raw of list) {
          const id = typeof raw.id === "string" ? raw.id : "";
          if (!id) continue;
          // Only shared catalogue rows: never a business's own row.
          const incoming: Row = { ...raw, tenant_id: null };
          for (const k of Object.keys(incoming)) if (!cols.has(k)) delete incoming[k];
          const local = this.db.db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id) as Row | undefined;
          if (local && local.tenant_id != null) continue; // the id belongs to this pharmacy's own row: leave it
          const track = this.db.db.prepare(`SELECT source_hash FROM standalone_catalogue_rows WHERE tbl = ? AND row_id = ?`).get(t, id) as { source_hash: string } | undefined;
          const edited = !!local && (!track || contentHash(local) !== track.source_hash);
          if (incoming.deleted_at) {
            if (!local || local.deleted_at) continue;
            if (edited) { c.keptLocalEdits++; continue; }
            if (t === "products" && this.inUse(id)) { c.keptInUse++; continue; }
            this.db.db.prepare(`UPDATE ${t} SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(String(incoming.deleted_at), t0, id);
            c.removed++;
            continue;
          }
          if (local && edited) { c.keptLocalEdits++; continue; }
          const row = local ? incoming : (t === "products" ? drapNaming(incoming) : incoming);
          row.created_at = (local?.created_at as string) ?? row.created_at ?? t0;
          row.updated_at = row.updated_at ?? t0;
          const keys = Object.keys(row);
          if (local) {
            this.db.db.prepare(`UPDATE ${t} SET ${keys.filter((k) => k !== "id").map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
              .run(...keys.filter((k) => k !== "id").map((k) => row[k] as never), id);
            c.updated++;
          } else {
            this.db.db.prepare(`INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k] as never));
            c.added++;
          }
          const stored = this.db.db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id) as Row;
          this.db.db.prepare(`INSERT INTO standalone_catalogue_rows (tbl, row_id, source_hash, source_updated_at, imported_at) VALUES (?, ?, ?, ?, ?)
                              ON CONFLICT(tbl, row_id) DO UPDATE SET source_hash = excluded.source_hash, source_updated_at = excluded.source_updated_at, imported_at = excluded.imported_at`)
            .run(t, id, contentHash(stored), (raw.updated_at as string) ?? null, t0);
        }
      }
    });
    return c;
  }

  /** The catalogue that ships with the installer (first start only). */
  importBundled(bundle: { version: string; cursor: string | null; generatedAt: string; rows: Partial<Record<CatTable, Row[]>> }) {
    if (this.db.meta("catalogue_version")) return null;
    const r = this.apply(bundle.rows);
    this.db.setMeta("catalogue_version", bundle.version);
    if (bundle.cursor) this.db.setMeta("catalogue_cursor", bundle.cursor);
    this.db.setMeta("catalogue_bundled", bundle.version);
    // An update is due 24 hours after the bundled catalogue was made (at once when it is older).
    this.db.setMeta("catalogue_installed_at", bundle.generatedAt);
    this.db.audit(null, "catalogue_bundled", { version: bundle.version, ...r });
    return r;
  }

  status(): CatalogueStatus {
    const last = this.db.meta("catalogue_last_success_at");
    return {
      version: this.db.meta("catalogue_version"),
      lastSuccessAt: last,
      lastAttemptAt: this.db.meta("catalogue_last_attempt_at"),
      lastError: this.db.meta("catalogue_last_error"),
      pending: this.due(),
      running: !!this.running,
      products: Number((this.db.db.prepare(`SELECT COUNT(*) AS n FROM products WHERE tenant_id IS NULL AND deleted_at IS NULL`).get() as { n: number }).n),
      source: this.source,
    };
  }

  /** Due when the last successful update is 24 hours old (and any retry pause has passed). */
  due(): boolean {
    const now = this.now().getTime();
    const last = Date.parse(this.db.meta("catalogue_last_success_at") ?? "") || Date.parse(this.db.meta("catalogue_installed_at") ?? "") || 0;
    if (now - last < SYNC_EVERY_MS) return false;
    const retryAt = Number(this.db.meta("catalogue_retry_at") ?? "0");
    return now >= retryAt;
  }

  /** One update (never two at once). `force` ignores the 24-hour wait, not a running update. */
  sync(force = false): Promise<CatalogueStatus> {
    if (this.running) return this.running;
    if (!force && !this.due()) return Promise.resolve(this.status());
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<CatalogueStatus> {
    const t = this.now().toISOString();
    this.db.setMeta("catalogue_last_attempt_at", t);
    try {
      let cursor = this.db.meta("catalogue_cursor");
      const version = this.db.meta("catalogue_version");
      let total = { added: 0, updated: 0, keptLocalEdits: 0, removed: 0, keptInUse: 0 };
      let latest = version;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${this.source}?${new URLSearchParams({ ...(cursor ? { since: cursor } : {}), ...(version ? { version } : {}) })}`;
        const p = await this.fetchPage(url);
        if (!p || typeof p.version !== "string") throw new Error("The catalogue server sent an unreadable answer.");
        latest = p.version;
        if (p.unchanged) break;
        const r = this.apply(p.rows ?? {});
        total = { added: total.added + r.added, updated: total.updated + r.updated, keptLocalEdits: total.keptLocalEdits + r.keptLocalEdits, removed: total.removed + r.removed, keptInUse: total.keptInUse + r.keptInUse };
        if (p.cursor) { cursor = p.cursor; this.db.setMeta("catalogue_cursor", cursor); }
        if (!p.more) break;
      }
      this.db.setMeta("catalogue_version", latest);
      this.db.setMeta("catalogue_last_success_at", this.now().toISOString());
      this.db.setMeta("catalogue_last_error", null);
      this.db.setMeta("catalogue_failures", "0");
      this.db.setMeta("catalogue_retry_at", null);
      if (total.added || total.updated || total.removed) this.db.audit(null, "catalogue_updated", { version: latest, ...total });
    } catch (e) {
      const n = Number(this.db.meta("catalogue_failures") ?? "0") + 1;
      this.db.setMeta("catalogue_failures", String(n));
      this.db.setMeta("catalogue_last_error", (e instanceof Error ? e.message : String(e)).slice(0, 300));
      this.db.setMeta("catalogue_retry_at", String(this.now().getTime() + RETRY_PAUSES_MS[Math.min(n - 1, RETRY_PAUSES_MS.length - 1)]));
    }
    return this.status();
  }

  /** Back online: retry at once if an update is overdue (the pause after a failure is skipped once). */
  onReconnect(): Promise<CatalogueStatus> {
    const last = Date.parse(this.db.meta("catalogue_last_success_at") ?? "") || Date.parse(this.db.meta("catalogue_installed_at") ?? "") || 0;
    if (this.now().getTime() - last < SYNC_EVERY_MS) return Promise.resolve(this.status());
    this.db.setMeta("catalogue_retry_at", null);
    return this.sync();
  }
}
