"use client";

import { SimpleCategoryPage } from "@/components/ui/SimpleCategoryPage";
import { expenseCategoriesRepo } from "@/lib/repo/expenses";

export default function ExpenseCategoriesPage() {
  return <SimpleCategoryPage title="Expense Category Details" repo={expenseCategoriesRepo} />;
}
