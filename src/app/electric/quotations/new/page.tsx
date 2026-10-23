"use client";

import { EsGuard } from "@/components/electric/ui";
import { SaleForm } from "@/components/electric/SaleForm";

export default function NewQuotationPage() {
  return (
    <EsGuard>
      <SaleForm mode="quotation" />
    </EsGuard>
  );
}
