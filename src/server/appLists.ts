/** The website's list pages for the MAVIN Business app, one definition per
 * page: the same tables and rules as the web pages (invoice returns, drafts,
 * quotations, orders, purchases and returns, price list, UOM, categories,
 * companies, narcotics, staff, banks, salesmen, other revenue, categories,
 * tasks). Read through `run` (runForCaller in production: the same policy,
 * business and branch scoping as the web). Each page answers columns, rows
 * (searchable, paged, by period where the web has dates) and totals. */
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Res, Runner } from "./appDocs";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

type Row = Record<string, unknown>;
const rowsOf = (r: Res | undefined): Row[] => (r ? r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) : []);
const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 50;

export type ListColumnKind = "text" | "money" | "qty" | "date" | "pct";
export interface ListColumn { key: string; label: string; kind: ListColumnKind }
export interface AppList {
  key: string;
  title: string;
  /** The web page has dates: the app offers a period. */
  dated: boolean;
  columns: ListColumn[];
  rows: Record<string, string | number | null>[];
  nextOffset: number | null;
  /** Sums over the whole period/search (not only this page). */
  totals: Record<string, number> | null;
  /** A row opens: an invoice or a purchase (by its id). */
  opens: "invoice" | "purchase" | null;
  /** The section a staff login needs (config/nav.ts moduleKey). */
}

interface Def {
  title: string;
  module: string;
  dated?: string;
  columns: ListColumn[];
  /** FROM ... WHERE (the business filter included; `?` = tenant id, as many as `tenantArgs`). */
  from: string;
  tenantArgs: number;
  select: string;
  search?: string[];
  order: string;
  sums?: string[];
  opens?: "invoice" | "purchase";
}

const t = (key: string, label: string): ListColumn => ({ key, label, kind: "text" });
const m = (key: string, label: string): ListColumn => ({ key, label, kind: "money" });
const d = (key: string, label: string): ListColumn => ({ key, label, kind: "date" });
const q = (key: string, label: string): ListColumn => ({ key, label, kind: "qty" });
const p = (key: string, label: string): ListColumn => ({ key, label, kind: "pct" });

const invoiceList = (title: string, where: string): Def => ({
  title, module: "invoices", dated: "i.date",
  columns: [t("no", "Bill #"), d("date", "Date"), t("customer", "Customer"), m("payable", "Total Bill"), m("paid", "Paid"), m("balance", "Balance")],
  from: `invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND ${where}`,
  tenantArgs: 1,
  select: `i.id, i.invoice_no AS no, i.date, COALESCE(NULLIF(i.customer_name, ''), c.name, 'Walk-in') AS customer, i.payable, i.paid, i.balance`,
  search: ["CAST(i.invoice_no AS TEXT)", "i.customer_name", "c.name"],
  order: "i.date DESC, i.created_at DESC",
  sums: ["payable", "paid", "balance"],
  opens: "invoice",
});

const purchaseList = (title: string, ret: 0 | 1): Def => ({
  title, module: "purchase", dated: "pu.date",
  columns: [t("no", "Purchase #"), d("date", "Date"), t("supplier", "Supplier"), t("supplier_invoice_no", "Invoice #"), m("payable", "Payable"), m("paid", "Paid"), m("balance", "Balance")],
  from: `purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.deleted_at IS NULL AND pu.tenant_id = ? AND COALESCE(pu.is_return, 0) = ${ret}`,
  tenantArgs: 1,
  select: `pu.id, pu.purchase_no AS no, pu.date, COALESCE(s.name, '—') AS supplier, pu.supplier_invoice_no, pu.payable, pu.paid_amount AS paid, pu.balance`,
  search: ["CAST(pu.purchase_no AS TEXT)", "s.name", "pu.supplier_invoice_no"],
  order: "pu.date DESC, pu.created_at DESC",
  sums: ["payable", "paid", "balance"],
  opens: "purchase",
});

const DEFS: Record<string, Def> = {
  "invoice-returns": invoiceList("Invoice Return Details", "i.is_return = 1 AND COALESCE(i.is_quotation, 0) = 0"),
  memorized: invoiceList("Memorized Invoice Detail", "i.is_memorized = 1 AND i.is_return = 0 AND COALESCE(i.is_quotation, 0) = 0"),
  quotations: { ...invoiceList("Quotation", "COALESCE(i.is_quotation, 0) = 1"), module: "quotation" },
  purchases: purchaseList("Purchase Details", 0),
  "purchase-returns": purchaseList("Purchase Return Details", 1),
  orders: {
    title: "Order", module: "order", dated: "o.date",
    columns: [t("no", "Order #"), d("date", "Date"), t("supplier", "Supplier"), t("order_type", "Type"), m("estimated_price", "Estimated Price"), m("advance_payment", "Advance")],
    from: `orders o LEFT JOIN suppliers s ON s.id = o.supplier_id WHERE o.deleted_at IS NULL AND o.tenant_id = ?`, tenantArgs: 1,
    select: `o.id, o.order_no AS no, o.date, COALESCE(s.name, '—') AS supplier, o.order_type, o.estimated_price, o.advance_payment`,
    search: ["CAST(o.order_no AS TEXT)", "s.name"], order: "o.date DESC, o.created_at DESC", sums: ["estimated_price", "advance_payment"],
  },
  "price-list": {
    title: "Price List", module: "products",
    columns: [t("product", "Product"), m("sale_price", "Sale Price"), m("wholesale_price", "Wholesale"), m("mrp", "MRP"), t("batch_no", "Batch"), d("date", "Date")],
    from: `price_list pl JOIN products p ON p.id = pl.product_id WHERE pl.deleted_at IS NULL AND pl.tenant_id = ?`, tenantArgs: 1,
    select: `pl.id, p.name AS product, pl.sale_price, pl.wholesale_price, pl.mrp, pl.batch_no, substr(pl.created_at, 1, 10) AS date`,
    search: ["p.name", "p.barcode"], order: "pl.created_at DESC",
  },
  categories: {
    title: "Categories Details", module: "products",
    columns: [t("name", "Name"), p("flat_discount_pct", "Discount"), t("description", "Description")],
    from: `categories c WHERE c.deleted_at IS NULL AND (c.tenant_id = ? OR c.tenant_id IS NULL)`, tenantArgs: 1,
    select: `c.id, c.name, c.flat_discount_pct, c.description`, search: ["c.name"], order: "c.name COLLATE NOCASE",
  },
  uom: {
    title: "UOM Details", module: "products",
    columns: [t("name", "Name"), t("description", "Description")],
    from: `uoms u WHERE u.deleted_at IS NULL`, tenantArgs: 0,
    select: `u.id, u.name, u.description`, search: ["u.name"], order: "u.name COLLATE NOCASE",
  },
  companies: {
    title: "Companies", module: "products",
    columns: [t("name", "Company"), q("products", "Products")],
    from: `products p WHERE p.deleted_at IS NULL AND p.tenant_id = ? AND NULLIF(TRIM(p.company_name), '') IS NOT NULL`, tenantArgs: 1,
    select: `TRIM(p.company_name) AS id, TRIM(p.company_name) AS name, COUNT(*) AS products`, search: ["p.company_name"],
    order: "name COLLATE NOCASE", sums: [],
  },
  narcotics: {
    title: "Narcotics", module: "customers", dated: "i.date",
    columns: [t("no", "Bill #"), d("date", "Date"), t("customer", "Customer"), t("phone", "Mobile"), t("product", "Product"), q("qty", "Qty")],
    from: `invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN products p ON p.id = ii.product_id LEFT JOIN customers c ON c.id = i.customer_id
           WHERE ii.deleted_at IS NULL AND i.deleted_at IS NULL AND i.tenant_id = ? AND COALESCE(p.is_narcotic, 0) = 1 AND i.is_memorized = 0 AND COALESCE(i.is_quotation, 0) = 0`,
    tenantArgs: 1,
    select: `i.id, i.invoice_no AS no, i.date, COALESCE(NULLIF(i.customer_name, ''), c.name, 'Walk-in') AS customer, COALESCE(NULLIF(i.customer_phone, ''), c.phone) AS phone, p.name AS product, ii.qty, COALESCE(p.packing, 1) AS packing`,
    search: ["p.name", "i.customer_name", "c.name", "i.customer_phone"], order: "i.date DESC, i.created_at DESC", opens: "invoice",
  },
  staff: {
    title: "Staff Details", module: "staff",
    columns: [t("name", "Name"), t("designation", "Designation"), t("phone", "Phone"), m("basic_pay", "Basic Pay"), d("date_of_joining", "Joined")],
    from: `staff s WHERE s.deleted_at IS NULL AND s.tenant_id = ?`, tenantArgs: 1,
    select: `s.id, s.name, s.designation, s.phone, s.basic_pay, s.date_of_joining`, search: ["s.name", "s.phone"], order: "s.name COLLATE NOCASE",
  },
  banks: {
    title: "Bank Details", module: "banks",
    columns: [t("name", "Bank"), t("account_title", "Account Title"), t("account_no", "Account No"), m("balance", "Balance")],
    from: `banks b WHERE b.deleted_at IS NULL AND b.tenant_id = ?`, tenantArgs: 1,
    select: `b.id, b.name, b.account_title, b.account_no,
             COALESCE(b.opening_balance, 0)
               + COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id = b.id AND transaction_type = 'deposit' AND deleted_at IS NULL), 0)
               - COALESCE((SELECT SUM(amount) FROM bank_ledger_entries WHERE bank_id = b.id AND transaction_type = 'withdraw' AND deleted_at IS NULL), 0) AS balance`,
    search: ["b.name", "b.account_no"], order: "b.name COLLATE NOCASE", sums: ["balance"],
  },
  salesmen: {
    title: "Salesman", module: "salesman",
    columns: [t("name", "Name"), t("phone", "Phone")],
    from: `salesmen s WHERE s.deleted_at IS NULL AND s.tenant_id = ?`, tenantArgs: 1,
    select: `s.id, s.name, s.phone`, search: ["s.name", "s.phone"], order: "s.name COLLATE NOCASE",
  },
  "other-revenue": {
    title: "Revenue Details", module: "other_revenue", dated: "r.date",
    columns: [d("date", "Date"), t("category", "Category"), m("amount", "Amount"), t("payment_method", "Method"), t("revenue_by", "Revenue By"), t("description", "Description")],
    from: `revenues r LEFT JOIN revenue_categories c ON c.id = r.category_id WHERE r.deleted_at IS NULL AND r.tenant_id = ?`, tenantArgs: 1,
    select: `r.id, r.date, c.name AS category, r.amount, r.payment_method, r.revenue_by, r.description`,
    search: ["c.name", "r.description", "r.revenue_by"], order: "r.date DESC, r.created_at DESC", sums: ["amount"],
  },
  "expense-categories": {
    title: "Expense Category Details", module: "expenses",
    columns: [t("name", "Name"), t("description", "Description")],
    from: `expense_categories c WHERE c.deleted_at IS NULL AND c.tenant_id = ?`, tenantArgs: 1,
    select: `c.id, c.name, c.description`, search: ["c.name"], order: "c.name COLLATE NOCASE",
  },
  "revenue-categories": {
    title: "Revenue Category Details", module: "other_revenue",
    columns: [t("name", "Name"), t("description", "Description")],
    from: `revenue_categories c WHERE c.deleted_at IS NULL AND c.tenant_id = ?`, tenantArgs: 1,
    select: `c.id, c.name, c.description`, search: ["c.name"], order: "c.name COLLATE NOCASE",
  },
  tasks: {
    title: "Tasks", module: "tasks", dated: "k.assign_date",
    columns: [t("task_name", "Task"), t("assign_to", "Assigned To"), t("assign_by", "Assigned By"), d("assign_date", "Assigned"), t("status", "Status"), d("finished_date", "Finished")],
    from: `tasks k WHERE k.deleted_at IS NULL AND k.tenant_id = ?`, tenantArgs: 1,
    select: `k.id, k.task_name, k.assign_to, k.assign_by, k.assign_date, k.status, k.finished_date`,
    search: ["k.task_name", "k.assign_to"], order: "k.assign_date DESC, k.created_at DESC",
  },
};

export const LIST_KEYS = Object.keys(DEFS);

export async function appList(run: Runner, caller: Caller, key: string, opts: { search?: string | null; from?: string | null; to?: string | null; offset?: number }): Promise<AppList> {
  const def = DEFS[key];
  if (!def) throw new HttpError(404, "Page not found.");
  if (caller.role === "staff" && Array.isArray(caller.permissions) && !caller.permissions.includes(def.module)) {
    throw new HttpError(403, `Your login has no access to ${def.title}. Ask the owner to allow it.`);
  }
  const T = caller.tenantId!;
  const term = (opts.search ?? "").trim().slice(0, 60);
  const from = opts.from && DATE.test(opts.from) ? opts.from : null;
  const to = opts.to && DATE.test(opts.to) ? opts.to : null;
  if ((opts.from && !from) || (opts.to && !to)) throw new HttpError(400, "Invalid date.");
  const off = Math.max(0, Math.floor(opts.offset ?? 0));

  let where = "";
  const args: unknown[] = Array.from({ length: def.tenantArgs }, () => T);
  if (term && def.search?.length) {
    where += ` AND (${def.search.map((c) => `${c} LIKE ?`).join(" OR ")})`;
    args.push(...def.search.map(() => `%${term}%`));
  }
  if (def.dated && from) { where += ` AND ${def.dated} >= ?`; args.push(from); }
  if (def.dated && to) { where += ` AND ${def.dated} <= ?`; args.push(to); }
  const grouped = key === "companies" ? " GROUP BY TRIM(p.company_name)" : "";
  const base = `FROM ${def.from}${where}${grouped}`;
  const stmts = [{ sql: `SELECT ${def.select} ${base} ORDER BY ${def.order} LIMIT ? OFFSET ?`, args: [...args, PAGE + 1, off] }];
  const sums = def.sums ?? [];
  if (sums.length) stmts.push({ sql: `SELECT ${sums.map((s) => `COALESCE(SUM(${s}), 0) AS ${s}`).join(", ")} FROM (SELECT ${def.select} ${base})`, args });
  const res = await run(stmts, false);
  const rows = rowsOf(res[0]);
  const total = sums.length ? rowsOf(res[1])[0] ?? {} : null;
  const moneyKeys = new Set(def.columns.filter((c) => c.kind === "money" || c.kind === "qty" || c.kind === "pct").map((c) => c.key));
  return {
    key, title: def.title, dated: !!def.dated, columns: def.columns, opens: def.opens ?? null,
    rows: rows.slice(0, PAGE).map((x) => {
      const o: Record<string, string | number | null> = { id: x.id == null ? null : String(x.id) };
      if (x.packing != null) o.packing = num(x.packing);
      for (const c of def.columns) o[c.key] = x[c.key] == null || x[c.key] === "" ? null : moneyKeys.has(c.key) ? r2(num(x[c.key])) : String(x[c.key]);
      return o;
    }),
    nextOffset: rows.length > PAGE ? off + PAGE : null,
    totals: total ? Object.fromEntries(sums.map((s) => [s, r2(num(total[s]))])) : null,
  };
}

// ── One purchase (Purchase Details > a row) ──────────────────────────────

export interface AppPurchaseDetail {
  id: string; no: number | null; date: string; supplier: string; supplierInvoiceNo: string | null; isReturn: boolean;
  payable: number; paid: number; balance: number; discount: number; tax: number; method: string | null; description: string | null;
  items: { product: string; batchNo: string | null; expiry: string | null; qty: number; packing: number; price: number | null; total: number }[];
}

export async function purchaseDetail(run: Runner, caller: Caller, id: string): Promise<AppPurchaseDetail> {
  if (caller.role === "staff" && Array.isArray(caller.permissions) && !caller.permissions.includes("purchase")) {
    throw new HttpError(403, "Your login has no access to Purchase. Ask the owner to allow it.");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, "Invalid purchase.");
  const T = caller.tenantId!;
  const [h, it] = await run([
    { sql: `SELECT pu.id, pu.purchase_no, pu.date, COALESCE(s.name, '—') AS supplier, pu.supplier_invoice_no, pu.is_return, pu.payable, pu.paid_amount, pu.balance,
                   pu.discount_rs, pu.tax, pu.payment_method, pu.description
            FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.id = ? AND pu.tenant_id = ? AND pu.deleted_at IS NULL`, args: [id, T] },
    { sql: `SELECT p.name AS product, pi.batch_no, pi.expiry_date, pi.received_qty, COALESCE(p.packing, 1) AS packing, pi.purchase_price, pi.total
            FROM purchase_items pi LEFT JOIN products p ON p.id = pi.product_id AND (p.tenant_id = pi.tenant_id OR p.tenant_id IS NULL)
            WHERE pi.purchase_id = ? AND pi.tenant_id = ? AND pi.deleted_at IS NULL ORDER BY pi.created_at`, args: [id, T] },
  ], false);
  const x = rowsOf(h)[0];
  if (!x) throw new HttpError(404, "This purchase was not found.");
  return {
    id, no: x.purchase_no == null ? null : num(x.purchase_no), date: String(x.date ?? ""), supplier: String(x.supplier ?? ""),
    supplierInvoiceNo: x.supplier_invoice_no ? String(x.supplier_invoice_no) : null, isReturn: num(x.is_return) === 1,
    payable: r2(num(x.payable)), paid: r2(num(x.paid_amount)), balance: r2(num(x.balance)), discount: r2(num(x.discount_rs)), tax: r2(num(x.tax)),
    method: x.payment_method ? String(x.payment_method) : null, description: x.description ? String(x.description) : null,
    items: rowsOf(it).map((i) => ({
      product: String(i.product ?? "(deleted product)"), batchNo: i.batch_no ? String(i.batch_no) : null, expiry: i.expiry_date ? String(i.expiry_date) : null,
      qty: num(i.received_qty), packing: num(i.packing) || 1,
      // Removed for logins without purchase prices: absent means hidden.
      price: "purchase_price" in i ? r2(num(i.purchase_price)) : null, total: r2(num(i.total)),
    })),
  };
}
