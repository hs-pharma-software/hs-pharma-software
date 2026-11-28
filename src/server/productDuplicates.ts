/** Super Admin > Duplicate Products (schema v112).
 *
 * Finds products whose names match by more than half: two products of the
 * shared catalogue (e.g. the pharmacy catalogue every pharmacy sees), or a
 * business's own product and a shared one it can see. Never two businesses'
 * own products: those stay private to each business.
 *
 * The Super Admin decides on each pair: merge (keep one, the other's records
 * move to it) or "not duplicates" (not shown again). A merge moves every row
 * that points at the merged product, in every table and every business
 * (stock, prices, invoices, purchases, orders, …) to the kept product, fills
 * the kept product's blank fields from the merged one if asked, and removes
 * the merged product; the shared product is then the one every business sees.
 * All in one transaction, recorded in product_merges. */
import { randomUUID } from "node:crypto";
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import { sharedCatalogGroupsFor, type SharedCatalogGroup } from "../lib/catalogAccess";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const now = () => new Date().toISOString();

// ── Name matching ───────────────────────────────────────────────────────────

/** Same spelling for the forms medicines are written in ("Tablets" = "Tab", "500 mg" = "500MG"). */
const FORMS: [RegExp, string][] = [
  [/\bTABLETS?\b|\bTABS\b/g, "TAB"], [/\bCAPSULES?\b|\bCAPS\b/g, "CAP"], [/\bSYRUPS?\b|\bSYR\b/g, "SYP"],
  [/\bINJECTIONS?\b|\bINJS?\b/g, "INJ"], [/\bSUSPENSIONS?\b|\bSUSP\b/g, "SUSP"], [/\bDROPS?\b/g, "DROP"],
  [/\bOINTMENTS?\b|\bOINT\b/g, "OINT"], [/\bCREAMS?\b/g, "CREAM"], [/\bSACHETS?\b/g, "SACHET"],
];
export function normalizeName(name: string): string {
  let s = ` ${name.toUpperCase().replace(/[^A-Z0-9.]+/g, " ")} `;
  for (const [re, to] of FORMS) s = s.replace(re, to);
  // "500 MG" → "500MG", "1.5 G" → "1.5G"
  s = s.replace(/(\d(?:[\d.]*\d)?)\s+(MG|MCG|G|GM|ML|L|IU|%)\b/g, "$1$2").replace(/\bGM\b/g, "G");
  return s.replace(/\s+/g, " ").trim();
}

function bigrams(s: string): Map<string, number> {
  const t = s.replace(/\s+/g, "");
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
/** How much of two names match, 0 to 1 (letter pairs in common, Dice coefficient). */
export function nameSimilarity(a: string, b: string): number {
  const x = bigrams(normalizeName(a)), y = bigrams(normalizeName(b));
  let nx = 0, ny = 0, both = 0;
  for (const v of x.values()) nx += v;
  for (const v of y.values()) ny += v;
  if (!nx || !ny) return normalizeName(a) === normalizeName(b) ? 1 : 0;
  for (const [g, v] of x) both += Math.min(v, y.get(g) ?? 0);
  return (2 * both) / (nx + ny);
}

/** Numbers that differ (strength, pack size): "500MG / 1000MG" — likely different products. */
export function numbersDiffer(a: string, b: string): string | null {
  const nums = (s: string) => (normalizeName(s).match(/\d+(?:\.\d+)?[A-Z%]*/g) ?? []).sort();
  const x = nums(a), y = nums(b);
  if (!x.length && !y.length) return null;
  return x.join(" ") === y.join(" ") ? null : `${x.join(" ") || "—"} / ${y.join(" ") || "—"}`;
}

const STOP = new Set(["TAB", "CAP", "SYP", "INJ", "SUSP", "DROP", "OINT", "CREAM", "SACHET", "FORTE", "PLUS", "EXTRA", "DS"]);
const keyTokens = (name: string) => normalizeName(name).split(" ").filter((t) => t.length >= 3 && !/^\d/.test(t) && !STOP.has(t));

// ── Finding pairs ───────────────────────────────────────────────────────────

export interface DupProduct {
  id: string; name: string; owner: "shared" | "own"; tenantId: string | null; tenantName: string | null; catalogGroup: string | null;
  company: string | null; description: string | null; barcode: string | null; unitsSet: boolean; packing: number;
}
export interface DupPair {
  key: string; score: number; numbersDiffer: string | null; a: DupProduct; b: DupProduct;
  /** Which may be kept: a shared product always survives over a business's own. */
  keep: ("a" | "b")[];
}

interface Row { id: string; name: string; tenant_id: string | null; catalog_group: string | null; company_name: string | null; description: string | null; barcode: string | null; base_unit_id: string | null; secondary_unit_id: string | null; packing: number | null }

function toDup(r: Row, tenantName: Map<string, string>): DupProduct {
  return {
    id: r.id, name: r.name, owner: r.tenant_id ? "own" : "shared", tenantId: r.tenant_id, tenantName: r.tenant_id ? tenantName.get(r.tenant_id) ?? "A business" : null,
    catalogGroup: r.catalog_group, company: str(r.company_name), description: str(r.description), barcode: str(r.barcode),
    unitsSet: Boolean(r.base_unit_id) && Boolean(r.secondary_unit_id) && num(r.packing) > 0, packing: num(r.packing) || 1,
  };
}

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Pairs for one shared catalogue (pharma or general_store), best match first. */
export async function findDuplicatePairs(sql: Sql, o: { group: SharedCatalogGroup; minScore?: number; q?: string; limit?: number }): Promise<{ pairs: DupPair[]; total: number; compared: number }> {
  const minScore = Math.min(1, Math.max(0.5, Number(o.minScore) || 0.5));
  const limit = Math.min(500, Math.max(1, Math.round(Number(o.limit) || 100)));
  const cols = `id, name, tenant_id, catalog_group, company_name, description, barcode, base_unit_id, secondary_unit_id, packing`;
  const tenants = (await sql.execute(`SELECT id, name, business_type FROM tenants WHERE deleted_at IS NULL`)).rows;
  const tenantName = new Map(tenants.map((t) => [String(t.id), String(t.name)]));
  // Businesses that see this catalogue: their own products are compared with it.
  const seeing = tenants.filter((t) => sharedCatalogGroupsFor(str(t.business_type)).includes(o.group)).map((t) => String(t.id));
  const shared = (await sql.execute(`SELECT ${cols} FROM products WHERE tenant_id IS NULL AND catalog_group = ? AND deleted_at IS NULL`, [o.group])).rows as unknown as Row[];
  const own = seeing.length ? (await sql.execute(
    `SELECT ${cols} FROM products WHERE tenant_id IN (${seeing.map(() => "?").join(",")}) AND deleted_at IS NULL`, seeing)).rows as unknown as Row[] : [];
  const dismissed = new Set((await sql.execute(`SELECT a_id, b_id FROM product_duplicate_dismissals`)).rows.map((r) => pairKey(String(r.a_id), String(r.b_id))));

  // Candidates share a word (not a strength or form); a word in too many names is no help.
  const index = new Map<string, number[]>();
  shared.forEach((p, i) => { for (const t of new Set(keyTokens(p.name))) { const l = index.get(t) ?? []; l.push(i); index.set(t, l); } });
  const seen = new Set<string>();
  const found: DupPair[] = [];
  const q = (o.q ?? "").trim().toUpperCase();
  const consider = (x: Row, y: Row) => {
    if (x.id === y.id) return;
    const k = pairKey(x.id, y.id);
    if (seen.has(k) || dismissed.has(k)) return;
    seen.add(k);
    if (q && !x.name.toUpperCase().includes(q) && !y.name.toUpperCase().includes(q)) return;
    const score = nameSimilarity(x.name, y.name);
    if (score < minScore) return;
    const a = toDup(x, tenantName), b = toDup(y, tenantName);
    const keep: ("a" | "b")[] = a.owner === "shared" && b.owner === "shared" ? ["a", "b"] : a.owner === "shared" ? ["a"] : ["b"];
    found.push({ key: k, score: Math.round(score * 1000) / 1000, numbersDiffer: numbersDiffer(x.name, y.name), a, b, keep });
  };
  const candidates = (p: Row) => {
    const out = new Set<number>();
    for (const t of new Set(keyTokens(p.name))) { const l = index.get(t); if (l && l.length <= 300) for (const i of l) out.add(i); }
    return out;
  };
  for (const p of shared) for (const i of candidates(p)) consider(p, shared[i]);
  for (const p of own) for (const i of candidates(p)) consider(shared[i], p);
  // Exact same name (any spelling) though no shared word (e.g. all short words).
  const byNorm = new Map<string, Row>();
  for (const p of shared) byNorm.set(normalizeName(p.name), p);
  for (const p of [...shared, ...own]) { const m = byNorm.get(normalizeName(p.name)); if (m) consider(m, p); }

  found.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
  return { pairs: found.slice(0, limit), total: found.length, compared: shared.length + own.length };
}

// ── Merging ─────────────────────────────────────────────────────────────────

/** Tables that point at products (product_id), found in the database itself so a new one is never missed. */
async function productTables(sql: Pick<Sql, "execute">): Promise<{ table: string; hasUpdated: boolean }[]> {
  // One query for every table's product_id / updated_at columns.
  const rows = (await sql.execute(
    `SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p
     WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND p.name IN ('product_id', 'updated_at')`)).rows;
  const cols = new Map<string, Set<string>>();
  for (const r of rows) { const t = String(r.t); if (!cols.has(t)) cols.set(t, new Set()); cols.get(t)!.add(String(r.c)); }
  return [...cols].filter(([t, c]) => c.has("product_id") && t !== "product_merges" && t !== "product_duplicate_dismissals" && /^[A-Za-z0-9_]+$/.test(t))
    .map(([table, c]) => ({ table, hasUpdated: c.has("updated_at") }));
}

export interface MergeResult { ok: true; survivorId: string; merged: number; moved: Record<string, number> }

/** Merges `mergeIds` into `survivorId`. The survivor is a shared product, or (both shared) either one. */
export async function mergeProducts(sql: Sql, caller: Caller, b: Record<string, unknown>): Promise<MergeResult> {
  const survivorId = typeof b.survivorId === "string" ? b.survivorId : "";
  const mergeIds = Array.from(new Set((Array.isArray(b.mergeIds) ? b.mergeIds : []).map(String).filter((x) => x && x !== survivorId)));
  if (!survivorId || !mergeIds.length) throw new HttpError(400, "Choose the product to keep and at least one to merge into it.");
  const S = (await sql.execute(`SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`, [survivorId])).rows[0];
  if (!S) throw new HttpError(404, "The product to keep was not found (merged or deleted meanwhile).");
  if (S.tenant_id != null) throw new HttpError(400, "Keep the shared catalogue product: a business's own product cannot replace it for everyone.");
  const Ms = (await sql.execute(`SELECT * FROM products WHERE id IN (${mergeIds.map(() => "?").join(",")}) AND deleted_at IS NULL`, mergeIds)).rows;
  if (Ms.length !== mergeIds.length) throw new HttpError(404, "A product to merge was not found (merged or deleted meanwhile).");
  for (const M of Ms) {
    // A business's own product only merges into a shared catalogue it can see.
    if (M.tenant_id != null) {
      const t = (await sql.execute(`SELECT business_type FROM tenants WHERE id = ?`, [M.tenant_id])).rows[0];
      if (!sharedCatalogGroupsFor(str(t?.business_type)).includes(String(S.catalog_group) as SharedCatalogGroup)) {
        throw new HttpError(400, `${M.name} belongs to a business that does not use this catalogue.`);
      }
    }
  }
  const tables = await productTables(sql);
  const t = now();

  // The kept product's blank fields from the merged ones (units and categories only when they are shared, never a business's own).
  const fill: Record<string, unknown> = {};
  if (b.fillBlanks !== false) {
    const sharedRow = async (table: "uoms" | "categories" | "sub_categories", id: unknown) =>
      id ? Boolean((await sql.execute(`SELECT 1 FROM ${table} WHERE id = ? AND tenant_id IS NULL AND deleted_at IS NULL`, [id])).rows[0]) : false;
    for (const M of Ms) {
      for (const f of ["barcode", "company_name", "description", "hs_code"]) if (!S[f] && !fill[f] && M[f]) fill[f] = M[f];
      if (!S.base_unit_id && !fill.base_unit_id && (await sharedRow("uoms", M.base_unit_id))) fill.base_unit_id = M.base_unit_id;
      if (!S.secondary_unit_id && !fill.secondary_unit_id && (await sharedRow("uoms", M.secondary_unit_id))) {
        fill.secondary_unit_id = M.secondary_unit_id;
        if (num(M.packing) > 1 && !(num(S.packing) > 1)) fill.packing = M.packing;
      }
      if (!S.category_id && !fill.category_id && (await sharedRow("categories", M.category_id))) {
        fill.category_id = M.category_id;
        if (!S.sub_category_id && (await sharedRow("sub_categories", M.sub_category_id))) fill.sub_category_id = M.sub_category_id;
      }
    }
  }

  const work = async (tx: Pick<Sql, "execute">) => {
    const moved: Record<string, number> = {};
    for (const M of Ms) {
      const mid = String(M.id);
      // One row per business and product: the kept product's row stays, the merged one's goes.
      if (tables.some((x) => x.table === "product_flat_discounts")) {
        await tx.execute(`UPDATE product_flat_discounts SET deleted_at = ?, updated_at = ? WHERE product_id = ? AND deleted_at IS NULL
          AND tenant_id IN (SELECT tenant_id FROM product_flat_discounts WHERE product_id = ? AND deleted_at IS NULL)`, [t, t, mid, survivorId]);
      }
      if (tables.some((x) => x.table === "web_products")) {
        await tx.execute(`DELETE FROM web_products WHERE product_id = ? AND tenant_id IN (SELECT tenant_id FROM web_products WHERE product_id = ?)`, [mid, survivorId]);
      }
      if (tables.some((x) => x.table === "es_serials")) {
        const clash = (await tx.execute(`SELECT COUNT(*) AS n FROM es_serials a JOIN es_serials b ON b.tenant_id = a.tenant_id AND b.serial = a.serial AND b.product_id = ? WHERE a.product_id = ?`, [survivorId, mid])).rows[0];
        if (num(clash?.n) > 0) throw new HttpError(409, `${M.name} and the kept product share serial numbers: they cannot be merged.`);
      }
      // One usual catalogue price per product: the kept product's own wins.
      if (tables.some((x) => x.table === "catalog_prices")) {
        await tx.execute(`DELETE FROM catalog_prices WHERE product_id = ? AND EXISTS (SELECT 1 FROM catalog_prices WHERE product_id = ?)`, [mid, survivorId]);
      }
      for (const { table, hasUpdated } of tables) {
        const r = await tx.execute(`UPDATE ${table} SET product_id = ?${hasUpdated ? ", updated_at = ?" : ""} WHERE product_id = ?`, hasUpdated ? [survivorId, t, mid] : [survivorId, mid]);
        if (r.rowsAffected) moved[table] = (moved[table] ?? 0) + r.rowsAffected;
      }
      await tx.execute(`UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?`, [t, t, mid]);
      await tx.execute(
        `INSERT INTO product_merges (id, survivor_id, survivor_name, merged_id, merged_name, merged_tenant_id, moved, merged_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), survivorId, String(S.name), mid, String(M.name), M.tenant_id ?? null, JSON.stringify(moved), caller.userId, t]);
    }
    const sets = Object.keys(fill);
    if (sets.length) await tx.execute(`UPDATE products SET ${sets.map((f) => `${f} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...sets.map((f) => fill[f]), t, survivorId]);
    return moved;
  };
  if (!sql.transaction) throw new HttpError(500, "Merging needs a database transaction.");
  const moved = await sql.transaction(work);
  return { ok: true, survivorId, merged: Ms.length, moved };
}

export interface MergeLogRow { id: string; at: string; survivorId: string; survivorName: string; mergedName: string; mergedTenant: string | null; moved: Record<string, number> }

/** Super Admin > Duplicate Products. */
export async function duplicatesAction(sql: Sql, caller: Caller, b: Record<string, unknown>): Promise<unknown> {
  if (caller.role !== "super_admin" || caller.platformRole) throw new HttpError(403, "Only the platform owner merges products.");
  const group = (String(b.group) === "general_store" ? "general_store" : "pharma") as SharedCatalogGroup;
  switch (b.action) {
    case "pairs": return findDuplicatePairs(sql, { group, minScore: Number(b.minScore), q: typeof b.q === "string" ? b.q : "", limit: Number(b.limit) || 100 });
    case "merge": return mergeProducts(sql, caller, b);
    case "dismiss": {
      const x = typeof b.aId === "string" ? b.aId : "", y = typeof b.bId === "string" ? b.bId : "";
      if (!x || !y || x === y) throw new HttpError(400, "Choose the two products.");
      const [a, c] = x < y ? [x, y] : [y, x];
      await sql.execute(`INSERT OR IGNORE INTO product_duplicate_dismissals (id, a_id, b_id, dismissed_by, created_at) VALUES (?, ?, ?, ?, ?)`, [randomUUID(), a, c, caller.userId, now()]);
      return { ok: true };
    }
    case "log": {
      const rows = (await sql.execute(
        `SELECT m.*, t.name AS tenant_name FROM product_merges m LEFT JOIN tenants t ON t.id = m.merged_tenant_id ORDER BY m.created_at DESC LIMIT 200`)).rows;
      return rows.map((r): MergeLogRow => {
        let moved: Record<string, number> = {};
        try { moved = JSON.parse(String(r.moved ?? "{}")); } catch { moved = {}; }
        return { id: String(r.id), at: String(r.created_at), survivorId: String(r.survivor_id), survivorName: String(r.survivor_name), mergedName: String(r.merged_name), mergedTenant: str(r.tenant_name), moved };
      });
    }
    case "usage": {
      // How much each product of a pair is used, before choosing which to keep.
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 10);
      const out: Record<string, { batches: number; stock: number; invoices: number; purchases: number; businesses: number }> = {};
      for (const id of ids) {
        const one = async (q: string) => num((await sql.execute(q, [id])).rows[0]?.n);
        out[id] = {
          batches: await one(`SELECT COUNT(*) AS n FROM product_batches WHERE product_id = ? AND deleted_at IS NULL`),
          stock: await one(`SELECT COALESCE(SUM(qty), 0) AS n FROM product_batches WHERE product_id = ? AND deleted_at IS NULL`),
          invoices: await one(`SELECT COUNT(*) AS n FROM invoice_items WHERE product_id = ? AND deleted_at IS NULL`),
          purchases: await one(`SELECT COUNT(*) AS n FROM purchase_items WHERE product_id = ? AND deleted_at IS NULL`),
          businesses: await one(`SELECT COUNT(DISTINCT tenant_id) AS n FROM product_batches WHERE product_id = ? AND deleted_at IS NULL`),
        };
      }
      return out;
    }
    default: throw new HttpError(400, "Unknown action.");
  }
}
