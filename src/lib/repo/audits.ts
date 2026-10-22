import { dbSelect } from "../db";
import { createTenantRepo } from "./base";
import { useAuthStore } from "../../store/authStore";
import type { AuditRow, AuditItem } from "../types2";

export const auditsRepo = createTenantRepo<AuditRow>("audits");
export const auditItemsRepo = createTenantRepo<AuditItem>("audit_items");

export interface AuditItemWithProduct extends AuditItem {
  product_name: string;
  system_qty: number;
}

/** Each line's system qty is looked up live (current stock), not stored on
 * the audit item \u2014 a re-print or edit later reflects any stock that's
 * moved since the count, same way the variance would appear in real life. */
export async function listItemsForAudit(auditId: string): Promise<AuditItemWithProduct[]> {
  const tenantId = useAuthStore.getState().currentTenant?.id ?? null;
  return dbSelect<AuditItemWithProduct>(
    `
    SELECT ai.*, p.name AS product_name,
           COALESCE((SELECT SUM(qty) FROM product_batches WHERE product_id = ai.product_id AND tenant_id = ? AND deleted_at IS NULL), 0) AS system_qty
    FROM audit_items ai
    LEFT JOIN products p ON p.id = ai.product_id
    WHERE ai.audit_id = ? AND ai.deleted_at IS NULL
  `,
    [tenantId, auditId]
  );
}

/** Soft-deletes an audit and all of its line items together, so Delete
 * never leaves orphaned audit_items behind. */
export async function deleteAuditWithItems(auditId: string, reason?: string): Promise<void> {
  const items = await listItemsForAudit(auditId);
  for (const item of items) {
    await auditItemsRepo.remove(item.id);
  }
  await auditsRepo.remove(auditId, reason, "Audit");
}
