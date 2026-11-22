/** The website's Reports (src/lib/repo/reports.ts, /reports/*) for the MAVIN
 * Business app: the same SQL and the same rules (returns subtract, drafts and
 * quotations are not sales, a line's share of the bill discount), run through
 * `run` (runForCaller in production: the same policy, business and branch
 * scoping as the web). Each report answers in one shape the app draws:
 * columns, rows and totals. */
import { HttpError } from "./db";
import { partyBalance } from "./appReads";
import type { Res, Runner } from "./appDocs";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

type Row = Record<string, unknown>;
const rowsOf = (r: Res | undefined): Row[] => (r ? r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) : []);
const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type ColumnKind = "text" | "money" | "qty";
export interface ReportColumn { key: string; label: string; kind: ColumnKind }
export interface AppReport {
  key: string;
  title: string;
  /** "range": From and To; "asOf": one date (Balance Sheet); "none": all time (Trial Balance). */
  dates: "range" | "asOf" | "none";
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  /** The sum of each money / qty column, when adding them up means something. */
  totals: Record<string, number> | null;
  /** Rows shown as headings or totals (Balance Sheet, Business P/L). */
  strongRows?: number[];
  note?: string;
}

/** The reports, in the website's menu order (config/nav.ts). */
export const REPORTS = [
  { key: "business-profit-loss", title: "Business Wise Profit/Loss" },
  { key: "product-profit-loss", title: "Product Wise Profit/Loss" },
  { key: "company-profit-loss", title: "Company Wise Profit/Loss" },
  { key: "category-profit-loss", title: "Category Wise Profit/Loss" },
  { key: "sub-category-profit-loss", title: "Sub Category Wise Profit/Loss" },
  { key: "customer-profit-loss", title: "Customer Wise Profit/Loss" },
  { key: "tax", title: "Tax Reports" },
  { key: "bonus-discount", title: "Bonus Claim And Discount Report" },
  { key: "product-sales", title: "Product Wise Sales Report" },
  { key: "category-sales", title: "Category Wise Sales" },
  { key: "trial-balance", title: "Trial Balance Report" },
  { key: "balance-sheet", title: "Balance Sheet" },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateFilter(column: string, from: string | null, to: string | null) {
  const parts: string[] = [];
  const params: string[] = [];
  if (from) { parts.push(`${column} >= ?`); params.push(from); }
  if (to) { parts.push(`${column} <= ?`); params.push(to); }
  return { clause: parts.length ? `AND ${parts.join(" AND ")}` : "", params };
}

/** An invoice's sale after its discounts (gross less line and bill discounts). */
const NET = `(i.total - COALESCE(i.discount_rs, 0) - COALESCE((SELECT SUM(d.discount_rs) FROM invoice_items d WHERE d.invoice_id = i.id AND d.deleted_at IS NULL), 0))`;
/** A line's sale after its own discount and its share of the bill discount. */
const LINE_NET = "(COALESCE(ii.sale_price, 0) * COALESCE(ii.qty, 0) - COALESCE(ii.discount_rs, 0))";
const BILL_LINES = "(SELECT SUM(COALESCE(x.sale_price, 0) * COALESCE(x.qty, 0) - COALESCE(x.discount_rs, 0)) FROM invoice_items x WHERE x.invoice_id = i.id AND x.deleted_at IS NULL)";
const LINE_SALE = `(${LINE_NET} - COALESCE(i.discount_rs, 0) * ${LINE_NET} / NULLIF(${BILL_LINES}, 0))`;
const SIGN = "CASE WHEN i.is_return = 0 THEN 1 ELSE -1 END";
const SOLD = "i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_memorized = 0 AND i.is_quotation = 0";

const money = (key: string, label: string): ReportColumn => ({ key, label, kind: "money" });
const text = (key: string, label: string): ReportColumn => ({ key, label, kind: "text" });
const qty = (key: string, label: string): ReportColumn => ({ key, label, kind: "qty" });

function sumCols(rows: Record<string, string | number | null>[], cols: ReportColumn[]) {
  const t: Record<string, number> = {};
  for (const c of cols) if (c.kind !== "text") t[c.key] = r2(rows.reduce((s, r) => s + num(r[c.key]), 0));
  return t;
}

export async function appReport(run: Runner, tenantId: string, key: string, from: string | null, to: string | null): Promise<AppReport> {
  const meta = REPORTS.find((x) => x.key === key);
  if (!meta) throw new HttpError(404, "Report not found.");
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new HttpError(400, "Invalid date.");
  const T = tenantId;
  const inv = dateFilter("i.date", from, to);
  const base = { key: meta.key, title: meta.title, dates: "range" as const };

  if (key === "business-profit-loss") {
    const ex = dateFilter("date", from, to);
    const sold = (ret: 0 | 1) => `SELECT SUM(${NET}) FROM invoices i WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = ${ret} AND i.is_memorized = 0 AND i.is_quotation = 0 ${inv.clause}`;
    const cost = (ret: 0 | 1) => `SELECT SUM(ii.purchase_price * ii.qty) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = ${ret} AND i.is_memorized = 0 AND i.is_quotation = 0 ${inv.clause}`;
    const [s, e, v, d] = await run([
      { sql: `SELECT COALESCE((${sold(0)}), 0) AS sales, COALESCE((${sold(1)}), 0) AS returns, COALESCE((${cost(0)}), 0) AS cogs, COALESCE((${cost(1)}), 0) AS cogs_return`, args: [T, ...inv.params, T, ...inv.params, T, ...inv.params, T, ...inv.params] },
      { sql: `SELECT COALESCE(SUM(amount), 0) AS n FROM expenses WHERE deleted_at IS NULL AND tenant_id = ? ${ex.clause}`, args: [T, ...ex.params] },
      { sql: `SELECT COALESCE(SUM(amount), 0) AS n FROM revenues WHERE deleted_at IS NULL AND tenant_id = ? ${ex.clause}`, args: [T, ...ex.params] },
      { sql: `SELECT COUNT(*) AS n, COALESCE(SUM(${NET}), 0) AS total, COALESCE(SUM(i.paid), 0) AS paid,
                     COALESCE((SELECT SUM(ii.purchase_price * ii.qty) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                               WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_memorized = 1 AND i.is_return = 0 AND i.is_quotation = 0 ${inv.clause}), 0) AS cogs
              FROM invoices i WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_memorized = 1 AND i.is_return = 0 AND i.is_quotation = 0 ${inv.clause}`, args: [T, ...inv.params, T, ...inv.params] },
    ], false);
    const x = rowsOf(s)[0] ?? {};
    const netSales = num(x.sales) - num(x.returns);
    const netCogs = num(x.cogs) - num(x.cogs_return);
    const gross = netSales - netCogs;
    const expenses = num(rowsOf(e)[0]?.n);
    const other = num(rowsOf(v)[0]?.n);
    const dr = rowsOf(d)[0] ?? {};
    const drafts = num(dr.n);
    const draftTotal = num(dr.total);
    const draftPaid = num(dr.paid);
    const draftProfit = draftTotal - num(dr.cogs);
    const rows = [
      ["Net Sales", netSales], ["Cost of Goods Sold", netCogs], ["Gross Profit", gross], ["Expenses", expenses], ["Other Revenue", other],
      ["Net Profit / Loss", gross - expenses + other],
      [`Memorized Invoices Total (${drafts} draft${drafts === 1 ? "" : "s"}, not in sales)`, draftTotal],
      ["Memorized Invoices Profit (if converted)", draftProfit],
      ["Memorized Invoices Paid", draftPaid],
      ["Profit on Paid Amount", draftTotal > 0 ? r2(draftProfit * (Math.min(draftPaid, draftTotal) / draftTotal)) : 0],
    ].map(([metric, amount]) => ({ metric: String(metric), amount: r2(Number(amount)) }));
    return { ...base, columns: [text("metric", "Metric"), money("amount", "Amount")], rows, totals: null, strongRows: [2, 5] };
  }

  const grouped: Record<string, { expr: string; name: string; label: string }> = {
    "product-profit-loss": { expr: "p.id", name: "p.name", label: "Product" },
    "company-profit-loss": { expr: "COALESCE(NULLIF(TRIM(p.company_name), ''), 'Unspecified')", name: "COALESCE(NULLIF(TRIM(p.company_name), ''), 'Unspecified')", label: "Company" },
    "category-profit-loss": { expr: "COALESCE(cat.id, 'none')", name: "COALESCE(cat.name, 'Uncategorized')", label: "Category" },
    "sub-category-profit-loss": { expr: "COALESCE(sc.id, 'none')", name: "COALESCE(sc.name, 'Uncategorized')", label: "Sub Category" },
    "customer-profit-loss": { expr: "COALESCE(cu.id, 'walk-in')", name: "COALESCE(cu.name, 'Walk-in')", label: "Customer" },
  };
  const g = grouped[key];
  if (g) {
    const product = key === "product-profit-loss";
    const [res] = await run([{
      sql: `SELECT ${g.expr} AS id, ${g.name} AS name,
                   COALESCE(SUM(${SIGN} * COALESCE(ii.qty, 0)), 0) AS qty,
                   COALESCE(SUM(${SIGN} * ${LINE_SALE}), 0) AS sales,
                   COALESCE(SUM(${SIGN} * COALESCE(ii.purchase_price, 0) * COALESCE(ii.qty, 0)), 0) AS cogs,
                   COALESCE(SUM(${SIGN} * (${LINE_SALE} - COALESCE(ii.purchase_price, 0) * COALESCE(ii.qty, 0))), 0) AS profit,
                   MAX(COALESCE(p.packing, 1)) AS packing
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
            JOIN products p ON p.id = ii.product_id
            LEFT JOIN categories cat ON cat.id = p.category_id
            LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
            LEFT JOIN customers cu ON cu.id = i.customer_id
            WHERE ${SOLD} ${inv.clause}
            GROUP BY ${g.expr}
            ORDER BY profit DESC`,
      args: [T, ...inv.params],
    }], false);
    const rows = rowsOf(res).map((x) => ({ name: String(x.name ?? ""), qty: r2(num(x.qty) * 1000) / 1000, packing: num(x.packing) || 1, sales: r2(num(x.sales)), cogs: r2(num(x.cogs)), profit: r2(num(x.profit)) }));
    const columns = [text("name", g.label), ...(product ? [qty("qty", "Qty")] : []), money("sales", "Sales"), money("cogs", "Cost"), money("profit", "Profit")];
    return { ...base, columns, rows, totals: sumCols(rows, columns.filter((c) => c.kind === "money")) };
  }

  if (key === "product-sales" || key === "category-sales") {
    const product = key === "product-sales";
    const [res] = await run([{
      sql: product
        ? `SELECT p.id, p.name, COALESCE(SUM(${SIGN} * COALESCE(ii.qty, 0)), 0) AS qty, COALESCE(SUM(${SIGN} * ${LINE_SALE}), 0) AS sales, MAX(COALESCE(p.packing, 1)) AS packing
           FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN products p ON p.id = ii.product_id
           WHERE ${SOLD} ${inv.clause} GROUP BY p.id ORDER BY sales DESC`
        : `SELECT COALESCE(cat.id, 'none') AS id, COALESCE(cat.name, 'Uncategorized') AS name, COALESCE(SUM(${SIGN} * ${LINE_SALE}), 0) AS sales
           FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN products p ON p.id = ii.product_id LEFT JOIN categories cat ON cat.id = p.category_id
           WHERE ${SOLD} ${inv.clause} GROUP BY COALESCE(cat.id, 'none') ORDER BY sales DESC`,
      args: [T, ...inv.params],
    }], false);
    const rows = rowsOf(res).map((x) => ({ name: String(x.name ?? ""), ...(product ? { qty: r2(num(x.qty) * 1000) / 1000, packing: num(x.packing) || 1 } : {}), sales: r2(num(x.sales)) }));
    const columns = product ? [text("name", "Product"), qty("qty", "Qty"), money("sales", "Sales")] : [text("name", "Category"), money("sales", "Sales")];
    return { ...base, columns, rows, totals: sumCols(rows, [money("sales", "Sales")]) };
  }

  if (key === "tax") {
    const pur = dateFilter("pu.date", from, to);
    const [st, wh] = await run([
      { sql: `SELECT substr(i.date, 1, 7) AS month, COALESCE(SUM(${SIGN} * COALESCE(ii.tax_rs, 0)), 0) AS n
              FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ${SOLD} ${inv.clause} GROUP BY month`, args: [T, ...inv.params] },
      { sql: `SELECT substr(pu.date, 1, 7) AS month, COALESCE(SUM(COALESCE(pi.purchase_price, 0) * COALESCE(pi.received_qty, 0) * (1 - COALESCE(pi.disc_pct, 0) / 100) * COALESCE(pi.wht_pct, 0) / 100), 0) AS n
              FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
              WHERE pu.deleted_at IS NULL AND pi.deleted_at IS NULL AND pu.tenant_id = ? AND pu.is_return = 0 ${pur.clause} GROUP BY month`, args: [T, ...pur.params] },
    ], false);
    const tax = new Map(rowsOf(st).map((x) => [String(x.month), num(x.n)]));
    const wht = new Map(rowsOf(wh).map((x) => [String(x.month), num(x.n)]));
    const rows = [...new Set([...tax.keys(), ...wht.keys()])].sort().map((month) => ({ month, sales_tax: r2(tax.get(month) ?? 0), wht_collected: r2(wht.get(month) ?? 0) }));
    const columns = [text("month", "Month"), money("sales_tax", "Sales Tax"), money("wht_collected", "WHT Collected")];
    return { ...base, columns, rows, totals: sumCols(rows, columns) };
  }

  if (key === "bonus-discount") {
    const [res] = await run([{
      sql: `SELECT p.id, p.name,
                   COALESCE(SUM(COALESCE(ii.bonus_qty, 0)), 0) AS bonus_qty,
                   COALESCE(SUM(COALESCE(ii.bonus_qty, 0) * COALESCE(ii.sale_price, 0)), 0) AS bonus_value,
                   COALESCE(SUM(COALESCE(ii.discount_rs, 0)), 0) AS discount_rs,
                   MAX(COALESCE(p.packing, 1)) AS packing
            FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN products p ON p.id = ii.product_id
            WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 0 AND i.is_quotation = 0 ${inv.clause}
            GROUP BY p.id
            HAVING SUM(COALESCE(ii.bonus_qty, 0)) > 0 OR SUM(COALESCE(ii.discount_rs, 0)) > 0
            ORDER BY SUM(COALESCE(ii.discount_rs, 0)) DESC`,
      args: [T, ...inv.params],
    }], false);
    const rows = rowsOf(res).map((x) => ({ name: String(x.name ?? ""), bonus_qty: r2(num(x.bonus_qty) * 1000) / 1000, packing: num(x.packing) || 1, bonus_value: r2(num(x.bonus_value)), discount_rs: r2(num(x.discount_rs)) }));
    const columns = [text("name", "Product"), qty("bonus_qty", "Bonus Qty"), money("bonus_value", "Bonus Value"), money("discount_rs", "Discount")];
    return { ...base, columns, rows, totals: sumCols(rows, columns.filter((c) => c.kind === "money")) };
  }

  // Accounts: Trial Balance (all time) and Balance Sheet (as of a date).
  const bankSql = `SELECT b.name, b.opening_balance
      + COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id = b.id AND transaction_type = 'deposit' AND deleted_at IS NULL), 0)
      - COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id = b.id AND transaction_type = 'withdraw' AND deleted_at IS NULL), 0) AS n
    FROM banks b WHERE b.deleted_at IS NULL AND b.tenant_id = ?`;
  if (key === "trial-balance") {
    const [cash, banks, cu, su, ex, rv] = await run([
      { sql: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'in' THEN amount ELSE -amount END), 0) AS n FROM cash_register_entries WHERE deleted_at IS NULL AND tenant_id = ?`, args: [T] },
      { sql: bankSql, args: [T] },
      { sql: partyBalance("customers"), args: [T, T, T] },
      { sql: partyBalance("suppliers"), args: [T, T, T] },
      { sql: `SELECT COALESCE(SUM(amount), 0) AS n FROM expenses WHERE deleted_at IS NULL AND tenant_id = ?`, args: [T] },
      { sql: `SELECT COALESCE(SUM(amount), 0) AS n FROM revenues WHERE deleted_at IS NULL AND tenant_id = ?`, args: [T] },
    ], false);
    const c = num(rowsOf(cash)[0]?.n);
    const recv = num(rowsOf(cu)[0]?.n);
    const pay = num(rowsOf(su)[0]?.n);
    const rows = [
      { account: "Cash In Hand", debit: r2(Math.max(c, 0)), credit: r2(Math.max(-c, 0)) },
      ...rowsOf(banks).map((b) => ({ account: `Bank — ${String(b.name ?? "")}`, debit: r2(Math.max(num(b.n), 0)), credit: r2(Math.max(-num(b.n), 0)) })),
      { account: "Accounts Receivable", debit: r2(Math.max(recv, 0)), credit: 0 },
      { account: "Accounts Payable", debit: 0, credit: r2(Math.max(pay, 0)) },
      { account: "Expenses", debit: r2(num(rowsOf(ex)[0]?.n)), credit: 0 },
      { account: "Other Revenue", debit: 0, credit: r2(num(rowsOf(rv)[0]?.n)) },
    ];
    const columns = [text("account", "Account"), money("debit", "Debit"), money("credit", "Credit")];
    return { ...base, dates: "none", columns, rows, totals: sumCols(rows, columns) };
  }

  // Balance Sheet, as of the To date (the web's single date).
  const asOf = to;
  const [cash, banks, cu, su, stock] = await run([
    { sql: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'in' THEN amount ELSE -amount END), 0) AS n FROM cash_register_entries WHERE deleted_at IS NULL AND tenant_id = ? ${asOf ? "AND date <= ?" : ""}`, args: [T, ...(asOf ? [asOf] : [])] },
    { sql: `SELECT COALESCE(SUM(n), 0) AS n FROM (${bankSql})`, args: [T] },
    { sql: partyBalance("customers"), args: [T, T, T] },
    { sql: partyBalance("suppliers"), args: [T, T, T] },
    { sql: `SELECT COALESCE(SUM(pb.qty * pb.purchase_price), 0) AS n FROM product_batches pb WHERE pb.deleted_at IS NULL AND pb.tenant_id = ?`, args: [T] },
  ], false);
  const c = num(rowsOf(cash)[0]?.n);
  const b = num(rowsOf(banks)[0]?.n);
  const recv = num(rowsOf(cu)[0]?.n);
  const pay = num(rowsOf(su)[0]?.n);
  const sv = num(rowsOf(stock)[0]?.n);
  const assets = c + b + recv + sv;
  const rows = [
    { section: "Assets", account: "Cash In Hand", amount: r2(c) },
    { section: "Assets", account: "Cash In Bank", amount: r2(b) },
    { section: "Assets", account: "Accounts Receivable", amount: r2(recv) },
    { section: "Assets", account: "Stock Value", amount: r2(sv) },
    { section: "Assets", account: "Total Assets", amount: r2(assets) },
    { section: "Liabilities", account: "Accounts Payable", amount: r2(pay) },
    { section: "Equity", account: "Owner's Equity (plug)", amount: r2(assets - pay) },
  ];
  return { ...base, dates: "asOf", columns: [text("section", "Section"), text("account", "Account"), money("amount", "Amount")], rows, totals: null, strongRows: [4, 6] };
}
