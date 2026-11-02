import { dbExecute, dbSelect } from "../db";
import { nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { productBatchesRepo } from "./products";
import { useAuthStore } from "../../store/authStore";
import { STOCK_EPS } from "../batchAllocation";
import type { ProductBatch } from "../types";

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

/** Changes a batch's quantity in one statement (qty = qty + change), so two
 * people selling or receiving the same batch at once can't overwrite each
 * other. A take is refused when the batch does not hold it (within rounding);
 * a result within rounding of 0 is 0. Returns whether the batch changed. */
async function changeBatchQty(batchId: string, change: number, extra: { purchase_price?: number } = {}): Promise<boolean> {
  const ts = nowIso();
  const sets = [`qty = CASE WHEN ABS(qty + ?) <= ? THEN 0 ELSE qty + ? END`, "updated_at = ?"];
  const params: unknown[] = [change, STOCK_EPS, change, ts];
  if (extra.purchase_price != null) {
    sets.push("purchase_price = ?");
    params.push(extra.purchase_price);
  }
  const r = await dbExecute(
    `UPDATE product_batches SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL${change < 0 ? " AND qty + ? >= ?" : ""}`,
    [...params, batchId, currentTenantId(), ...(change < 0 ? [change, -STOCK_EPS] : [])]
  );
  if (!r.rowsAffected) return false;
  const row = await productBatchesRepo.get(batchId);
  if (row) await recordOutbox("product_batches", batchId, "update", row as unknown as Record<string, unknown>);
  return true;
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
      await changeBatchQty(existing[0].id, input.qty, input.purchasePrice ? { purchase_price: input.purchasePrice } : {});
      const meta: Partial<ProductBatch> = {};
      if (input.expiryDate != null) meta.expiry_date = input.expiryDate;
      if (input.location != null) meta.location = input.location;
      const updated = Object.keys(meta).length ? await productBatchesRepo.update(existing[0].id, meta) : await productBatchesRepo.get(existing[0].id);
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

/** Manually adds quantity (base units) to one existing batch of the
 * logged-in tenant. A purchase price, when given, replaces the batch's. */
export async function addStockToBatch(batchId: string, qty: number, purchasePrice?: number): Promise<void> {
  if (!(qty > 0)) throw new Error("Enter a quantity greater than 0.");
  const batch = await productBatchesRepo.get(batchId);
  if (!batch || (batch as ProductBatch & { tenant_id?: string }).tenant_id !== currentTenantId()) {
    throw new Error("This stock row belongs to another account.");
  }
  await changeBatchQty(batchId, qty, purchasePrice && purchasePrice > 0 ? { purchase_price: purchasePrice } : {});
}

/** Manually adds quantity (base units) to a product: into its newest
 * no-batch-number stock row of the logged-in tenant, or a new one. */
export async function addProductStock(productId: string, qty: number, purchasePrice?: number): Promise<void> {
  if (!(qty > 0)) throw new Error("Enter a quantity greater than 0.");
  const rows = await dbSelect<{ id: string }>(
    `SELECT id FROM product_batches
     WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL AND (batch_no IS NULL OR batch_no = '')
     ORDER BY created_at DESC LIMIT 1`,
    [productId, currentTenantId()]
  );
  if (rows[0]) return addStockToBatch(rows[0].id, qty, purchasePrice);
  await receiveStock({ productId, batchNo: null, qty, purchasePrice: purchasePrice && purchasePrice > 0 ? purchasePrice : 0, expiryDate: null, location: null });
}

/** Deducts sold/returned-out stock from a specific batch. Throws if the
 * batch doesn't have enough available quantity. Used by Invoice creation. */

export async function deductStock(batchId: string, qty: number): Promise<void> {
  // Loose units are fractions of a pack (2 of 30 tablets = 0.0666...), and
  // quantities are rounded to 6 decimals: a difference that small is the
  // same stock, so selling the last tablets is not refused.
  if (await changeBatchQty(batchId, -qty)) return;
  const batch = await productBatchesRepo.get(batchId);
  if (!batch) throw new Error("Batch not found");
  throw new Error(`Not enough stock in batch (avail ${batch.qty}, need ${qty})`);
}

export async function restoreStock(batchId: string, qty: number): Promise<void> {
  await changeBatchQty(batchId, qty);
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

/** Who supplied each batch: the supplier of the latest purchase of that
 * product and batch number, else of the product's latest purchase. Keyed
 * `${product_id}|${batch_no}` and `${product_id}`. Purchase returns are ignored. */
export async function stockSupplierNames(): Promise<Map<string, string>> {
  const rows = await dbSelect<{ product_id: string; batch_no: string | null; name: string }>(
    `SELECT pi.product_id, pi.batch_no, s.name
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     JOIN suppliers s ON s.id = pu.supplier_id
     WHERE pi.tenant_id = ? AND pi.deleted_at IS NULL AND pu.deleted_at IS NULL AND COALESCE(pu.is_return, 0) = 0
     ORDER BY pu.date ASC, pu.created_at ASC`,
    [currentTenantId()]
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(`${r.product_id}|${(r.batch_no ?? "").trim()}`, r.name);
    map.set(r.product_id, r.name);
  }
  return map;
}

export function supplierOf(map: Map<string, string>, productId: string, batchNo: string | null): string | null {
  return map.get(`${productId}|${(batchNo ?? "").trim()}`) ?? map.get(productId) ?? null;
}
