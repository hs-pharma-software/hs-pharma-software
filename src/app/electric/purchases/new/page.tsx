"use client";

import { EsGuard } from "@/components/electric/ui";
import { PurchaseForm } from "@/components/electric/PurchaseForm";

export default function NewPurchasePage() {
  return (
    <EsGuard>
      <PurchaseForm />
    </EsGuard>
  );
}
