import { dbSelect } from "../db";
import { getTotalPartyBalance } from "./ledger";
import { useAuthStore } from "../../store/authStore";

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

function dateFilter(column: string, fromDate: string, toDate: string): { clause: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (fromDate) {
    parts.push(`${column} >= ?`);
    params.push(fromDate);
  }
  if (toDate) {
    parts.push(`${column} <= ?`);
    params.push(toDate);
  }
  return { clause: parts.length ? `AND ${parts.join(" AND ")}` : "", params };
}

export interface BusinessPL {
  id: string;
  metric: string;
  amount: number;
}

export async function getBusinessProfitLoss(fromDate: string, toDate: string): Promise<BusinessPL[]> {
  const tenantId = currentTenantId();
  const inv = dateFilter("i.date", fromDate, toDate);
  const exp = dateFilter("date", fromDate, toDate);
  const rev = dateFilter("date", fromDate, toDate);

  const [salesRows] = await Promise.all([
    dbSelect<{ sales: number; returns: number; cogs: number; cogs_return: number }>(
      `
      SELECT
        COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 0 AND i.is_quotation = 0 ${inv.clause}), 0) AS sales,
        COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 1 AND i.is_quotation = 0 ${inv.clause}), 0) AS returns,
        COALESCE((SELECT SUM(ii.purchase_price * ii.qty) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 0 AND i.is_quotation = 0 ${inv.clause}), 0) AS cogs,
        COALESCE((SELECT SUM(ii.purchase_price * ii.qty) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 1 AND i.is_quotation = 0 ${inv.clause}), 0) AS cogs_return
    `,
      [
        tenantId,
        ...inv.params,
        tenantId,
        ...inv.params,
        tenantId,
        ...inv.params,
        tenantId,
        ...inv.params,
      ]
    ),
  ]);

  const expenseRows = await dbSelect<{ n: number }>(
    `SELECT COALESCE(SUM(amount),0) as n FROM expenses WHERE deleted_at IS NULL AND tenant_id = ? ${exp.clause}`,
    [tenantId, ...exp.params]
  );
  const revenueRows = await dbSelect<{ n: number }>(
    `SELECT COALESCE(SUM(amount),0) as n FROM revenues WHERE deleted_at IS NULL AND tenant_id = ? ${rev.clause}`,
    [tenantId, ...rev.params]
  );

  const s = salesRows[0];
  const netSales = s.sales - s.returns;
  const netCogs = s.cogs - s.cogs_return;
  const grossProfit = netSales - netCogs;
  const expenses = expenseRows[0]?.n ?? 0;
  const otherRevenue = revenueRows[0]?.n ?? 0;
  const netProfit = grossProfit - expenses + otherRevenue;

  return [
    { id: "1", metric: "Net Sales", amount: netSales },
    { id: "2", metric: "Cost of Goods Sold", amount: netCogs },
    { id: "3", metric: "Gross Profit", amount: grossProfit },
    { id: "4", metric: "Expenses", amount: expenses },
    { id: "5", metric: "Other Revenue", amount: otherRevenue },
    { id: "6", metric: "Net Profit / Loss", amount: netProfit },
  ];
}

export interface GroupedPL {
  id: string;
  name: string;
  qty: number;
  sales: number;
  cogs: number;
  profit: number;
}

async function groupedProfitLoss(
  groupBy: "product" | "company" | "category" | "sub_category" | "customer",
  fromDate: string,
  toDate: string
): Promise<GroupedPL[]> {
  const inv = dateFilter("i.date", fromDate, toDate);
  const groupExpr =
    groupBy === "product"
      ? "p.id"
      : groupBy === "company"
        ? "p.company_name"
        : groupBy === "category"
          ? "cat.id"
          : groupBy === "sub_category"
            ? "sc.id"
            : "cu.id";
  const nameExpr =
    groupBy === "product"
      ? "p.name"
      : groupBy === "company"
        ? "COALESCE(p.company_name, 'Unspecified')"
        : groupBy === "category"
          ? "COALESCE(cat.name, 'Uncategorized')"
          : groupBy === "sub_category"
            ? "COALESCE(sc.name, 'Uncategorized')"
            : "COALESCE(cu.name, 'Walk-in')";

  // Returns (is_return=1) subtract from the matching product/company/
  // category/customer instead of being ignored — a return with no effect
  // here was exactly the "still shows in profit" bug.
  const sign = "CASE WHEN i.is_return = 0 THEN 1 ELSE -1 END";
  return dbSelect<GroupedPL>(
    `
    SELECT
      ${groupExpr} AS id,
      ${nameExpr} AS name,
      SUM(${sign} * ii.qty) AS qty,
      SUM(${sign} * ii.sale_price * ii.qty) AS sales,
      SUM(${sign} * ii.purchase_price * ii.qty) AS cogs,
      SUM(${sign} * (ii.sale_price - ii.purchase_price) * ii.qty) AS profit
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN products p ON p.id = ii.product_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
    LEFT JOIN customers cu ON cu.id = i.customer_id
    WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_memorized = 0 AND i.is_quotation = 0 ${inv.clause}
    GROUP BY ${groupExpr}
    ORDER BY profit DESC
  `,
    [currentTenantId(), ...inv.params]
  );
}

export const getProductProfitLoss = (f: string, t: string) => groupedProfitLoss("product", f, t);
export const getCompanyProfitLoss = (f: string, t: string) => groupedProfitLoss("company", f, t);
export const getCategoryProfitLoss = (f: string, t: string) => groupedProfitLoss("category", f, t);
export const getSubCategoryProfitLoss = (f: string, t: string) => groupedProfitLoss("sub_category", f, t);
export const getCustomerProfitLoss = (f: string, t: string) => groupedProfitLoss("customer", f, t);

export interface ProductSalesRow {
  id: string;
  name: string;
  qty: number;
  sales: number;
}

export async function getProductWiseSales(fromDate: string, toDate: string): Promise<ProductSalesRow[]> {
  const inv = dateFilter("i.date", fromDate, toDate);
  return dbSelect<ProductSalesRow>(
    `
    SELECT p.id, p.name,
           SUM(CASE WHEN i.is_return = 0 THEN ii.qty ELSE -ii.qty END) AS qty,
           SUM(CASE WHEN i.is_return = 0 THEN ii.sale_price * ii.qty ELSE -ii.sale_price * ii.qty END) AS sales
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN products p ON p.id = ii.product_id
    WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_memorized = 0 AND i.is_quotation = 0 ${inv.clause}
    GROUP BY p.id
    ORDER BY sales DESC
  `,
    [currentTenantId(), ...inv.params]
  );
}

export interface CategorySalesRow {
  id: string;
  name: string;
  sales: number;
}

export async function getCategoryWiseSales(fromDate: string, toDate: string): Promise<CategorySalesRow[]> {
  const inv = dateFilter("i.date", fromDate, toDate);
  return dbSelect<CategorySalesRow>(
    `
    SELECT COALESCE(cat.id, 'none') AS id, COALESCE(cat.name, 'Uncategorized') AS name,
           SUM(CASE WHEN i.is_return = 0 THEN ii.sale_price * ii.qty ELSE -ii.sale_price * ii.qty END) AS sales
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN products p ON p.id = ii.product_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_memorized = 0 AND i.is_quotation = 0 ${inv.clause}
    GROUP BY id
    ORDER BY sales DESC
  `,
    [currentTenantId(), ...inv.params]
  );
}

export interface TaxRow {
  id: string;
  month: string;
  sales_tax: number;
  wht_collected: number;
}

export async function getTaxReport(fromDate: string, toDate: string): Promise<TaxRow[]> {
  const tenantId = currentTenantId();
  const inv = dateFilter("i.date", fromDate, toDate);
  const pur = dateFilter("pu.date", fromDate, toDate);
  const salesTax = await dbSelect<{ month: string; n: number }>(
    `
    SELECT substr(i.date,1,7) AS month,
           SUM(CASE WHEN i.is_return = 0 THEN ii.tax_rs ELSE -ii.tax_rs END) AS n
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_memorized = 0 AND i.is_quotation = 0 ${inv.clause}
    GROUP BY month
  `,
    [tenantId, ...inv.params]
  );
  const wht = await dbSelect<{ month: string; n: number }>(
    `
    SELECT substr(pu.date,1,7) AS month, SUM(pi.purchase_price * pi.received_qty * pi.wht_pct / 100) AS n
    FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE pu.deleted_at IS NULL AND pi.deleted_at IS NULL AND pu.tenant_id = ? AND pu.is_return = 0 ${pur.clause}
    GROUP BY month
  `,
    [tenantId, ...pur.params]
  );
  const months = new Set([...salesTax.map((r) => r.month), ...wht.map((r) => r.month)]);
  const whtMap = new Map(wht.map((r) => [r.month, r.n]));
  const taxMap = new Map(salesTax.map((r) => [r.month, r.n]));
  return [...months].sort().map((month) => ({
    id: month,
    month,
    sales_tax: taxMap.get(month) ?? 0,
    wht_collected: whtMap.get(month) ?? 0,
  }));
}

export interface BonusDiscountRow {
  id: string;
  name: string;
  bonus_qty: number;
  bonus_value: number;
  discount_rs: number;
}

export async function getBonusAndDiscountReport(fromDate: string, toDate: string): Promise<BonusDiscountRow[]> {
  const inv = dateFilter("i.date", fromDate, toDate);
  return dbSelect<BonusDiscountRow>(
    `
    SELECT p.id, p.name,
      SUM(ii.bonus_qty) AS bonus_qty,
      SUM(ii.bonus_qty * ii.sale_price) AS bonus_value,
      SUM(ii.discount_rs) AS discount_rs
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN products p ON p.id = ii.product_id
    WHERE i.deleted_at IS NULL AND ii.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 0 AND i.is_quotation = 0 ${inv.clause}
    GROUP BY p.id
    HAVING bonus_qty > 0 OR discount_rs > 0
    ORDER BY discount_rs DESC
  `,
    [currentTenantId(), ...inv.params]
  );
}

export interface TrialBalanceRow {
  id: string;
  account: string;
  debit: number;
  credit: number;
}

export async function getTrialBalance(): Promise<TrialBalanceRow[]> {
  const tenantId = currentTenantId();
  const [cash, banks, customerBalance, supplierBalance, expenseTotal, revenueTotal] = await Promise.all([
    dbSelect<{ n: number }>(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type='in' THEN amount ELSE -amount END),0) AS n FROM cash_register_entries WHERE deleted_at IS NULL AND tenant_id = ?`,
      [tenantId]
    ),
    dbSelect<{ name: string; n: number }>(
      `
      SELECT b.name,
        b.opening_balance
          + COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id=b.id AND transaction_type='deposit' AND deleted_at IS NULL),0)
          - COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id=b.id AND transaction_type='withdraw' AND deleted_at IS NULL),0)
        AS n
      FROM banks b WHERE b.deleted_at IS NULL AND b.tenant_id = ?
    `,
      [tenantId]
    ),
    getTotalPartyBalance("customer"),
    getTotalPartyBalance("supplier"),
    dbSelect<{ n: number }>(`SELECT COALESCE(SUM(amount),0) AS n FROM expenses WHERE deleted_at IS NULL AND tenant_id = ?`, [
      tenantId,
    ]),
    dbSelect<{ n: number }>(`SELECT COALESCE(SUM(amount),0) AS n FROM revenues WHERE deleted_at IS NULL AND tenant_id = ?`, [
      tenantId,
    ]),
  ]);

  const rows: TrialBalanceRow[] = [
    { id: "cash", account: "Cash In Hand", debit: Math.max(cash[0].n, 0), credit: Math.max(-cash[0].n, 0) },
    ...banks.map((b, i) => ({
      id: `bank-${i}`,
      account: `Bank — ${b.name}`,
      debit: Math.max(b.n, 0),
      credit: Math.max(-b.n, 0),
    })),
    { id: "receivable", account: "Accounts Receivable", debit: Math.max(customerBalance, 0), credit: 0 },
    { id: "payable", account: "Accounts Payable", debit: 0, credit: Math.max(supplierBalance, 0) },
    { id: "expenses", account: "Expenses", debit: expenseTotal[0].n, credit: 0 },
    { id: "revenue", account: "Other Revenue", debit: 0, credit: revenueTotal[0].n },
  ];
  return rows;
}

export interface BalanceSheetRow {
  id: string;
  section: string;
  account: string;
  amount: number;
}

export async function getBalanceSheet(asOfDate: string): Promise<BalanceSheetRow[]> {
  const tenantId = currentTenantId();
  const dateClause = asOfDate ? "AND date <= ?" : "";
  const dateParams = asOfDate ? [asOfDate] : [];

  const [cash, banks, receivable, payable, stockValue] = await Promise.all([
    dbSelect<{ n: number }>(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type='in' THEN amount ELSE -amount END),0) AS n FROM cash_register_entries WHERE deleted_at IS NULL AND tenant_id = ? ${dateClause}`,
      [tenantId, ...dateParams]
    ),
    dbSelect<{ n: number }>(
      `
      SELECT COALESCE(SUM(
        b.opening_balance
          + COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id=b.id AND transaction_type='deposit' AND deleted_at IS NULL),0)
          - COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id=b.id AND transaction_type='withdraw' AND deleted_at IS NULL),0)
      ),0) AS n FROM banks b WHERE b.deleted_at IS NULL AND b.tenant_id = ?
    `,
      [tenantId]
    ),
    getTotalPartyBalance("customer"),
    getTotalPartyBalance("supplier"),
    dbSelect<{ n: number }>(
      `
      SELECT COALESCE(SUM(pb.qty * pb.purchase_price),0) AS n FROM product_batches pb WHERE pb.deleted_at IS NULL AND pb.tenant_id = ?
    `,
      [tenantId]
    ),
  ]);

  const totalAssets = cash[0].n + banks[0].n + receivable + stockValue[0].n;
  const totalLiabilities = payable;
  const equity = totalAssets - totalLiabilities;

  return [
    { id: "cash", section: "Assets", account: "Cash In Hand", amount: cash[0].n },
    { id: "bank", section: "Assets", account: "Cash In Bank", amount: banks[0].n },
    { id: "receivable", section: "Assets", account: "Accounts Receivable", amount: receivable },
    { id: "stock", section: "Assets", account: "Stock Value", amount: stockValue[0].n },
    { id: "total-assets", section: "Assets", account: "Total Assets", amount: totalAssets },
    { id: "payable", section: "Liabilities", account: "Accounts Payable", amount: totalLiabilities },
    { id: "equity", section: "Equity", account: "Owner's Equity (plug)", amount: equity },
  ];
}
