"use client";

import { EsGuard } from "@/components/electric/ui";
import { SaleForm } from "@/components/electric/SaleForm";

export default function NewSalePage() {
  return (
    <EsGuard>
      <SaleForm mode="sale" />
    </EsGuard>
  );
}
