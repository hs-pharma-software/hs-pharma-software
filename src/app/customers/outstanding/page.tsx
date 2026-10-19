"use client";

import { OutstandingPage } from "@/components/ledger/OutstandingPage";

export default function CustomerOutstandingPage() {
  return <OutstandingPage title="Outstanding" partyType="customer" table="customers" />;
}
