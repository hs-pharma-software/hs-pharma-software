import { dbSelect, dbExecute } from "../db";
import { assertOwnedRefs, createTenantRepo, requireCurrentTenantId, LINE_REFS } from "./base";
import { useAuthStore } from "../../store/authStore";
import { sharedCatalogGroupsFor, sharedCatalogWhereClause, isPharmacyFamilyType, type SharedCatalogGroup } from "../catalogAccess";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import type { Product, ProductBatch, PriceListEntry } from "../types";

/** Products belong to one tenant (v29; before that the catalog was shared by
 * every tenant). A restaurant, a shop and a pharmacy each only see, search,
 * edit or sell their own. Pharmacy-family tenants also read the shared pharma
 * and general-store catalog (tenant_id IS NULL, catalog_group set). Writes
 * also check that the chosen category, sub category and units belong to this
 * tenant or to the shared catalog. */
const productsBase = createTenantRepo<Product>("products");
const productRefs = (d: Partial<Product>) =>
  assertOwnedRefs([
    ["categories", d.category_id, "Category"],
    ["sub_categories", d.sub_category_id, "Sub category"],
    ["uoms", d.base_unit_id, "Base unit"],
    ["uoms", d.secondary_unit_id, "Secondary unit"],
  ]);
export const productsRepo = {
  ...productsBase,

  /** Returns a product by id: tenant-owned OR shared catalog product for
   * pharmacy-family tenants. */
  async get(id: string): Promise<Product | null> {
    const tenantId = requireCurrentTenantId();
    const sharedGroups = sharedCatalogGroupsFor(currentBusinessType());
    if (sharedGroups.length) {
      const { clause, params } = sharedCatalogWhereClause(tenantId, sharedGroups);
      const rows = await dbSelect<Product>(`SELECT * FROM products WHERE id = ? AND ${clause}`, [id, ...params]);
      return rows[0] ?? null;
    }
    return productsBase.get(id);
  },

  /** Lists tenant-owned products and, for pharmacy-family tenants, shared
   * catalog products (pharma + general_store). */
  async list(opts: { where?: string; params?: unknown[]; orderBy?: string } = {}): Promise<Product[]> {
    const tenantId = requireCurrentTenantId();
    const sharedGroups = sharedCatalogGroupsFor(currentBusinessType());
    const { where = "", params = [], orderBy = "created_at DESC" } = opts;
    if (sharedGroups.length) {
      const { clause: tenantClause, params: tenantParams } = sharedCatalogWhereClause(tenantId, sharedGroups);
      const extraWhere = where ? `AND ${where}` : "";
      return dbSelect<Product>(
        `SELECT * FROM products WHERE deleted_at IS NULL AND ${tenantClause} ${extraWhere} ORDER BY ${orderBy}`,
        [...tenantParams, ...params]
      );
    }
    return productsBase.list(opts);
  },

  async create(data: Partial<Product>) {
    await productRefs(data);
    return productsBase.create(data);
  },

  async update(id: string, data: Partial<Product>) {
    await productRefs(data);
    // Allow updating shared catalog products (tenant_id IS NULL + catalog_group set)
    // in addition to the tenant's own products.
    const sharedGroups = sharedCatalogGroupsFor(currentBusinessType());
    if (sharedGroups.length) {
      const tenantId = requireCurrentTenantId();
      const { clause, params } = sharedCatalogWhereClause(tenantId, sharedGroups);
      const existing = (await dbSelect<{ id: string }>(`SELECT id FROM products WHERE id = ? AND ${clause}`, [id, ...params]))[0];
      if (!existing) throw new Error("Product not found in this business.");
      return productsBase.update(id, data);
    }
    return productsBase.update(id, data);
  },
};

/**
 * Creates a master product in the shared catalog (tenant_id = NULL).
 * Only callable by pharmacy-family tenants. The product becomes visible to
 * all tenants of the same pharmacy family type via the shared catalog.
 * Stock (batches, price list) must still be created per-tenant.
 */
export async function createSharedProduct(data: Partial<Product>): Promise<Product> {
  const { currentTenant } = useAuthStore.getState();
  if (!isPharmacyFamilyType(currentTenant?.businessType)) {
    throw new Error("Only pharmacy-type tenants can create shared catalog products.");
  }
  if (!data.catalog_group) throw new Error("catalog_group is required for shared products.");
  // Category / sub_category / unit refs are allowed to be shared or tenant-owned.
  await productRefs(data);
  const id = (data.id as string) ?? newId();
  const ts = nowIso();
  // tenant_id = NULL marks this as a shared catalog row (not quarantined
  // because catalog_group is set — that distinguishes them from quarantined rows).
  const record = { ...data, id, tenant_id: null, created_at: ts, updated_at: ts, deleted_at: null } as unknown as Product;
  const keys = Object.keys(record);
  await dbExecute(
    `INSERT INTO products (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    keys.map((k) => (record as Record<string, unknown>)[k] ?? null)
  );
  await recordOutbox("products", id, "insert", record as unknown as Record<string, unknown>);
  return record;
}

/** Throws unless every product id belongs to the logged-in tenant OR is in a
 * shared catalog accessible to the tenant's business type. */
export async function assertOwnProducts(ids: (string | null | undefined)[]): Promise<void> {
  await assertOwnedRefs([...new Set(ids.filter(Boolean))].map((id) => ["products", id, "Product"] as [string, string, string]));
}
export const productBatchesRepo = createTenantRepo<ProductBatch>("product_batches", { refs: LINE_REFS });
export const priceListRepo = createTenantRepo<PriceListEntry>("price_list", { refs: LINE_REFS });

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

function currentBusinessType(): string | null {
  return useAuthStore.getState().currentTenant?.businessType ?? null;
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
  /** 'pharma' | 'general_store' | null — shared catalog row indicator. */
  catalog_group: string | null;
  /** 'pharma' | 'general_store' | null */
  product_classification: string | null;
}

/** Products list screen: joins category/UOM names and rolls up available
 * stock + current sale price, matching the reference app's Product Detail
 * grid (`Barcode | Product Name | Company | ... | UOM | Avail Qty`).
 * `avail_qty`/`sale_price` are scoped to the logged-in tenant's own stock and
 * pricing. Pharmacy-family tenants also see the shared pharma and general-store
 * catalog products (tenant_id IS NULL, catalog_group set). */
export async function listProductsForGrid(): Promise<ProductListRow[]> {
  const tenantId = currentTenantId();
  const sharedGroups = sharedCatalogGroupsFor(currentBusinessType());

  // Category/UOM joins: match on tenant_id matching the product's tenant_id,
  // OR a shared catalog match when both are NULL (shared product + shared ref).
  const joinCondition = sharedGroups.length
    ? "(c.tenant_id = p.tenant_id OR (c.tenant_id IS NULL AND p.tenant_id IS NULL AND c.catalog_group IS NOT NULL))"
    : "c.tenant_id = p.tenant_id";
  const scJoinCondition = sharedGroups.length
    ? "(sc.tenant_id = p.tenant_id OR (sc.tenant_id IS NULL AND p.tenant_id IS NULL AND sc.catalog_group IS NOT NULL))"
    : "sc.tenant_id = p.tenant_id";
  const uJoinCondition = "u.tenant_id = p.tenant_id OR (u.tenant_id IS NULL AND p.tenant_id IS NULL)";
  const suJoinCondition = "su.tenant_id = p.tenant_id OR (su.tenant_id IS NULL AND p.tenant_id IS NULL)";

  let productWhere: string;
  let productParams: (string | null)[];
  if (sharedGroups.length) {
    const placeholders = sharedGroups.map(() => "?").join(", ");
    productWhere = `p.deleted_at IS NULL AND (p.tenant_id = ? OR (p.tenant_id IS NULL AND p.catalog_group IN (${placeholders})))`;
    productParams = [tenantId, ...sharedGroups];
  } else {
    productWhere = "p.deleted_at IS NULL AND p.tenant_id = ?";
    productParams = [tenantId];
  }

  return dbSelect<ProductListRow>(
    `
    SELECT
      p.id,
      p.barcode,
      p.name,
      p.company_name,
      p.catalog_group,
      p.product_classification,
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
    LEFT JOIN categories c ON c.id = p.category_id AND (${joinCondition})
    LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id AND (${scJoinCondition})
    LEFT JOIN uoms u ON u.id = p.base_unit_id AND (${uJoinCondition})
    LEFT JOIN uoms su ON su.id = p.secondary_unit_id AND (${suJoinCondition})
    WHERE ${productWhere}
    ORDER BY p.created_at DESC
  `,
    [tenantId, tenantId, ...productParams]
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
 * batch/price history for its own product. */
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

/** Searches the tenant's own products and, for pharmacy-family tenants, the
 * shared pharma/general-store catalog as well. */
export async function searchProductsByNameOrBarcode(term: string): Promise<Product[]> {
  const like = `%${term}%`;
  const tenantId = currentTenantId();
  const sharedGroups = sharedCatalogGroupsFor(currentBusinessType());

  if (sharedGroups.length) {
    const placeholders = sharedGroups.map(() => "?").join(", ");
    return dbSelect<Product>(
      `SELECT * FROM products
       WHERE deleted_at IS NULL
         AND (tenant_id = ? OR (tenant_id IS NULL AND catalog_group IN (${placeholders})))
         AND (name LIKE ? OR barcode LIKE ?)
       ORDER BY name ASC LIMIT 25`,
      [tenantId, ...sharedGroups, like, like]
    );
  }
  return dbSelect<Product>(
    `SELECT * FROM products WHERE deleted_at IS NULL AND tenant_id = ? AND (name LIKE ? OR barcode LIKE ?) ORDER BY name ASC LIMIT 25`,
    [tenantId, like, like]
  );
}

/** Searches ONLY the shared catalog (tenant_id IS NULL) for a given group.
 * Used during product creation to check for duplicates before creating a
 * new shared master product. */
export async function searchSharedCatalog(term: string, group: SharedCatalogGroup): Promise<Product[]> {
  const like = `%${term}%`;
  return dbSelect<Product>(
    `SELECT * FROM products
     WHERE deleted_at IS NULL AND tenant_id IS NULL AND catalog_group = ?
       AND (name LIKE ? OR barcode LIKE ?)
     ORDER BY name ASC LIMIT 25`,
    [group, like, like]
  );
}
