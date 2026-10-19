import { createTenantRepo } from "./base";
import type { ExpenseCategory, Expense } from "../types2";

export const expenseCategoriesRepo = createTenantRepo<ExpenseCategory>("expense_categories");
export const expensesRepo = createTenantRepo<Expense>("expenses");
