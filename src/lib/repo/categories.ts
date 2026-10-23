import { assertOwnedRefs, createTenantRepo, requireCurrentTenantId } from "./base";
import { dbSelect } from "../db";
import { sharedCatalogGroupsFor } from "../catalogAccess";
import { useAuthStore } from "../../store/authStore";
import type { Category, SubCategory, Product } from "../types";

/** Categories and sub categories belong to one tenant (v29). */
export const categoriesRepo = createTenantRepo<Category>("categories");
const subCategoriesBase = createTenantRepo<SubCategory>("sub_categories");

/** A sub category may only hang under this tenant's own category / unit. */
export const subCategoriesRepo = {
  ...subCategoriesBase,
  async create(data: Partial<SubCategory>) {
    await assertOwnedRefs([["categories", data.category_id, "Category"], ["uoms", (data as { default_secondary_unit_id?: string | null }).default_secondary_unit_id, "Unit"]]);
    return subCategoriesBase.create(data);
  },
  async update(id: string, data: Partial<SubCategory>) {
    await assertOwnedRefs([["categories", data.category_id, "Category"], ["uoms", (data as { default_secondary_unit_id?: string | null }).default_secondary_unit_id, "Unit"]]);
    return subCategoriesBase.update(id, data);
  },
};
/** Returns tenant's own categories plus shared catalog categories for
 * pharmacy-family tenants. Used in the product form dropdowns. */
export async function listCategoriesWithShared(): Promise<Category[]> {
  const tenantId = requireCurrentTenantId();
  const bType = useAuthStore.getState().currentTenant?.businessType;
  const sharedGroups = sharedCatalogGroupsFor(bType);
  if (sharedGroups.length) {
    const placeholders = sharedGroups.map(() => "?").join(", ");
    return dbSelect<Category>(
      `SELECT * FROM categories
       WHERE deleted_at IS NULL
         AND (tenant_id = ? OR (tenant_id IS NULL AND catalog_group IN (${placeholders})))
       ORDER BY name ASC`,
      [tenantId, ...sharedGroups]
    );
  }
  return categoriesRepo.list({ orderBy: "name ASC" });
}

/** Returns tenant's own sub categories plus shared ones for the given
 * category. Used in the product form dropdowns. */
export async function listSubCategoriesWithShared(categoryId: string): Promise<SubCategory[]> {
  const tenantId = requireCurrentTenantId();
  const bType = useAuthStore.getState().currentTenant?.businessType;
  const sharedGroups = sharedCatalogGroupsFor(bType);
  if (sharedGroups.length) {
    const placeholders = sharedGroups.map(() => "?").join(", ");
    return dbSelect<SubCategory>(
      `SELECT * FROM sub_categories
       WHERE deleted_at IS NULL AND category_id = ?
         AND (tenant_id = ? OR (tenant_id IS NULL AND catalog_group IN (${placeholders})))
       ORDER BY name ASC`,
      [categoryId, tenantId, ...sharedGroups]
    );
  }
  return subCategoriesRepo.list({ where: "category_id = ?", params: [categoryId], orderBy: "name ASC" });
}

/** A product's flat discount comes from its Sub Category when that has one
 * set, else its Category, else no discount \u2014 used to prefill the discount %
 * when a product is first added to an invoice line instead of always
 * starting at 0. */
export async function getEffectiveDiscountPct(product: Product): Promise<number> {
  if (product.sub_category_id) {
    const sc = await subCategoriesRepo.get(product.sub_category_id);
    if (sc && sc.flat_discount_pct > 0) return sc.flat_discount_pct;
  }
  if (product.category_id) {
    const c = await categoriesRepo.get(product.category_id);
    if (c && c.flat_discount_pct > 0) return c.flat_discount_pct;
  }
  return 0;
}
