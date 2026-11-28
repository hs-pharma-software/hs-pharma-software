/** Shared catalogue prices (Pharmacy and General store catalogues, schema v114).
 *
 * - Every shared product may have a usual retail price and MRP (per base unit),
 *   taken from the business whose product the Super Admin shared. It prefills
 *   another business's first purchase of the product.
 * - A business that raises a shared product's retail price in a purchase is
 *   asked whether the retail price itself has gone up. Yes: a proposal, open
 *   for a week. The other businesses of that catalogue are asked; one agrees by
 *   answering Yes or by saving that price themselves. Once enough agree, the
 *   proposed price becomes the usual price. Otherwise it lapses and stays only
 *   with the business that raised it.
 * - A LOWER retail price goes to the Super Admin instead (catalogChanges.ts).
 * - A business's own price list changes only by that business's own action. */
import { randomUUID } from "node:crypto";
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import type { SharedCatalogGroup } from "../lib/catalogAccess";
import { businessOf, latestPrice, mayPrice, requirePricing, type Business } from "./catalogBusiness";
import { answerChange, changeNotices, decideReview, listReviews, listUnpriced, publishUsual, requestDecrease, requestPacking, type ChangeNotice } from "./catalogChanges";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** Other businesses that must agree before an increase becomes the usual price. */
export const CONFIRMATIONS_NEEDED = 2;
export const PROPOSAL_DAYS = 7;
const MAX_ITEMS = 200;
const SAME = 0.005;

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface CatalogDefault { salePrice: number; mrp: number }
export interface PriceItem { productId: string; price: number; previousPrice?: number }
export interface PriceQuestion { productId: string; name: string; oldPrice: number; newPrice: number; direction: "up" | "down" }
export interface PriceNotice {
  id: string; productId: string; name: string; unit: string | null; myPrice: number; newPrice: number;
  confirmations: number; accepted: boolean; endsAt: string;
}

const marks = (n: number) => Array(n).fill("?").join(",");

function itemsOf(v: unknown): PriceItem[] {
  const out = new Map<string, PriceItem>();
  for (const x of (Array.isArray(v) ? v : []).slice(0, MAX_ITEMS)) {
    const o = x as Record<string, unknown>;
    const productId = typeof o?.productId === "string" ? o.productId : "";
    const price = round2(num(o?.price));
    if (productId && price > 0) out.set(productId, { productId, price, previousPrice: round2(num(o?.previousPrice)) });
  }
  return [...out.values()];
}

/** The shared products among `ids` that this business sees. */
async function sharedProducts(sql: Sql, b: Business, ids: string[]) {
  const found = new Map<string, { name: string; group: SharedCatalogGroup }>();
  if (!ids.length) return found;
  const rows = (await sql.execute(
    `SELECT id, name, COALESCE(catalog_group, 'pharma') AS g FROM products WHERE tenant_id IS NULL AND deleted_at IS NULL AND id IN (${marks(ids.length)})`, ids)).rows;
  for (const r of rows) {
    const group = String(r.g) as SharedCatalogGroup;
    if (b.groups.includes(group)) found.set(String(r.id), { name: String(r.name), group });
  }
  return found;
}

/** The usual prices of shared products (for a first purchase). */
export async function catalogDefaults(sql: Sql, caller: Caller, productIds: unknown): Promise<Record<string, CatalogDefault>> {
  const b = businessOf(caller);
  const ids = (Array.isArray(productIds) ? productIds : []).map(String).filter(Boolean).slice(0, MAX_ITEMS);
  if (!b || !ids.length) return {};
  const seen = [...(await sharedProducts(sql, b, ids)).keys()];
  if (!seen.length) return {};
  const rows = (await sql.execute(`SELECT product_id, sale_price, mrp FROM catalog_prices WHERE product_id IN (${marks(seen.length)})`, seen)).rows;
  return Object.fromEntries(rows.map((r) => [String(r.product_id), { salePrice: num(r.sale_price), mrp: num(r.mrp) }]));
}

/** Businesses other than the proposer that agreed: answered Yes, or saved the
 * proposed price themselves since it was proposed (any screen or app). */
async function confirmationsOf(sql: Sql, p: Record<string, unknown>): Promise<number> {
  const r = (await sql.execute(
    `SELECT COUNT(*) AS n FROM (
       SELECT tenant_id FROM catalog_price_responses WHERE proposal_id = ? AND answer = 'yes' AND tenant_id <> ?
       UNION
       SELECT tenant_id FROM price_list WHERE product_id = ? AND deleted_at IS NULL AND tenant_id <> ? AND created_at >= ? AND ABS(sale_price - ?) < ${SAME}
     )`, [p.id, p.proposed_by, p.product_id, p.proposed_by, p.created_at, p.new_price])).rows[0];
  return num(r?.n);
}

async function setDefault(sql: Sql, productId: string, salePrice: number, tenantId: string, at: string) {
  await sql.execute(
    `INSERT INTO catalog_prices (product_id, sale_price, mrp, source_tenant_id, updated_at) VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET sale_price = excluded.sale_price, source_tenant_id = excluded.source_tenant_id, updated_at = excluded.updated_at`,
    [productId, salePrice, tenantId, at]);
}

/** An open proposal that enough businesses agreed to becomes the usual price. */
async function settle(sql: Sql, p: Record<string, unknown>, now: Date): Promise<{ confirmations: number; accepted: boolean }> {
  const confirmations = await confirmationsOf(sql, p);
  if (p.status === "accepted") return { confirmations, accepted: true };
  if (p.status !== "open" || confirmations < CONFIRMATIONS_NEEDED) return { confirmations, accepted: false };
  const at = now.toISOString();
  const won = await sql.execute(`UPDATE catalog_price_proposals SET status = 'accepted', accepted_at = ? WHERE id = ? AND status = 'open'`, [at, p.id]);
  if (won.rowsAffected) await setDefault(sql, String(p.product_id), num(p.new_price), String(p.proposed_by), at);
  return { confirmations, accepted: true };
}

const liveProposals = async (sql: Sql, productIds: string[], now: Date) =>
  productIds.length
    ? (await sql.execute(
      `SELECT * FROM catalog_price_proposals WHERE status IN ('open', 'accepted') AND expires_at > ? AND product_id IN (${marks(productIds.length)})`,
      [now.toISOString(), ...productIds])).rows
    : [];

/** After a purchase: which changed prices to ask "has the retail price changed?"
 * about. Not asked when the price only moves to the usual price, or is already
 * proposed (saving it counts as agreeing) or waiting for the Super Admin. */
export async function priceQuestions(sql: Sql, caller: Caller, items: unknown, now = new Date()): Promise<PriceQuestion[]> {
  const b = businessOf(caller);
  if (!b || !mayPrice(caller)) return [];
  const list = itemsOf(items);
  const products = await sharedProducts(sql, b, list.map((i) => i.productId));
  if (!products.size) return [];
  const defaults = await catalogDefaults(sql, caller, [...products.keys()]);
  const live = await liveProposals(sql, [...products.keys()], now);
  const out: PriceQuestion[] = [];
  for (const i of list) {
    const p = products.get(i.productId);
    if (!p) continue;
    const same = live.find((x) => x.product_id === i.productId && Math.abs(num(x.new_price) - i.price) < SAME);
    if (same) { await settle(sql, same, now); continue; }
    const usual = defaults[i.productId]?.salePrice ?? 0;
    const old = i.previousPrice || usual;
    if (old <= 0) continue;
    if (i.price > old + SAME && (usual <= 0 || i.price > usual + SAME)) out.push({ productId: i.productId, name: p.name, oldPrice: old, newPrice: i.price, direction: "up" });
    else if (i.price < old - SAME && (usual <= 0 || i.price < usual - SAME)) {
      const waiting = (await sql.execute(`SELECT 1 FROM catalog_change_requests WHERE product_id = ? AND kind = 'decrease' AND status = 'pending' AND ABS(new_price - ?) < ${SAME}`, [i.productId, i.price])).rows[0];
      if (!waiting) out.push({ productId: i.productId, name: p.name, oldPrice: old, newPrice: i.price, direction: "down" });
    }
  }
  return out;
}

/** "Yes, the retail price has changed". A rise is proposed to the others for a
 * week; a fall goes to the Super Admin. Only a price the business has itself
 * saved counts. */
export async function proposePrices(sql: Sql, caller: Caller, items: unknown, now = new Date()): Promise<{ proposed: number; sentForReview: number }> {
  const b = requirePricing(caller);
  const list = itemsOf(items);
  const products = await sharedProducts(sql, b, list.map((i) => i.productId));
  const defaults = await catalogDefaults(sql, caller, [...products.keys()]);
  const live = await liveProposals(sql, [...products.keys()], now);
  let proposed = 0;
  let sentForReview = 0;
  for (const i of list) {
    const p = products.get(i.productId);
    if (!p) continue;
    const mine = await latestPrice(sql, b.tenantId, i.productId);
    if (!mine || Math.abs(num(mine.sale_price) - i.price) >= SAME) continue;
    const usual = defaults[i.productId]?.salePrice ?? 0;
    const old = i.previousPrice || usual;
    if (old > 0 && i.price < old - SAME) {
      if ((usual <= 0 || i.price < usual - SAME) && (await requestDecrease(sql, caller, i.productId, i.price, old, now))) sentForReview++;
      continue;
    }
    if (usual > 0 && i.price <= usual + SAME) continue;
    const same = live.find((x) => x.product_id === i.productId && Math.abs(num(x.new_price) - i.price) < SAME);
    if (same) { await settle(sql, same, now); continue; }
    // This business's earlier, different proposal for the product is withdrawn.
    await sql.execute(`UPDATE catalog_price_proposals SET status = 'replaced' WHERE product_id = ? AND proposed_by = ? AND status = 'open'`, [i.productId, b.tenantId]);
    await sql.execute(
      `INSERT INTO catalog_price_proposals (id, product_id, catalog_group, proposed_by, old_price, new_price, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [randomUUID(), i.productId, p.group, b.tenantId, i.previousPrice || usual, i.price, now.toISOString(), new Date(now.getTime() + PROPOSAL_DAYS * 864e5).toISOString()]);
    proposed++;
  }
  return { proposed, sentForReview };
}

/** This week's increases to ask this business about: products it uses (stock or
 * a price of its own), still priced below the proposal, not yet answered. */
export async function priceNotices(sql: Sql, caller: Caller, now = new Date()): Promise<PriceNotice[]> {
  const b = businessOf(caller);
  if (!b || !mayPrice(caller)) return [];
  const rows = (await sql.execute(
    `SELECT q.*, p.name AS product_name, u.name AS unit_name
     FROM catalog_price_proposals q
     JOIN products p ON p.id = q.product_id AND p.deleted_at IS NULL AND p.tenant_id IS NULL
     LEFT JOIN uoms u ON u.id = p.base_unit_id
     WHERE q.status IN ('open', 'accepted') AND q.expires_at > ? AND q.proposed_by <> ? AND q.catalog_group IN (${marks(b.groups.length)})
       AND NOT EXISTS (SELECT 1 FROM catalog_price_responses r WHERE r.proposal_id = q.id AND r.tenant_id = ?)
       AND (EXISTS (SELECT 1 FROM price_list l WHERE l.product_id = q.product_id AND l.tenant_id = ? AND l.deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM product_batches s WHERE s.product_id = q.product_id AND s.tenant_id = ? AND s.deleted_at IS NULL))
     ORDER BY q.created_at DESC LIMIT 100`,
    [now.toISOString(), b.tenantId, ...b.groups, b.tenantId, b.tenantId, b.tenantId])).rows;
  const out: PriceNotice[] = [];
  for (const q of rows) {
    const state = await settle(sql, q, now);
    const mine = num((await latestPrice(sql, b.tenantId, String(q.product_id)))?.sale_price);
    if (mine >= num(q.new_price) - SAME) continue;
    out.push({
      id: String(q.id), productId: String(q.product_id), name: String(q.product_name), unit: (q.unit_name as string | null) ?? null,
      myPrice: mine, newPrice: num(q.new_price), confirmations: state.confirmations, accepted: state.accepted, endsAt: String(q.expires_at),
    });
  }
  return out;
}

/** A business's answer. Yes: its own retail price becomes the new one. */
export async function answerPrice(sql: Sql, caller: Caller, id: unknown, answer: unknown, now = new Date()): Promise<{ ok: true; accepted: boolean }> {
  const b = requirePricing(caller);
  if (answer !== "yes" && answer !== "no") throw new HttpError(400, "Answer yes or no.");
  const q = (await sql.execute(`SELECT * FROM catalog_price_proposals WHERE id = ? AND status IN ('open', 'accepted') AND expires_at > ?`, [String(id ?? ""), now.toISOString()])).rows[0];
  if (!q || !b.groups.includes(String(q.catalog_group) as SharedCatalogGroup)) throw new HttpError(404, "This price change is no longer open.");
  if (q.proposed_by === b.tenantId) throw new HttpError(400, "Your own business proposed this price.");
  const at = now.toISOString();
  const first = await sql.execute(`INSERT OR IGNORE INTO catalog_price_responses (id, proposal_id, tenant_id, answer, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), q.id, b.tenantId, answer, caller.userId, at]);
  if (first.rowsAffected && answer === "yes") {
    const mine = await latestPrice(sql, b.tenantId, String(q.product_id));
    if (num(mine?.sale_price) < num(q.new_price) - SAME) {
      await sql.execute(
        `INSERT INTO price_list (id, product_id, tenant_id, batch_no, sale_price, wholesale_price, mrp, comment, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, ?, ?, 'Retail price increase', ?, ?, NULL)`,
        [randomUUID(), q.product_id, b.tenantId, num(q.new_price), num(mine?.wholesale_price), num(mine?.mrp), at, at]);
    }
  }
  const state = await settle(sql, q, now);
  return { ok: true, accepted: state.accepted };
}

/** One thing in a business's pop-up: a week's price rise, or an approved change. */
export type CatalogNotice = ({ kind: "increase" } & PriceNotice) | ChangeNotice;

export async function allNotices(sql: Sql, caller: Caller, now = new Date()): Promise<CatalogNotice[]> {
  if (!businessOf(caller) || !mayPrice(caller)) return [];
  const rises = (await priceNotices(sql, caller, now)).map((n) => ({ kind: "increase" as const, ...n }));
  return [...(await changeNotices(sql, caller, now)), ...rises];
}

export async function catalogPricesAction(sql: Sql, caller: Caller, body: Record<string, unknown>) {
  switch (body.action) {
    case "defaults": return catalogDefaults(sql, caller, body.productIds);
    case "questions": return priceQuestions(sql, caller, body.items);
    case "propose": return proposePrices(sql, caller, body.items);
    case "notices": return allNotices(sql, caller);
    case "answer": {
      if (body.answer !== "yes" && body.answer !== "no") throw new HttpError(400, "Answer yes or no.");
      if (await answerChange(sql, caller, String(body.id ?? ""), body.answer === "yes")) return { ok: true, accepted: true };
      return answerPrice(sql, caller, body.id, body.answer);
    }
    case "packing": return requestPacking(sql, caller, body);
    case "reviews": return listReviews(sql, caller, body.status);
    case "decide": return decideReview(sql, caller, body);
    case "unpriced": return listUnpriced(sql, caller);
    case "publish": return publishUsual(sql, caller, body.items);
    default: throw new HttpError(400, "Unknown action.");
  }
}
