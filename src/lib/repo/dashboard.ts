import { dbSelect } from "../db";
import { useAuthStore } from "../../store/authStore";
import { sharedCatalogGroupsFor, sharedCatalogWhereClause } from "../catalogAccess";

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

function currentBusinessType(): string | null {
  return useAuthStore.getState().currentTenant?.businessType ?? null;
}

/** Returns a properly-scoped product WHERE clause + params for the current
 * tenant: includes their own products + only the shared catalog groups they
 * are allowed to see (e.g. general_store tenants only see general_store
 * shared catalog, not the pharma catalog). */
function productScopeClause(tenantId: string) {
  return sharedCatalogWhereClause(tenantId, sharedCatalogGroupsFor(currentBusinessType()));
}

export interface LowStockRow {
  id: string;
  name: string;
  avail_qty: number;
  max_stock_qty: number | null;
}

/** Flags products at or below a low-stock threshold: their own
 * `max_stock_qty * 0.2` when set, else a flat fallback of 10 units.
 * Only includes products accessible to the current tenant type (general-store
 * tenants see general_store catalog, pharmacy tenants see pharma + general_store). */
export async function getLowStockProducts(limit = 8): Promise<LowStockRow[]> {
  const tenantId = currentTenantId() ?? "";
  const { clause, params } = productScopeClause(tenantId);
  return dbSelect<LowStockRow>(
    `
    SELECT * FROM (
      SELECT p.id, p.name,
             COALESCE((SELECT SUM(qty) FROM product_batches WHERE product_id = p.id AND tenant_id = ? AND deleted_at IS NULL), 0) AS avail_qty,
             p.max_stock_qty
      FROM products p
      WHERE p.deleted_at IS NULL AND (${clause})
    )
    WHERE avail_qty <= COALESCE(max_stock_qty * 0.2, 10)
    ORDER BY avail_qty ASC
    LIMIT ?
  `,
    [tenantId, ...params, limit]
  );
}

export interface ExpiringBatchRow {
  id: string;
  product_name: string;
  batch_no: string | null;
  expiry_date: string;
  qty: number;
}

export async function getExpiringSoonBatches(days = 180, limit = 12): Promise<ExpiringBatchRow[]> {
  return dbSelect<ExpiringBatchRow>(
    `
    SELECT pb.id, p.name AS product_name, pb.batch_no, pb.expiry_date, pb.qty
    FROM product_batches pb
    JOIN products p ON p.id = pb.product_id AND (p.tenant_id = pb.tenant_id OR p.tenant_id IS NULL)
    WHERE pb.deleted_at IS NULL AND pb.tenant_id = ? AND pb.qty > 0 AND pb.expiry_date IS NOT NULL
      AND date(pb.expiry_date) <= date('now', '+' || ? || ' days')
    ORDER BY pb.expiry_date ASC
    LIMIT ?
  `,
    [currentTenantId(), days, limit]
  );
}

export interface RecentInvoiceRow {
  id: string;
  invoice_no: number | null;
  date: string;
  customer_name: string;
  total: number;
  balance: number;
}

export async function getRecentInvoices(limit = 6): Promise<RecentInvoiceRow[]> {
  return dbSelect<RecentInvoiceRow>(
    `
    SELECT i.id, i.invoice_no, i.date, COALESCE(c.name, 'Walk-in') AS customer_name, i.total, i.balance
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 0 AND i.is_memorized = 0 AND i.is_quotation = 0
    ORDER BY i.created_at DESC
    LIMIT ?
  `,
    [currentTenantId(), limit]
  );
}

export interface TopProductRow {
  id: string;
  name: string;
  qty: number;
  sales: number;
}

/** Nets returns out of qty/sales per product. */
export async function getTopSellingProducts(limit = 5): Promise<TopProductRow[]> {
  return dbSelect<TopProductRow>(
    `
    SELECT p.id, p.name,
           SUM(CASE WHEN i.is_return = 0 THEN ii.qty ELSE -ii.qty END) AS qty,
           SUM(CASE WHEN i.is_return = 0 THEN ii.sale_price * ii.qty ELSE -ii.sale_price * ii.qty END) AS sales
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN products p ON p.id = ii.product_id AND (p.tenant_id = ii.tenant_id OR p.tenant_id IS NULL)
    WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_memorized = 0 AND i.is_quotation = 0
    GROUP BY p.id
    HAVING sales > 0
    ORDER BY sales DESC
    LIMIT ?
  `,
    [currentTenantId(), limit]
  );
}

export interface InventoryUnitRow {
  unit_type: string;
  product_count: number;
  total_qty: number;
}

/** Groups available stock by secondary-unit type. Scoped to the catalog
 * groups the current tenant can access. */
export async function getInventoryByUnitType(): Promise<InventoryUnitRow[]> {
  const tenantId = currentTenantId() ?? "";
  const { clause, params } = productScopeClause(tenantId);
  return dbSelect<InventoryUnitRow>(
    `
    SELECT
      COALESCE(su.name, u.name, 'Other') AS unit_type,
      COUNT(DISTINCT p.id) AS product_count,
      COALESCE(SUM(pb.qty), 0) AS total_qty
    FROM products p
    LEFT JOIN uoms su ON su.id = p.secondary_unit_id
    LEFT JOIN uoms u  ON u.id  = p.base_unit_id
    LEFT JOIN product_batches pb
           ON pb.product_id = p.id AND pb.tenant_id = ? AND pb.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND (${clause})
    GROUP BY COALESCE(su.name, u.name, 'Other')
    ORDER BY product_count DESC
    LIMIT 8
  `,
    [tenantId, ...params]
  );
}

export interface InventoryCategoryRow {
  category: string;
  product_count: number;
  total_qty: number;
}

/** Groups available stock by product category. Scoped to the catalog
 * groups the current tenant can access (general_store sees only
 * general_store categories, pharmacy sees pharma + general_store). */
export async function getInventoryByCategory(): Promise<InventoryCategoryRow[]> {
  const tenantId = currentTenantId() ?? "";
  const { clause, params } = productScopeClause(tenantId);
  return dbSelect<InventoryCategoryRow>(
    `
    SELECT
      COALESCE(c.name, 'Uncategorized') AS category,
      COUNT(DISTINCT p.id) AS product_count,
      COALESCE(SUM(pb.qty), 0) AS total_qty
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_batches pb
           ON pb.product_id = p.id AND pb.tenant_id = ? AND pb.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND (${clause})
    GROUP BY COALESCE(c.name, 'Uncategorized')
    ORDER BY product_count DESC
    LIMIT 8
  `,
    [tenantId, ...params]
  );
}

/** Counts products visible to the current tenant: own rows + allowed shared catalog. */
export async function countProducts(): Promise<number> {
  const tenantId = currentTenantId() ?? "";
  const { clause, params } = productScopeClause(tenantId);
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) as n FROM products WHERE deleted_at IS NULL AND (${clause})`,
    params
  );
  return rows[0]?.n ?? 0;
}

export interface TodaySummary {
  sales: number;
  invoiceCount: number;
  expenses: number;
  cashIn: number;
  cashOut: number;
}

export async function getTodaySummary(): Promise<TodaySummary> {
  const tenantId = currentTenantId();
  const [sales, expenses, cash] = await Promise.all([
    dbSelect<{ sales: number; n: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN is_return = 0 THEN total ELSE -total END), 0) AS sales,
         COALESCE(SUM(CASE WHEN is_return = 0 THEN 1 ELSE 0 END), 0) AS n
       FROM invoices
       WHERE deleted_at IS NULL AND tenant_id = ? AND is_memorized = 0 AND is_quotation = 0 AND date = date('now')`,
      [tenantId]
    ),
    dbSelect<{ n: number }>(
      `SELECT COALESCE(SUM(amount),0) AS n FROM expenses WHERE deleted_at IS NULL AND tenant_id = ? AND date = date('now')`,
      [tenantId]
    ),
    dbSelect<{ cash_in: number; cash_out: number }>(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type='in' THEN amount ELSE 0 END),0) AS cash_in,
              COALESCE(SUM(CASE WHEN transaction_type='out' THEN amount ELSE 0 END),0) AS cash_out
       FROM cash_register_entries WHERE deleted_at IS NULL AND tenant_id = ? AND date = date('now')`,
      [tenantId]
    ),
  ]);
  return {
    sales: sales[0]?.sales ?? 0,
    invoiceCount: sales[0]?.n ?? 0,
    expenses: expenses[0]?.n ?? 0,
    cashIn: cash[0]?.cash_in ?? 0,
    cashOut: cash[0]?.cash_out ?? 0,
  };
}