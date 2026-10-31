/** Batch expiry: how close a batch is to expiry (for colouring the stock
 * list) and correcting an expiry date entered by mistake. A batch's expiry
 * can be corrected at most EXPIRY_CORRECTION_LIMIT times; every correction
 * keeps the old and new date, who made it and why. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { productBatchesRepo } from "./products";
import { useAuthStore } from "../../store/authStore";
import { localDate } from "../localDate";
import { isMissingSchemaError } from "../dbErrors";

export const EXPIRY_CORRECTION_LIMIT = 3;
/** Within this many days of expiry a batch counts as expiring soon (as on the dashboard). */
export const EXPIRING_SOON_DAYS = 180;

export interface ExpiryChange extends TenantRow {
  batch_id: string;
  product_id: string | null;
  old_expiry: string | null;
  new_expiry: string;
  reason: string;
  changed_by: string | null;
  changed_by_name: string | null;
}

export const expiryChangesRepo = createTenantRepo<ExpiryChange>("product_batch_expiry_changes");

export type ExpiryStatus = "expired" | "soon" | "ok" | "none";

/** Expired (on or before today), expiring soon (within 180 days), or fine. */
export function expiryStatus(expiry: string | null | undefined, today: string = localDate()): { status: ExpiryStatus; days: number | null } {
  const d = (expiry ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { status: "none", days: null };
  const days = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { status: days <= 0 ? "expired" : days <= EXPIRING_SOON_DAYS ? "soon" : "ok", days };
}

/** Corrections already made, per batch. Empty before the v60 migration. */
export async function expiryCorrectionCounts(): Promise<Map<string, number>> {
  try {
    const rows = await dbSelect<{ batch_id: string; n: number }>(
      `SELECT batch_id, COUNT(*) AS n FROM product_batch_expiry_changes WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY batch_id`,
      [requireCurrentTenantId()]
    );
    return new Map(rows.map((r) => [r.batch_id, Number(r.n)]));
  } catch {
    return new Map();
  }
}

export async function listExpiryChanges(batchId: string): Promise<ExpiryChange[]> {
  return expiryChangesRepo.list({ where: "batch_id = ?", params: [batchId], orderBy: "created_at ASC" });
}

/** Corrects a batch's expiry date. Returns how many corrections are left. */
export async function correctBatchExpiry(batchId: string, newExpiry: string, reason: string): Promise<{ left: number }> {
  const date = newExpiry.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("Enter the correct expiry date.");
  if (!reason.trim()) throw new Error("Enter why the expiry is being corrected.");
  const batch = await productBatchesRepo.get(batchId);
  if (!batch) throw new Error("Stock batch not found.");
  if ((batch.expiry_date ?? "").slice(0, 10) === date) throw new Error("This is already the batch's expiry date.");
  let used: number;
  try {
    used = (await listExpiryChanges(batchId)).length;
  } catch (e) {
    if (isMissingSchemaError(e)) {
      throw new Error("Expiry correction needs the latest database update (v60). Ask the administrator to run it.");
    }
    throw e;
  }
  if (used >= EXPIRY_CORRECTION_LIMIT) {
    throw new Error(`This batch's expiry has already been corrected ${EXPIRY_CORRECTION_LIMIT} times and cannot be changed again.`);
  }
  const u = useAuthStore.getState().currentUser;
  await expiryChangesRepo.create({
    batch_id: batchId, product_id: batch.product_id ?? null, old_expiry: batch.expiry_date ?? null, new_expiry: date, reason: reason.trim(),
    changed_by: u?.id ?? null, changed_by_name: u?.displayName ?? u?.username ?? null,
  });
  await productBatchesRepo.update(batchId, { expiry_date: date });
  return { left: EXPIRY_CORRECTION_LIMIT - used - 1 };
}
