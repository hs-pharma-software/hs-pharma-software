"use client";

import { CategorizedEntryPage } from "@/components/ui/CategorizedEntryPage";
import { revenueCategoriesRepo, revenuesRepo } from "@/lib/repo/revenue";

export default function RevenuePage() {
  return (
    <CategorizedEntryPage
      title="Revenue Details"
      byLabel="Revenue By"
      byField="revenue_by"
      categoryRepo={revenueCategoriesRepo}
      entryRepo={revenuesRepo}
    />
  );
}
