/** Super Admin > Catalog Review > Pharmacies (own): a pharmacy's own products
 * shared to a shared catalogue (Pharmacy, or General store).
 *
 * Shared in place: the product row itself becomes a shared catalogue product
 * (no business, the catalogue's group), so the pharmacy's stock, prices,
 * invoices and purchases stay on it and it shows once in its list, never
 * twice. A product the shared catalogue already has (the same name, written
 * the same way) is merged into that one instead, so nothing is duplicated.
 * Its units and categories are swapped for shared ones of the same name, or
 * other businesses would see them empty. */
import { randomUUID } from "node:crypto";
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import { mergeProducts, normalizeName } from "./productDuplicates";
import { sharedCatalogGroupsFor, type SharedCatalogGroup } from "../lib/catalogAccess";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const str = (v: unknown) => (v == null || v === "" ? null : String(v));
/** At most this many products per request (the screen asks again for the rest). */
export const SHARE_BATCH = 300;

export interface ShareResult { shared: number; merged: number; skipped: { name: string; reason: string }[]; remaining: number }

/** Shares products of one business (the chosen ones, or all of them) to a shared catalogue. */
export async function shareToCatalog(sql: Sql, caller: Caller, b: Record<string, unknown>): Promise<ShareResult> {
  if (caller.role !== "super_admin" || caller.platformRole) throw new HttpError(403, "Only the platform owner shares products to a catalogue.");
  const target = (String(b.target) === "general_store" ? "general_store" : "pharma") as SharedCatalogGroup;
  const tenantId = typeof b.tenantId === "string" ? b.tenantId : "";
  const t = tenantId ? (await sql.execute(`SELECT id, name, business_type FROM tenants WHERE id = ? AND deleted_at IS NULL`, [tenantId])).rows[0] : undefined;
  if (!t) throw new HttpError(404, "Business not found.");
  if (!sharedCatalogGroupsFor(str(t.business_type)).includes(target)) throw new HttpError(400, `${t.name} does not use that shared catalogue.`);
  const ids = Array.isArray(b.productIds) ? b.productIds.map(String).filter(Boolean) : [];
  if (!b.all && !ids.length) throw new HttpError(400, "Choose the products to share.");
  const cols = `id, name, base_unit_id, secondary_unit_id, category_id, sub_category_id`;
  const rows = b.all
    ? (await sql.execute(`SELECT ${cols} FROM products WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name LIMIT ${SHARE_BATCH + 1}`, [tenantId])).rows
    : (await sql.execute(`SELECT ${cols} FROM products WHERE tenant_id = ? AND deleted_at IS NULL AND id IN (${ids.slice(0, SHARE_BATCH).map(() => "?").join(",")})`, [tenantId, ...ids.slice(0, SHARE_BATCH)])).rows;
  const batch = rows.slice(0, SHARE_BATCH);
  const left = async () => (b.all ? Number((await sql.execute(`SELECT COUNT(*) AS n FROM products WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId])).rows[0]?.n ?? 0) : Math.max(0, ids.length - SHARE_BATCH));

  // The catalogue's products by name, as the duplicate finder writes them.
  const sharedByName = new Map<string, string>();
  for (const r of (await sql.execute(`SELECT id, name FROM products WHERE tenant_id IS NULL AND catalog_group = ? AND deleted_at IS NULL`, [target])).rows) {
    const k = normalizeName(String(r.name));
    if (!sharedByName.has(k)) sharedByName.set(k, String(r.id));
  }

  const now = new Date().toISOString();
  const cache = new Map<string, string | null>();
  const pending: { sql: string; args: unknown[] }[] = [];
  /** A shared row of the same name in `table` (created when there is none). */
  const sharedOf = async (table: "uoms" | "categories" | "sub_categories", id: unknown, parent?: string | null): Promise<string | null> => {
    if (!id) return null;
    const key = `${table}:${id}:${parent ?? ""}`;
    if (cache.has(key)) return cache.get(key)!;
    const row = (await sql.execute(`SELECT * FROM ${table} WHERE id = ?`, [id])).rows[0];
    let out: string | null = null;
    if (!row) out = null;
    else if (row.tenant_id == null) out = String(row.id);
    else {
      const name = String(row.name).trim();
      const where = table === "sub_categories" ? `category_id = ? AND ` : "";
      const found = (await sql.execute(
        `SELECT id FROM ${table} WHERE ${where}tenant_id IS NULL AND deleted_at IS NULL AND UPPER(TRIM(name)) = UPPER(?) ORDER BY created_at, id LIMIT 1`,
        table === "sub_categories" ? [parent, name] : [name])).rows[0];
      if (found) out = String(found.id);
      else if (table === "sub_categories" && !parent) out = null;
      else {
        out = randomUUID();
        if (table === "uoms") await sql.execute(`INSERT INTO uoms (id, name, description, tenant_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)`, [out, name, row.description ?? null, now, now]);
        else if (table === "categories") await sql.execute(`INSERT INTO categories (id, name, description, flat_discount_pct, catalog_group, tenant_id, created_at, updated_at) VALUES (?, ?, ?, 0, ?, NULL, ?, ?)`, [out, name, row.description ?? null, target, now, now]);
        else await sql.execute(`INSERT INTO sub_categories (id, category_id, name, description, catalog_group, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`, [out, parent, name, row.description ?? null, target, now, now]);
      }
    }
    cache.set(key, out);
    return out;
  };

  const res: ShareResult = { shared: 0, merged: 0, skipped: [], remaining: 0 };
  const flush = async () => { if (pending.length) { await sql.batch(pending.splice(0)); } };
  for (const p of batch) {
    const name = String(p.name);
    const same = sharedByName.get(normalizeName(name));
    if (same) {
      // Already in the catalogue: one product, the pharmacy's records move onto it.
      await flush();
      try { await mergeProducts(sql, caller, { survivorId: same, mergeIds: [String(p.id)], fillBlanks: true }); res.merged++; }
      catch (e) { res.skipped.push({ name, reason: e instanceof Error ? e.message : String(e) }); }
      continue;
    }
    const category = await sharedOf("categories", p.category_id);
    pending.push({
      sql: `UPDATE products SET tenant_id = NULL, catalog_group = ?, product_classification = ?, base_unit_id = ?, secondary_unit_id = ?, category_id = ?, sub_category_id = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      args: [target, target, await sharedOf("uoms", p.base_unit_id), await sharedOf("uoms", p.secondary_unit_id), category,
        await sharedOf("sub_categories", p.sub_category_id, category), now, p.id, tenantId],
    });
    sharedByName.set(normalizeName(name), String(p.id));
    res.shared++;
    if (pending.length >= 100) await flush();
  }
  await flush();
  res.remaining = await left();
  return res;
}
