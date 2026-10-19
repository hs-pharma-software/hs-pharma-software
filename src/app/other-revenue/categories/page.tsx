"use client";

import { SimpleCategoryPage } from "@/components/ui/SimpleCategoryPage";
import { revenueCategoriesRepo } from "@/lib/repo/revenue";

export default function RevenueCategoriesPage() {
  return <SimpleCategoryPage title="Revenue Category Details" repo={revenueCategoriesRepo} />;
}
