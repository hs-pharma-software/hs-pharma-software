import { dbSelect } from "../db";
import { createTenantRepo } from "./base";
import { useAuthStore } from "../../store/authStore";
import type { LedgerAdjustment, PartyType } from "../types2";

export const ledgerRepo = createTenantRepo<LedgerAdjustment>("ledger_adjustments");

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

export async function listLedgerForParty(
  partyType: PartyType,
  partyId: string
): Promise<LedgerAdjustment[]> {
  return dbSelect<LedgerAdjustment>(
    `SELECT * FROM ledger_adjustments WHERE deleted_at IS NULL AND tenant_id = ? AND party_type = ? AND party_id = ? ORDER BY date DESC, created_at DESC`,
    [currentTenantId(), partyType, partyId]
  );
}

export async function sumPaidForParty(partyType: PartyType, partyId: string): Promise<number> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT SUM(paid_amount) as n FROM ledger_adjustments WHERE deleted_at IS NULL AND tenant_id = ? AND party_type = ? AND party_id = ?`,
    [currentTenantId(), partyType, partyId]
  );
  return rows[0]?.n ?? 0;
}

/** What a party's actual trade balance is from real business (unpaid
 * invoice balances for a customer, unpaid purchase balances for a
 * supplier) \u2014 a return nets against it. Staff have no invoices/purchases,
 * so this is 0 for them. Previously the Accounts Receivable/Payable and
 * Outstanding screens only looked at opening_balance and manual ledger
 * adjustments, so a credit sale or purchase never actually moved the
 * balance shown \u2014 this is what closes that gap. */
/** Same formula as getPartyTradeBalance, but summed across every customer
 * or supplier at once \u2014 powers the Dashboard's Customer Receivable /
 * Supplier Payable tiles and the Trial Balance / Balance Sheet reports,
 * all of which previously summed opening_balance alone (or opening_balance
 * minus adjustments) and so never reflected real credit sales/purchases. */
export async function getTotalPartyBalance(partyType: "customer" | "supplier"): Promise<number> {
  const table = partyType === "customer" ? "customers" : "suppliers";
  const tradeTable = partyType === "customer" ? "invoices" : "purchases";
  const fk = partyType === "customer" ? "customer_id" : "supplier_id";
  const quotationClause = partyType === "customer" ? "AND is_quotation = 0" : "";
  const tenantId = currentTenantId();
  const rows = await dbSelect<{ n: number | null }>(
    `
    SELECT SUM(
      p.opening_balance
      + COALESCE((SELECT SUM(CASE WHEN is_return = 0 THEN balance ELSE -balance END) FROM ${tradeTable} WHERE ${fk} = p.id AND tenant_id = ? AND deleted_at IS NULL ${quotationClause}), 0)
      - COALESCE((SELECT SUM(paid_amount) FROM ledger_adjustments WHERE tenant_id = ? AND party_type = ? AND party_id = p.id AND deleted_at IS NULL), 0)
    ) as n
    FROM ${table} p WHERE p.deleted_at IS NULL AND p.tenant_id = ?
  `,
    [tenantId, tenantId, partyType, tenantId]
  );
  return rows[0]?.n ?? 0;
}

export async function getPartyTradeBalance(partyType: PartyType, partyId: string): Promise<number> {
  const tenantId = currentTenantId();
  if (partyType === "customer") {
    const rows = await dbSelect<{ n: number | null }>(
      `SELECT SUM(CASE WHEN is_return = 0 THEN balance ELSE -balance END) as n
       FROM invoices WHERE customer_id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_quotation = 0`,
      [partyId, tenantId]
    );
    return rows[0]?.n ?? 0;
  }
  if (partyType === "supplier") {
    const rows = await dbSelect<{ n: number | null }>(
      `SELECT SUM(CASE WHEN is_return = 0 THEN balance ELSE -balance END) as n
       FROM purchases WHERE supplier_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [partyId, tenantId]
    );
    return rows[0]?.n ?? 0;
  }
  return 0;
}
