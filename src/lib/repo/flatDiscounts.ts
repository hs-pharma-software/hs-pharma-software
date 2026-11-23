/** Products > Flat Discounts: a business's own discount % on a product, used
 * on every invoice line of that product before the category's flat discount.
 * Kept per business (product_flat_discounts, v94), not on the product row,
 * because pharmacies share catalogue products. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";

interface FlatDiscountRow { id: string; tenant_id: string; product_id: string; discount_pct: number; created_at: string; updated_at: string; deleted_at: string | null }
export const flatDiscountsRepo = createTenantRepo<FlatDiscountRow>("product_flat_discounts");

/** This business's flat discount % on a product; 0 when none (or before migration v94). */
export async function productFlatDiscount(productId: string): Promise<number> {
  try {
    const r = (await flatDiscountsRepo.list({ where: "product_id = ?", params: [productId] }))[0];
    return r ? Number(r.discount_pct) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Sets (or, with 0, removes) this business's flat discount on products. */
export async function setFlatDiscount(productIds: string[], pct: number): Promise<number> {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("A flat discount is between 0 and 100%.");
  const value = Math.round(pct * 100) / 100;
  let changed = 0;
  for (const productId of productIds) {
    const existing = (await flatDiscountsRepo.list({ where: "product_id = ?", params: [productId] }))[0];
    if (value === 0) {
      if (existing) { await flatDiscountsRepo.remove(existing.id); changed++; }
    } else if (existing) {
      if (Number(existing.discount_pct) !== value) { await flatDiscountsRepo.update(existing.id, { discount_pct: value }); changed++; }
    } else {
      await flatDiscountsRepo.create({ product_id: productId, discount_pct: value } as Partial<FlatDiscountRow>);
      changed++;
    }
  }
  return changed;
}

export interface FlatDiscountProduct {
  id: string;
  name: string;
  company_name: string | null;
  generic_name: string | null;
  category_name: string | null;
  category_discount_pct: number;
  flat_discount_pct: number;
}

/** Products this business carries (its own, and catalogue products it has stock or a price for), with their discounts. */
export async function listFlatDiscountProducts(filter: { search?: string; company?: string; onlyDiscounted?: boolean } = {}): Promise<FlatDiscountProduct[]> {
  const T = requireCurrentTenantId();
  const where = [
    "p.deleted_at IS NULL",
    `(p.tenant_id = ? OR (p.tenant_id IS NULL AND (
        EXISTS (SELECT 1 FROM product_batches b WHERE b.product_id = p.id AND b.tenant_id = ? AND b.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM price_list pl WHERE pl.product_id = p.id AND pl.tenant_id = ? AND pl.deleted_at IS NULL))))`,
  ];
  const params: unknown[] = [T, T, T, T];
  const q = (filter.search ?? "").trim();
  if (q) { where.push("(p.name LIKE ? OR p.barcode LIKE ? OR p.description LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (filter.company) { where.push("p.company_name = ?"); params.push(filter.company); }
  if (filter.onlyDiscounted) where.push("fd.id IS NOT NULL");
  return dbSelect<FlatDiscountProduct>(
    `SELECT p.id, p.name, p.company_name, NULLIF(TRIM(p.description), '') AS generic_name,
            COALESCE(sc.name, c.name) AS category_name,
            COALESCE(NULLIF(sc.flat_discount_pct, 0), c.flat_discount_pct, 0) AS category_discount_pct,
            COALESCE(fd.discount_pct, 0) AS flat_discount_pct
     FROM products p
     LEFT JOIN product_flat_discounts fd ON fd.product_id = p.id AND fd.tenant_id = ? AND fd.deleted_at IS NULL
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
     WHERE ${where.join(" AND ")}
     ORDER BY p.name COLLATE NOCASE ASC
     LIMIT 500`,
    params
  );
}

/** Companies of the products this business carries (the page's filter). */
export async function flatDiscountCompanies(): Promise<string[]> {
  const T = requireCurrentTenantId();
  const rows = await dbSelect<{ company_name: string }>(
    `SELECT DISTINCT p.company_name FROM products p
     WHERE p.deleted_at IS NULL AND TRIM(COALESCE(p.company_name, '')) <> ''
       AND (p.tenant_id = ? OR (p.tenant_id IS NULL AND EXISTS (SELECT 1 FROM product_batches b WHERE b.product_id = p.id AND b.tenant_id = ? AND b.deleted_at IS NULL)))
     ORDER BY p.company_name COLLATE NOCASE`,
    [T, T]
  );
  return rows.map((r) => r.company_name);
}
