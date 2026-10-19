"use client";

import { PartyLedgerPage } from "@/components/ledger/PartyLedgerPage";
import { customersRepo } from "@/lib/repo/customers";

export default function AccountsReceivablePage() {
  return (
    <PartyLedgerPage
      title="Accounts Receivable"
      partyType="customer"
      listParties={() => customersRepo.list()}
    />
  );
}
