/** The Stock Register's search list and a product's in / out history, for
 * businesses that keep stock in batches (pharmacy, general store and the other
 * counters): purchases, sales, returns and branch transfers.
 *
 * Reading product_batches without UNION or WITH keeps these open to the logins
 * whose purchase prices are hidden (server/sqlPolicy.ts). */
import { dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { dayMonthYear, latestLast, oneMovePerDocument, type LedgerMove, type LedgerView, type SearchItem } from "../stockLedger";

interface ProductRow { id: string; name: string; barcode: string | null; company: string | null; generic: string | null; packing: number; unit: string | null; subUnit: string | null }

const PRODUCT_COLUMNS = `p.id, p.name, p.barcode, NULLIF(TRIM(p.company_name), '') AS company, NULLIF(TRIM(p.description), '') AS generic,
  COALESCE(p.packing, 1) AS packing, u.name AS unit, su.name AS subUnit`;
const UNIT_JOINS = `LEFT JOIN uoms u ON u.id = p.base_unit_id LEFT JOIN uoms su ON su.id = p.secondary_unit_id AND p.secondary_unit_id <> COALESCE(p.base_unit_id, '')`;

/** Every product this business has in stock or has bought (also when none is left), with all its distributors. */
export async function stockSearchItems(): Promise<SearchItem[]> {
  const T = requireCurrentTenantId();
  const [products, bought, assigned] = await Promise.all([
    dbSelect<ProductRow & { stock: number }>(
      `SELECT ${PRODUCT_COLUMNS}, COALESCE(st.q, 0) AS stock
       FROM products p ${UNIT_JOINS}
       LEFT JOIN (SELECT product_id, SUM(qty) AS q FROM product_batches WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY product_id) st ON st.product_id = p.id
       WHERE p.deleted_at IS NULL AND (p.tenant_id = ? OR p.tenant_id IS NULL)
         AND (st.product_id IS NOT NULL OR p.id IN (SELECT product_id FROM purchase_items WHERE tenant_id = ? AND deleted_at IS NULL))
       ORDER BY p.name COLLATE NOCASE`,
      [T, T, T]
    ),
    dbSelect<{ pid: string; name: string }>(
      `SELECT pi.product_id AS pid, s.name FROM purchase_items pi
       JOIN purchases pu ON pu.id = pi.purchase_id JOIN suppliers s ON s.id = pu.supplier_id
       WHERE pu.tenant_id = ? AND pu.deleted_at IS NULL AND pi.deleted_at IS NULL AND COALESCE(pu.is_return, 0) = 0
       ORDER BY pu.date, pu.created_at`,
      [T]
    ),
    dbSelect<{ pid: string; name: string }>(
      `SELECT ps.product_id AS pid, s.name FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
       WHERE ps.tenant_id = ? AND ps.deleted_at IS NULL ORDER BY s.name`,
      [T]
    ),
  ]);
  // Assigned suppliers first, then purchases oldest to latest: the last name is the current distributor.
  const names = latestLast([...assigned, ...bought]);
  return products.map((p) => ({
    id: p.id, name: p.name, codes: [p.barcode], company: p.company, generic: p.generic, distributors: names.get(p.id) ?? [],
    stock: Number(p.stock) || 0, units: { packing: p.packing, unit: p.unit, subUnit: p.subUnit },
  }));
}

interface Line { doc: string; d: string; at: string; ret: number; party: string | null; q: number; bonus: number; batch: string | null; no: string | number | null; extra: string | null; expiry?: string | null }

/** One movement per document: a bill with the product on several lines or batches shows once. */
function byDocument(lines: Line[], make: (first: Line, qty: number, details: string[]) => LedgerMove): LedgerMove[] {
  return oneMovePerDocument(lines.map((l) => ({ ...l, qty: Number(l.q) + Number(l.bonus) })), (l) => l.doc, (first, qty, ls) => {
    const batches = [...new Set(ls.filter((l) => l.batch).map((l) => `Batch ${l.batch}${l.expiry ? `, expiry ${dayMonthYear(l.expiry) || l.expiry}` : ""}`))];
    return make(first, qty, batches);
  });
}

/** A product's stock now and everything that brought it in or took it out. */
export async function productLedger(productId: string): Promise<LedgerView> {
  const T = requireCurrentTenantId();
  const [products, stock, purchases, sales, transfersOut, transfersIn] = await Promise.all([
    dbSelect<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM products p ${UNIT_JOINS} WHERE p.id = ? AND (p.tenant_id = ? OR p.tenant_id IS NULL)`, [productId, T]),
    dbSelect<{ q: number }>(`SELECT COALESCE(SUM(qty), 0) AS q FROM product_batches WHERE tenant_id = ? AND product_id = ? AND deleted_at IS NULL`, [T, productId]),
    dbSelect<Line>(
      `SELECT pu.id AS doc, substr(pu.date, 1, 10) AS d, pu.created_at AS at, COALESCE(pu.is_return, 0) AS ret, s.name AS party,
              COALESCE(NULLIF(pi.received_qty, 0), pi.booked_qty, 0) AS q, COALESCE(pi.bonus_qty, 0) AS bonus, pi.batch_no AS batch, pi.expiry_date AS expiry,
              pu.purchase_no AS no, pu.supplier_invoice_no AS extra
       FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id LEFT JOIN suppliers s ON s.id = pu.supplier_id
       WHERE pu.tenant_id = ? AND pi.product_id = ? AND pu.deleted_at IS NULL AND pi.deleted_at IS NULL`,
      [T, productId]
    ),
    dbSelect<Line>(
      `SELECT i.id AS doc, substr(i.date, 1, 10) AS d, i.created_at AS at, COALESCE(i.is_return, 0) AS ret,
              COALESCE(c.name, NULLIF(TRIM(i.customer_name), '')) AS party,
              COALESCE(ii.qty, 0) AS q, COALESCE(ii.bonus_qty, 0) AS bonus, ii.batch_no AS batch, i.invoice_no AS no, i.offline_ref AS extra
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.tenant_id = ? AND ii.product_id = ? AND i.deleted_at IS NULL AND ii.deleted_at IS NULL
         AND COALESCE(i.is_memorized, 0) = 0 AND COALESCE(i.is_quotation, 0) = 0`,
      [T, productId]
    ),
    // Branch transfers: this branch's batches are the only ones it can read, so only its own side shows.
    dbSelect<Line>(
      `SELECT t.id AS doc, substr(t.dispatched_at, 1, 10) AS d, t.dispatched_at AS at, 0 AS ret, b.name AS party,
              it.qty AS q, 0 AS bonus, it.batch_no AS batch, t.transfer_no AS no, NULL AS extra
       FROM branch_transfer_items it JOIN branch_transfers t ON t.id = it.transfer_id LEFT JOIN branches b ON b.id = t.to_branch_id
       WHERE it.tenant_id = ? AND it.product_id = ? AND t.status <> 'cancelled'
         AND it.source_batch_id IN (SELECT id FROM product_batches WHERE tenant_id = ?)`,
      [T, productId, T]
    ).catch(() => [] as Line[]),
    dbSelect<Line>(
      `SELECT t.id AS doc, substr(t.received_at, 1, 10) AS d, t.received_at AS at, 0 AS ret, b.name AS party,
              COALESCE(it.received_qty, 0) AS q, 0 AS bonus, it.batch_no AS batch, t.transfer_no AS no, NULL AS extra
       FROM branch_transfer_items it JOIN branch_transfers t ON t.id = it.transfer_id LEFT JOIN branches b ON b.id = t.from_branch_id
       WHERE it.tenant_id = ? AND it.product_id = ? AND t.status IN ('received', 'received_short') AND COALESCE(it.received_qty, 0) > 0
         AND it.dest_batch_id IN (SELECT id FROM product_batches WHERE tenant_id = ?)`,
      [T, productId, T]
    ).catch(() => [] as Line[]),
  ]);
  const p = products[0];
  if (!p) throw new Error("This product was not found.");
  const number = (l: Line) => l.no ?? l.extra ?? "";
  const bonusNote = (lines: Line[], doc: string) => {
    const bonus = lines.filter((l) => l.doc === doc).reduce((s, l) => s + Number(l.bonus), 0);
    return bonus > 0 ? [`Includes ${Math.round(bonus * Number(p.packing || 1) * 100) / 100} ${p.subUnit && p.packing > 1 ? p.subUnit : p.unit ?? ""} bonus`.trim()] : [];
  };
  const moves: LedgerMove[] = [
    ...byDocument(purchases, (l, qty, details) => ({
      id: `pu-${l.doc}`, date: l.d, at: l.at, kind: l.ret ? "purchase_return" : "purchase", label: l.ret ? "Returned to distributor" : "Purchased",
      qty: l.ret ? -qty : qty, supplied: !l.ret,
      ref: [l.no != null ? `Purchase #${l.no}` : "", l.extra ? `Bill ${l.extra}` : ""].filter(Boolean).join(" · ") || null,
      party: l.party, details: [...details, ...bonusNote(purchases, l.doc)],
    })),
    ...byDocument(sales, (l, qty, details) => ({
      id: `in-${l.doc}`, date: l.d, at: l.at, kind: l.ret ? "sale_return" : "sale", label: l.ret ? "Sale return" : "Sold",
      qty: l.ret ? qty : -qty, ref: number(l) !== "" ? `Invoice #${number(l)}` : null, party: l.party ?? "Walk-in customer",
      details: [...details, ...bonusNote(sales, l.doc)],
    })),
    ...byDocument(transfersOut, (l, qty, details) => ({
      id: `to-${l.doc}`, date: l.d, at: l.at, kind: "transfer_out", label: "Sent to branch", qty: -qty, ref: `Transfer #${l.no}`, party: l.party, details,
    })),
    ...byDocument(transfersIn, (l, qty, details) => ({
      id: `ti-${l.doc}`, date: l.d, at: l.at, kind: "transfer_in", label: "Received from branch", qty, ref: `Transfer #${l.no}`, party: l.party, details,
    })),
  ];
  return {
    name: p.name, company: p.company, generic: p.generic, units: { packing: Number(p.packing) || 1, unit: p.unit, subUnit: p.subUnit },
    available: Number(stock[0]?.q) || 0, moves,
  };
}

export interface LastPurchase { supplierId: string; supplier: string; date: string }

/** Each product's latest purchase (returns apart), to point out a new distributor while a purchase is entered. */
export async function lastPurchases(productIds: string[]): Promise<Map<string, LastPurchase>> {
  const ids = [...new Set(productIds)];
  const map = new Map<string, LastPurchase>();
  if (!ids.length) return map;
  const rows = await dbSelect<{ pid: string; supplierId: string; supplier: string; date: string }>(
    `SELECT pi.product_id AS pid, pu.supplier_id AS supplierId, s.name AS supplier, substr(pu.date, 1, 10) AS date
     FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id JOIN suppliers s ON s.id = pu.supplier_id
     WHERE pu.tenant_id = ? AND pi.product_id IN (${ids.map(() => "?").join(", ")}) AND pu.deleted_at IS NULL AND pi.deleted_at IS NULL AND COALESCE(pu.is_return, 0) = 0
     ORDER BY pu.date, pu.created_at`,
    [requireCurrentTenantId(), ...ids]
  );
  for (const r of rows) map.set(r.pid, { supplierId: r.supplierId, supplier: r.supplier, date: r.date });
  return map;
}
