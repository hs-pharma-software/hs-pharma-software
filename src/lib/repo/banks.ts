import { dbSelect } from "../db";
import { createTenantRepo } from "./base";
import { useAuthStore } from "../../store/authStore";
import type { Bank, BankLedgerEntry } from "../types2";

export const banksRepo = createTenantRepo<Bank>("banks");
export const bankLedgerRepo = createTenantRepo<BankLedgerEntry>("bank_ledger_entries");

export interface BankSummaryRow {
  id: string;
  name: string;
  deposit: number;
  withdraw: number;
  balance: number;
}

export async function getBankSummaries(): Promise<BankSummaryRow[]> {
  const tenantId = useAuthStore.getState().currentTenant?.id ?? null;
  return dbSelect<BankSummaryRow>(
    `
    SELECT
      b.id,
      b.name,
      COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id = b.id AND transaction_type = 'deposit' AND deleted_at IS NULL), 0) AS deposit,
      COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id = b.id AND transaction_type = 'withdraw' AND deleted_at IS NULL), 0) AS withdraw,
      b.opening_balance
        + COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id = b.id AND transaction_type = 'deposit' AND deleted_at IS NULL), 0)
        - COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id = b.id AND transaction_type = 'withdraw' AND deleted_at IS NULL), 0)
        AS balance
    FROM banks b
    WHERE b.deleted_at IS NULL AND b.tenant_id = ?
    ORDER BY b.name ASC
  `,
    [tenantId]
  );
}
