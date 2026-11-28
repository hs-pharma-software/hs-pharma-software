/** Changes of a shared product that the Super Admin decides (schema v114):
 * a LOWER retail price and a NEW PACK SIZE. A business reports one; the Super
 * Admin sees who (name and mobile) and approves or rejects it. Approved, every
 * business of that catalogue is told: a price is applied by each business
 * itself, a pack size converts everyone's stock and records at once
 * (catalogPacking.ts). */
import { randomUUID } from "node:crypto";
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import { packingStatements } from "./catalogPacking";
import { businessOf, latestPrice, requirePricing, type Business } from "./catalogBusiness";
import type { SharedCatalogGroup } from "../lib/catalogAccess";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** How long an approved change stays in a business's pop-up until answered. */
export const CHANGE_NOTICE_DAYS = 30;
const MAX_PACKING = 100_000;
const SAME = 0.005;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;
const marks = (n: number) => Array(n).fill("?").join(",");

async function sharedProduct(sql: Pick<Sql, "execute">, b: Business, id: string) {
  const p = (await sql.execute(
    `SELECT id, name, packing, secondary_unit_id, COALESCE(catalog_group, 'pharma') AS g FROM products WHERE id = ? AND tenant_id IS NULL AND deleted_at IS NULL`, [id])).rows[0];
  return p && b.groups.includes(String(p.g) as SharedCatalogGroup) ? p : null;
}

/** "The retail price has gone down": for the Super Admin. One waiting request per product and price. */
export async function requestDecrease(sql: Sql, caller: Caller, productId: string, price: number, previous: number, now = new Date()): Promise<boolean> {
  const b = requirePricing(caller);
  const p = await sharedProduct(sql, b, productId);
  if (!p) return false;
  // Only a price the business has itself saved.
  const mine = await latestPrice(sql, b.tenantId, productId);
  if (!mine || Math.abs(num(mine.sale_price) - price) >= SAME) return false;
  const waiting = (await sql.execute(`SELECT 1 FROM catalog_change_requests WHERE product_id = ? AND kind = 'decrease' AND status = 'pending' AND ABS(new_price - ?) < ${SAME}`, [productId, price])).rows[0];
  if (waiting) return false;
  await sql.execute(`UPDATE catalog_change_requests SET status = 'replaced' WHERE product_id = ? AND tenant_id = ? AND kind = 'decrease' AND status = 'pending'`, [productId, b.tenantId]);
  await sql.execute(
    `INSERT INTO catalog_change_requests (id, product_id, catalog_group, kind, tenant_id, user_id, old_price, new_price, status, created_at) VALUES (?, ?, ?, 'decrease', ?, ?, ?, ?, 'pending', ?)`,
    [randomUUID(), productId, p.g, b.tenantId, caller.userId, previous, price, now.toISOString()]);
  return true;
}

/** "The company changed the pack size": for the Super Admin. */
export async function requestPacking(sql: Sql, caller: Caller, body: Record<string, unknown>, now = new Date()): Promise<{ requested: boolean }> {
  const b = requirePricing(caller);
  const productId = String(body.productId ?? "");
  const size = num(body.newPacking);
  const p = await sharedProduct(sql, b, productId);
  if (!p) throw new HttpError(404, "This is not a shared catalogue product.");
  if (!(size > 0) || size > MAX_PACKING) throw new HttpError(400, "Enter the new pack size.");
  if (Math.abs(size - num(p.packing)) < 1e-9) throw new HttpError(400, "That is the current pack size.");
  const waiting = (await sql.execute(`SELECT 1 FROM catalog_change_requests WHERE product_id = ? AND kind = 'packing' AND status = 'pending' AND ABS(new_packing - ?) < 1e-9`, [productId, size])).rows[0];
  if (waiting) return { requested: false };
  await sql.execute(`UPDATE catalog_change_requests SET status = 'replaced' WHERE product_id = ? AND tenant_id = ? AND kind = 'packing' AND status = 'pending'`, [productId, b.tenantId]);
  await sql.execute(
    `INSERT INTO catalog_change_requests (id, product_id, catalog_group, kind, tenant_id, user_id, old_packing, new_packing, note, status, created_at) VALUES (?, ?, ?, 'packing', ?, ?, ?, ?, ?, 'pending', ?)`,
    [randomUUID(), productId, p.g, b.tenantId, caller.userId, num(p.packing) || 1, size, String(body.note ?? "").trim().slice(0, 300) || null, now.toISOString()]);
  return { requested: true };
}

// ── Super Admin ───────────────────────────────────────────────────────────

function requireOwnerOfPlatform(caller: Caller) {
  if (caller.role !== "super_admin" || caller.platformRole) throw new HttpError(403, "Only the platform owner decides catalogue changes.");
}

export interface ReviewRow {
  id: string; kind: "decrease" | "packing"; status: string; productId: string; productName: string; catalog: string;
  businessName: string; mobile: string | null; ownerName: string | null; note: string | null; createdAt: string; decidedAt: string | null;
  oldPrice: number; newPrice: number; oldPacking: number | null; newPacking: number | null; currentPacking: number; usualPrice: number | null;
  /** Businesses holding stock of the product (their stock converts with a new pack size). */
  stockHolders: number;
}

export async function listReviews(sql: Sql, caller: Caller, status: unknown): Promise<ReviewRow[]> {
  requireOwnerOfPlatform(caller);
  const pending = status !== "decided";
  const rows = (await sql.execute(
    `SELECT r.*, p.name AS product_name, p.packing AS current_packing, t.name AS business_name, t.phone, t.owner_name, c.sale_price AS usual_price,
       (SELECT COUNT(DISTINCT s.tenant_id) FROM product_batches s WHERE s.product_id = r.product_id AND s.deleted_at IS NULL AND s.qty > 0) AS holders
     FROM catalog_change_requests r
     JOIN products p ON p.id = r.product_id
     LEFT JOIN tenants t ON t.id = r.tenant_id
     LEFT JOIN catalog_prices c ON c.product_id = r.product_id
     WHERE r.status ${pending ? "= 'pending'" : "IN ('approved', 'rejected')"}
     ORDER BY ${pending ? "r.created_at" : "r.decided_at DESC"} LIMIT 200`)).rows;
  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  return rows.map((r) => ({
    id: String(r.id), kind: r.kind === "packing" ? "packing" : "decrease", status: String(r.status), productId: String(r.product_id), productName: String(r.product_name),
    catalog: String(r.catalog_group), businessName: s(r.business_name) ?? "(removed business)", mobile: s(r.phone), ownerName: s(r.owner_name), note: s(r.note),
    createdAt: String(r.created_at), decidedAt: s(r.decided_at), oldPrice: num(r.old_price), newPrice: num(r.new_price),
    oldPacking: r.old_packing == null ? null : num(r.old_packing), newPacking: r.new_packing == null ? null : num(r.new_packing),
    currentPacking: num(r.current_packing) || 1, usualPrice: r.usual_price == null ? null : num(r.usual_price), stockHolders: num(r.holders),
  }));
}

/** Approve or reject. An approval may carry the retail price and MRP to publish
 * (per pack; for a new pack size, per new pack). Everything an approval changes
 * goes in one atomic batch; its first statement can only succeed once, so a
 * request is never applied twice. */
export async function decideReview(sql: Sql, caller: Caller, body: Record<string, unknown>, now = new Date()): Promise<{ ok: true; moved: Record<string, number> }> {
  requireOwnerOfPlatform(caller);
  const at = now.toISOString();
  const price = body.salePrice == null || body.salePrice === "" ? null : round2(num(body.salePrice));
  const mrp = body.mrp == null || body.mrp === "" ? null : round2(num(body.mrp));
  if ((price != null && price <= 0) || (mrp != null && mrp < 0)) throw new HttpError(400, "Prices must be positive.");
  const r = (await sql.execute(`SELECT * FROM catalog_change_requests WHERE id = ? AND status = 'pending'`, [String(body.id ?? "")])).rows[0];
  if (!r) throw new HttpError(404, "This request was already decided.");
  const note = String(body.note ?? "").trim().slice(0, 300) || null;
  if (body.approve !== true) {
    const done = await sql.execute(`UPDATE catalog_change_requests SET status = 'rejected', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND status = 'pending'`, [at, caller.userId, note, r.id]);
    if (!done.rowsAffected) throw new HttpError(404, "This request was already decided.");
    return { ok: true, moved: {} };
  }
  const productId = String(r.product_id);
  const stmts: { table: string; sql: string; args: unknown[] }[] = [{
    table: "", sql: `INSERT INTO catalog_price_responses (id, proposal_id, tenant_id, answer, user_id, created_at) VALUES (?, ?, '#decided', 'yes', ?, ?)`,
    args: [`decide:${r.id}`, r.id, caller.userId, at],
  }];
  let publish = price;
  if (r.kind === "packing") {
    const p = (await sql.execute(`SELECT packing, tenant_id FROM products WHERE id = ? AND deleted_at IS NULL`, [productId])).rows[0];
    if (!p || p.tenant_id != null) throw new HttpError(409, "The product is no longer in the shared catalogue.");
    if (Math.abs(num(p.packing) - num(r.old_packing)) > 1e-9) throw new HttpError(409, `The pack size changed since this was reported (now ${num(p.packing)}). Reject it.`);
    stmts.push(...(await packingStatements(sql, productId, num(r.old_packing), num(r.new_packing), at)));
    // Other reports about the old pack size no longer apply.
    stmts.push({ table: "", sql: `UPDATE catalog_change_requests SET status = 'replaced' WHERE product_id = ? AND kind = 'packing' AND status = 'pending' AND id <> ?`, args: [productId, r.id] });
  } else {
    publish = price ?? num(r.new_price);
    stmts.push({ table: "", sql: `UPDATE catalog_price_proposals SET status = 'replaced' WHERE product_id = ? AND status IN ('open', 'accepted')`, args: [productId] });
  }
  // The usual price: set (a new pack's usual price was converted above, so an MRP alone keeps it).
  if (publish != null) {
    stmts.push({
      table: "", sql: `INSERT INTO catalog_prices (product_id, sale_price, mrp, source_tenant_id, updated_at) VALUES (?, ?, COALESCE(?, 0), ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET sale_price = excluded.sale_price, mrp = COALESCE(?, catalog_prices.mrp), source_tenant_id = excluded.source_tenant_id, updated_at = excluded.updated_at`,
      args: [productId, publish, mrp, r.tenant_id, at, mrp],
    });
  } else if (mrp != null) {
    stmts.push({ table: "", sql: `UPDATE catalog_prices SET mrp = ?, updated_at = ? WHERE product_id = ?`, args: [mrp, at, productId] });
  }
  stmts.push({
    table: "", sql: `UPDATE catalog_change_requests SET status = 'approved', approved_price = ?, approved_mrp = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?`,
    args: [publish, mrp, at, caller.userId, note, r.id],
  });
  const changed = await sql.batch(stmts.map((s) => ({ sql: s.sql, args: s.args })));
  const moved: Record<string, number> = {};
  stmts.forEach((s, i) => { if (s.table && changed[i]) moved[s.table] = changed[i]; });
  // What was converted, kept with the decision (for the record only).
  if (Object.keys(moved).length) await sql.execute(`UPDATE catalog_change_requests SET moved = ? WHERE id = ?`, [JSON.stringify(moved), r.id]).catch(() => undefined);
  return { ok: true, moved };
}

// ── Businesses: what was approved ─────────────────────────────────────────

export interface ChangeNotice {
  id: string; kind: "decrease" | "packing"; productId: string; name: string; unit: string | null;
  myPrice: number;
  /** The retail price to apply, or 0 when there is nothing to apply. */
  newPrice: number;
  oldPacking: number | null; newPacking: number | null; at: string;
}

/** Approved changes this business has not acknowledged yet. */
export async function changeNotices(sql: Sql, caller: Caller, now = new Date()): Promise<ChangeNotice[]> {
  const b = businessOf(caller);
  if (!b) return [];
  const since = new Date(now.getTime() - CHANGE_NOTICE_DAYS * 864e5).toISOString();
  const rows = (await sql.execute(
    `SELECT r.*, p.name AS product_name, u.name AS unit_name FROM catalog_change_requests r
     JOIN products p ON p.id = r.product_id AND p.deleted_at IS NULL
     LEFT JOIN uoms u ON u.id = p.base_unit_id
     WHERE r.status = 'approved' AND r.decided_at >= ? AND r.catalog_group IN (${marks(b.groups.length)})
       AND NOT (r.kind = 'decrease' AND r.tenant_id = ?)
       AND NOT EXISTS (SELECT 1 FROM catalog_price_responses x WHERE x.proposal_id = r.id AND x.tenant_id = ?)
     ORDER BY r.decided_at DESC LIMIT 100`, [since, ...b.groups, b.tenantId, b.tenantId])).rows;
  const out: ChangeNotice[] = [];
  for (const r of rows) {
    const mine = num((await latestPrice(sql, b.tenantId, String(r.product_id)))?.sale_price);
    const approved = num(r.approved_price);
    out.push({
      id: String(r.id), kind: r.kind === "packing" ? "packing" : "decrease", productId: String(r.product_id), name: String(r.product_name), unit: (r.unit_name as string | null) ?? null,
      myPrice: mine, newPrice: approved > 0 && mine > 0 && Math.abs(mine - approved) >= SAME ? approved : 0,
      oldPacking: r.old_packing == null ? null : num(r.old_packing), newPacking: r.new_packing == null ? null : num(r.new_packing), at: String(r.decided_at),
    });
  }
  return out;
}

/** Yes: the approved price becomes this business's own. No (or OK): only noted. */
export async function answerChange(sql: Sql, caller: Caller, id: string, yes: boolean, now = new Date()): Promise<boolean> {
  const b = requirePricing(caller);
  const r = (await sql.execute(`SELECT * FROM catalog_change_requests WHERE id = ? AND status = 'approved'`, [id])).rows[0];
  if (!r || !b.groups.includes(String(r.catalog_group) as SharedCatalogGroup)) return false;
  const at = now.toISOString();
  const first = await sql.execute(`INSERT OR IGNORE INTO catalog_price_responses (id, proposal_id, tenant_id, answer, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), id, b.tenantId, yes ? "yes" : "no", caller.userId, at]);
  const approved = num(r.approved_price);
  if (first.rowsAffected && yes && approved > 0) {
    const mine = await latestPrice(sql, b.tenantId, String(r.product_id));
    if (Math.abs(num(mine?.sale_price) - approved) >= SAME) {
      await sql.execute(
        `INSERT INTO price_list (id, product_id, tenant_id, batch_no, sale_price, wholesale_price, mrp, comment, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, ?, ?, 'Catalogue price change', ?, ?, NULL)`,
        [randomUUID(), r.product_id, b.tenantId, approved, num(mine?.wholesale_price), r.approved_mrp == null ? num(mine?.mrp) : num(r.approved_mrp), at, at]);
    }
  }
  return true;
}
