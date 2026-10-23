import { assertOwnedRefs, createTenantRepo } from "./base";
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
