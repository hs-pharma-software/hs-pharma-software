/** What the MAVIN Business Android app (Flutter, mobile/) reads.
 *
 * - bootstrap: who is signed in, the business, its sections (the same menu the
 *   web shows this login, from config/navFilter.ts), branches and the few
 *   settings the app needs. The app builds its navigation from this; the
 *   server still checks every request on its own.
 * - products: a paged search (name or barcode) with the available quantity
 *   and the latest sale price, the way the Stock page works them out; and one
 *   product with its batches.
 *
 * Product reads go through `run` (runForCaller in production): the same
 * policy check, business and branch scoping and hidden purchase prices as
 * the web. */
import { visibleNavFor } from "../config/navFilter";
import { businessType } from "../config/businessTypes";
import { parseDeniedActions } from "../lib/actionPermissions";
import { HttpError } from "./db";
import { branchContext } from "./branches";
import { costHidden, type Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import type { Res, Runner } from "./appDocs";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

type Row = Record<string, unknown>;
const rowsOf = (r: Res | undefined): Row[] => (r ? r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) : []);
const num = (v: unknown) => Number(v) || 0;
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));

/** Sections the app shows as its own screens; every other section opens the web screen inside the app. */
export const NATIVE_SECTIONS = ["dashboard", "invoices", "purchase", "stock", "products"] as const;

export interface AppSection { key: string; label: string; path: string; native: boolean; children: { key: string | null; label: string; path: string }[] }

export interface AppBootstrap {
  user: { id: string; name: string; role: string };
  business: { id: string; name: string; type: string; typeLabel: string; subscriptionStatus: string | null; subscriptionExpiresAt: string | null; logo: string | null };
  /** The web menu this login sees, in order. */
  sections: AppSection[];
  /** Staff: the actions the owner turned off; the business's own (Super Admin) turned-off actions too. */
  deniedActions: string[];
  /** Purchase prices hidden from this login. */
  costHidden: boolean;
  branches: { list: { id: string; name: string; isMain: boolean; status: string }[]; active: string | null; canSwitch: boolean };
  settings: { billoriEnabled: boolean; currency: "PKR" };
}

function allowedModules(tenant: Row, plan: Row | undefined): string[] {
  for (const raw of [tenant.allowed_modules, plan?.allowed_modules]) {
    if (raw == null || raw === "") continue;
    try {
      const v = JSON.parse(String(raw));
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    } catch { /* next */ }
  }
  return [];
}

/** Everything the app needs after sign-in, in one call. */
export async function appBootstrap(sql: Sql, caller: Caller, requestedBranch: string | null): Promise<AppBootstrap> {
  if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
  const T = caller.tenantId;
  const tenant = (await sql.execute(`SELECT * FROM tenants WHERE id = ?`, [T])).rows[0] as Row | undefined;
  if (!tenant) throw new HttpError(404, "Business not found.");
  const plan = tenant.subscription_plan_id
    ? ((await sql.execute(`SELECT allowed_modules FROM subscription_plans WHERE id = ?`, [tenant.subscription_plan_id])).rows[0] as Row | undefined)
    : undefined;
  const keys = ["print_logo", "billori_enabled", "pra_server_managed"];
  const settings = new Map(
    ((await sql.execute(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(", ")})`, keys.map((k) => `${T}::${k}`))).rows as Row[])
      .map((r) => [String(r.key).slice(T.length + 2), String(r.value ?? "")]),
  );
  const user = (await sql.execute(`SELECT display_name, username FROM users WHERE id = ?`, [caller.userId])).rows[0] as Row | undefined;

  const type = businessType(strOrNull(tenant.business_type));
  const nav = visibleNavFor(type.id, allowedModules(tenant, plan), caller.role === "staff" ? caller.permissions ?? null : null, { pra: settings.get("pra_server_managed") === "true" });
  const native = new Set<string>(NATIVE_SECTIONS);
  const sections: AppSection[] = nav.map((n) => ({
    key: n.moduleKey, label: n.label, path: n.href, native: native.has(n.moduleKey),
    children: (n.children ?? []).map((c) => ({ key: c.moduleKey ?? null, label: c.label, path: c.href })),
  }));

  const ctx = await branchContext(sql, caller, requestedBranch).catch((e) => {
    // A business from before branches (no branches table): one branch, nothing to switch.
    if (/no such (table|column)/i.test(String((e as Error)?.message))) return null;
    throw e;
  });
  const logo = settings.get("print_logo") || null;
  return {
    user: { id: caller.userId, name: String(user?.display_name || user?.username || ""), role: caller.role },
    business: {
      id: T, name: String(tenant.name ?? ""), type: type.id, typeLabel: type.label,
      subscriptionStatus: strOrNull(tenant.subscription_status), subscriptionExpiresAt: strOrNull(tenant.subscription_expires_at),
      logo: logo && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(logo) ? logo : null,
    },
    sections,
    deniedActions: [...new Set([...(caller.actions ?? []), ...(caller.tenantDeniedActions ?? []), ...parseDeniedActions(strOrNull(tenant.denied_actions))])],
    costHidden: costHidden(caller),
    branches: ctx
      ? { list: ctx.branches.map((b) => ({ id: b.id, name: b.name, isMain: Boolean(b.isMain), status: String(b.status) })), active: ctx.active, canSwitch: ctx.branches.length > 1 }
      : { list: [], active: null, canSwitch: false },
    // Anything but "false" is on (the same rule as the server's assistant route).
    settings: { billoriEnabled: settings.get("billori_enabled") !== "false", currency: "PKR" },
  };
}

// ── Products ──────────────────────────────────────────────────────────────

export interface AppProductRow { id: string; name: string; barcode: string | null; qty: number; packing: number; unit: string | null; salePrice: number }
export interface AppProductPage { rows: AppProductRow[]; offset: number; nextOffset: number | null }

export const PRODUCT_PAGE = 50;

/** Latest sale price per product (the Stock page's rule: the newest price-list row). */
const LATEST_PRICE = `SELECT product_id, sale_price, mrp, MAX(created_at) AS at FROM price_list WHERE deleted_at IS NULL AND tenant_id = ? GROUP BY product_id`;

/** Products of the business (its own, and shared catalogue items it holds stock of), by name or barcode, a page at a time. */
export async function listProducts(run: Runner, tenantId: string, q: { search?: string | null; offset?: number; limit?: number }): Promise<AppProductPage> {
  const term = (q.search ?? "").trim().slice(0, 80);
  const limit = Math.min(100, Math.max(1, Math.floor(q.limit ?? PRODUCT_PAGE)));
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const like = `%${term}%`;
  const [r] = await run([{
    sql: `SELECT p.id, p.name, p.barcode, COALESCE(p.packing, 1) AS packing, u.name AS unit,
                 COALESCE(SUM(CASE WHEN pb.qty > 0 THEN pb.qty ELSE 0 END), 0) AS qty,
                 COALESCE(pl.sale_price, 0) AS sale_price
          FROM products p
          LEFT JOIN product_batches pb ON pb.product_id = p.id AND pb.tenant_id = ? AND pb.deleted_at IS NULL
          LEFT JOIN uoms u ON u.id = p.base_unit_id
          LEFT JOIN (${LATEST_PRICE}) pl ON pl.product_id = p.id
          WHERE p.deleted_at IS NULL AND (p.tenant_id = ? OR (p.tenant_id IS NULL AND pb.id IS NOT NULL))
            AND COALESCE(p.product_classification, '') <> 'pra_service'
            ${term ? "AND (p.name LIKE ? OR p.barcode LIKE ?)" : ""}
          GROUP BY p.id
          ORDER BY p.name COLLATE NOCASE ASC
          LIMIT ? OFFSET ?`,
    args: [tenantId, tenantId, tenantId, ...(term ? [like, like] : []), limit + 1, offset],
  }], false);
  const rows = rowsOf(r);
  const more = rows.length > limit;
  return {
    rows: rows.slice(0, limit).map((x) => ({
      id: String(x.id), name: String(x.name ?? ""), barcode: strOrNull(x.barcode), qty: num(x.qty), packing: num(x.packing) || 1, unit: strOrNull(x.unit), salePrice: num(x.sale_price),
    })),
    offset,
    nextOffset: more ? offset + limit : null,
  };
}

export interface AppProductDetail {
  id: string; name: string; barcode: string | null; company: string | null; category: string | null;
  packing: number; unit: string | null; salePrice: number; mrp: number; qty: number;
  /** Null when purchase prices are hidden from this login. */
  batches: { id: string; batchNo: string | null; expiry: string | null; qty: number; purchasePrice: number | null }[];
}

export async function productDetail(run: Runner, tenantId: string, id: string): Promise<AppProductDetail> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, "Invalid product.");
  const [p, b] = await run([
    {
      sql: `SELECT p.id, p.name, p.barcode, p.company_name, COALESCE(p.packing, 1) AS packing, u.name AS unit, c.name AS category,
                   COALESCE(pl.sale_price, 0) AS sale_price, COALESCE(pl.mrp, 0) AS mrp
            FROM products p
            LEFT JOIN uoms u ON u.id = p.base_unit_id
            LEFT JOIN categories c ON c.id = p.category_id AND (c.tenant_id = ? OR c.tenant_id IS NULL)
            LEFT JOIN (${LATEST_PRICE}) pl ON pl.product_id = p.id
            WHERE p.id = ? AND p.deleted_at IS NULL AND (p.tenant_id = ? OR p.tenant_id IS NULL)`,
      args: [tenantId, tenantId, id, tenantId],
    },
    {
      sql: `SELECT id, batch_no, expiry_date, qty, purchase_price FROM product_batches
            WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL AND qty > 0
            ORDER BY COALESCE(expiry_date, '9999-12-31') ASC`,
      args: [id, tenantId],
    },
  ], false);
  const row = rowsOf(p)[0];
  if (!row) throw new HttpError(404, "Product not found.");
  const batches = rowsOf(b);
  return {
    id: String(row.id), name: String(row.name ?? ""), barcode: strOrNull(row.barcode), company: strOrNull(row.company_name), category: strOrNull(row.category),
    packing: num(row.packing) || 1, unit: strOrNull(row.unit), salePrice: num(row.sale_price), mrp: num(row.mrp),
    qty: batches.reduce((t, x) => t + num(x.qty), 0),
    batches: batches.map((x) => ({
      id: String(x.id), batchNo: strOrNull(x.batch_no), expiry: strOrNull(x.expiry_date), qty: num(x.qty),
      // Removed by the server for logins without purchase prices: absent means hidden.
      purchasePrice: "purchase_price" in x ? num(x.purchase_price) : null,
    })),
  };
}

// ── Home (the web Dashboard's figures, lib/repo/dashboard.ts) ────────────

export interface AppDashboard {
  today: string;
  summary: { sales: number; invoiceCount: number; expenses: number; cashIn: number; cashOut: number };
  lowStock: { id: string; name: string; qty: number }[];
  expiring: { id: string; product: string; batchNo: string | null; expiry: string; qty: number }[];
  recentInvoices: { id: string; invoiceNo: number | null; date: string; customer: string; total: number; balance: number }[];
}

/** Today's figures, low stock, batches expiring within 180 days and the latest invoices: the same rules as the web Dashboard. */
export async function appDashboard(run: Runner, caller: Caller, today: string): Promise<AppDashboard> {
  const T = caller.tenantId;
  if (!T) throw new HttpError(403, "This login is not attached to a business.");
  if (caller.role === "staff" && Array.isArray(caller.permissions) && !caller.permissions.includes("dashboard")) {
    throw new HttpError(403, "Your login has no access to the Dashboard. Ask the owner to allow it.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new HttpError(400, "Invalid date.");
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 180);
  const day = `substr(date, 1, 10) = ?`;
  const res = await run([
    { sql: `SELECT COALESCE(SUM(CASE WHEN COALESCE(is_return, 0) = 0 THEN COALESCE(total, 0) ELSE -COALESCE(total, 0) END), 0) AS sales,
                   COALESCE(SUM(CASE WHEN COALESCE(is_return, 0) = 0 THEN 1 ELSE 0 END), 0) AS n
            FROM invoices WHERE deleted_at IS NULL AND tenant_id = ? AND COALESCE(is_memorized, 0) = 0 AND COALESCE(is_quotation, 0) = 0 AND ${day}`, args: [T, today] },
    { sql: `SELECT COALESCE(SUM(amount), 0) AS n FROM expenses WHERE deleted_at IS NULL AND tenant_id = ? AND ${day}`, args: [T, today] },
    { sql: `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'in' THEN amount ELSE 0 END), 0) AS cash_in,
                   COALESCE(SUM(CASE WHEN transaction_type = 'out' THEN amount ELSE 0 END), 0) AS cash_out
            FROM cash_register_entries WHERE deleted_at IS NULL AND tenant_id = ? AND ${day}`, args: [T, today] },
    { sql: `SELECT COALESCE(SUM(paid), 0) AS n FROM invoices WHERE deleted_at IS NULL AND tenant_id = ? AND COALESCE(is_return, 0) = 0
            AND COALESCE(is_memorized, 0) = 0 AND COALESCE(is_quotation, 0) = 0 AND ${day}`, args: [T, today] },
    { sql: `SELECT COALESCE(SUM(paid), 0) AS n FROM invoices WHERE deleted_at IS NULL AND tenant_id = ? AND COALESCE(is_return, 0) = 1
            AND COALESCE(is_quotation, 0) = 0 AND ${day}`, args: [T, today] },
    { sql: `SELECT COALESCE(SUM(paid_amount), 0) AS n FROM purchases WHERE deleted_at IS NULL AND tenant_id = ? AND COALESCE(is_return, 0) = 0 AND ${day}`, args: [T, today] },
    { sql: `SELECT COALESCE(SUM(paid_amount), 0) AS n FROM purchases WHERE deleted_at IS NULL AND tenant_id = ? AND COALESCE(is_return, 0) = 1 AND ${day}`, args: [T, today] },
    { sql: `SELECT COALESCE(SUM(paid_amount), 0) AS n FROM ledger_adjustments WHERE deleted_at IS NULL AND tenant_id = ? AND party_type = 'customer' AND ${day}`, args: [T, today] },
    { sql: `SELECT COALESCE(SUM(paid_amount), 0) AS n FROM ledger_adjustments WHERE deleted_at IS NULL AND tenant_id = ? AND party_type IN ('supplier', 'staff') AND ${day}`, args: [T, today] },
    { sql: `SELECT * FROM (
              SELECT p.id, p.name, p.max_stock_qty,
                     COALESCE((SELECT SUM(qty) FROM product_batches WHERE product_id = p.id AND tenant_id = ? AND deleted_at IS NULL), 0) AS avail_qty
              FROM products p
              WHERE p.deleted_at IS NULL AND p.tenant_id = ? AND COALESCE(p.product_classification, '') <> 'pra_service'
            ) WHERE avail_qty <= COALESCE(max_stock_qty * 0.2, 10) ORDER BY avail_qty ASC LIMIT 8`, args: [T, T] },
    { sql: `SELECT pb.id, p.name AS product_name, pb.batch_no, pb.expiry_date, pb.qty
            FROM product_batches pb
            JOIN products p ON p.id = pb.product_id AND (p.tenant_id = pb.tenant_id OR p.tenant_id IS NULL)
            WHERE pb.deleted_at IS NULL AND pb.tenant_id = ? AND pb.qty > 0 AND pb.expiry_date IS NOT NULL AND date(pb.expiry_date) <= ?
            ORDER BY pb.expiry_date ASC LIMIT 12`, args: [T, until.toISOString().slice(0, 10)] },
    { sql: `SELECT i.id, i.invoice_no, i.date, COALESCE(c.name, 'Walk-in') AS customer_name, i.total, i.balance
            FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
            WHERE i.deleted_at IS NULL AND i.tenant_id = ? AND i.is_return = 0 AND i.is_memorized = 0 AND i.is_quotation = 0
            ORDER BY i.created_at DESC LIMIT 6`, args: [T] },
  ], false);
  const n = (i: number, col = "n") => num(rowsOf(res[i])[0]?.[col]);
  const expenses = n(1);
  return {
    today,
    summary: {
      sales: n(0, "sales"), invoiceCount: n(0), expenses,
      cashIn: n(2, "cash_in") + n(3) + n(6) + n(7),
      cashOut: n(2, "cash_out") + n(4) + n(5) + n(8) + expenses,
    },
    lowStock: rowsOf(res[9]).map((x) => ({ id: String(x.id), name: String(x.name ?? ""), qty: num(x.avail_qty) })),
    expiring: rowsOf(res[10]).map((x) => ({ id: String(x.id), product: String(x.product_name ?? ""), batchNo: strOrNull(x.batch_no), expiry: String(x.expiry_date), qty: num(x.qty) })),
    recentInvoices: rowsOf(res[11]).map((x) => ({ id: String(x.id), invoiceNo: x.invoice_no == null ? null : num(x.invoice_no), date: String(x.date ?? ""), customer: String(x.customer_name), total: num(x.total), balance: num(x.balance) })),
  };
}
