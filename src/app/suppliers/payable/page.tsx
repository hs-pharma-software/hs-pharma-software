"use client";

import { PartyLedgerPage } from "@/components/ledger/PartyLedgerPage";
import { suppliersRepo } from "@/lib/repo/suppliers";

export default function AccountsPayablePage() {
  return (
    <PartyLedgerPage
      title="Accounts Payable"
      partyType="supplier"
      listParties={() => suppliersRepo.list()}
    />
  );
}
