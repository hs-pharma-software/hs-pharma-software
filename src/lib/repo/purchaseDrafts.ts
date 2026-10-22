import { createTenantRepo, type TenantRow } from "./base";

export interface PurchaseDraftLine {
  productId: string;
  batchNo: string;
  expiryDate: string;
  purchasePrice: number;
  qty: number;
  stPct: number;
  whtPct: number;
  salePrice: number;
  initialSalePrice: number;
  unit: "base" | "secondary";
}

export interface PurchaseDraftPayload {
  supplierId: string;
  supplierInvoiceNo: string;
  discountRs: string;
  paidAmount: string;
  paymentMethod: string;
  description: string;
  lines: PurchaseDraftLine[];
}

export interface PurchaseDraft extends TenantRow {
  title: string | null;
  /** JSON of PurchaseDraftPayload. */
  payload: string;
  /** 1 = saved automatically while typing, 0 = saved with the Draft button. */
  is_auto: number;
}

export const purchaseDraftsRepo = createTenantRepo<PurchaseDraft>("purchase_drafts");

export function parseDraft(d: PurchaseDraft): PurchaseDraftPayload | null {
  try {
    return JSON.parse(d.payload) as PurchaseDraftPayload;
  } catch {
    return null;
  }
}

/** Creates the draft on first save, updates it afterwards. */
export async function saveDraft(
  id: string,
  payload: PurchaseDraftPayload,
  title: string,
  isAuto: boolean
): Promise<void> {
  const data = { title, payload: JSON.stringify(payload), is_auto: isAuto ? 1 : 0 };
  const existing = await purchaseDraftsRepo.get(id);
  if (existing && !existing.deleted_at) await purchaseDraftsRepo.update(id, data);
  else if (!existing) await purchaseDraftsRepo.create({ id, ...data });
}

export async function listPurchaseDrafts(): Promise<PurchaseDraft[]> {
  return purchaseDraftsRepo.list({ orderBy: "updated_at DESC" });
}

export async function deleteDraft(id: string): Promise<void> {
  const existing = await purchaseDraftsRepo.get(id);
  if (existing && !existing.deleted_at) await purchaseDraftsRepo.remove(id);
}
