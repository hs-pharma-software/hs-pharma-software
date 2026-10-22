import { dbSelect } from "../db";
import { createTenantRepo } from "./base";
import { useAuthStore } from "../../store/authStore";
import { receiveStock, deductStock, listAvailableBatches } from "./stock";
import type { Invoice, InvoiceItem } from "../types2";

export const invoicesRepo = createTenantRepo<Invoice>("invoices");
export const invoiceItemsRepo = createTenantRepo<InvoiceItem>("invoice_items");

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

export interface InvoiceListRow {
  id: string;
  invoice_no: number | null;
  date: string;
  customer_name: string;
  salesman_name: string | null;
  total: number;
  payable: number;
  paid: number;
  balance: number;
  original_invoice_no: number | null;
  fbr_invoice_no: string | null;
}

export async function listInvoicesForGrid(opts: { isReturn?: boolean; isMemorized?: boolean } = {}): Promise<InvoiceListRow[]> {
  const { isReturn = false, isMemorized = false } = opts;
  return dbSelect<InvoiceListRow>(
    `
    SELECT i.id, i.invoice_no, i.date,
           COALESCE(c.name, 'Walk-in') AS customer_name,
           sm.name AS salesman_name,
           i.total, i.payable, i.paid, i.balance,
           orig.invoice_no AS original_invoice_no,
           i.fbr_invoice_no
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN salesmen sm ON sm.id = i.salesman_id
    LEFT JOIN invoices orig ON orig.id = i.original_invoice_id
    WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = ? AND i.is_memorized = ? AND i.is_quotation = 0
    ORDER BY i.created_at DESC
  `,
    [currentTenantId(), isReturn ? 1 : 0, isMemorized ? 1 : 0]
  );
}

/** How many real (non-return, non-quotation) invoices the current tenant has
 * created since the given month started \u2014 used to enforce a subscription
 * plan's `max_invoices_per_month` cap. */
export async function countInvoicesThisMonth(monthStartIso: string): Promise<number> {
  const rows = await dbSelect<{ n: number }>(
    `
    SELECT COUNT(*) as n FROM invoices
    WHERE deleted_at IS NULL AND tenant_id = ? AND is_return = 0 AND is_quotation = 0 AND date >= ?
  `,
    [currentTenantId(), monthStartIso]
  );
  return rows[0]?.n ?? 0;
}

/** For the Sale Item Return flow: find the original bill to return items
 * from, by invoice number or customer name. Only real, completed sales
 * (never other returns or memorized drafts) are eligible. */
export async function searchInvoicesForReturn(term: string): Promise<InvoiceListRow[]> {
  const like = `%${term}%`;
  const asNumber = Number(term);
  return dbSelect<InvoiceListRow>(
    `
    SELECT i.id, i.invoice_no, i.date,
           COALESCE(c.name, 'Walk-in') AS customer_name,
           sm.name AS salesman_name,
           i.total, i.payable, i.paid, i.balance,
           NULL AS original_invoice_no
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN salesmen sm ON sm.id = i.salesman_id
    WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 0 AND i.is_memorized = 0 AND i.is_quotation = 0
      AND (i.invoice_no = ? OR COALESCE(c.name, 'Walk-in') LIKE ?)
    ORDER BY i.created_at DESC
    LIMIT 15
  `,
    [currentTenantId(), Number.isFinite(asNumber) ? asNumber : -1, like]
  );
}

export async function nextInvoiceNo(): Promise<number> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(invoice_no) as n FROM invoices WHERE deleted_at IS NULL AND tenant_id = ?`,
    [currentTenantId()]
  );
  return (rows[0]?.n ?? 0) + 1;
}

export async function nextQuotationNo(): Promise<number> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(quotation_no) as n FROM invoices WHERE deleted_at IS NULL AND tenant_id = ? AND is_quotation = 1`,
    [currentTenantId()]
  );
  return (rows[0]?.n ?? 0) + 1;
}

export interface QuotationListRow {
  id: string;
  quotation_no: number | null;
  date: string;
  customer_name: string;
  salesman_name: string | null;
  total: number;
  payable: number;
  converted_invoice_id: string | null;
  converted_invoice_no: number | null;
}

/** Quotations live in the same `invoices` table (is_quotation=1) but never
 * consume the invoice_no sequence and never touch stock \u2014 that only happens
 * when one is accepted, via convertQuotationToInvoice(). */
export async function listQuotations(): Promise<QuotationListRow[]> {
  return dbSelect<QuotationListRow>(
    `
    SELECT i.id, i.quotation_no, i.date,
           COALESCE(c.name, 'Walk-in') AS customer_name,
           sm.name AS salesman_name,
           i.total, i.payable,
           i.converted_invoice_id,
           conv.invoice_no AS converted_invoice_no
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN salesmen sm ON sm.id = i.salesman_id
    LEFT JOIN invoices conv ON conv.id = i.converted_invoice_id
    WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_quotation = 1
    ORDER BY i.created_at DESC
  `,
    [currentTenantId()]
  );
}

/** Accepting a quotation creates a brand-new real invoice (fresh invoice_no,
 * today's date, actual stock deduction against currently available batches \u2014
 * a quotation never reserved stock, so it re-resolves FEFO batches at accept
 * time rather than trusting whatever batch it was quoted against) and
 * stamps `converted_invoice_id` back onto the quotation. The quotation row
 * itself is left in place (is_quotation stays 1) so it never leaks into
 * invoice lists/reports, just shows as converted. */
export async function convertQuotationToInvoice(quotationId: string): Promise<string> {
  const quotation = await invoicesRepo.get(quotationId);
  if (!quotation) throw new Error("Quotation not found");
  if (quotation.converted_invoice_id) return quotation.converted_invoice_id;

  const items = await listItemsForInvoice(quotationId);
  const invoiceNo = await nextInvoiceNo();
  const created = await invoicesRepo.create({
    invoice_no: invoiceNo,
    date: new Date().toISOString().slice(0, 10),
    inv_on: quotation.inv_on,
    invoice_type: quotation.invoice_type,
    description: quotation.description,
    salesman_id: quotation.salesman_id,
    customer_id: quotation.customer_id,
    total: quotation.total,
    charges: quotation.charges,
    discount_pct: quotation.discount_pct,
    discount_rs: quotation.discount_rs,
    tax_pct: quotation.tax_pct,
    payable: quotation.payable,
    paid: 0,
    balance: quotation.payable,
    is_return: 0,
    is_memorized: 0,
    is_quotation: 0,
    quotation_no: null,
    converted_invoice_id: null,
    original_invoice_id: null,
  });

  for (const item of items) {
    const batches = await listAvailableBatches(item.product_id);
    const needed = item.qty + item.bonus_qty;
    const match = batches.find((b) => b.batch_no === item.batch_no && b.qty >= needed) ?? batches[0];
    if (!match || match.qty < needed) {
      throw new Error(`Not enough stock for ${item.product_name} to accept this quotation (need ${needed}).`);
    }
    await deductStock(match.id, needed);
    await invoiceItemsRepo.create({
      invoice_id: created.id,
      product_id: item.product_id,
      batch_no: match.batch_no,
      packing: item.packing,
      uom_id: item.uom_id,
      avail_qty: match.qty,
      qty: item.qty,
      bonus_qty: item.bonus_qty,
      purchase_price: match.purchase_price,
      sale_price: item.sale_price,
      tax_pct: item.tax_pct,
      further_tax_pct: item.further_tax_pct,
      tax_rs: item.tax_rs,
      discount_pct: item.discount_pct,
      discount_rs: item.discount_rs,
      total: item.total,
    });
  }

  await invoicesRepo.update(quotationId, { converted_invoice_id: created.id });
  return created.id;
}

/** Sums qty already returned against each product on a given original
 * invoice (across all its return invoices), so Sale Item Return can cap a
 * line at what's actually still returnable instead of the full original
 * qty every time. */
export async function getReturnedQtyByProduct(originalInvoiceId: string): Promise<Map<string, number>> {
  const rows = await dbSelect<{ product_id: string; qty: number }>(
    `
    SELECT ii.product_id, SUM(ii.qty) AS qty
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.original_invoice_id = ? AND i.tenant_id = ? AND i.deleted_at IS NULL AND ii.deleted_at IS NULL
    GROUP BY ii.product_id
  `,
    [originalInvoiceId, currentTenantId()]
  );
  return new Map(rows.map((r) => [r.product_id, r.qty]));
}

export interface InvoiceItemWithProduct extends InvoiceItem {
  product_name: string;
  barcode: string | null;
  packing: number;
  secondary_unit_id: string | null;
  secondary_unit_name: string | null;
}

export async function listItemsForInvoice(invoiceId: string): Promise<InvoiceItemWithProduct[]> {
  return dbSelect<InvoiceItemWithProduct>(
    `
    SELECT ii.*, p.name AS product_name, p.barcode,
           COALESCE(p.packing, 1) AS packing,
           p.secondary_unit_id,
           su.name AS secondary_unit_name
    FROM invoice_items ii
    LEFT JOIN products p ON p.id = ii.product_id
    LEFT JOIN uoms su ON su.id = p.secondary_unit_id
    WHERE ii.invoice_id = ? AND ii.tenant_id = ? AND ii.deleted_at IS NULL
  `,
    [invoiceId, currentTenantId()]
  );
}

/** Adds each line's qty+bonus_qty back into stock (re-creating the batch by
 * product_id+batch_no if it no longer exists) \u2014 used when editing or
 * deleting an invoice so stock stays correct either way. */
export async function restoreInvoiceStock(items: InvoiceItem[]): Promise<void> {
  for (const item of items) {
    await receiveStock({
      productId: item.product_id,
      batchNo: item.batch_no,
      qty: item.qty + item.bonus_qty,
      purchasePrice: item.purchase_price,
      expiryDate: null,
      location: null,
    });
  }
}

/** Soft-deletes an invoice, its line items, and restores the stock they'd
 * deducted \u2014 the single place both "Delete" and "Edit" (delete-then-recreate
 * under the hood) route through, so stock bookkeeping can't drift between
 * the two actions. */
export async function deleteInvoiceWithStockRestore(invoiceId: string, reason?: string): Promise<void> {
  const items = await listItemsForInvoice(invoiceId);
  await restoreInvoiceStock(items);
  for (const item of items) {
    await invoiceItemsRepo.remove(item.id);
  }
  await invoicesRepo.remove(invoiceId, reason, "Invoice");
}
