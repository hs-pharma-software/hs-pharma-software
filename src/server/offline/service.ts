/** Offline desktop (pilot): approved checkout devices, their offline
 * allowance, the catalogue/stock they download, and the sales they send.
 *
 * - A device is approved for one business and one branch (one active device
 *   per branch). Its secret is shown once and kept here only as a hash.
 * - The offline allowance is a grant signed with OFFLINE_GRANT_PRIVATE_KEY
 *   (Ed25519); the device checks it with the public key and cannot extend it.
 *   A device learns of a revocation only when it next connects or when its
 *   allowance runs out.
 * - Each sale operation is applied once (op_id is the key; the invoice id is
 *   the sale id). The server keeps the device's prices and amounts, takes
 *   stock from the batches the device used (never below zero) and records a
 *   stock exception for anything those batches no longer hold.
 * - A revoked device (or a business whose offline switch was turned off) can
 *   still hand in its sales: they are held for review, not applied. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Sql } from "../subSupers";
import { callerCan, type Caller } from "../sqlPolicy";
import { HttpError } from "../db";
import { tenantAllows } from "@/lib/tenantFeatures";
import {
  MAX_OFFLINE_HOURS, MIN_OFFLINE_HOURS, OFFLINE_BUSINESS_TYPES, OFFLINE_MODULES, PROTOCOL_VERSION, STOCK_EPS,
  checkOperation, signGrant,
  type GrantPayload, type GrantUser, type Operation, type PullCursor, type PullResponse, type PushResult, type SalePayload, type SignedGrant,
} from "@/offline/protocol";

const iso = () => new Date().toISOString();
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const jsonList = (raw: unknown): string[] => { try { const v = raw ? JSON.parse(String(raw)) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const PAGE = 500;

type Row = Record<string, unknown>;
export type Device = Row & { id: string; tenant_id: string; branch_id: string; status: string; device_code: string };

/** The signing key (PKCS8 PEM, given base64 in OFFLINE_GRANT_PRIVATE_KEY). */
function signingKey(): string {
  const raw = process.env.OFFLINE_GRANT_PRIVATE_KEY?.trim();
  if (!raw) throw new HttpError(503, "Offline desktop is not set up on the server yet (OFFLINE_GRANT_PRIVATE_KEY).");
  return Buffer.from(raw, "base64").toString("utf8");
}

async function audit(sql: Sql, tenantId: string | null, actor: string | null, action: string, detail: unknown) {
  // The payments audit table holds every money-relevant action; offline device actions join it.
  await sql.execute(`INSERT INTO payment_audit (id, tenant_id, actor_user_id, actor_role, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), tenantId, actor, actor ? "user" : "device", `offline.${action}`, JSON.stringify(detail), iso()]).catch(() => undefined);
}

async function tenantRow(sql: Sql, tenantId: string) {
  const t = (await sql.execute(`SELECT id, name, business_type, denied_actions, subscription_status FROM tenants WHERE id = ?`, [tenantId])).rows[0];
  if (!t) throw new HttpError(404, "Business not found.");
  return t;
}
const offlineAllowed = (t: Row) => tenantAllows(jsonList(t.denied_actions), "desktop.offline");

/** Who may manage a business's devices: the Super Admin, or that business's owner. */
function managerOf(caller: Caller, tenantId: string) {
  if (caller.role === "super_admin") return;
  if (caller.role !== "owner" || caller.tenantId !== tenantId) throw new HttpError(403, "Only the business owner or MAVIN.pk manages offline devices.");
}

// ── Provisioning ──────────────────────────────────────────────────────────

/** Approves this computer as the branch's offline checkout device. Needs the
 * Super Admin's switch for the business, a supported business type and no
 * other active device on the branch. The secret is returned once. */
export async function provisionDevice(sql: Sql, caller: Caller, input: { branchId?: unknown; name?: unknown; appVersion?: unknown }) {
  if (caller.role !== "owner" || !caller.tenantId) throw new HttpError(403, "The business owner sets up the offline desktop.");
  const tenantId = caller.tenantId;
  const t = await tenantRow(sql, tenantId);
  if (!offlineAllowed(t)) throw new HttpError(403, "Offline desktop is not enabled for your business. Ask MAVIN.pk.");
  if (!(OFFLINE_BUSINESS_TYPES as readonly string[]).includes(String(t.business_type))) throw new HttpError(409, "Offline billing is built for pharmacies, medical stores and general stores only. Use MAVIN.pk online.");
  const branchId = typeof input.branchId === "string" && input.branchId ? input.branchId : `main-${tenantId}`;
  const b = (await sql.execute(`SELECT id, name, status FROM branches WHERE id = ? AND tenant_id = ?`, [branchId, tenantId])).rows[0];
  const branchName = b ? String(b.name) : branchId === `main-${tenantId}` ? "Main branch" : null;
  if (!branchName) throw new HttpError(404, "Branch not found.");
  if (b && String(b.status) !== "active") throw new HttpError(409, "This branch is not active.");
  if ((await sql.execute(`SELECT 1 FROM offline_devices WHERE tenant_id = ? AND branch_id = ? AND status = 'active'`, [tenantId, branchId])).rows[0]) {
    throw new HttpError(409, "This branch already has an offline checkout device. Revoke it first (one offline device per branch).");
  }
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 60) : "Checkout";
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const now = iso();
  const users: GrantUser[] = [{ id: caller.userId, name: await userName(sql, caller.userId), role: "owner" }];
  let code = "";
  for (let i = 0; i < 6 && !code; i++) {
    const c = `D${randomBytes(3).toString("hex").toUpperCase().slice(0, 4)}`;
    if (!(await sql.execute(`SELECT 1 FROM offline_devices WHERE tenant_id = ? AND device_code = ?`, [tenantId, c])).rows[0]) code = c;
  }
  if (!code) throw new HttpError(500, "Could not pick a device code. Try again.");
  await sql.execute(
    `INSERT INTO offline_devices (id, tenant_id, branch_id, name, device_code, secret_hash, status, allowed_users, modules, max_offline_hours, registered_by, registered_at, app_version, protocol, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 72, ?, ?, ?, ?, ?, ?)`,
    [id, tenantId, branchId, name, code, sha(secret), JSON.stringify(users), JSON.stringify(["sale.cash"]), caller.userId, now, typeof input.appVersion === "string" ? input.appVersion.slice(0, 20) : null, PROTOCOL_VERSION, now, now],
  );
  await audit(sql, tenantId, caller.userId, "device.provisioned", { device: id, branch: branchId, code });
  const device = (await deviceById(sql, id))!;
  return { deviceId: id, deviceCode: code, secret, grant: await grantFor(sql, device) };
}

async function userName(sql: Sql, id: string) {
  const u = (await sql.execute(`SELECT display_name, username FROM users WHERE id = ?`, [id])).rows[0];
  return String(u?.display_name || u?.username || "User");
}

async function deviceById(sql: Sql, id: string) {
  return ((await sql.execute(`SELECT * FROM offline_devices WHERE id = ?`, [id])).rows[0] as Device | undefined) ?? null;
}

/** The device from its X-Mavin-Device header "<id>:<secret>" (a revoked device too: its sales are held). */
export async function deviceFromAuth(sql: Sql, header: string | null): Promise<Device> {
  const m = header && /^([0-9a-f-]{36}):([A-Za-z0-9_-]{20,100})$/.exec(header.trim());
  if (!m) throw new HttpError(401, "This computer is not set up as an offline device.");
  const d = await deviceById(sql, m[1]);
  const a = Buffer.from(sha(m[2]), "hex");
  const b = Buffer.from(String(d?.secret_hash ?? "00"), "hex");
  if (!d || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "This computer is not set up as an offline device.");
  return d;
}

/** Device still allowed to work offline: active and the business still has the switch. */
async function deviceUsable(sql: Sql, d: Device) {
  if (d.status !== "active") return false;
  return offlineAllowed(await tenantRow(sql, d.tenant_id));
}

/** A fresh offline allowance for an active device. */
export async function grantFor(sql: Sql, d: Device): Promise<SignedGrant> {
  if (!(await deviceUsable(sql, d))) throw new HttpError(403, "This offline device has been turned off. Pending sales can still be sent.");
  const t = await tenantRow(sql, d.tenant_id);
  const b = (await sql.execute(`SELECT name FROM branches WHERE id = ? AND tenant_id = ?`, [d.branch_id, d.tenant_id])).rows[0];
  const hours = Math.min(MAX_OFFLINE_HOURS, Math.max(MIN_OFFLINE_HOURS, Number(d.max_offline_hours) || 72));
  // Users: only those still active in this business.
  const listed = (JSON.parse(String(d.allowed_users || "[]")) as GrantUser[]).filter((u) => u && typeof u.id === "string");
  const users: GrantUser[] = [];
  for (const u of listed) {
    const r = (await sql.execute(`SELECT id, display_name, username, role, is_active FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [u.id, d.tenant_id])).rows[0];
    if (r && Number(r.is_active)) users.push({ id: String(r.id), name: String(r.display_name || r.username), role: String(r.role) === "owner" ? "owner" : "staff" });
  }
  const now = new Date();
  const p: GrantPayload = {
    v: 1, deviceId: d.id, deviceCode: d.device_code, tenantId: d.tenant_id, tenantName: String(t.name), businessType: String(t.business_type),
    branchId: d.branch_id, branchName: b ? String(b.name) : "Main branch", users,
    modules: jsonList(d.modules).filter((m): m is (typeof OFFLINE_MODULES)[number] => (OFFLINE_MODULES as readonly string[]).includes(m)),
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + hours * 3600_000).toISOString(),
  };
  return signGrant(p, signingKey());
}

/** A user who signed in online on the device is allowed to bill on it offline
 * (owner, or staff with the Invoices section). Returns the new allowance. */
export async function enrolUser(sql: Sql, d: Device, caller: Caller) {
  if (caller.tenantId !== d.tenant_id) throw new HttpError(403, "This login belongs to another business.");
  if (caller.role === "staff" && caller.permissions && !caller.permissions.includes("invoices")) throw new HttpError(403, "This login cannot make sales.");
  if (!(await deviceUsable(sql, d))) throw new HttpError(403, "This offline device has been turned off.");
  const users = (JSON.parse(String(d.allowed_users || "[]")) as GrantUser[]).filter((u) => u.id !== caller.userId);
  users.push({ id: caller.userId, name: await userName(sql, caller.userId), role: caller.role === "owner" ? "owner" : "staff" });
  await sql.execute(`UPDATE offline_devices SET allowed_users = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(users.slice(-20)), iso(), d.id]);
  await audit(sql, d.tenant_id, caller.userId, "device.user_enrolled", { device: d.id });
  return { grant: await grantFor(sql, (await deviceById(sql, d.id))!) };
}

/** What the device reports about itself on each call. */
async function touch(sql: Sql, d: Device, status: { pending?: unknown; failed?: unknown; appVersion?: unknown } | undefined, synced: boolean) {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null);
  await sql.execute(
    `UPDATE offline_devices SET last_seen_at = ?, last_sync_at = CASE WHEN ? THEN ? ELSE last_sync_at END, last_pending = COALESCE(?, last_pending), last_failed = COALESCE(?, last_failed), app_version = COALESCE(?, app_version) WHERE id = ?`,
    [iso(), synced ? 1 : 0, iso(), n(status?.pending), n(status?.failed), typeof status?.appVersion === "string" ? status.appVersion.slice(0, 20) : null, d.id],
  );
}

export function checkProtocol(v: unknown) {
  if (v !== PROTOCOL_VERSION) throw new HttpError(426, "This MAVIN desktop version is out of date. Install the latest version; your pending sales are kept.");
}

// ── Pull ──────────────────────────────────────────────────────────────────

const mapProduct = (r: Row) => ({
  id: String(r.id), name: String(r.name), barcode: (r.barcode as string | null) ?? null, packing: Number(r.packing) > 0 ? Number(r.packing) : 1,
  taxPct: Number(r.gst_rate_pct ?? 0) || 0, isNarcotic: Number(r.is_narcotic) === 1, trackImei: Number(r.track_imei) === 1, deleted: r.deleted_at != null,
});
const mapPrice = (r: Row) => ({ id: String(r.id), productId: String(r.product_id), salePrice: Number(r.sale_price) || 0, createdAt: String(r.created_at), deleted: r.deleted_at != null });
const mapBatch = (r: Row) => ({
  id: String(r.id), productId: String(r.product_id), batchNo: (r.batch_no as string | null) ?? null, expiryDate: (r.expiry_date as string | null) ?? null,
  qty: Number(r.qty) || 0, purchasePrice: Number(r.purchase_price) || 0, deleted: r.deleted_at != null,
});

/** Products the branch can sell: the business's own, and shared catalogue products the branch holds stock of. */
const BRANCH_PRODUCTS = `(p.tenant_id = ? OR p.id IN (SELECT product_id FROM product_batches WHERE tenant_id = ? AND branch_id = ?))`;

/** One page of the initial download (resumable: products, then prices, then
 * batches, by id), then the changes after it from the server's change
 * sequence (offline_changes; no clocks). */
export async function pull(sql: Sql, d: Device, cursorIn: unknown, status?: { pending?: unknown; failed?: unknown; appVersion?: unknown }): Promise<PullResponse> {
  const grant = await grantFor(sql, d);
  const T = d.tenant_id, B = d.branch_id;
  const out: PullResponse = { products: [], prices: [], batches: [], cursor: { phase: "live", seq: 0 }, more: false, reset: false, grant, serverTime: iso() };
  let cursor = parseCursor(cursorIn);
  if (cursor && cursor.phase === "live") {
    // Changes older than the kept log: download everything again.
    const min = Number((await sql.execute(`SELECT MIN(seq) AS m FROM offline_changes`)).rows[0]?.m ?? 0);
    if (min > cursor.seq + 1 && cursor.seq > 0) { cursor = null; out.reset = true; }
  }
  if (!cursor || cursor.phase === "initial") {
    const snapSeq = cursor?.phase === "initial" ? cursor.snapSeq : Number((await sql.execute(`SELECT COALESCE(MAX(seq), 0) AS m FROM offline_changes`)).rows[0]?.m ?? 0);
    const table = cursor?.phase === "initial" ? cursor.table : "products";
    const after = cursor?.phase === "initial" ? cursor.after : "";
    let rows: Row[];
    if (table === "products") {
      rows = (await sql.execute(`SELECT p.* FROM products p WHERE ${BRANCH_PRODUCTS} AND p.deleted_at IS NULL AND p.id > ? ORDER BY p.id LIMIT ?`, [T, T, B, after, PAGE])).rows;
      out.products = rows.map(mapProduct);
    } else if (table === "price_list") {
      rows = (await sql.execute(`SELECT pl.* FROM price_list pl JOIN products p ON p.id = pl.product_id WHERE pl.tenant_id = ? AND pl.deleted_at IS NULL AND ${BRANCH_PRODUCTS} AND pl.id > ? ORDER BY pl.id LIMIT ?`, [T, T, T, B, after, PAGE])).rows;
      out.prices = rows.map(mapPrice);
    } else {
      rows = (await sql.execute(`SELECT * FROM product_batches WHERE tenant_id = ? AND branch_id = ? AND deleted_at IS NULL AND id > ? ORDER BY id LIMIT ?`, [T, B, after, PAGE])).rows;
      out.batches = rows.map(mapBatch);
    }
    const next = ["products", "price_list", "product_batches"] as const;
    if (rows.length === PAGE) out.cursor = { phase: "initial", table, after: String(rows[rows.length - 1].id), snapSeq };
    else if (table !== "product_batches") out.cursor = { phase: "initial", table: next[next.indexOf(table) + 1], after: "", snapSeq };
    else out.cursor = { phase: "live", seq: snapSeq };
    out.more = true;
    if (out.cursor.phase === "live") out.more = false;
  } else {
    const ch = (await sql.execute(
      `SELECT seq, tbl, row_id FROM offline_changes WHERE seq > ? AND (tenant_id = ? OR (tbl = 'products' AND tenant_id IS NULL)) AND (tbl != 'product_batches' OR branch_id = ?) ORDER BY seq LIMIT ?`,
      [cursor.seq, T, B, PAGE],
    )).rows;
    const ids = (tbl: string) => [...new Set(ch.filter((c) => c.tbl === tbl).map((c) => String(c.row_id)))];
    const inList = (n: number) => Array(n).fill("?").join(",");
    const pIds = ids("products"), plIds = ids("price_list"), bIds = ids("product_batches");
    if (pIds.length) out.products = (await sql.execute(`SELECT p.* FROM products p WHERE p.id IN (${inList(pIds.length)}) AND ${BRANCH_PRODUCTS}`, [...pIds, T, T, B])).rows.map(mapProduct);
    if (plIds.length) out.prices = (await sql.execute(`SELECT * FROM price_list WHERE id IN (${inList(plIds.length)}) AND tenant_id = ?`, [...plIds, T])).rows.map(mapPrice);
    if (bIds.length) out.batches = (await sql.execute(`SELECT * FROM product_batches WHERE id IN (${inList(bIds.length)}) AND tenant_id = ? AND branch_id = ?`, [...bIds, T, B])).rows.map(mapBatch);
    // A new batch of a shared catalogue product: send the product too.
    const known = new Set(out.products.map((p) => p.id));
    const missing = [...new Set(out.batches.map((b) => b.productId))].filter((id) => !known.has(id));
    if (missing.length) out.products.push(...(await sql.execute(`SELECT * FROM products WHERE id IN (${inList(missing.length)})`, missing)).rows.map(mapProduct));
    out.cursor = { phase: "live", seq: ch.length ? Number(ch[ch.length - 1].seq) : cursor.seq };
    out.more = ch.length === PAGE;
  }
  await touch(sql, d, status, !out.more);
  return out;
}

function parseCursor(c: unknown): PullCursor | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (o.phase === "live" && Number.isInteger(o.seq) && Number(o.seq) >= 0) return { phase: "live", seq: Number(o.seq) };
  if (o.phase === "initial" && ["products", "price_list", "product_batches"].includes(String(o.table)) && typeof o.after === "string" && Number.isInteger(o.snapSeq)) {
    return { phase: "initial", table: o.table as "products", after: o.after, snapSeq: Number(o.snapSeq) };
  }
  return null;
}

// ── Push ──────────────────────────────────────────────────────────────────

/** Applies the device's operations in order. Each is answered durably: a
 * repeated operation gets the stored answer, never a second sale. */
export async function push(sql: Sql, d: Device, ops: unknown, status?: { pending?: unknown; failed?: unknown; appVersion?: unknown }): Promise<PushResult[]> {
  if (!Array.isArray(ops) || ops.length > 50) throw new HttpError(400, "Send 1 to 50 operations at a time.");
  const usable = await deviceUsable(sql, d);
  const results: PushResult[] = [];
  for (const raw of ops) {
    const opId = typeof (raw as Operation)?.opId === "string" ? (raw as Operation).opId : "";
    const prev = opId ? await storedResult(sql, d, opId) : null;
    if (prev) { results.push(prev); continue; }
    const problems = checkOperation(raw);
    if (problems.length) { results.push({ opId, status: "rejected", error: `Invalid operation: ${problems.slice(0, 5).join(", ")}` }); continue; }
    const op = raw as Operation;
    // Dependencies first (the device sends in order; a missing one waits).
    const missingDep = [];
    for (const dep of op.dependsOn) if (!(await sql.execute(`SELECT 1 FROM offline_ops WHERE op_id = ? AND device_id = ? AND status IN ('applied', 'conflict', 'held')`, [dep, d.id])).rows[0]) missingDep.push(dep);
    if (missingDep.length) { results.push({ opId, status: "rejected", error: `Waiting for earlier operation ${missingDep[0]}` }); continue; }
    results.push(!usable ? await holdOp(sql, d, op) : op.kind === "sale.update" ? await applyEdit(sql, d, op) : await applySale(sql, d, op));
  }
  await touch(sql, d, status, false);
  return results;
}

async function storedResult(sql: Sql, d: Device, opId: string): Promise<PushResult | null> {
  const r = (await sql.execute(`SELECT device_id, status, result, error FROM offline_ops WHERE op_id = ?`, [opId])).rows[0];
  if (!r) return null;
  if (r.device_id !== d.id) return { opId, status: "rejected", error: "Operation id already used by another device." };
  const res = r.result ? (JSON.parse(String(r.result)) as PushResult) : { opId, status: String(r.status) as PushResult["status"] };
  return { ...res, opId, status: String(r.status) as PushResult["status"], error: (r.error as string | null) ?? res.error };
}

/** Kept on the server, not in the books, for the owner to put in or keep out (the sale is never lost). */
async function holdOp(sql: Sql, d: Device, op: Operation, reason = "This device was turned off. The sale is kept on the server for the owner to review."): Promise<PushResult> {
  const result: PushResult = { opId: op.opId, status: "held", error: reason };
  await sql.execute(
    `INSERT INTO offline_ops (op_id, tenant_id, branch_id, device_id, user_id, kind, entity_id, schema_version, depends_on, payload, occurred_at, received_at, status, result, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?, ?)
     ON CONFLICT(op_id) DO UPDATE SET result = excluded.result, error = excluded.error WHERE offline_ops.status = 'held'`,
    [op.opId, d.tenant_id, d.branch_id, d.id, op.userId, op.kind, op.entityId, op.schemaVersion, JSON.stringify(op.dependsOn), JSON.stringify(op.payload), op.occurredAt, iso(), JSON.stringify(result), result.error],
  );
  await audit(sql, d.tenant_id, null, "op.held", { device: d.id, op: op.opId, reason });
  return (await storedResult(sql, d, op.opId)) ?? result;
}

const reject = async (sql: Sql, d: Device, op: Operation, error: string): Promise<PushResult> => {
  const result: PushResult = { opId: op.opId, status: "rejected", error };
  await sql.execute(
    `INSERT INTO offline_ops (op_id, tenant_id, branch_id, device_id, user_id, kind, entity_id, schema_version, depends_on, payload, occurred_at, received_at, status, result, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?) ON CONFLICT(op_id) DO NOTHING`,
    [op.opId, d.tenant_id, d.branch_id, d.id, op.userId, op.kind, op.entityId, op.schemaVersion, JSON.stringify(op.dependsOn), JSON.stringify(op.payload), op.occurredAt, iso(), JSON.stringify(result), error],
  );
  return (await storedResult(sql, d, op.opId)) ?? result;
};

type Stmt = { sql: string; args: unknown[] };
type Shortfall = { lineId: string; productId: string; batchId: string; short: number; name: string };

/** Checks shared by new sales and edits: the user, the date, the batches and
 * products (this business and branch only), the customer. Returns the
 * reason to hold the operation, or the rows it needs. */
async function checkSaleRefs(sql: Sql, d: Device, op: Operation): Promise<{ hold: string } | { batches: Map<string, Row> }> {
  const s: SalePayload = op.payload;
  const T = d.tenant_id, B = d.branch_id;
  // Who made it: a user allowed on this device, still in this business.
  const allowed = (JSON.parse(String(d.allowed_users || "[]")) as GrantUser[]).some((u) => u.id === op.userId);
  const u = (await sql.execute(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`, [op.userId, T])).rows[0];
  if (!allowed || !u) return { hold: "The user who made this sale is no longer allowed on this device. Review it." };
  if (!jsonList(d.modules).includes("sale.cash")) return { hold: "Offline sales are no longer allowed on this device. Review it." };
  // The business day: not ahead of the server by more than a day, not older than the allowance allows (plus a day).
  // An edit keeps its invoice's date; it is checked by when it was made instead.
  const day = op.kind === "sale.update" ? Date.parse(op.occurredAt) : Date.parse(`${s.date}T00:00:00Z`);
  const maxAgeDays = Math.ceil((Number(d.max_offline_hours) || 72) / 24) + 1;
  if (day > Date.now() + 36 * 3600_000 || day < Date.now() - (maxAgeDays + 1) * 86_400_000) return { hold: "The sale date is outside the offline allowance. Review it." };
  // Batches and products: this business and this branch only.
  const batchIds = [...new Set(s.lines.map((l) => l.batchId))];
  const q = Array(batchIds.length).fill("?").join(",");
  const batches = new Map((await sql.execute(`SELECT * FROM product_batches WHERE id IN (${q}) AND tenant_id = ? AND branch_id = ?`, [...batchIds, T, B])).rows.map((r) => [String(r.id), r]));
  for (const l of s.lines) {
    const b = batches.get(l.batchId);
    if (!b || String(b.product_id) !== l.productId) return { hold: `The batch of ${l.productName} is no longer in this branch's stock. Review it.` };
  }
  const prodIds = [...new Set(s.lines.map((l) => l.productId))];
  const products = new Map((await sql.execute(`SELECT id, name, packing, is_narcotic, track_imei FROM products WHERE id IN (${Array(prodIds.length).fill("?").join(",")}) AND (tenant_id = ? OR tenant_id IS NULL)`, [...prodIds, T])).rows.map((r) => [String(r.id), r]));
  for (const l of s.lines) {
    const p = products.get(l.productId);
    if (!p) return { hold: `${l.productName} is no longer in this business's catalogue. Review it.` };
    if (Number(p.track_imei) === 1) return { hold: `${l.productName} needs IMEI numbers, which offline sales do not record. Review it.` };
    if (Number(p.is_narcotic) === 1 && (!s.customerName?.trim() || !s.customerPhone?.trim())) return { hold: `${l.productName} is a controlled medicine and the buyer's name and mobile are missing. Review it.` };
  }
  // A customer (credit): of this business, not deleted.
  if (s.customerId && !(await sql.execute(`SELECT 1 FROM customers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [s.customerId, T])).rows[0]) {
    return { hold: "The customer of this sale is not in this business's customer list. Review it." };
  }
  return { batches };
}

/** Stock the lines take (paid and bonus), from the batch the device used,
 * never below zero; what the batch no longer has is a shortfall. `extra`
 * is stock given back first in the same change (an edit's old lines). */
function planTakes(s: SalePayload, batches: Map<string, Row>, extra: Map<string, number> = new Map()) {
  const left = new Map([...batches].map(([id, b]) => [id, (Number(b.qty) || 0) + (extra.get(id) ?? 0)]));
  const shortfalls: Shortfall[] = [];
  const takes: { batchId: string; qty: number; lineId: string }[] = [];
  for (const l of s.lines) {
    const want = l.qtyPacks + (l.bonusPacks ?? 0);
    const have = left.get(l.batchId) ?? 0;
    const take = Math.max(0, Math.min(want, have));
    const short = want - take;
    left.set(l.batchId, have - take);
    if (take > STOCK_EPS) takes.push({ batchId: l.batchId, qty: take, lineId: l.lineId });
    if (short > STOCK_EPS) shortfalls.push({ lineId: l.lineId, productId: l.productId, batchId: l.batchId, short, name: l.productName });
  }
  return { takes, shortfalls };
}

/** The statements for a bill's lines (prices captured at the counter), the stock they take and the shortfalls. */
function lineStatements(d: Device, op: Operation, batches: Map<string, Row>, takes: { batchId: string; qty: number }[], shortfalls: Shortfall[], now: string, what: string) {
  const s: SalePayload = op.payload;
  const T = d.tenant_id, B = d.branch_id;
  const items: Stmt[] = s.lines.map((l) => {
    const b = batches.get(l.batchId)!;
    return {
      sql: `INSERT INTO invoice_items (id, invoice_id, product_id, batch_no, packing, uom_id, avail_qty, qty, bonus_qty, purchase_price, sale_price, tax_pct, further_tax_pct, tax_rs, discount_pct, discount_rs, total, tenant_id, branch_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [l.lineId, s.saleId, l.productId, b.batch_no ?? l.batchNo, l.packing, Number(b.qty) || 0, l.qtyPacks, l.bonusPacks ?? 0, l.purchasePrice, l.pricePerPack, l.taxPct, l.taxRs, l.discountPct, l.discountRs, l.total, T, B, now, now],
    };
  });
  // Stock taken (a change, never an absolute balance from the device).
  const stock: Stmt[] = takes.map((k) => ({
    sql: `UPDATE product_batches SET qty = CASE WHEN ABS(qty - ?) <= ? THEN 0 ELSE qty - ? END, updated_at = ? WHERE id = ? AND tenant_id = ? AND branch_id = ? AND qty + ? >= ?`,
    args: [k.qty, STOCK_EPS, k.qty, now, k.batchId, T, B, STOCK_EPS, k.qty],
  }));
  const short: Stmt[] = shortfalls.map((x) => exceptionStmt(d, op, x, `${x.name}: ${round6(x.short)} more than the batch held when the ${what} arrived (${refOf(s)}).`, now));
  return { items, stock, short };
}

const refOf = (s: SalePayload) => (s.offlineRef ? `receipt ${s.offlineRef}` : `invoice ${s.edit?.invoiceNo ?? s.saleId}`);
const exceptionStmt = (d: Device, op: Operation, x: Shortfall, detail: string, now: string): Stmt => ({
  sql: `INSERT INTO offline_exceptions (id, tenant_id, branch_id, device_id, op_id, invoice_id, product_id, batch_id, kind, qty, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stock_short', ?, ?, 'open', ?)`,
  args: [randomUUID(), d.tenant_id, d.branch_id, d.id, op.opId, op.payload.saleId, x.productId, x.batchId, x.short, detail, now],
});

/** The operation record (primary key = exactly once; a concurrent duplicate fails the whole batch). */
function opStmt(d: Device, op: Operation, status: PushResult["status"], now: string, decidedBy: string | null): Stmt {
  return {
    sql: `INSERT INTO offline_ops (op_id, tenant_id, branch_id, device_id, user_id, kind, entity_id, schema_version, depends_on, payload, occurred_at, received_at, status, result, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${decidedBy ? ` ON CONFLICT(op_id) DO UPDATE SET status = excluded.status, result = excluded.result, error = NULL, decided_by = excluded.decided_by, decided_at = excluded.decided_at WHERE offline_ops.status = 'held'` : ""}`,
    args: [op.opId, d.tenant_id, d.branch_id, d.id, op.userId, op.kind, op.entityId, op.schemaVersion, JSON.stringify(op.dependsOn), JSON.stringify(op.payload), op.occurredAt, now, status, JSON.stringify({ opId: op.opId, status }), decidedBy, decidedBy ? now : null],
  };
}

/** Runs the statements; a batch whose stock changed between the read and the
 * write (another counter or the web) keeps the sale and raises an exception
 * for what could not be taken. Records and returns the final answer. */
async function finish(sql: Sql, d: Device, op: Operation, stmts: Stmt[], firstTake: number, takes: { batchId: string; qty: number; lineId: string }[], shortCount: number, status: PushResult["status"], extraResult: Partial<PushResult> = {}): Promise<PushResult> {
  const s: SalePayload = op.payload;
  let affected: number[];
  try {
    affected = await sql.batch(stmts);
  } catch (e) {
    // Sent twice at the same moment: the other request applied it.
    const again = await storedResult(sql, d, op.opId);
    if (again) return again;
    throw e;
  }
  const now = iso();
  let late = 0;
  for (const [i, k] of takes.entries()) {
    if (affected[firstTake + i] !== 0) continue;
    const l = s.lines.find((x) => x.lineId === k.lineId)!;
    late++;
    const x = { lineId: l.lineId, productId: l.productId, batchId: k.batchId, short: k.qty, name: l.productName };
    const st = exceptionStmt(d, op, x, `${x.name}: the batch changed while the sale was applied; ${round6(x.short)} not taken (${refOf(s)}).`, now);
    await sql.execute(st.sql, st.args);
  }
  const inv = (await sql.execute(`SELECT invoice_no, updated_at FROM invoices WHERE id = ?`, [s.saleId])).rows[0];
  const seq = Number((await sql.execute(`SELECT COALESCE(MAX(seq), 0) AS m FROM offline_changes`)).rows[0]?.m ?? 0);
  const final: PushResult & { updatedAt?: string } = {
    opId: op.opId, status: late ? "conflict" : status, invoiceId: s.saleId, invoiceNo: Number(inv?.invoice_no), exceptions: shortCount + late, appliedSeq: seq, ...extraResult,
    // The invoice as this operation left it: a later edit from this device follows it only if nothing else changed it.
    updatedAt: inv?.updated_at == null ? undefined : String(inv.updated_at),
  };
  await sql.execute(`UPDATE offline_ops SET status = ?, result = ?, applied_seq = ? WHERE op_id = ?`, [final.status, JSON.stringify(final), seq, op.opId]);
  if (final.exceptions) await audit(sql, d.tenant_id, null, "op.stock_exception", { op: op.opId, invoice: s.saleId, count: final.exceptions });
  return final;
}

/** The invoice's header fields from the sale (as the online invoice form saves them:
 * discount_rs is the bill discount; line discounts stay on the lines). */
function headerValues(s: SalePayload) {
  const t = s.totals;
  return {
    inv_on: s.payment.method, customer_id: s.customerId || null, customer_name: s.customerName?.trim() || null, customer_phone: s.customerPhone?.trim() || null,
    total: t.total, charges: t.charges ?? 0, discount_rs: t.billDiscountRs ?? 0, payable: t.payable, paid: t.paid, balance: t.balance,
  };
}

/** One sale (cash, or credit on a customer) into the books, all or nothing:
 * the operation record, the invoice (server number + the device's receipt
 * number), its lines, the stock taken and any stock exceptions. */
export async function applySale(sql: Sql, d: Device, op: Operation, decidedBy: string | null = null): Promise<PushResult> {
  const s: SalePayload = op.payload;
  const T = d.tenant_id, B = d.branch_id;
  if (!s.offlineRef?.startsWith(`${d.device_code}-`)) return reject(sql, d, op, "Receipt number does not belong to this device.");
  const refs = await checkSaleRefs(sql, d, op);
  if ("hold" in refs) return holdOp(sql, d, op, refs.hold);
  if ((await sql.execute(`SELECT 1 FROM invoices WHERE id = ?`, [s.saleId])).rows[0]) return reject(sql, d, op, "A sale with this id already exists.");
  const { takes, shortfalls } = planTakes(s, refs.batches);
  const status: PushResult["status"] = shortfalls.length ? "conflict" : "applied";
  const now = iso();
  const h = headerValues(s);
  const lines = lineStatements(d, op, refs.batches, takes, shortfalls, now, "sale");
  const stmts: Stmt[] = [
    opStmt(d, op, status, now, decidedBy),
    // The invoice: next number of the business, the device's receipt number kept alongside.
    {
      sql: `INSERT INTO invoices (id, invoice_no, date, inv_on, invoice_type, description, customer_id, customer_name, customer_phone, total, charges, discount_pct, discount_rs, tax_pct, payable, paid, balance,
              is_return, is_memorized, is_quotation, tenant_id, branch_id, offline_ref, created_at, updated_at)
            VALUES (?, (SELECT COALESCE(MAX(invoice_no), 0) + 1 FROM invoices WHERE tenant_id = ? AND COALESCE(is_quotation, 0) = 0), ?, ?, 'retail', ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`,
      args: [s.saleId, T, s.date, h.inv_on, `Offline sale ${s.offlineRef}`, h.customer_id, h.customer_name, h.customer_phone, h.total, h.charges, h.discount_rs, h.payable, h.paid, h.balance, T, B, s.offlineRef, now, now],
    },
    ...lines.items,
  ];
  const firstTake = stmts.length;
  stmts.push(...lines.stock, ...lines.short);
  return finish(sql, d, op, stmts, firstTake, takes, shortfalls.length, status);
}

/** Whether this user may edit invoices (the same rule as online: staff need
 * "Edit invoices", and the business must not have it turned off). */
async function userMayEdit(sql: Sql, tenantId: string, userId: string): Promise<boolean> {
  const u = (await sql.execute(`SELECT role, denied_actions FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [userId, tenantId])).rows[0];
  if (!u) return false;
  const t = await tenantRow(sql, tenantId);
  const role = String(u.role) as Caller["role"];
  return callerCan({ userId, role, tenantId, actions: role === "staff" ? jsonList(u.denied_actions) : [], tenantDeniedActions: jsonList(t.denied_actions) } as Caller, "invoice.edit");
}

/** An offline edit of a sale invoice: the old lines' stock comes back, the
 * new lines take theirs, the lines and the header are replaced (as editing
 * online does), all in one change. Held for the owner instead when the
 * invoice changed elsewhere after this computer saw it, was submitted to FBR,
 * is not a sale of this branch, or the user may not edit invoices. */
export async function applyEdit(sql: Sql, d: Device, op: Operation, decidedBy: string | null = null): Promise<PushResult> {
  const s: SalePayload = op.payload;
  const T = d.tenant_id, B = d.branch_id;
  const inv = (await sql.execute(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`, [s.saleId, T])).rows[0];
  if (!inv || inv.deleted_at != null) return holdOp(sql, d, op, "The invoice of this edit is not on MAVIN.pk (deleted, or never received). Review it.");
  if (String(inv.branch_id ?? "") !== B) return holdOp(sql, d, op, "The invoice belongs to another branch. Review it.");
  if (Number(inv.is_return ?? 0) || Number(inv.is_memorized ?? 0) || Number(inv.is_quotation ?? 0)) return holdOp(sql, d, op, "Only sale invoices can be edited offline. Review it.");
  if (inv.fbr_invoice_no) return holdOp(sql, d, op, "The invoice was submitted to FBR, so the offline edit was not applied. Review it.");
  if (!(await userMayEdit(sql, T, op.userId))) return holdOp(sql, d, op, "The user who edited this invoice may not edit invoices. Review it.");
  if (s.offlineRef && s.offlineRef !== (inv.offline_ref ?? null)) return reject(sql, d, op, "The receipt number does not match the invoice.");
  // Changed elsewhere since this computer saw it? (An owner approving a held edit decides that.)
  if (!decidedBy) {
    let base: string | null = s.edit?.invoiceUpdatedAt ?? null;
    if (s.edit?.afterOpId) {
      const prev = (await sql.execute(`SELECT entity_id, status, result FROM offline_ops WHERE op_id = ? AND device_id = ?`, [s.edit.afterOpId, d.id])).rows[0];
      const latest = (await sql.execute(`SELECT op_id FROM offline_ops WHERE entity_id = ? AND status IN ('applied', 'conflict') ORDER BY received_at DESC, rowid DESC LIMIT 1`, [s.saleId])).rows[0];
      base = prev && prev.entity_id === s.saleId && (prev.status === "applied" || prev.status === "conflict") && latest?.op_id === s.edit.afterOpId
        ? ((JSON.parse(String(prev.result || "{}")) as { updatedAt?: string }).updatedAt ?? null) : null;
    }
    if (!base || base !== String(inv.updated_at)) return holdOp(sql, d, op, "The invoice was changed on MAVIN.pk after this computer last saw it, so the offline edit was not applied over it. Review it.");
  }
  const refs = await checkSaleRefs(sql, d, op);
  if ("hold" in refs) return holdOp(sql, d, op, refs.hold);
  if ((await sql.execute(`SELECT 1 FROM invoice_items WHERE invoice_id = ? AND id IN (${s.lines.map(() => "?").join(",")})`, [s.saleId, ...s.lines.map((l) => l.lineId)])).rows[0]) {
    return reject(sql, d, op, "The edit's lines were already received.");
  }

  // The old lines' stock comes back to their batches in this branch (as editing online does).
  const oldItems = (await sql.execute(`SELECT id, product_id, batch_no, qty, bonus_qty FROM invoice_items WHERE invoice_id = ? AND tenant_id = ? AND deleted_at IS NULL`, [s.saleId, T])).rows;
  const back = new Map<string, number>();
  for (const it of oldItems) {
    const b = (await sql.execute(`SELECT id FROM product_batches WHERE tenant_id = ? AND branch_id = ? AND product_id = ? AND batch_no IS ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [T, B, it.product_id, it.batch_no ?? null])).rows[0];
    if (!b) return holdOp(sql, d, op, "A batch of the invoice's old lines is no longer in this branch, so its stock cannot be put back. Review it.");
    back.set(String(b.id), (back.get(String(b.id)) ?? 0) + (Number(it.qty) || 0) + (Number(it.bonus_qty) || 0));
  }
  // Batches given stock back that the new lines do not use are read too (for the guard).
  const { takes, shortfalls } = planTakes(s, refs.batches, back);
  const status: PushResult["status"] = shortfalls.length ? "conflict" : "applied";
  const now = iso();
  const h = headerValues(s);
  const lines = lineStatements(d, op, refs.batches, [], shortfalls, now, "edit");
  const stmts: Stmt[] = [
    // Stops the whole change if the invoice moved since it was read (abs() of the smallest integer is an error in SQLite).
    { sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM invoices WHERE id = ? AND updated_at = ? AND deleted_at IS NULL AND fbr_invoice_no IS NULL) THEN 1 ELSE abs(-9223372036854775808) END`, args: [s.saleId, String(inv.updated_at)] },
    opStmt(d, op, status, now, decidedBy),
    ...[...back].map(([id, qty]) => ({ sql: `UPDATE product_batches SET qty = qty + ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND branch_id = ?`, args: [qty, now, id, T, B] })),
    { sql: `UPDATE invoice_items SET deleted_at = ?, updated_at = ? WHERE invoice_id = ? AND tenant_id = ? AND deleted_at IS NULL`, args: [now, now, s.saleId, T] },
    {
      sql: `UPDATE invoices SET inv_on = ?, customer_id = ?, customer_name = ?, customer_phone = ?, total = ?, charges = ?, discount_rs = ?, payable = ?, paid = ?, balance = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      args: [h.inv_on, h.customer_id, h.customer_name, h.customer_phone, h.total, h.charges, h.discount_rs, h.payable, h.paid, h.balance, now, s.saleId, T],
    },
    ...lines.items,
  ];
  // The new lines take their stock after the old came back.
  const firstTake = stmts.length;
  stmts.push(...takes.map((k) => ({
    sql: `UPDATE product_batches SET qty = CASE WHEN ABS(qty - ?) <= ? THEN 0 ELSE qty - ? END, updated_at = ? WHERE id = ? AND tenant_id = ? AND branch_id = ? AND qty + ? >= ?`,
    args: [k.qty, STOCK_EPS, k.qty, now, k.batchId, T, B, STOCK_EPS, k.qty],
  })), ...lines.short);
  try {
    const r = await finish(sql, d, op, stmts, firstTake, takes, shortfalls.length, status);
    await audit(sql, T, op.userId, "invoice.edited_offline", { op: op.opId, invoice: s.saleId, device: d.id });
    return r;
  } catch (e) {
    // The guard stopped it: the invoice changed between the read and the write.
    if (/overflow/i.test(e instanceof Error ? e.message : String(e))) return holdOp(sql, d, op, "The invoice was changed on MAVIN.pk while this edit arrived. Review it.");
    throw e;
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ── Management (Super Admin / owner) ─────────────────────────────────────

export async function listDevices(sql: Sql, caller: Caller, tenantId: string) {
  managerOf(caller, tenantId);
  const rows = (await sql.execute(`SELECT d.*, b.name AS branch_name FROM offline_devices d LEFT JOIN branches b ON b.id = d.branch_id WHERE d.tenant_id = ? ORDER BY d.status = 'active' DESC, d.registered_at DESC`, [tenantId])).rows;
  const t = await tenantRow(sql, tenantId);
  const counts = (await sql.execute(`SELECT device_id, status, COUNT(*) AS n FROM offline_ops WHERE tenant_id = ? AND status IN ('held', 'rejected') GROUP BY device_id, status`, [tenantId])).rows;
  const open = (await sql.execute(`SELECT device_id, COUNT(*) AS n FROM offline_exceptions WHERE tenant_id = ? AND status = 'open' GROUP BY device_id`, [tenantId])).rows;
  return {
    allowed: offlineAllowed(t),
    supportedType: (OFFLINE_BUSINESS_TYPES as readonly string[]).includes(String(t.business_type)),
    devices: rows.map((r) => ({
      id: String(r.id), name: String(r.name), code: String(r.device_code), branchId: String(r.branch_id), branchName: (r.branch_name as string | null) ?? "Main branch",
      status: String(r.status), users: (JSON.parse(String(r.allowed_users || "[]")) as GrantUser[]).map((u) => u.name), modules: jsonList(r.modules),
      maxOfflineHours: Number(r.max_offline_hours), registeredAt: String(r.registered_at), revokedAt: (r.revoked_at as string | null) ?? null, revokeReason: (r.revoke_reason as string | null) ?? null,
      lastSeenAt: (r.last_seen_at as string | null) ?? null, lastSyncAt: (r.last_sync_at as string | null) ?? null,
      pendingOnDevice: r.last_pending == null ? null : Number(r.last_pending), failedOnDevice: r.last_failed == null ? null : Number(r.last_failed),
      held: Number(counts.find((c) => c.device_id === r.id && c.status === "held")?.n ?? 0),
      rejected: Number(counts.find((c) => c.device_id === r.id && c.status === "rejected")?.n ?? 0),
      openExceptions: Number(open.find((c) => c.device_id === r.id)?.n ?? 0),
      appVersion: (r.app_version as string | null) ?? null,
    })),
  };
}

async function ownDevice(sql: Sql, caller: Caller, id: string) {
  const d = await deviceById(sql, id);
  if (!d) throw new HttpError(404, "Device not found.");
  managerOf(caller, d.tenant_id);
  return d;
}

/** Stops the device's offline allowance and sync. Its unsent sales are still accepted, as held, for review. */
export async function revokeDevice(sql: Sql, caller: Caller, id: string, reason: unknown) {
  const d = await ownDevice(sql, caller, id);
  if (d.status !== "active") return { ok: true };
  const why = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  await sql.execute(`UPDATE offline_devices SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ?, updated_at = ? WHERE id = ?`, [iso(), caller.userId, why || null, iso(), id]);
  await audit(sql, d.tenant_id, caller.userId, "device.revoked", { device: id, reason: why || null });
  return { ok: true };
}

/** Offline allowance (hours) of a device: Super Admin only. */
export async function setDeviceHours(sql: Sql, caller: Caller, id: string, hours: unknown) {
  if (caller.role !== "super_admin") throw new HttpError(403, "MAVIN.pk sets the offline allowance.");
  const d = await ownDevice(sql, caller, id);
  const h = Math.round(Number(hours));
  if (!(h >= MIN_OFFLINE_HOURS && h <= MAX_OFFLINE_HOURS)) throw new HttpError(400, `Between ${MIN_OFFLINE_HOURS} and ${MAX_OFFLINE_HOURS} hours.`);
  await sql.execute(`UPDATE offline_devices SET max_offline_hours = ?, updated_at = ? WHERE id = ?`, [h, iso(), id]);
  await audit(sql, d.tenant_id, caller.userId, "device.hours", { device: id, hours: h });
  return { ok: true };
}

export async function listExceptions(sql: Sql, caller: Caller, tenantId: string) {
  managerOf(caller, tenantId);
  return (await sql.execute(
    `SELECT x.*, i.invoice_no, i.offline_ref, d.name AS device_name FROM offline_exceptions x LEFT JOIN invoices i ON i.id = x.invoice_id LEFT JOIN offline_devices d ON d.id = x.device_id WHERE x.tenant_id = ? ORDER BY x.status = 'open' DESC, x.created_at DESC LIMIT 200`,
    [tenantId],
  )).rows.map((r) => ({
    id: String(r.id), kind: String(r.kind), qty: Number(r.qty), detail: (r.detail as string | null) ?? "", status: String(r.status), invoiceNo: r.invoice_no == null ? null : Number(r.invoice_no),
    offlineRef: (r.offline_ref as string | null) ?? null, deviceName: (r.device_name as string | null) ?? null, resolution: (r.resolution as string | null) ?? null, createdAt: String(r.created_at),
  }));
}

/** Closes an exception with what was done about it (stock count, adjustment, return); the sale is never changed here. */
export async function resolveException(sql: Sql, caller: Caller, id: string, note: unknown) {
  const x = (await sql.execute(`SELECT tenant_id FROM offline_exceptions WHERE id = ? AND status = 'open'`, [id])).rows[0];
  if (!x) throw new HttpError(404, "No open exception.");
  managerOf(caller, String(x.tenant_id));
  const why = typeof note === "string" ? note.trim().slice(0, 300) : "";
  if (!why) throw new HttpError(400, "Say what was done (for example: stock counted and adjusted).");
  await sql.execute(`UPDATE offline_exceptions SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'`, [why, caller.userId, iso(), id]);
  await audit(sql, String(x.tenant_id), caller.userId, "exception.resolved", { exception: id, note: why });
  return { ok: true };
}

export async function listHeld(sql: Sql, caller: Caller, tenantId: string) {
  managerOf(caller, tenantId);
  return (await sql.execute(`SELECT op_id, device_id, kind, payload, received_at, error FROM offline_ops WHERE tenant_id = ? AND status = 'held' ORDER BY received_at`, [tenantId])).rows.map((r) => {
    const p = JSON.parse(String(r.payload)) as SalePayload;
    return {
      opId: String(r.op_id), deviceId: String(r.device_id), kind: String(r.kind) === "sale.update" ? "edit" : "sale",
      offlineRef: p.offlineRef ?? (p.edit?.invoiceNo != null ? `Invoice ${p.edit.invoiceNo}` : null), date: p.date, payable: p.totals.payable, lines: p.lines.length,
      receivedAt: String(r.received_at), reason: (r.error as string | null) ?? null,
    };
  });
}

/** A held sale (from a turned-off device): put into the books, or kept out with a reason. */
export async function decideHeld(sql: Sql, caller: Caller, opId: string, approve: boolean, note: unknown) {
  const r = (await sql.execute(`SELECT * FROM offline_ops WHERE op_id = ? AND status = 'held'`, [opId])).rows[0];
  if (!r) throw new HttpError(404, "No held sale.");
  managerOf(caller, String(r.tenant_id));
  const d = (await deviceById(sql, String(r.device_id)))!;
  if (!approve) {
    const why = typeof note === "string" ? note.trim().slice(0, 300) : "";
    if (!why) throw new HttpError(400, "Give a reason.");
    await sql.execute(`UPDATE offline_ops SET status = 'rejected', error = ?, decided_by = ?, decided_at = ? WHERE op_id = ? AND status = 'held'`, [`Not accepted: ${why}`, caller.userId, iso(), opId]);
    await audit(sql, d.tenant_id, caller.userId, "op.held_rejected", { op: opId, note: why });
    return { status: "rejected" };
  }
  const kind = String(r.kind) === "sale.update" ? "sale.update" : "sale.create";
  const op: Operation = { opId, kind, entityId: String(r.entity_id), schemaVersion: Number(r.schema_version), dependsOn: jsonList(r.depends_on), occurredAt: String(r.occurred_at), userId: String(r.user_id), payload: JSON.parse(String(r.payload)) };
  // Applied as the device would have been, by the owner's decision (an edit over later changes too).
  const res = kind === "sale.update" ? await applyEdit(sql, d, op, caller.userId) : await applySale(sql, d, op, caller.userId);
  await audit(sql, d.tenant_id, caller.userId, "op.held_approved", { op: opId, status: res.status });
  return res;
}

/** Keeps the change log bounded: entries older than `days` go (a device whose
 * cursor is older then downloads everything again; see pull()). */
export async function pruneChanges(sql: Sql, days = 45) {
  const cut = new Date(Date.now() - days * 86_400_000).toISOString();
  const r = await sql.execute(`DELETE FROM offline_changes WHERE seq < (SELECT COALESCE(MIN(seq), 0) FROM offline_changes WHERE changed_at >= ?)`, [cut]);
  return { removed: r.rowsAffected };
}

// ── Read-only copy for the desktop screens (shown offline) ────────────────

/** Tables the desktop keeps a read-only copy of, each limited to the
 * device's business (and its branch for stock). Secrets never leave. */
const MIRROR: Record<string, (T: string, B: string, groups: string[]) => { where: string; args: unknown[] }> = {
  tenants: (T) => ({ where: `id = ?`, args: [T] }),
  branches: (T) => ({ where: `tenant_id = ?`, args: [T] }),
  // An exact prefix (LIKE would treat "_" in an id as a wildcard).
  settings: (T) => ({ where: `substr(key, 1, ?) = ?`, args: [T.length + 2, `${T}::`] }),
  users: (T) => ({ where: `tenant_id = ? AND deleted_at IS NULL`, args: [T] }),
  categories: (T) => ({ where: `(tenant_id = ? OR tenant_id IS NULL) AND deleted_at IS NULL`, args: [T] }),
  sub_categories: (T) => ({ where: `(tenant_id = ? OR tenant_id IS NULL) AND deleted_at IS NULL`, args: [T] }),
  uoms: (T) => ({ where: `(tenant_id = ? OR tenant_id IS NULL) AND deleted_at IS NULL`, args: [T] }),
  products: (T, B, groups) => ({
    where: `deleted_at IS NULL AND (tenant_id = ?${groups.length ? ` OR (tenant_id IS NULL AND catalog_group IN (${groups.map(() => "?").join(",")}))` : ""} OR id IN (SELECT product_id FROM product_batches WHERE tenant_id = ? AND branch_id = ?))`,
    args: [T, ...groups, T, B],
  }),
  price_list: (T) => ({ where: `tenant_id = ? AND deleted_at IS NULL`, args: [T] }),
  product_batches: (T, B) => ({ where: `tenant_id = ? AND branch_id = ? AND deleted_at IS NULL`, args: [T, B] }),
  customers: (T) => ({ where: `tenant_id = ? AND deleted_at IS NULL`, args: [T] }),
  salesmen: (T) => ({ where: `tenant_id = ? AND deleted_at IS NULL`, args: [T] }),
};
MIRROR.suppliers = (T) => ({ where: `tenant_id = ? AND deleted_at IS NULL`, args: [T] });
export const MIRROR_TABLES = Object.keys(MIRROR);

/** History the desktop keeps for its branch: the last HISTORY_DAYS days (by
 * the document's date), so the screens show recent sales, purchases and cash
 * offline, including those made online, on other counters or on phones.
 * Fetched in full, or only rows changed since a time (deleted ones included,
 * so the copy drops them). Items follow their document's date. */
export const HISTORY_DAYS = 60;
const inWindow = (parent: string) => `SELECT id FROM ${parent} WHERE tenant_id = ? AND branch_id = ? AND date >= ?`;
const HISTORY: Record<string, (T: string, B: string, cutoff: string) => { where: string; args: unknown[] }> = {
  invoices: (T, B, c) => ({ where: `tenant_id = ? AND branch_id = ? AND date >= ?`, args: [T, B, c] }),
  invoice_items: (T, B, c) => ({ where: `tenant_id = ? AND invoice_id IN (${inWindow("invoices")})`, args: [T, T, B, c] }),
  purchases: (T, B, c) => ({ where: `tenant_id = ? AND branch_id = ? AND date >= ?`, args: [T, B, c] }),
  purchase_items: (T, B, c) => ({ where: `tenant_id = ? AND purchase_id IN (${inWindow("purchases")})`, args: [T, T, B, c] }),
  expenses: (T, B, c) => ({ where: `tenant_id = ? AND branch_id = ? AND date >= ?`, args: [T, B, c] }),
  cash_register_entries: (T, B, c) => ({ where: `tenant_id = ? AND branch_id = ? AND date >= ?`, args: [T, B, c] }),
  ledger_adjustments: (T, B, c) => ({ where: `tenant_id = ? AND branch_id = ? AND date >= ?`, args: [T, B, c] }),
};
export const HISTORY_TABLES = Object.keys(HISTORY);

const SECRET_COLUMN = /pass(word)?|secret|token|hash|salt|api_?key|private/i;
/** Settings holding credentials (FBR tokens, AI keys ...) never leave either. */
const SECRET_SETTING = /token|secret|api_?key|pass(word)?|private|pin\b|credential/i;
const MIRROR_PAGE = 2000;

/** One page of one table for the device's read-only copy. History tables
 * take `since` (an updated_at) to send only what changed after it. */
export async function mirrorPage(sql: Sql, d: Device, table: unknown, offset: unknown, since?: unknown, now = new Date()) {
  if (!(await deviceUsable(sql, d))) throw new HttpError(403, "This offline device has been turned off.");
  const name = String(table);
  const from = Math.max(0, Math.floor(Number(offset) || 0));
  let where: string;
  let args: unknown[];
  let cutoff: string | null = null;
  if (HISTORY[name]) {
    cutoff = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
    ({ where, args } = HISTORY[name](d.tenant_id, d.branch_id, cutoff));
    if (typeof since === "string" && since) { where += ` AND updated_at > ?`; args.push(since); }
    else where += ` AND deleted_at IS NULL`;
  } else if (MIRROR[name]) {
    const t = await tenantRow(sql, d.tenant_id);
    const { sharedCatalogGroupsFor } = await import("@/lib/catalogAccess");
    ({ where, args } = MIRROR[name](d.tenant_id, d.branch_id, sharedCatalogGroupsFor(String(t.business_type))));
  } else throw new HttpError(400, "Unknown table.");
  const rows = (await sql.execute(`SELECT * FROM ${name} WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`, [...args, MIRROR_PAGE + 1, from])).rows;
  const more = rows.length > MIRROR_PAGE;
  const clean = rows.slice(0, MIRROR_PAGE)
    .filter((r) => name !== "settings" || !SECRET_SETTING.test(String(r.key).slice(d.tenant_id.length + 2)))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLUMN.test(k))));
  return { table: name, rows: clean, next: more ? from + MIRROR_PAGE : null, cutoff };
}
