import { dbSelect } from "../db";
import { createTenantRepo } from "./base";
import { useAuthStore } from "../../store/authStore";
import { deductStock, listAvailableBatches } from "./stock";
import type { Purchase, PurchaseItem } from "../types2";

export const purchasesRepo = createTenantRepo<Purchase>("purchases");
export const purchaseItemsRepo = createTenantRepo<PurchaseItem>("purchase_items");

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

export interface PurchaseListRow {
  id: string;
  purchase_no: number | null;
  date: string;
  supplier_name: string;
  supplier_invoice_no: string | null;
  discount_rs: number;
  tax: number;
  paid_amount: number;
  balance: number;
  payment_method: string | null;
  is_return: number;
  original_purchase_no: number | null;
}

export async function listPurchasesForGrid(isReturn = false): Promise<PurchaseListRow[]> {
  return dbSelect<PurchaseListRow>(
    `
    SELECT pu.id, pu.purchase_no, pu.date, s.name AS supplier_name, pu.supplier_invoice_no,
           pu.discount_rs, pu.tax, pu.paid_amount, pu.balance, pu.payment_method, pu.is_return,
           orig.purchase_no AS original_purchase_no
    FROM purchases pu
    LEFT JOIN suppliers s ON s.id = pu.supplier_id
    LEFT JOIN purchases orig ON orig.id = pu.original_purchase_id
    WHERE pu.deleted_at IS NULL AND pu.tenant_id = ? AND pu.is_return = ?
    ORDER BY pu.created_at DESC
  `,
    [currentTenantId(), isReturn ? 1 : 0]
  );
}

export async function nextPurchaseNo(): Promise<number> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(purchase_no) as n FROM purchases WHERE deleted_at IS NULL AND tenant_id = ?`,
    [currentTenantId()]
  );
  return (rows[0]?.n ?? 0) + 1;
}

/** For the Purchase Return flows: find the original purchase to return
 * items to the supplier from, by P.ID or supplier name. Only real,
 * completed purchases (never other returns) are eligible. */
export async function searchPurchasesForReturn(term: string): Promise<PurchaseListRow[]> {
  const like = `%${term}%`;
  const asNumber = Number(term);
  return dbSelect<PurchaseListRow>(
    `
    SELECT pu.id, pu.purchase_no, pu.date, s.name AS supplier_name, pu.supplier_invoice_no,
           pu.discount_rs, pu.tax, pu.paid_amount, pu.balance, pu.payment_method, pu.is_return,
           NULL AS original_purchase_no
    FROM purchases pu
    LEFT JOIN suppliers s ON s.id = pu.supplier_id
    WHERE pu.deleted_at IS NULL AND pu.tenant_id = ? AND pu.is_return = 0
      AND (pu.purchase_no = ? OR s.name LIKE ?)
    ORDER BY pu.created_at DESC
    LIMIT 15
  `,
    [currentTenantId(), Number.isFinite(asNumber) ? asNumber : -1, like]
  );
}

export interface PurchaseItemWithProduct extends PurchaseItem {
  product_name: string;
  barcode: string | null;
}

export async function listItemsForPurchase(purchaseId: string): Promise<PurchaseItemWithProduct[]> {
  return dbSelect<PurchaseItemWithProduct>(
    `
    SELECT pi.*, p.name AS product_name, p.barcode
    FROM purchase_items pi
    LEFT JOIN products p ON p.id = pi.product_id
    WHERE pi.purchase_id = ? AND pi.tenant_id = ? AND pi.deleted_at IS NULL
  `,
    [purchaseId, currentTenantId()]
  );
}

/** Sums qty already returned to the supplier per product on a given
 * original purchase (across all its return purchases), so both return
 * flows can cap a line at what's actually still returnable. */
export async function getReturnedQtyByProduct(originalPurchaseId: string): Promise<Map<string, number>> {
  const rows = await dbSelect<{ product_id: string; qty: number }>(
    `
    SELECT pi.product_id, SUM(pi.received_qty) AS qty
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE pu.original_purchase_id = ? AND pu.tenant_id = ? AND pu.deleted_at IS NULL AND pi.deleted_at IS NULL
    GROUP BY pi.product_id
  `,
    [originalPurchaseId, currentTenantId()]
  );
  return new Map(rows.map((r) => [r.product_id, r.qty]));
}

/** One-click "return whole invoice": returns every line of the original
 * purchase at its full still-returnable qty (received_qty minus whatever
 * was already returned against it) in a single new return purchase, rather
 * than the cashier re-picking each item \u2014 Purchase Item Return remains the
 * flow for a partial, item-by-item return. */
export async function returnWholePurchase(purchaseId: string, paidAmount = 0): Promise<string> {
  const original = await purchasesRepo.get(purchaseId);
  if (!original) throw new Error("Purchase not found");
  const items = await listItemsForPurchase(purchaseId);
  const alreadyReturned = await getReturnedQtyByProduct(purchaseId);

  const lines = items
    .map((item) => ({
      item,
      returnQty: item.received_qty - (alreadyReturned.get(item.product_id) ?? 0),
    }))
    .filter((l) => l.returnQty > 0);

  if (lines.length === 0) throw new Error("Nothing left to return on this purchase \u2014 every item was already returned.");

  const payable = lines.reduce((s, l) => s + l.item.purchase_price * l.returnQty, 0);

  const ret = await purchasesRepo.create({
    purchase_no: null,
    date: new Date().toISOString().slice(0, 10),
    order_id: null,
    supplier_id: original.supplier_id,
    supplier_invoice_no: original.supplier_invoice_no,
    discount_rs: 0,
    discount_pct: 0,
    tax: 0,
    payable,
    paid_amount: paidAmount,
    balance: payable - paidAmount,
    description: `Whole-invoice return of Purchase #${original.purchase_no ?? ""}`,
    payment_method: original.payment_method,
    bank_id: null,
    slip_no: null,
    advance_payment: 0,
    is_return: 1,
    original_purchase_id: purchaseId,
  });

  for (const { item, returnQty } of lines) {
    const batches = await listAvailableBatches(item.product_id);
    const match = batches.find((b) => b.batch_no === item.batch_no) ?? batches[0];
    if (!match || match.qty < returnQty) {
      throw new Error(`Not enough stock of ${item.product_name} on hand to return (need ${returnQty}).`);
    }
    await deductStock(match.id, returnQty);
    await purchaseItemsRepo.create({
      purchase_id: ret.id,
      product_id: item.product_id,
      location: item.location,
      batch_no: item.batch_no,
      expiry_date: item.expiry_date,
      uom_id: item.uom_id,
      purchase_price: item.purchase_price,
      booked_qty: returnQty,
      received_qty: returnQty,
      avail_qty: match.qty - returnQty,
      amount: item.purchase_price * returnQty,
      st_pct: item.st_pct,
      wht_pct: item.wht_pct,
      total: item.purchase_price * returnQty,
    });
  }

  return ret.id;
}
