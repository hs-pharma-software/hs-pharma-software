/** Pharmacy stock reports: Stock in Hand, Stock Register and Dead Stock, by
 * product, company, distributor or generic name.
 *
 * - Stock in Hand: what is on the shelves now (batches with stock), at
 *   purchase cost and at the latest sale price.
 * - Stock Register: what came in (purchases, sale returns) and went out
 *   (sales, purchase returns) in a period, with the stock at its start and end
 *   worked out from those movements and today's stock.
 * - Dead Stock: products with stock that sold nothing in a period.
 *
 * A product's distributor is the supplier of its latest purchase, else the
 * supplier it is assigned to; its generic name is the product's description. */
import { dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";

export type StockGroup = "product" | "company" | "distributor" | "generic";
export const STOCK_GROUPS: Record<StockGroup, string> = { product: "Product wise", company: "Company wise", distributor: "Distributor wise", generic: "Generic name wise" };

const NONE: Record<StockGroup, string> = { product: "", company: "No company", distributor: "No distributor", generic: "No generic name" };

/** SQL for a product's distributor (latest purchase's supplier, else an assigned one). */
const DISTRIBUTOR = `COALESCE(
  (SELECT s.name FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id JOIN suppliers s ON s.id = pu.supplier_id
   WHERE pi.product_id = p.id AND pu.tenant_id = ? AND pu.deleted_at IS NULL AND pi.deleted_at IS NULL AND COALESCE(pu.is_return, 0) = 0
   ORDER BY pu.date DESC, pu.created_at DESC LIMIT 1),
  (SELECT MIN(s.name) FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id WHERE ps.product_id = p.id AND ps.tenant_id = ? AND ps.deleted_at IS NULL))`;

/** Latest sale price per product (the Stock page's rule). */
const LATEST_PRICE = `SELECT product_id, sale_price, MAX(created_at) AS at FROM price_list WHERE deleted_at IS NULL AND tenant_id = ? GROUP BY product_id`;

export interface StockProductRow {
  id: string;
  name: string;
  company: string | null;
  generic: string | null;
  distributor: string | null;
  qty: number;
  packing: number;
  cost: number;
  retail: number;
  batches: number;
  nearestExpiry: string | null;
}

export interface StockGroupRow { id: string; label: string; products: number; qty: number; cost: number; retail: number }

/** Products with stock now, with their value at cost and at sale price. */
export async function stockInHandProducts(search = ""): Promise<StockProductRow[]> {
  const T = requireCurrentTenantId();
  const q = search.trim();
  return dbSelect<StockProductRow>(
    `SELECT p.id, p.name, NULLIF(TRIM(p.company_name), '') AS company, NULLIF(TRIM(p.description), '') AS generic,
            ${DISTRIBUTOR} AS distributor,
            SUM(pb.qty) AS qty, MAX(COALESCE(p.packing, 1)) AS packing,
            SUM(pb.qty * COALESCE(pb.purchase_price, 0)) AS cost,
            SUM(pb.qty) * COALESCE(MAX(pl.sale_price), 0) AS retail,
            COUNT(*) AS batches, MIN(pb.expiry_date) AS nearestExpiry
     FROM product_batches pb
     JOIN products p ON p.id = pb.product_id AND (p.tenant_id = pb.tenant_id OR p.tenant_id IS NULL)
     LEFT JOIN (${LATEST_PRICE}) pl ON pl.product_id = p.id
     WHERE pb.tenant_id = ? AND pb.deleted_at IS NULL AND pb.qty > 0
       ${q ? "AND (p.name LIKE ? OR p.barcode LIKE ? OR p.description LIKE ? OR p.company_name LIKE ?)" : ""}
     GROUP BY p.id
     ORDER BY p.name COLLATE NOCASE`,
    [T, T, T, T, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [])]
  );
}

/** Stock in Hand totals per company, distributor or generic name. */
export function groupStock(rows: StockProductRow[], by: Exclude<StockGroup, "product">): StockGroupRow[] {
  const m = new Map<string, StockGroupRow>();
  for (const r of rows) {
    const label = (by === "company" ? r.company : by === "distributor" ? r.distributor : r.generic) || NONE[by];
    const g = m.get(label) ?? { id: label, label, products: 0, qty: 0, cost: 0, retail: 0 };
    g.products += 1;
    g.qty += r.qty;
    g.cost += r.cost;
    g.retail += r.retail;
    m.set(label, g);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost);
}

export interface RegisterRow {
  id: string;
  name: string;
  company: string | null;
  generic: string | null;
  distributor: string | null;
  packing: number;
  opening: number;
  received: number;
  saleReturns: number;
  sold: number;
  purchaseReturns: number;
  closing: number;
}
export interface RegisterGroupRow { id: string; label: string; products: number; opening: number; received: number; saleReturns: number; sold: number; purchaseReturns: number; closing: number }

/** Movements per product in a period (quantities in packs, bonus included), opening and closing worked out from today's stock. */
export async function stockRegister(from: string, to: string, search = ""): Promise<RegisterRow[]> {
  const T = requireCurrentTenantId();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Choose the From and To dates.");
  if (to < from) throw new Error("The To date is before the From date.");
  const q = search.trim();
  // Each movement once, signed for stock: + in, - out. "after" = after the period (to work back from today's stock).
  const rows = await dbSelect<{
    id: string; name: string; company: string | null; generic: string | null; distributor: string | null; packing: number; now_qty: number;
    received: number; sale_returns: number; sold: number; purchase_returns: number; net_after: number;
  }>(
    `WITH moves AS (
       SELECT pi.product_id AS pid, substr(pu.date, 1, 10) AS d,
              CASE WHEN COALESCE(pu.is_return, 0) = 1 THEN 'pret' ELSE 'pin' END AS kind,
              COALESCE(NULLIF(pi.received_qty, 0), pi.booked_qty, 0) + COALESCE(pi.bonus_qty, 0) AS q
       FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
       WHERE pu.tenant_id = ? AND pu.deleted_at IS NULL AND pi.deleted_at IS NULL
       UNION ALL
       SELECT ii.product_id, substr(i.date, 1, 10),
              CASE WHEN COALESCE(i.is_return, 0) = 1 THEN 'sret' ELSE 'sale' END,
              COALESCE(ii.qty, 0) + COALESCE(ii.bonus_qty, 0)
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.tenant_id = ? AND i.deleted_at IS NULL AND ii.deleted_at IS NULL AND COALESCE(i.is_memorized, 0) = 0 AND COALESCE(i.is_quotation, 0) = 0
     ),
     stock AS (SELECT product_id AS pid, SUM(qty) AS q FROM product_batches WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY product_id)
     SELECT p.id, p.name, NULLIF(TRIM(p.company_name), '') AS company, NULLIF(TRIM(p.description), '') AS generic, ${DISTRIBUTOR} AS distributor,
            COALESCE(p.packing, 1) AS packing, COALESCE(st.q, 0) AS now_qty,
            COALESCE(SUM(CASE WHEN m.d BETWEEN ? AND ? AND m.kind = 'pin' THEN m.q END), 0) AS received,
            COALESCE(SUM(CASE WHEN m.d BETWEEN ? AND ? AND m.kind = 'sret' THEN m.q END), 0) AS sale_returns,
            COALESCE(SUM(CASE WHEN m.d BETWEEN ? AND ? AND m.kind = 'sale' THEN m.q END), 0) AS sold,
            COALESCE(SUM(CASE WHEN m.d BETWEEN ? AND ? AND m.kind = 'pret' THEN m.q END), 0) AS purchase_returns,
            COALESCE(SUM(CASE WHEN m.d > ? THEN (CASE WHEN m.kind IN ('pin', 'sret') THEN m.q ELSE -m.q END) END), 0) AS net_after
     FROM products p
     LEFT JOIN moves m ON m.pid = p.id
     LEFT JOIN stock st ON st.pid = p.id
     WHERE p.deleted_at IS NULL AND (p.tenant_id = ? OR p.tenant_id IS NULL)
       AND (st.pid IS NOT NULL OR m.pid IS NOT NULL)
       ${q ? "AND (p.name LIKE ? OR p.barcode LIKE ? OR p.description LIKE ? OR p.company_name LIKE ?)" : ""}
     GROUP BY p.id
     HAVING received + sale_returns + sold + purchase_returns + now_qty <> 0
     ORDER BY p.name COLLATE NOCASE`,
    [T, T, T, T, T, from, to, from, to, from, to, from, to, to, T, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [])]
  );
  return rows.map((r) => {
    const closing = r.now_qty - r.net_after;
    const opening = closing - r.received - r.sale_returns + r.sold + r.purchase_returns;
    return {
      id: r.id, name: r.name, company: r.company, generic: r.generic, distributor: r.distributor, packing: r.packing || 1,
      opening, received: r.received, saleReturns: r.sale_returns, sold: r.sold, purchaseReturns: r.purchase_returns, closing,
    };
  });
}

export function groupRegister(rows: RegisterRow[], by: Exclude<StockGroup, "product">): RegisterGroupRow[] {
  const m = new Map<string, RegisterGroupRow>();
  for (const r of rows) {
    const label = (by === "company" ? r.company : by === "distributor" ? r.distributor : r.generic) || NONE[by];
    const g = m.get(label) ?? { id: label, label, products: 0, opening: 0, received: 0, saleReturns: 0, sold: 0, purchaseReturns: 0, closing: 0 };
    g.products += 1;
    g.opening += r.opening;
    g.received += r.received;
    g.saleReturns += r.saleReturns;
    g.sold += r.sold;
    g.purchaseReturns += r.purchaseReturns;
    g.closing += r.closing;
    m.set(label, g);
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export interface DeadStockRow extends StockProductRow { lastSale: string | null }

/** Products with stock that sold nothing since `since` (yyyy-mm-dd), oldest last sale first. */
export async function deadStock(since: string): Promise<DeadStockRow[]> {
  const T = requireCurrentTenantId();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("Choose the date.");
  const stock = await stockInHandProducts();
  if (!stock.length) return [];
  const sales = await dbSelect<{ pid: string; last: string }>(
    `SELECT ii.product_id AS pid, MAX(substr(i.date, 1, 10)) AS last
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
     WHERE i.tenant_id = ? AND i.deleted_at IS NULL AND ii.deleted_at IS NULL
       AND COALESCE(i.is_return, 0) = 0 AND COALESCE(i.is_memorized, 0) = 0 AND COALESCE(i.is_quotation, 0) = 0
     GROUP BY ii.product_id`,
    [T]
  );
  const last = new Map(sales.map((s) => [s.pid, s.last]));
  return stock
    .map((r) => ({ ...r, lastSale: last.get(r.id) ?? null }))
    .filter((r) => !r.lastSale || r.lastSale < since)
    .sort((a, b) => (a.lastSale ?? "").localeCompare(b.lastSale ?? "") || b.cost - a.cost);
}
