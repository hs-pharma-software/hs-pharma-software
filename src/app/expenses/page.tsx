"use client";

import { useEffect, useState } from "react";
import { CategorizedEntryPage } from "@/components/ui/CategorizedEntryPage";
import { expenseCategoriesRepo, expensesRepo } from "@/lib/repo/expenses";
import { useAppStore } from "@/store/appStore";

export default function ExpensesPage() {
  const pendingAction = useAppStore((s) => s.pendingAction);
  const setPendingAction = useAppStore((s) => s.setPendingAction);
  const [addTrigger, setAddTrigger] = useState(0);

  // ALT+E -> New Expense (see GlobalShortcuts.tsx).
  useEffect(() => {
    if (pendingAction === "new-expense") {
      setAddTrigger((t) => t + 1);
      setPendingAction(null);
    }
  }, [pendingAction, setPendingAction]);

  return (
    <CategorizedEntryPage
      title="Expenses Details"
      byLabel="Expense By"
      byField="expense_by"
      categoryRepo={expenseCategoriesRepo}
      entryRepo={expensesRepo}
      externalAddTrigger={addTrigger}
    />
  );
}
