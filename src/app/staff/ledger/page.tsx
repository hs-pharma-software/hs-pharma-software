"use client";

import { PartyLedgerPage } from "@/components/ledger/PartyLedgerPage";
import { staffRepo } from "@/lib/repo/staff";

export default function EmployeeLedgerPage() {
  return (
    <PartyLedgerPage title="Employee Ledger" partyType="staff" listParties={() => staffRepo.list()} />
  );
}
