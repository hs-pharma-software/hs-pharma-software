"use client";

import { OutstandingPage } from "@/components/ledger/OutstandingPage";

export default function SupplierOutstandingPage() {
  return <OutstandingPage title="Outstanding" partyType="supplier" table="suppliers" />;
}
