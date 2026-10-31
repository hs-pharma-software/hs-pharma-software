import { dbSelect } from "../db";
import { createTenantRepo, LINE_REFS } from "./base";
import { useAuthStore } from "../../store/authStore";
import type { OrderRow, OrderItem } from "../types2";

export const ordersRepo = createTenantRepo<OrderRow>("orders");
export const orderItemsRepo = createTenantRepo<OrderItem>("order_items", { refs: LINE_REFS });

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
 * Only this tenant's own products, with its own stock. */
export async function getLowStockForOrder(limit = 100): Promise<LowStockOrderRow[]> {
  const tenantId = currentTenantId();
  return dbSelect<LowStockOrderRow>(
    `
    SELECT * FROM (
      SELECT p.id, p.name, p.barcode, p.company_name,
             COALESCE((SELECT SUM(qty) FROM product_batches WHERE product_id = p.id AND tenant_id = ? AND deleted_at IS NULL), 0) AS avail_qty,
             p.max_stock_qty
      FROM products p
      WHERE p.deleted_at IS NULL AND p.tenant_id = ?
    )
    WHERE avail_qty <= COALESCE(max_stock_qty * 0.2, 10)
    ORDER BY avail_qty ASC
    LIMIT ?
  `,
    [tenantId, tenantId, limit]
  );
}

export async function listItemsForOrder(orderId: string) {
  return dbSelect(
    `
    SELECT oi.*, p.name AS product_name, p.barcode, u.name AS uom_name
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id AND (p.tenant_id = oi.tenant_id OR p.tenant_id IS NULL)
    LEFT JOIN uoms u ON u.id = oi.uom_id
    WHERE oi.order_id = ? AND oi.tenant_id = ? AND oi.deleted_at IS NULL
  `,
    [orderId, currentTenantId()]
  );
}

// ── Order status, numbering, stock-out orders, edit / delete / convert ─────

/** Orders the system raises for products whose stock ran out. */
export const AUTO_ORDER_TYPE = "Auto: stock out";

export interface OrderGridRow extends OrderListRow {
  supplier_id: string | null;
  order_type: string | null;
  item_count: number;
  /** The purchase this order was converted to, if any. */
  purchase_id: string | null;
  purchase_no: number | null;
}

/** Orders with their item count and, once converted, the purchase. */
export async function listOrdersWithStatus(): Promise<OrderGridRow[]> {
  return dbSelect<OrderGridRow>(
    `SELECT o.id, o.order_no, o.date, o.supplier_id, COALESCE(s.name, '-') AS supplier_name, COALESCE(o.estimated_price, 0) AS estimated_price,
            COALESCE(o.advance_payment, 0) AS advance_payment, o.payment_method, o.description, o.order_type,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.tenant_id = o.tenant_id AND oi.deleted_at IS NULL) AS item_count,
            (SELECT pu.id FROM purchases pu WHERE pu.order_id = o.id AND pu.tenant_id = o.tenant_id AND pu.deleted_at IS NULL LIMIT 1) AS purchase_id,
            (SELECT pu.purchase_no FROM purchases pu WHERE pu.order_id = o.id AND pu.tenant_id = o.tenant_id AND pu.deleted_at IS NULL LIMIT 1) AS purchase_no
     FROM orders o
     LEFT JOIN suppliers s ON s.id = o.supplier_id
     WHERE o.deleted_at IS NULL AND o.tenant_id = ?
     ORDER BY o.created_at DESC`,
    [currentTenantId()]
  );
}

export async function nextOrderNo(): Promise<number> {
  const rows = await dbSelect<{ n: number | null }>(`SELECT MAX(order_no) AS n FROM orders WHERE tenant_id = ?`, [currentTenantId()]);
  return (Number(rows[0]?.n) || 0) + 1;
}

export interface OrderLineInput {
  productId: string;
  packing: number | null;
  uomId: string | null;
  maxStockQty?: number | null;
  /** Base units (packs). */
  qty: number;
  /** Per base unit. */
  purchasePrice: number;
}

export interface OrderHeaderInput {
  supplierId: string;
  orderType: string;
  advancePayment: number;
  paymentMethod: string;
  description: string | null;
}

async function purchaseOfOrder(orderId: string): Promise<string | null> {
  const rows = await dbSelect<{ id: string }>(`SELECT id FROM purchases WHERE order_id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`, [orderId, currentTenantId()]);
  return rows[0]?.id ?? null;
}

/** Creates or edits an order (its lines are replaced). A converted order is not edited. */
export async function saveOrder(id: string | null, h: OrderHeaderInput, lines: OrderLineInput[], today: string): Promise<OrderRow> {
  if (!h.supplierId) throw new Error("Choose the supplier.");
  if (!lines.length) throw new Error("Add at least one product.");
  const header = {
    supplier_id: h.supplierId, order_type: h.orderType, estimated_price: lines.reduce((s, l) => s + l.purchasePrice * l.qty, 0),
    advance_payment: h.advancePayment || 0, payment_method: h.paymentMethod, bank_id: null, description: h.description?.trim() || null,
  };
  let order: OrderRow;
  if (id) {
    if (await purchaseOfOrder(id)) throw new Error("This order is already converted to a purchase; edit the purchase instead.");
    order = (await ordersRepo.update(id, header))!;
    for (const it of await orderItemsRepo.list({ where: "order_id = ?", params: [id] })) await orderItemsRepo.remove(it.id);
  } else {
    order = await ordersRepo.create({ ...header, date: today, order_no: await nextOrderNo() });
  }
  for (const l of lines) {
    await orderItemsRepo.create({
      order_id: order.id, product_id: l.productId, packing: l.packing ?? 1, uom_id: l.uomId, purchase_price: l.purchasePrice,
      qty: l.qty, avail_qty: null, max_stock_qty: l.maxStockQty ?? null,
    });
  }
  return order;
}

/** Deletes an order and its lines (a purchase made from it stays). */
export async function deleteOrder(orderId: string, reason?: string): Promise<void> {
  if (!(await ordersRepo.get(orderId))) throw new Error("Order not found.");
  for (const it of await orderItemsRepo.list({ where: "order_id = ?", params: [orderId] })) await orderItemsRepo.remove(it.id);
  await ordersRepo.remove(orderId, reason, "Order");
}

export interface OrderForPurchase {
  orderId: string;
  supplierId: string;
  /** Base units and per-base-unit rates. */
  lines: { productId: string; qty: number; purchasePrice: number }[];
}

/** An open order's supplier and lines, to fill the purchase form. */
export async function orderForPurchase(orderId: string): Promise<OrderForPurchase> {
  const o = await ordersRepo.get(orderId);
  if (!o) throw new Error("Order not found.");
  if (await purchaseOfOrder(orderId)) throw new Error("This order is already converted to a purchase.");
  const items = await orderItemsRepo.list({ where: "order_id = ?", params: [orderId], orderBy: "created_at ASC" });
  return {
    orderId, supplierId: o.supplier_id,
    lines: items.map((i) => ({ productId: i.product_id, qty: Number(i.qty) || 0, purchasePrice: Number(i.purchase_price) || 0 })),
  };
}

/** Raises orders for products that ran out of stock: every product this
 * business has bought before whose stock is now zero (or less), and that is
 * not on an open order already, goes on an order to the supplier of its last
 * purchase, with that purchase's quantity and rate. Products of one supplier
 * share one open stock-out order. */
export async function createStockOutOrders(today: string): Promise<{ products: number; orders: number }> {
  // One check at a time: two at once (two tabs, a reload mid-check) would both order the same products.
  const key = currentTenantId() ?? "";
  const running = stockOutRuns.get(key);
  if (running) return running;
  const run = (async () => {
    await mergeDuplicateAutoOrders();
    const r = await raiseStockOutOrders(today);
    // Another tab or device may have checked at the same moment: fold any copy in again.
    await mergeDuplicateAutoOrders();
    return r;
  })().finally(() => stockOutRuns.delete(key));
  stockOutRuns.set(key, run);
  return run;
}

const stockOutRuns = new Map<string, Promise<{ products: number; orders: number }>>();

/** Folds duplicate open stock-out orders of one supplier into the oldest: its
 * products are kept once, the copies are deleted. Returns how many were removed. */
export async function mergeDuplicateAutoOrders(): Promise<number> {
  const t = currentTenantId();
  const open = await dbSelect<{ id: string; supplier_id: string }>(
    `SELECT o.id, o.supplier_id FROM orders o
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND o.order_type = ?
       AND NOT EXISTS (SELECT 1 FROM purchases pu WHERE pu.order_id = o.id AND pu.deleted_at IS NULL)
     ORDER BY o.created_at ASC, o.id ASC`,
    [t, AUTO_ORDER_TYPE]
  );
  const keep = new Map<string, string>();
  let removed = 0;
  for (const o of open) {
    const kept = keep.get(o.supplier_id);
    if (!kept) { keep.set(o.supplier_id, o.id); continue; }
    const have = new Set((await orderItemsRepo.list({ where: "order_id = ?", params: [kept] })).map((i) => i.product_id));
    for (const it of await orderItemsRepo.list({ where: "order_id = ?", params: [o.id] })) {
      if (have.has(it.product_id)) await orderItemsRepo.remove(it.id);
      else { await orderItemsRepo.update(it.id, { order_id: kept }); have.add(it.product_id); }
    }
    await ordersRepo.remove(o.id, "Duplicate stock-out order merged", "Order");
    removed++;
  }
  if (!removed) return 0;
  // Bring the merged orders' estimates in step with their lines.
  for (const id of keep.values()) {
    const items = await orderItemsRepo.list({ where: "order_id = ?", params: [id] });
    await ordersRepo.update(id, { estimated_price: items.reduce((s, i) => s + (Number(i.purchase_price) || 0) * (Number(i.qty) || 0), 0) });
  }
  return removed;
}

async function raiseStockOutOrders(today: string): Promise<{ products: number; orders: number }> {
  const t = currentTenantId();
  type Last = { supplier_id: string; purchase_price: number; qty: number; packing: number | null; uom_id: string | null; max_stock_qty: number | null };
  const last = new Map<string, Last>();
  const bought = await dbSelect<Last & { product_id: string; received_qty: number }>(
    `SELECT pi.product_id, pu.supplier_id, pi.purchase_price, pi.received_qty, p.packing, p.base_unit_id AS uom_id, p.max_stock_qty
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     JOIN products p ON p.id = pi.product_id AND p.deleted_at IS NULL
     WHERE pi.tenant_id = ? AND pi.deleted_at IS NULL AND pu.deleted_at IS NULL AND COALESCE(pu.is_return, 0) = 0 AND pu.supplier_id IS NOT NULL
     ORDER BY pu.date ASC, pu.created_at ASC`,
    [t]
  );
  for (const b of bought) {
    last.set(b.product_id, {
      supplier_id: b.supplier_id, purchase_price: Number(b.purchase_price) || 0, qty: Number(b.received_qty) || 1,
      packing: b.packing, uom_id: b.uom_id, max_stock_qty: b.max_stock_qty,
    });
  }
  if (!last.size) return { products: 0, orders: 0 };
  const stock = new Map((await dbSelect<{ product_id: string; qty: number }>(
    `SELECT product_id, SUM(qty) AS qty FROM product_batches WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY product_id`, [t]
  )).map((r) => [r.product_id, Number(r.qty) || 0]));
  const onOrder = new Set((await dbSelect<{ product_id: string }>(
    `SELECT DISTINCT oi.product_id FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND oi.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM purchases pu WHERE pu.order_id = o.id AND pu.deleted_at IS NULL)`, [t]
  )).map((r) => r.product_id));

  const bySupplier = new Map<string, string[]>();
  for (const [productId, l] of last) {
    if ((stock.get(productId) ?? 0) > 1e-9 || onOrder.has(productId)) continue;
    bySupplier.set(l.supplier_id, [...(bySupplier.get(l.supplier_id) ?? []), productId]);
  }
  let products = 0;
  let orders = 0;
  for (const [supplierId, productIds] of bySupplier) {
    const open = (await dbSelect<{ id: string }>(
      `SELECT o.id FROM orders o WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND o.supplier_id = ? AND o.order_type = ?
         AND NOT EXISTS (SELECT 1 FROM purchases pu WHERE pu.order_id = o.id AND pu.deleted_at IS NULL)
       ORDER BY o.created_at DESC LIMIT 1`,
      [t, supplierId, AUTO_ORDER_TYPE]
    ))[0];
    const order = open ? (await ordersRepo.get(open.id))! : await ordersRepo.create({
      date: today, order_no: await nextOrderNo(), supplier_id: supplierId, order_type: AUTO_ORDER_TYPE, estimated_price: 0,
      advance_payment: 0, payment_method: "Cash", bank_id: null, description: "Raised automatically: stock ran out",
    });
    if (!open) orders++;
    let added = 0;
    for (const productId of productIds) {
      const l = last.get(productId)!;
      await orderItemsRepo.create({
        order_id: order.id, product_id: productId, packing: l.packing ?? 1, uom_id: l.uom_id, purchase_price: l.purchase_price,
        qty: l.qty, avail_qty: stock.get(productId) ?? 0, max_stock_qty: l.max_stock_qty,
      });
      added += l.purchase_price * l.qty;
      products++;
    }
    await ordersRepo.update(order.id, { estimated_price: (Number(order.estimated_price) || 0) + added });
  }
  return { products, orders };
}
