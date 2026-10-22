import { dbSelect } from "../db";
import { createRepo, createTenantRepo } from "./base";
import { useAuthStore } from "../../store/authStore";
import type { Product, ProductBatch, PriceListEntry } from "../types";

/** The medicine catalog itself is shared across every tenant \u2014 adding a
 * product here makes it visible to everyone, including the Super Admin, so
 * this stays on the plain (non-tenant-scoped) factory. Stock and pricing
 * below are each tenant's own private data. */
export const productsRepo = createRepo<Product>("products");
export const productBatchesRepo = createTenantRepo<ProductBatch>("product_batches");
export const priceListRepo = createTenantRepo<PriceListEntry>("price_list");

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

export interface ProductListRow {
  id: string;
  barcode: string | null;
  name: string;
  company_name: string | null;
  category_name: string | null;
  sub_category_name: string | null;
  base_unit_name: string | null;
  secondary_unit_id: string | null;
  secondary_unit_name: string | null;
  packing: number;
  avail_qty: number;
  sale_price: number | null;
  hs_code: string | null;
  fbr_sale_type: string | null;
  fbr_uom: string | null;
}

/** Products list screen: joins category/UOM names and rolls up available
 * stock + current sale price, matching the reference app's Product Detail
 * grid (`Barcode | Product Name | Company | ... | UOM | Avail Qty`).
 * `avail_qty`/`sale_price` are scoped to the logged-in tenant's own stock and
 * pricing \u2014 the product row itself (name/category/etc.) is shared. */
export async function listProductsForGrid(): Promise<ProductListRow[]> {
  const tenantId = currentTenantId();
  return dbSelect<ProductListRow>(
    `
    SELECT
      p.id,
      p.barcode,
      p.name,
      p.company_name,
      c.name AS category_name,
      sc.name AS sub_category_name,
      u.name AS base_unit_name,
      p.secondary_unit_id,
      su.name AS secondary_unit_name,
      COALESCE(p.packing, 1) AS packing,
      p.hs_code,
      p.fbr_sale_type,
      p.fbr_uom,
      COALESCE((
        SELECT SUM(pb.qty) FROM product_batches pb
        WHERE pb.product_id = p.id AND pb.tenant_id = ? AND pb.deleted_at IS NULL
      ), 0) AS avail_qty,
      (
        SELECT pl.sale_price FROM price_list pl
        WHERE pl.product_id = p.id AND pl.tenant_id = ? AND pl.deleted_at IS NULL
        ORDER BY pl.created_at DESC LIMIT 1
      ) AS sale_price
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
    LEFT JOIN uoms u ON u.id = p.base_unit_id
    LEFT JOIN uoms su ON su.id = p.secondary_unit_id
    WHERE p.deleted_at IS NULL
    ORDER BY p.created_at DESC
  `,
    [tenantId, tenantId]
  );
}

export async function getLatestPrice(productId: string): Promise<{ salePrice: number; wholesalePrice: number; mrp: number } | null> {
  const rows = await dbSelect<{ sale_price: number; wholesale_price: number; mrp: number }>(
    `SELECT sale_price, wholesale_price, mrp FROM price_list WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [productId, currentTenantId()]
  );
  if (!rows[0]) return null;
  return { salePrice: rows[0].sale_price, wholesalePrice: rows[0].wholesale_price, mrp: rows[0].mrp };
}

export interface CurrentRates {
  /** The most recently received batch, or null if the product has never
   * had stock \u2014 Purchase Rate has nowhere to persist against without one. */
  batchId: string | null;
  batchNo: string | null;
  purchasePrice: number;
  salePrice: number;
  wholesalePrice: number;
  mrp: number;
}

/** Powers the "current purchase & retail rate" fields on Product Detail's
 * edit form \u2014 previously those rates were only ever entered once, at
 * creation, with no way to see or change them afterwards short of going to
 * Purchase or Price List separately. Scoped to the logged-in tenant's own
 * batch/price history for this (possibly shared) product. */
export async function getCurrentRates(productId: string): Promise<CurrentRates> {
  const [batches, price] = await Promise.all([
    dbSelect<{ id: string; batch_no: string | null; purchase_price: number }>(
      `SELECT id, batch_no, purchase_price FROM product_batches
       WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [productId, currentTenantId()]
    ),
    getLatestPrice(productId),
  ]);
  return {
    batchId: batches[0]?.id ?? null,
    batchNo: batches[0]?.batch_no ?? null,
    purchasePrice: batches[0]?.purchase_price ?? 0,
    salePrice: price?.salePrice ?? 0,
    wholesalePrice: price?.wholesalePrice ?? 0,
    mrp: price?.mrp ?? 0,
  };
}

/** Only touches the shared `products` table \u2014 no tenant filter needed, every
 * tenant (and the Super Admin) searches the same catalog. */
export async function searchProductsByNameOrBarcode(term: string): Promise<Product[]> {
  const like = `%${term}%`;
  return dbSelect<Product>(
    `SELECT * FROM products WHERE deleted_at IS NULL AND (name LIKE ? OR barcode LIKE ?) ORDER BY name ASC LIMIT 25`,
    [like, like]
  );
}
