import { createRepo } from "./base";
import type { Category, SubCategory, Product } from "../types";

export const categoriesRepo = createRepo<Category>("categories");
export const subCategoriesRepo = createRepo<SubCategory>("sub_categories");

/** A product's flat discount comes from its Sub Category when that has one
 * set, else its Category, else no discount — used to prefill the discount %
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
