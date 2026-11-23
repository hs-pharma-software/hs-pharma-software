/** The pharmacy dashboard's pop-up: today's sale and profit, the last day's
 * sale, and products whose sale or purchase rate changed. Rate changes come
 * from history (no table of their own): every sale price is a new price_list
 * row, every purchase line keeps its rate, so a change is a row whose rate
 * differs from the one before it for the same product. */
import { dbSelect } from "../db";
import { localDate } from "../localDate";
import { requireCurrentTenantId } from "./base";
import { getBusinessProfitLoss } from "./reports";

export interface DayFigures {
  date: string;
  sales: number;
  profit: number;
  invoices: number;
}

async function dayFigures(date: string): Promise<DayFigures> {
  const T = requireCurrentTenantId();
  const [pl, n] = await Promise.all([
    getBusinessProfitLoss(date, date),
    dbSelect<{ n: number }>(
      `SELECT COUNT(*) AS n FROM invoices WHERE tenant_id = ? AND deleted_at IS NULL AND substr(date, 1, 10) = ?
         AND COALESCE(is_return, 0) = 0 AND COALESCE(is_memorized, 0) = 0 AND COALESCE(is_quotation, 0) = 0`,
      [T, date]
    ),
  ]);
  const metric = (id: string) => Number(pl.find((m) => m.id === id)?.amount ?? 0);
  return { date, sales: metric("1"), profit: metric("3"), invoices: Number(n[0]?.n ?? 0) };
}

/** Today's sale and gross profit (sales less returns, at cost), and the last earlier day that had a sale. */
export async function pharmacyDaySummary(today = localDate()): Promise<{ today: DayFigures; lastDay: DayFigures | null }> {
  const T = requireCurrentTenantId();
  const last = await dbSelect<{ d: string | null }>(
    `SELECT MAX(substr(date, 1, 10)) AS d FROM invoices WHERE tenant_id = ? AND deleted_at IS NULL AND substr(date, 1, 10) < ?
       AND COALESCE(is_return, 0) = 0 AND COALESCE(is_memorized, 0) = 0 AND COALESCE(is_quotation, 0) = 0`,
    [T, today]
  );
  const lastDate = last[0]?.d ?? null;
  const [t, l] = await Promise.all([dayFigures(today), lastDate ? dayFigures(lastDate) : Promise.resolve(null)]);
  return { today: t, lastDay: l };
}

export interface RateChange {
  key: string;
  productId: string;
  productName: string;
  company: string | null;
  kind: "sale" | "purchase";
  oldRate: number;
  newRate: number;
  /** When the change was recorded (ISO). */
  at: string;
  /** Purchase changes: the supplier of the purchase with the new rate. */
  supplier: string | null;
}

/** Sale-rate (and, when allowed, purchase-rate) changes recorded since `sinceIso`, newest first. */
export async function rateChanges(sinceIso: string, includePurchase: boolean, limit = 100): Promise<RateChange[]> {
  const T = requireCurrentTenantId();
  const sale = await dbSelect<{ id: string; product_id: string; name: string; company: string | null; old: number; new: number; at: string }>(
    `SELECT x.id, x.product_id, p.name, NULLIF(TRIM(p.company_name), '') AS company, x.old, x.new, x.at FROM (
       SELECT pl.id, pl.product_id, pl.sale_price AS new, pl.created_at AS at,
              LAG(pl.sale_price) OVER (PARTITION BY pl.product_id ORDER BY pl.created_at, pl.id) AS old
       FROM price_list pl
       WHERE pl.tenant_id = ? AND pl.deleted_at IS NULL
         AND pl.product_id IN (SELECT product_id FROM price_list WHERE tenant_id = ? AND deleted_at IS NULL AND created_at >= ?)
     ) x JOIN products p ON p.id = x.product_id
     WHERE x.at >= ? AND x.old IS NOT NULL AND ABS(COALESCE(x.new, 0) - COALESCE(x.old, 0)) >= 0.005
     ORDER BY x.at DESC LIMIT ?`,
    [T, T, sinceIso, sinceIso, limit]
  );
  const out: RateChange[] = sale.map((r) => ({
    key: `s:${r.id}`, productId: r.product_id, productName: r.name, company: r.company, kind: "sale",
    oldRate: Number(r.old) || 0, newRate: Number(r.new) || 0, at: r.at, supplier: null,
  }));
  if (includePurchase) {
    // Lines of the same unit only (a strip's rate is not a pack's); returns are not purchases.
    const pur = await dbSelect<{ id: string; product_id: string; name: string; company: string | null; old: number; new: number; at: string; supplier: string | null }>(
      `SELECT x.id, x.product_id, p.name, NULLIF(TRIM(p.company_name), '') AS company, x.old, x.new, x.at, s.name AS supplier FROM (
         SELECT pi.id, pi.product_id, pi.purchase_price AS new, pu.created_at AS at, pu.supplier_id,
                LAG(pi.purchase_price) OVER (PARTITION BY pi.product_id, COALESCE(pi.uom_id, '') ORDER BY pu.date, pu.created_at, pi.id) AS old
         FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
         WHERE pu.tenant_id = ? AND pu.deleted_at IS NULL AND pi.deleted_at IS NULL AND COALESCE(pu.is_return, 0) = 0
           AND COALESCE(pi.purchase_price, 0) > 0
           AND pi.product_id IN (SELECT pi2.product_id FROM purchase_items pi2 JOIN purchases pu2 ON pu2.id = pi2.purchase_id
                                 WHERE pu2.tenant_id = ? AND pu2.deleted_at IS NULL AND pi2.deleted_at IS NULL AND pu2.created_at >= ?)
       ) x JOIN products p ON p.id = x.product_id
       LEFT JOIN suppliers s ON s.id = x.supplier_id
       WHERE x.at >= ? AND x.old IS NOT NULL AND ABS(COALESCE(x.new, 0) - COALESCE(x.old, 0)) >= 0.005
       ORDER BY x.at DESC LIMIT ?`,
      [T, T, sinceIso, sinceIso, limit]
    );
    for (const r of pur) {
      out.push({
        key: `p:${r.id}`, productId: r.product_id, productName: r.name, company: r.company, kind: "purchase",
        oldRate: Number(r.old) || 0, newRate: Number(r.new) || 0, at: r.at, supplier: r.supplier,
      });
    }
    out.sort((a, b) => b.at.localeCompare(a.at));
  }
  return out.slice(0, limit);
}
