/** A new pack size of a shared product (the company now packs 14 where it
 * packed 10). Quantities are kept in packs, so every record of the product is
 * rewritten into the new pack: the number of tablets and every money total stay
 * the same (3 packs of 10 become 2.142857 packs of 14; a price per pack grows
 * by 14/10). Stock, past and open documents alike, so returns, edits and
 * reports stay correct. Given as statements for one atomic batch: a live
 * database must not wait on a conversion round trip by round trip. */
import type { Sql } from "./subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** Columns holding a quantity in packs (`qty`) or money per pack (`price`), per table.
 * tests/catalog/catalog-packing.test.ts fails when a table with product_id is
 * neither here nor in NOT_PER_PACK. */
export const PER_PACK: Record<string, { qty?: string[]; price?: string[]; packing?: boolean }> = {
  product_batches: { qty: ["qty"], price: ["purchase_price"] },
  price_list: { price: ["sale_price", "wholesale_price", "mrp"] },
  invoice_items: { qty: ["qty", "bonus_qty", "avail_qty"], price: ["purchase_price", "sale_price"], packing: true },
  purchase_items: { qty: ["booked_qty", "received_qty", "avail_qty", "bonus_qty"], price: ["purchase_price"] },
  order_items: { qty: ["qty", "avail_qty", "max_stock_qty"], price: ["purchase_price"], packing: true },
  audit_items: { qty: ["counted_qty", "system_qty"], price: ["unit_cost"] },
  branch_transfer_items: { qty: ["qty", "received_qty"], price: ["purchase_price"] },
  web_order_items: { qty: ["qty"], price: ["unit_price"] },
  web_products: { price: ["online_price"] },
  offline_exceptions: { qty: ["qty"] },
  hospital_store_purchase_items: { qty: ["qty", "received_qty"], price: ["rate"] },
  hospital_store_stock: { qty: ["qty"], price: ["unit_cost"] },
  hospital_indent_items: { qty: ["qty_requested", "qty_issued", "qty_received", "return_qty"] },
  hospital_rfq_items: { qty: ["qty"] },
  hospital_po_items: { qty: ["qty"], price: ["rate"] },
  catalog_prices: { price: ["sale_price", "mrp"] },
  catalog_price_proposals: { price: ["old_price", "new_price"] },
};

/** Tables with product_id that hold nothing per pack, and why. */
export const NOT_PER_PACK = new Set([
  // No quantities or prices.
  "product_suppliers", "hospital_brand_selections", "product_batch_expiry_changes", "product_flat_discounts", "fbr_scenario_tests",
  // What a doctor prescribed (their own words and counts), not stock.
  "clinic_rx_items", "pharmacy_rx_items", "hospital_rx_items",
  // Electronics, mobile and distribution businesses never use a shared catalogue.
  "es_serials", "es_doc_items", "es_stock_moves", "es_warranty_claims", "dist_booking_items", "dist_doc_items", "dist_stock_moves", "dist_product_schemes", "mobile_imei_units",
  // The catalogue's own history of merges and of these changes.
  "product_merges", "catalog_change_requests",
]);

export interface PackingStatement { table: string; sql: string; args: unknown[] }

/** The statements rewriting the product and all its records from `from` per pack to `to`. */
export async function packingStatements(sql: Pick<Sql, "execute">, productId: string, from: number, to: number, now: string): Promise<PackingStatement[]> {
  const qtyBy = from / to;
  const priceBy = to / from;
  const rows = (await sql.execute(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`)).rows;
  const columns = new Map<string, Set<string>>();
  for (const r of rows) { const t = String(r.t); if (!columns.has(t)) columns.set(t, new Set()); columns.get(t)!.add(String(r.c)); }

  const out: PackingStatement[] = [];
  for (const [table, spec] of Object.entries(PER_PACK)) {
    const have = columns.get(table);
    if (!have?.has("product_id")) continue;
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const c of spec.qty ?? []) if (have.has(c)) { sets.push(`${c} = ${c} * ?`); args.push(qtyBy); }
    for (const c of spec.price ?? []) if (have.has(c)) { sets.push(`${c} = ${c} * ?`); args.push(priceBy); }
    if (spec.packing && have.has("packing")) { sets.push(`packing = ?`); args.push(to); }
    if (!sets.length) continue;
    if (have.has("updated_at")) { sets.push(`updated_at = ?`); args.push(now); }
    out.push({ table, sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE product_id = ?`, args: [...args, productId] });
  }
  // The product itself: its pack size, the stock limit (packs) and, when set, the FBR quantity per pack.
  out.push({
    table: "products",
    sql: `UPDATE products SET packing = ?, max_stock_qty = max_stock_qty * ?, fbr_qty_factor = CASE WHEN COALESCE(fbr_qty_factor, 1) = 1 THEN fbr_qty_factor ELSE fbr_qty_factor * ? END, updated_at = ? WHERE id = ?`,
    args: [to, qtyBy, priceBy, now, productId],
  });
  return out;
}

/** Sale lines an offline computer made with the old pack size (its copy had not
 * caught up), rewritten to the current one before they are booked. Lines are
 * returned as they are when no approved change explains the difference. */
export async function toCurrentPacking<T extends { productId: string; packing: number; qtyPacks: number; bonusPacks?: number; pricePerPack: number; purchasePrice: number }>(
  sql: Pick<Sql, "execute">, lines: T[]): Promise<T[]> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  if (!ids.length) return lines;
  const marks = ids.map(() => "?").join(",");
  const changes = (await sql.execute(
    `SELECT product_id, old_packing, new_packing FROM catalog_change_requests WHERE kind = 'packing' AND status = 'approved' AND product_id IN (${marks}) ORDER BY decided_at`, ids)
    .catch(() => ({ rows: [] as Record<string, unknown>[] }))).rows;
  if (!changes.length) return lines;
  const current = new Map((await sql.execute(`SELECT id, packing FROM products WHERE id IN (${marks})`, ids)).rows.map((r) => [String(r.id), Number(r.packing)]));
  return lines.map((l) => {
    const now = current.get(l.productId);
    if (!now || Math.abs(now - l.packing) < 1e-9) return l;
    let size = l.packing;
    for (const c of changes) if (c.product_id === l.productId && Math.abs(Number(c.old_packing) - size) < 1e-9) size = Number(c.new_packing);
    if (Math.abs(size - now) > 1e-9) return l;
    const q = l.packing / now;
    return { ...l, packing: now, qtyPacks: l.qtyPacks * q, ...(l.bonusPacks != null ? { bonusPacks: l.bonusPacks * q } : {}), pricePerPack: l.pricePerPack / q, purchasePrice: l.purchasePrice / q };
  });
}
