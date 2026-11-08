/** The offline checkout device: provisioning, sign-in (online, then offline
 * within the server's allowance), the local catalogue and stock, the cash
 * sale (one local transaction) and the sync worker (outbox up, changes down).
 *
 * Runs in Electron's main process only; the window reaches it through a few
 * validated IPC calls (desktop/src/preload.ts), never SQL or files. */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { openDb, meta, backupTo, type LocalDb } from "./db";
import {
  PROTOCOL_VERSION, SALE_SCHEMA_VERSION, STOCK_EPS, checkSale, lineAmounts, round2, saleTotals, toPacks, verifyGrant,
  type GrantPayload, type Operation, type PullCursor, type PullResponse, type PushResult, type SaleLine, type SalePayload, type SignedGrant,
} from "../../../src/offline/protocol";
import { allocateBatches } from "../../../src/lib/batchAllocation";

// ── Outside world ─────────────────────────────────────────────────────────

export class TransportError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) { super(message); this.status = status; }
  /** No answer at all (offline, timeout, lost response): safe to retry. */
  get network() { return this.status === null; }
}
/** POST <apiBase>/api/... ; throws TransportError. */
export interface Transport {
  post<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T>;
}
/** OS-protected secret storage (Electron safeStorage / Windows DPAPI). */
export interface SecretStore {
  get(name: string): string | null;
  set(name: string, value: string): void;
}
export interface DeviceConfig {
  dataRoot: string;
  publicKeyPem: string;
  appVersion: string;
  transport: Transport;
  secrets: SecretStore;
  now?: () => Date;
}

interface Binding { deviceId: string; deviceCode: string; tenantId: string; branchId: string; dbFile: string }
export interface SessionUser { id: string; name: string; role: string; online: boolean }
export interface SaleInput {
  lines: { productId: string; unit: "pack" | "loose"; qty: number; discountPct?: number }[];
  customerName?: string | null;
  customerPhone?: string | null;
  tendered: number;
}
export interface ProductHit { id: string; name: string; barcode: string | null; packing: number; price: number | null; available: number; isNarcotic: boolean; onlineOnly: string | null }

const CLOCK_SLACK_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const OUTBOX_KEEP_DAYS = 90;

// ── Device ────────────────────────────────────────────────────────────────

export class OfflineDevice {
  private db: LocalDb | null = null;
  private binding: Binding | null = null;
  private session: { user: SessionUser; token: string | null } | null = null;
  private syncing: Promise<SyncReport> | null = null;
  private online: boolean | null = null;
  private lastError: string | null = null;
  readonly now: () => Date;

  private cfg: DeviceConfig;

  constructor(cfg: DeviceConfig) {
    this.cfg = cfg;
    this.now = cfg.now ?? (() => new Date());
    const f = join(cfg.dataRoot, "device.json");
    if (existsSync(f)) {
      this.binding = JSON.parse(readFileSync(f, "utf8")) as Binding;
      this.db = openDb(join(cfg.dataRoot, this.binding.dbFile), { backupDir: join(cfg.dataRoot, "backups"), now: this.now });
    }
  }

  get provisioned() { return this.binding !== null; }
  close() { this.db?.close(); this.db = null; }

  private need(): { db: LocalDb; b: Binding } {
    if (!this.db || !this.binding) throw new Error("This computer is not set up yet. Sign in online to set it up.");
    return { db: this.db, b: this.binding };
  }
  private deviceHeader() {
    const { b } = this.need();
    const secret = this.cfg.secrets.get(`device-secret-${b.deviceId}`);
    if (!secret) throw new Error("The device key is missing from this Windows account. Set the device up again.");
    return { "X-Mavin-Device": `${b.deviceId}:${secret}` };
  }

  /** The verified offline allowance, or null (missing, edited, other device). */
  grant(): GrantPayload | null {
    if (!this.db || !this.binding) return null;
    const raw = meta.get(this.db, "grant");
    const g = raw ? verifyGrant(JSON.parse(raw) as SignedGrant, this.cfg.publicKeyPem) : null;
    return g && g.deviceId === this.binding.deviceId && g.tenantId === this.binding.tenantId && g.branchId === this.binding.branchId ? g : null;
  }
  private saveGrant(g: SignedGrant) {
    const { db, b } = this.need();
    const p = verifyGrant(g, this.cfg.publicKeyPem);
    if (!p || p.deviceId !== b.deviceId) throw new Error("The server's offline allowance did not verify. Nothing was changed.");
    db.tx(() => {
      meta.set(db, "grant", JSON.stringify(g));
      // Users removed from the allowance can no longer sign in offline.
      const keep = new Set(p.users.map((u) => u.id));
      for (const u of db.all<{ id: string }>(`SELECT id FROM users`)) if (!keep.has(u.id)) db.run(`UPDATE users SET verifier = NULL WHERE id = ?`, u.id);
    });
  }

  /** The computer clock must not go back past what this device has already seen. */
  private clockOk(): boolean {
    const { db } = this.need();
    const now = this.now().getTime();
    const seen = Number(meta.get(db, "clock_max") ?? 0);
    if (now + CLOCK_SLACK_MS < seen) return false;
    if (now > seen) meta.set(db, "clock_max", String(now));
    return true;
  }

  // ── Provisioning and sign-in ────────────────────────────────────────────

  private async onlineLogin(username: string, password: string) {
    const r = await this.cfg.transport.post<{ userId: string; token: string }>("/api/auth/login/", { username, password, client: "desktop" }, {});
    return r;
  }

  /** First start: the owner signs in online and approves this computer for one branch. */
  async provision(username: string, password: string, opts: { branchId?: string; name?: string } = {}) {
    if (this.binding) throw new Error("This computer is already set up.");
    const { token } = await this.onlineLogin(username, password);
    const r = await this.cfg.transport.post<{ result: { deviceId: string; deviceCode: string; secret: string; grant: SignedGrant } }>(
      "/api/offline/", { action: "provision", protocol: PROTOCOL_VERSION, branchId: opts.branchId, name: opts.name, appVersion: this.cfg.appVersion }, { Authorization: `Bearer ${token}` },
    );
    const p = verifyGrant(r.result.grant, this.cfg.publicKeyPem);
    if (!p) throw new Error("The server's offline allowance did not verify (wrong MAVIN server or app build). Nothing was saved.");
    // Secret first (OS-protected), then the binding, then the database.
    this.cfg.secrets.set(`device-secret-${r.result.deviceId}`, r.result.secret);
    const b: Binding = { deviceId: r.result.deviceId, deviceCode: r.result.deviceCode, tenantId: p.tenantId, branchId: p.branchId, dbFile: join("data", safe(p.tenantId), safe(p.branchId), "mavin.db") };
    this.db = openDb(join(this.cfg.dataRoot, b.dbFile), { backupDir: join(this.cfg.dataRoot, "backups"), now: this.now });
    this.binding = b;
    this.saveGrant(r.result.grant);
    writeAtomic(join(this.cfg.dataRoot, "device.json"), JSON.stringify(b, null, 2));
    const me = p.users[0];
    this.rememberUser(me.id, username, me.name, me.role, password);
    this.session = { user: { id: me.id, name: me.name, role: me.role, online: true }, token };
    return { deviceCode: b.deviceCode, tenantName: p.tenantName, branchName: p.branchName };
  }

  private rememberUser(id: string, username: string, name: string, role: string, password: string) {
    const { db } = this.need();
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    db.run(
      `INSERT INTO users (id, username, name, role, verifier, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name, role = excluded.role, verifier = excluded.verifier, updated_at = excluded.updated_at`,
      id, username.trim().toLowerCase(), name, role, `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`, this.now().toISOString(),
    );
  }

  /** Sign in: online when the server answers (and this user is enrolled for
   * offline use), otherwise offline against the saved verifier within the allowance. */
  async signIn(username: string, password: string): Promise<SessionUser> {
    const { b } = this.need();
    try {
      const { userId, token } = await this.onlineLogin(username, password);
      const r = await this.cfg.transport.post<{ result: { grant: SignedGrant } }>("/api/offline/", { action: "enrol", protocol: PROTOCOL_VERSION }, { Authorization: `Bearer ${token}`, ...this.deviceHeader() });
      this.saveGrant(r.result.grant);
      const g = this.grant()!;
      const u = g.users.find((x) => x.id === userId);
      if (!u) throw new Error("This login is not allowed on this device.");
      if (this.grant()?.tenantId !== b.tenantId) throw new Error("This login belongs to another business.");
      this.rememberUser(u.id, username, u.name, u.role, password);
      this.online = true;
      this.session = { user: { id: u.id, name: u.name, role: u.role, online: true }, token };
      return this.session.user;
    } catch (e) {
      if (!(e instanceof TransportError) || !e.network) throw e;
      this.online = false;
      return this.signInOffline(username, password);
    }
  }

  private signInOffline(username: string, password: string): SessionUser {
    const { db } = this.need();
    const u = db.get<{ id: string; name: string; role: string; verifier: string | null }>(`SELECT id, name, role, verifier FROM users WHERE username = ?`, username.trim().toLowerCase());
    const bad = "Incorrect username or password, or this login has not signed in online on this computer yet.";
    if (!u?.verifier) throw new Error(bad);
    const [, salt, hash] = u.verifier.split("$");
    const want = Buffer.from(hash, "base64");
    const got = scryptSync(password, Buffer.from(salt, "base64"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    if (!timingSafeEqual(want, got)) throw new Error(bad);
    // A valid allowance that no longer lists this login: refused. No valid
    // allowance at all (expired, damaged): signing in still works so pending
    // sales can be seen and sent; selling stays blocked (sellBlock).
    const g = this.grant();
    if (g && !g.users.some((x) => x.id === u.id)) throw new Error("This login is not allowed offline on this device. Connect to the internet and sign in.");
    this.session = { user: { id: u.id, name: u.name, role: u.role, online: false }, token: null };
    return this.session.user;
  }

  /** Signing out keeps every sale and every pending operation on this computer. */
  signOut() { this.session = null; }
  get user() { return this.session?.user ?? null; }

  /** Why offline selling is not possible right now (null = it is). */
  sellBlock(): string | null {
    if (!this.session) return "Sign in first.";
    const g = this.grant();
    if (!g) return "This computer has no valid offline allowance. Connect to the internet and sign in.";
    if (!g.modules.includes("sale.cash")) return "Cash sales are not allowed on this device.";
    if (!g.users.some((u) => u.id === this.session!.user.id)) return "Your login is not allowed on this device.";
    if (!this.clockOk()) return "The computer's clock is earlier than before. Correct the date and time, or connect to the internet.";
    if (this.now().getTime() >= Date.parse(g.expiresAt)) return `The offline allowance ended on ${new Date(g.expiresAt).toLocaleString("en-PK")}. Connect to the internet to continue selling. Pending sales are kept and will be sent.`;
    return null;
  }

  // ── Catalogue and stock ─────────────────────────────────────────────────

  /** Applies one pull page; pulled rows never go into the outbox. */
  private applyPull(r: PullResponse) {
    const { db } = this.need();
    db.tx(() => {
      if (r.reset) {
        db.run(`DELETE FROM products`); db.run(`DELETE FROM prices`); db.run(`DELETE FROM batches`);
      }
      for (const p of r.products) {
        db.run(`INSERT INTO products (id, name, barcode, packing, tax_pct, is_narcotic, track_imei, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, barcode = excluded.barcode, packing = excluded.packing, tax_pct = excluded.tax_pct, is_narcotic = excluded.is_narcotic, track_imei = excluded.track_imei, deleted = excluded.deleted`,
          p.id, p.name, p.barcode, p.packing, p.taxPct, p.isNarcotic ? 1 : 0, p.trackImei ? 1 : 0, p.deleted ? 1 : 0);
      }
      for (const p of r.prices) {
        db.run(`INSERT INTO prices (id, product_id, sale_price, created_at, deleted) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET sale_price = excluded.sale_price, created_at = excluded.created_at, deleted = excluded.deleted`,
          p.id, p.productId, p.salePrice, p.createdAt, p.deleted ? 1 : 0);
      }
      for (const x of r.batches) {
        db.run(`INSERT INTO batches (id, product_id, batch_no, expiry_date, server_qty, purchase_price, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET product_id = excluded.product_id, batch_no = excluded.batch_no, expiry_date = excluded.expiry_date, server_qty = excluded.server_qty, purchase_price = excluded.purchase_price, deleted = excluded.deleted`,
          x.id, x.productId, x.batchNo, x.expiryDate, x.qty, x.purchasePrice, x.deleted ? 1 : 0);
      }
      // Sales the server has applied and this download already includes: stop subtracting them locally.
      const seen = r.cursor.phase === "live" ? r.cursor.seq : r.cursor.snapSeq;
      db.run(`UPDATE stock_moves SET reflected = 1 WHERE reflected = 0 AND applied_seq IS NOT NULL AND applied_seq <= ?`, seen);
      meta.set(db, "cursor", JSON.stringify(r.cursor));
      meta.set(db, "grant", JSON.stringify(r.grant));
      if (r.cursor.phase === "live" && !r.more) meta.set(db, "catalog_ready", "1");
    });
    this.saveGrant(r.grant);
  }

  /** Stock this computer can sell from a batch: the server's last figure minus sales not yet included in it. */
  private batchesFor(productId: string) {
    const { db } = this.need();
    return db.all<{ id: string; batch_no: string | null; expiry_date: string | null; qty: number; purchase_price: number }>(
      `SELECT b.id, b.batch_no, b.expiry_date, b.purchase_price,
              b.server_qty + COALESCE((SELECT SUM(m.qty) FROM stock_moves m WHERE m.batch_id = b.id AND m.reflected = 0), 0) AS qty
       FROM batches b WHERE b.product_id = ? AND b.deleted = 0
       ORDER BY (b.expiry_date IS NULL), b.expiry_date ASC, b.id`, productId,
    ).filter((b) => b.qty > STOCK_EPS);
  }

  private priceOf(productId: string): number | null {
    const { db } = this.need();
    return db.get<{ sale_price: number }>(`SELECT sale_price FROM prices WHERE product_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 1`, productId)?.sale_price ?? null;
  }

  /** Name or barcode search for the counter. */
  search(term: string, limit = 30): ProductHit[] {
    const { db } = this.need();
    const t = term.trim();
    if (!t) return [];
    const rows = db.all<{ id: string; name: string; barcode: string | null; packing: number; is_narcotic: number; track_imei: number }>(
      `SELECT id, name, barcode, packing, is_narcotic, track_imei FROM products WHERE deleted = 0 AND (barcode = ? OR name LIKE ?) ORDER BY (barcode = ?) DESC, name LIMIT ?`,
      t, `%${t.replace(/[%_]/g, "")}%`, t, limit,
    );
    return rows.map((p) => ({
      id: p.id, name: p.name, barcode: p.barcode, packing: p.packing, price: this.priceOf(p.id), isNarcotic: p.is_narcotic === 1,
      available: Math.round(this.batchesFor(p.id).reduce((s, b) => s + b.qty, 0) * 1e6) / 1e6,
      onlineOnly: p.track_imei ? "Needs IMEI numbers: sell online." : null,
    }));
  }

  // ── The sale ────────────────────────────────────────────────────────────

  /** One cash sale: sale, lines, stock moves and the outbox entry in ONE local
   * transaction (all saved or none). Batches earliest expiry first, as online. */
  createSale(input: SaleInput): { sale: SalePayload; receipt: string } {
    const block = this.sellBlock();
    if (block) throw new Error(block);
    const { db, b } = this.need();
    const user = this.session!.user;
    if (!Array.isArray(input.lines) || !input.lines.length) throw new Error("Add at least one product.");
    const name = input.customerName?.trim() || null;
    const phone = input.customerPhone?.trim() || null;
    return db.tx(() => {
      const lines: SaleLine[] = [];
      const used = new Map<string, number>();
      for (const l of input.lines) {
        const p = db.get<{ id: string; name: string; packing: number; tax_pct: number; is_narcotic: number; track_imei: number }>(`SELECT * FROM products WHERE id = ? AND deleted = 0`, l.productId);
        if (!p) throw new Error("A product on the bill is no longer in the catalogue.");
        if (p.track_imei) throw new Error(`${p.name} needs IMEI numbers: sell it online.`);
        if (p.is_narcotic && (!name || !phone)) throw new Error(`${p.name} is a controlled medicine: enter the buyer's name and mobile.`);
        const price = this.priceOf(p.id);
        if (price == null) throw new Error(`${p.name} has no sale price. Set it online first.`);
        if (!(l.qty > 0)) throw new Error(`Enter a quantity for ${p.name}.`);
        const unit = l.unit === "loose" ? "loose" : "pack";
        const packs = toPacks(l.qty, unit, p.packing);
        const { parts, short } = allocateBatches(this.batchesFor(p.id), packs, 0, used);
        if (short > STOCK_EPS) throw new Error(`Only ${round6(packs - short)} of ${p.name} in stock on this computer.`);
        const disc = Math.max(0, Math.min(100, Number(l.discountPct) || 0));
        for (const part of parts) {
          // One line per batch used (as online), each with its own amounts.
          const qtyEntered = unit === "loose" ? round6(round6(part.qty) * p.packing) : round6(part.qty);
          lines.push({
            lineId: randomUUID(), productId: p.id, productName: p.name, batchId: part.batch.id, batchNo: part.batch.batch_no, expiryDate: part.batch.expiry_date,
            packing: p.packing, unit, qtyEntered, qtyPacks: toPacks(qtyEntered, unit, p.packing), pricePerPack: price, discountPct: disc, taxPct: p.tax_pct, purchasePrice: part.batch.purchase_price,
            ...lineAmounts(toPacks(qtyEntered, unit, p.packing), price, disc, p.tax_pct),
          });
        }
      }
      const tendered = round2(Number(input.tendered) || 0);
      const totals = saleTotals(lines, tendered);
      if (tendered + 0.005 < totals.payable) throw new Error(`Cash received (${tendered.toFixed(2)}) is less than the bill (${totals.payable.toFixed(2)}).`);
      // Receipt number: this device's own sequence (collision-free across devices by the device code).
      const n = Number(meta.get(db, "receipt_seq") ?? 0) + 1;
      meta.set(db, "receipt_seq", String(n));
      const now = this.now();
      const sale: SalePayload = {
        saleId: randomUUID(), offlineRef: `${b.deviceCode}-${String(n).padStart(6, "0")}`, date: localDate(now), occurredAt: now.toISOString(), userId: user.id,
        customerName: name, customerPhone: phone, lines, totals, payment: { method: "cash", amount: totals.payable },
      };
      const problems = checkSale(sale);
      if (problems.length) throw new Error(`The sale did not pass its checks (${problems.join(", ")}). Nothing was saved.`);
      const op: Operation = { opId: randomUUID(), kind: "sale.create", entityId: sale.saleId, schemaVersion: SALE_SCHEMA_VERSION, dependsOn: [], occurredAt: sale.occurredAt, userId: user.id, payload: sale };
      db.run(`INSERT INTO sales (id, offline_ref, date, occurred_at, user_id, customer_name, customer_phone, payable, tendered, change_due, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sale.saleId, sale.offlineRef, sale.date, sale.occurredAt, user.id, name, phone, totals.payable, tendered, totals.change, JSON.stringify(sale));
      for (const l of lines) db.run(`INSERT INTO stock_moves (id, sale_id, op_id, batch_id, qty) VALUES (?, ?, ?, ?, ?)`, l.lineId, sale.saleId, op.opId, l.batchId, -l.qtyPacks);
      const seq = Number(db.get<{ m: number }>(`SELECT COALESCE(MAX(seq), 0) AS m FROM outbox`)?.m ?? 0) + 1;
      db.run(`INSERT INTO outbox (op_id, seq, kind, entity_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`, op.opId, seq, op.kind, op.entityId, JSON.stringify(op), now.toISOString());
      return { sale, receipt: receiptText(sale, this.grant()!, user.name) };
    });
  }

  /** A saved sale's receipt again (reprint). */
  receipt(saleId: string): string {
    const { db } = this.need();
    const r = db.get<{ payload: string; user_id: string; sync_status: string; server_invoice_no: number | null }>(`SELECT payload, user_id, sync_status, server_invoice_no FROM sales WHERE id = ?`, saleId);
    if (!r) throw new Error("Sale not found.");
    const who = db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, r.user_id)?.name ?? "";
    return receiptText(JSON.parse(r.payload) as SalePayload, this.grant() ?? null, who, r.server_invoice_no);
  }

  // ── Sync ────────────────────────────────────────────────────────────────

  /** One sync run at a time (a second call gets the running one). */
  sync(opts: { manual?: boolean } = {}): Promise<SyncReport> {
    if (!this.syncing) this.syncing = this.runSync(opts.manual === true).finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async runSync(manual: boolean): Promise<SyncReport> {
    const { db } = this.need();
    const rep: SyncReport = { pushed: 0, applied: 0, conflicts: 0, held: 0, rejected: 0, pulledPages: 0, error: null };
    try {
      // 1. Up: oldest first, a few at a time; each answer is stored before the next send.
      for (;;) {
        const due = db.all<{ op_id: string; body: string; attempts: number }>(
          `SELECT op_id, body, attempts FROM outbox WHERE status = 'pending' AND (? OR next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY seq LIMIT 20`,
          manual ? 1 : 0, this.now().toISOString(),
        );
        if (!due.length) break;
        let results: PushResult[];
        try {
          const r = await this.cfg.transport.post<{ result: { results: PushResult[] } }>(
            "/api/offline/", { action: "push", protocol: PROTOCOL_VERSION, ops: due.map((d) => JSON.parse(d.body)), status: this.counts() }, this.deviceHeader(),
          );
          results = r.result.results;
        } catch (e) {
          // No answer: nothing is assumed; the same operations are sent again later (the server answers repeats with the stored result).
          this.backoff(due.map((d) => d.op_id), e instanceof Error ? e.message : String(e));
          throw e;
        }
        db.tx(() => {
          for (const res of results) this.ack(res, rep);
        });
        rep.pushed += results.length;
        if (results.some((r) => r.status === "rejected" && /^Waiting for/.test(r.error ?? ""))) break;
      }
      // 2. Down: catalogue, prices and stock (pages until done).
      for (let i = 0; i < 1000; i++) {
        const raw = meta.get(db, "cursor");
        const cursor = raw ? (JSON.parse(raw) as PullCursor) : null;
        const r = await this.cfg.transport.post<{ result: PullResponse }>("/api/offline/", { action: "pull", protocol: PROTOCOL_VERSION, cursor, status: this.counts() }, this.deviceHeader());
        this.applyPull(r.result);
        rep.pulledPages++;
        if (!r.result.more) break;
      }
      // 3. Housekeeping: answered operations older than the retention period.
      const cut = new Date(this.now().getTime() - OUTBOX_KEEP_DAYS * 86_400_000).toISOString();
      db.run(`DELETE FROM outbox WHERE status IN ('applied', 'conflict') AND acked_at IS NOT NULL AND acked_at < ?`, cut);
      meta.set(db, "last_sync_ok", this.now().toISOString());
      this.online = true;
      this.lastError = null;
    } catch (e) {
      const te = e instanceof TransportError ? e : null;
      this.online = te ? !te.network : this.online;
      rep.error = te?.network ? "No connection to MAVIN.pk. Sales are saved on this computer and will be sent later." : e instanceof Error ? e.message : String(e);
      this.lastError = rep.error;
    }
    return rep;
  }

  /** Stores the server's answer for one operation (durable acknowledgement). */
  private ack(res: PushResult, rep: SyncReport) {
    const { db } = this.need();
    const o = db.get<{ entity_id: string }>(`SELECT entity_id FROM outbox WHERE op_id = ?`, res.opId);
    if (!o) return;
    if (res.status === "rejected" && /^Waiting for/.test(res.error ?? "")) return;
    const now = this.now().toISOString();
    db.run(`UPDATE outbox SET status = ?, acked_at = ?, result = ?, last_error = ? WHERE op_id = ?`, res.status, now, JSON.stringify(res), res.error ?? null, res.opId);
    db.run(`UPDATE sales SET sync_status = ?, server_invoice_no = COALESCE(?, server_invoice_no), server_note = ? WHERE id = ?`, res.status, res.invoiceNo ?? null, res.error ?? null, o.entity_id);
    if (res.status === "applied" || res.status === "conflict") db.run(`UPDATE stock_moves SET applied_seq = ? WHERE op_id = ?`, res.appliedSeq ?? null, res.opId);
    // Held or refused: the server did not take the stock (yet); the next download shows what it did.
    else db.run(`UPDATE stock_moves SET reflected = 1 WHERE op_id = ?`, res.opId);
    rep[res.status === "applied" ? "applied" : res.status === "conflict" ? "conflicts" : res.status === "held" ? "held" : "rejected"]++;
  }

  private backoff(opIds: string[], error: string) {
    const { db } = this.need();
    db.tx(() => {
      for (const id of opIds) {
        const a = (db.get<{ attempts: number }>(`SELECT attempts FROM outbox WHERE op_id = ?`, id)?.attempts ?? 0) + 1;
        const wait = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** Math.min(a, 10)) * (0.5 + Math.random());
        db.run(`UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE op_id = ? AND status = 'pending'`, a, new Date(this.now().getTime() + wait).toISOString(), error.slice(0, 300), id);
      }
    });
  }

  private counts() {
    const { db } = this.need();
    const c = (s: string) => Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox WHERE status ${s}`)?.n ?? 0);
    return { pending: c("= 'pending'"), failed: c("IN ('rejected', 'held')"), appVersion: this.cfg.appVersion };
  }

  /** Everything the sync bar shows. "Online" does not mean everything is sent. */
  status() {
    if (!this.db || !this.binding) return { provisioned: false as const };
    const db = this.db;
    const g = this.grant();
    const n = (sql: string) => Number(db.get<{ n: number }>(sql)?.n ?? 0);
    const cursor = meta.get(db, "cursor");
    return {
      provisioned: true as const,
      deviceCode: this.binding.deviceCode,
      tenantName: g?.tenantName ?? null, branchName: g?.branchName ?? null, businessType: g?.businessType ?? null,
      allowanceEndsAt: g?.expiresAt ?? null,
      online: this.online,
      lastSyncOk: meta.get(db, "last_sync_ok"),
      lastError: this.lastError,
      pending: n(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'`),
      conflicts: n(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'conflict'`),
      held: n(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'held'`),
      rejected: n(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'rejected'`),
      catalogReady: meta.get(db, "catalog_ready") === "1",
      downloading: cursor ? (JSON.parse(cursor) as PullCursor).phase === "initial" : true,
      products: n(`SELECT COUNT(*) AS n FROM products WHERE deleted = 0`),
      user: this.session?.user ?? null,
      sellBlock: this.session ? this.sellBlock() : null,
    };
  }

  /** Sales on this computer (newest first): this computer's own record, not the business's totals. */
  recentSales(limit = 50) {
    const { db } = this.need();
    return db.all<{ id: string; offline_ref: string; date: string; payable: number; sync_status: string; server_invoice_no: number | null; server_note: string | null }>(
      `SELECT id, offline_ref, date, payable, sync_status, server_invoice_no, server_note FROM sales ORDER BY occurred_at DESC LIMIT ?`, limit,
    );
  }

  /** Operations needing attention, without customer details (for support). */
  diagnostics() {
    const { db, b } = this.need();
    return {
      device: b.deviceCode, protocol: PROTOCOL_VERSION, app: this.cfg.appVersion, status: this.status(),
      problems: db.all<{ op_id: string; status: string; attempts: number; last_error: string | null; created_at: string }>(
        `SELECT op_id, status, attempts, last_error, created_at FROM outbox WHERE status != 'applied' ORDER BY seq LIMIT 100`,
      ),
    };
  }

  /** A copy of the local database into the backups folder. */
  backupNow() {
    const { db } = this.need();
    return backupTo(db, join(this.cfg.dataRoot, "backups"), "manual", this.now);
  }
}

export interface SyncReport { pushed: number; applied: number; conflicts: number; held: number; rejected: number; pulledPages: number; error: string | null }

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function writeAtomic(file: string, text: string) {
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Plain-text receipt (80 mm). Offline sales carry no FBR number or QR code. */
export function receiptText(s: SalePayload, g: GrantPayload | null, cashier: string, serverNo: number | null = null): string {
  const w = 42;
  const row = (l: string, r: string) => `${l.slice(0, w - r.length - 1).padEnd(w - r.length)}${r}`;
  const out = [
    (g?.tenantName ?? "").slice(0, w), (g?.branchName ?? "").slice(0, w), "-".repeat(w),
    row(`Receipt ${s.offlineRef}`, s.date), serverNo ? `Invoice no. ${serverNo}` : "Invoice no. given when synced", `Cashier: ${cashier}`.slice(0, w),
    ...(s.customerName ? [`Customer: ${s.customerName}`.slice(0, w)] : []), "-".repeat(w),
  ];
  for (const l of s.lines) {
    out.push(l.productName.slice(0, w));
    const q = l.unit === "loose" ? `${round6(l.qtyEntered)} loose` : `${round6(l.qtyPacks)}`;
    out.push(row(`  ${q} x ${l.pricePerPack.toFixed(2)}${l.discountPct ? ` -${l.discountPct}%` : ""}${l.batchNo ? ` B:${l.batchNo}` : ""}`, l.total.toFixed(2)));
  }
  out.push("-".repeat(w), row("Total", s.totals.payable.toFixed(2)), row("Cash", s.totals.tendered.toFixed(2)), row("Change", s.totals.change.toFixed(2)), "-".repeat(w));
  out.push("Saved offline. Not submitted to FBR.", "FBR status is set online after sync.");
  return out.join("\n");
}
