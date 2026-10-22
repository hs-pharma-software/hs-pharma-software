import { dbSelect } from "../db";
import { productBatchesRepo } from "./products";
import { useAuthStore } from "../../store/authStore";
import type { ProductBatch } from "../types";

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

/** Adds received stock to a batch \u2014 reuses an existing batch row for the
 * same product+batch_no if one exists (bumping its qty and purchase price),
 * otherwise creates a new one. Used by Purchase and the manual Stock screen.
 * Matched within the logged-in tenant's own stock only \u2014 the product itself
 * may be shared, but two tenants reusing the same batch number must not
 * collide into one row. */
export async function receiveStock(input: {
  productId: string;
  batchNo: string | null;
  qty: number;
  purchasePrice: number;
  expiryDate: string | null;
  location: string | null;
}): Promise<ProductBatch> {
  if (input.batchNo) {
    const existing = await dbSelect<ProductBatch>(
      `SELECT * FROM product_batches WHERE product_id = ? AND batch_no = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
      [input.productId, input.batchNo, currentTenantId()]
    );
    if (existing[0]) {
      const updated = await productBatchesRepo.update(existing[0].id, {
        qty: existing[0].qty + input.qty,
        purchase_price: input.purchasePrice || existing[0].purchase_price,
        expiry_date: input.expiryDate ?? existing[0].expiry_date,
        location: input.location ?? existing[0].location,
      });
      return updated as ProductBatch;
    }
  }
  return productBatchesRepo.create({
    product_id: input.productId,
    batch_no: input.batchNo,
    qty: input.qty,
    purchase_price: input.purchasePrice,
    expiry_date: input.expiryDate,
    location: input.location,
  });
}

/** Deducts sold/returned-out stock from a specific batch. Throws if the
 * batch doesn't have enough available quantity. Used by Invoice creation. */
export async function deductStock(batchId: string, qty: number): Promise<void> {
  const batch = await productBatchesRepo.get(batchId);
  if (!batch) throw new Error("Batch not found");
  if (batch.qty < qty) throw new Error(`Not enough stock in batch (avail ${batch.qty}, need ${qty})`);
  await productBatchesRepo.update(batchId, { qty: batch.qty - qty });
}

export async function restoreStock(batchId: string, qty: number): Promise<void> {
  const batch = await productBatchesRepo.get(batchId);
  if (!batch) return;
  await productBatchesRepo.update(batchId, { qty: batch.qty + qty });
}

export interface ProductBatchOption {
  id: string;
  batch_no: string | null;
  expiry_date: string | null;
  qty: number;
  purchase_price: number;
}

export async function listAvailableBatches(productId: string): Promise<ProductBatchOption[]> {
  return dbSelect<ProductBatchOption>(
    `SELECT id, batch_no, expiry_date, qty, purchase_price FROM product_batches
     WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL AND qty > 0
     ORDER BY (expiry_date IS NULL), expiry_date ASC`,
    [productId, currentTenantId()]
  );
}
