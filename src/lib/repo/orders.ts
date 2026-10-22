import { dbSelect } from "../db";
import { createTenantRepo } from "./base";
import { useAuthStore } from "../../store/authStore";
import type { OrderRow, OrderItem } from "../types2";

export const ordersRepo = createTenantRepo<OrderRow>("orders");
export const orderItemsRepo = createTenantRepo<OrderItem>("order_items");

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

export interface OrderListRow {
  id: string;
  order_no: number | null;
  date: string;
  supplier_name: string;
  estimated_price: number;
  advance_payment: number;
  payment_method: string | null;
  description: string | null;
}

export async function listOrdersForGrid(): Promise<OrderListRow[]> {
  return dbSelect<OrderListRow>(
    `
    SELECT o.id, o.order_no, o.date, s.name AS supplier_name, o.estimated_price, o.advance_payment, o.payment_method, o.description
    FROM orders o
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.deleted_at IS NULL AND o.tenant_id = ?
    ORDER BY o.created_at DESC
  `,
    [currentTenantId()]
  );
}

export interface LowStockOrderRow {
  id: string;
  name: string;
  barcode: string | null;
  company_name: string | null;
  avail_qty: number;
  max_stock_qty: number | null;
}

/** Same low-stock threshold as the Dashboard widget (20% of max_stock_qty,
 * or a flat 10-unit fallback when a product never got one configured) \u2014 kept
 * here too so the Order screen can drive "add to purchase" straight off it.
 * `avail_qty` is this tenant's own stock of an otherwise-shared product. */
export async function getLowStockForOrder(limit = 100): Promise<LowStockOrderRow[]> {
  const tenantId = currentTenantId();
  return dbSelect<LowStockOrderRow>(
    `
    SELECT * FROM (
      SELECT p.id, p.name, p.barcode, p.company_name,
             COALESCE((SELECT SUM(qty) FROM product_batches WHERE product_id = p.id AND tenant_id = ? AND deleted_at IS NULL), 0) AS avail_qty,
             p.max_stock_qty
      FROM products p
      WHERE p.deleted_at IS NULL
    )
    WHERE avail_qty <= COALESCE(max_stock_qty * 0.2, 10)
    ORDER BY avail_qty ASC
    LIMIT ?
  `,
    [tenantId, limit]
  );
}

export async function listItemsForOrder(orderId: string) {
  return dbSelect(
    `
    SELECT oi.*, p.name AS product_name, p.barcode, u.name AS uom_name
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN uoms u ON u.id = oi.uom_id
    WHERE oi.order_id = ? AND oi.tenant_id = ? AND oi.deleted_at IS NULL
  `,
    [orderId, currentTenantId()]
  );
}
