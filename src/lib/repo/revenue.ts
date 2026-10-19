import { createTenantRepo } from "./base";
import type { RevenueCategory, Revenue } from "../types2";

export const revenueCategoriesRepo = createTenantRepo<RevenueCategory>("revenue_categories");
export const revenuesRepo = createTenantRepo<Revenue>("revenues");
