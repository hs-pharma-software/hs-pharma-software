import { createTenantRepo } from "./base";
import type { FinancialClosing } from "../types2";

export const financialClosingsRepo = createTenantRepo<FinancialClosing>("financial_closings");
