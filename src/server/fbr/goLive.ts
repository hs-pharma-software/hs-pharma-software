/** Go-live "Clear" (Super Admin): after a business finished FBR sandbox
 * testing and its production token is saved, its test-period sales are
 * removed so it starts work clean:
 *
 * - every invoice, sale return, quotation and draft, with their lines;
 * - customer payments (ledger adjustments of customers);
 * - its FBR submission records;
 * - the stock those sales took is put back, batch by batch (sold minus returned);
 * - handsets sold on them are in stock again.
 *
 * Products, customers, suppliers, purchases, settings and FBR tokens stay.
 * Bill numbers start again at 1 (the rows are removed, not hidden), so the
 * response carries a full copy of everything removed (the page downloads it),
 * and the business's delete history and the server audit log record it.
 *
 * Refused when: no production token yet, a production invoice was accepted by
 * FBR (real tax records), other modules hang on these invoices (hospital,
 * clinic, online orders, distribution, banquet), or the name typed to confirm
 * is not the business's name. */
import { randomUUID } from "node:crypto";
import { HttpError } from "@/server/db";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import { tokensOf, type FbrDeps } from "./service";

const LINKED: [table: string, label: string][] = [
  ["hospital_charges", "hospital charges"],
  ["hospital_surgery_bookings", "surgery bookings"],
  ["clinic_orders", "clinic orders"],
  ["web_orders", "online orders"],
  ["dist_bookings", "distribution bookings"],
  ["banquet_bookings", "banquet bookings"],
];
/** Above this, the copy would be too large for one download: use a database backup instead. */
export const CLEAR_MAX_INVOICES = 5000;

const str = (x: unknown) => (typeof x === "string" ? x : "");
const n = (x: unknown) => Number(x ?? 0) || 0;

interface StockLine { product_id: string; batch_no: string | null; branch_id: string | null; net: number; purchase_price: number }

async function inspect(sql: Sql, T: string, deps: FbrDeps) {
  const tenant = (await sql.execute(`SELECT id, name FROM tenants WHERE id = ?`, [T])).rows[0];
  if (!tenant) throw new HttpError(404, "Business not found.");
  const inv = (await sql.execute(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN deleted_at IS NULL AND COALESCE(is_return, 0) = 0 AND COALESCE(is_quotation, 0) = 0 AND COALESCE(is_memorized, 0) = 0 THEN 1 ELSE 0 END) AS sales,
       SUM(CASE WHEN deleted_at IS NULL AND COALESCE(is_return, 0) = 1 THEN 1 ELSE 0 END) AS returns,
       SUM(CASE WHEN deleted_at IS NULL AND COALESCE(is_quotation, 0) = 1 THEN 1 ELSE 0 END) AS quotations,
       SUM(CASE WHEN deleted_at IS NULL AND COALESCE(is_memorized, 0) = 1 THEN 1 ELSE 0 END) AS drafts,
       SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted,
       SUM(CASE WHEN COALESCE(fbr_invoice_no, '') <> '' THEN 1 ELSE 0 END) AS with_fbr_no
     FROM invoices WHERE tenant_id = ?`, [T],
  )).rows[0];
  const items = n((await sql.execute(`SELECT COUNT(*) AS c FROM invoice_items WHERE tenant_id = ?`, [T])).rows[0].c);
  const payments = n((await sql.execute(`SELECT COUNT(*) AS c FROM ledger_adjustments WHERE tenant_id = ? AND party_type = 'customer'`, [T])).rows[0].c);
  const fbrRecords = n((await sql.execute(`SELECT COUNT(*) AS c FROM fbr_submissions WHERE tenant_id = ?`, [T])).rows[0].c);
  const productionAccepted = n((await sql.execute(`SELECT COUNT(*) AS c FROM fbr_submissions WHERE tenant_id = ? AND environment = 'production' AND status = 'accepted'`, [T])).rows[0].c);
  const handsets = n((await sql.execute(
    `SELECT COUNT(*) AS c FROM mobile_imei_units WHERE tenant_id = ? AND status = 'sold' AND invoice_id IN (SELECT id FROM invoices WHERE tenant_id = ?)`, [T, T],
  )).rows[0].c);
  const linked: string[] = [];
  for (const [table, label] of LINKED) {
    const c = n((await sql.execute(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ? AND invoice_id IN (SELECT id FROM invoices WHERE tenant_id = ?)`, [T, T])).rows[0].c);
    if (c) linked.push(`${c} ${label}`);
  }
  const stock = (await sql.execute(
    `SELECT ii.product_id, ii.batch_no, i.branch_id,
            SUM(CASE WHEN COALESCE(i.is_return, 0) = 1 THEN -1 ELSE 1 END * (COALESCE(ii.qty, 0) + COALESCE(ii.bonus_qty, 0))) AS net,
            MAX(COALESCE(ii.purchase_price, 0)) AS purchase_price
     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id AND i.tenant_id = ii.tenant_id
     WHERE i.tenant_id = ? AND i.deleted_at IS NULL AND ii.deleted_at IS NULL
       AND COALESCE(i.is_quotation, 0) = 0 AND COALESCE(i.is_memorized, 0) = 0 AND ii.product_id IS NOT NULL
     GROUP BY ii.product_id, ii.batch_no, i.branch_id`, [T],
  )).rows
    .map((r): StockLine => ({ product_id: String(r.product_id), batch_no: (r.batch_no as string | null) || null, branch_id: (r.branch_id as string | null) ?? null, net: n(r.net), purchase_price: n(r.purchase_price) }))
    .filter((r) => Math.abs(r.net) > 1e-9);
  const tokens = await tokensOf(sql, T, deps);

  const blockers: string[] = [];
  if (!tokens.production) blockers.push("Save this business's production token first (FBR setup).");
  if (productionAccepted) blockers.push(`${productionAccepted} invoice(s) were accepted by FBR in production: those are real tax records and are not cleared.`);
  if (linked.length) blockers.push(`Other records are linked to these invoices (${linked.join(", ")}). Clear handles shop sales only.`);
  if (n(inv.total) > CLEAR_MAX_INVOICES) blockers.push(`${n(inv.total)} invoices is more than Clear handles (${CLEAR_MAX_INVOICES}).`);
  const warnings: string[] = [];
  if (n(inv.with_fbr_no)) warnings.push(`${n(inv.with_fbr_no)} invoice(s) carry an FBR number. They must be sandbox (test) invoices.`);

  return {
    tenant: { id: T, name: String(tenant.name ?? "") },
    counts: {
      invoices: n(inv.total), sales: n(inv.sales), returns: n(inv.returns), quotations: n(inv.quotations), drafts: n(inv.drafts), deleted: n(inv.deleted),
      lines: items, customerPayments: payments, fbrRecords, handsets, stockBatches: stock.length,
    },
    stock, blockers, warnings,
  };
}

function superAdmin(c: Caller) {
  if (c.role !== "super_admin") throw new HttpError(403, "Super Admin only.");
}

/** What Clear would remove and put back, and what stops it. */
export async function clearPreview(sql: Sql, caller: Caller, input: { tenantId?: unknown }, deps: FbrDeps = {}) {
  superAdmin(caller);
  const r = await inspect(sql, str(input.tenantId), deps);
  return { tenant: r.tenant, counts: r.counts, blockers: r.blockers, warnings: r.warnings };
}

/** Clears the business's sales (see the top of this file). */
export async function clearSales(sql: Sql, caller: Caller, input: { tenantId?: unknown; confirmName?: unknown }, deps: FbrDeps = {}) {
  superAdmin(caller);
  const T = str(input.tenantId);
  const r = await inspect(sql, T, deps);
  if (r.blockers.length) throw new HttpError(409, r.blockers.join("\n"));
  if (str(input.confirmName).trim().toLowerCase() !== r.tenant.name.trim().toLowerCase()) {
    throw new HttpError(400, "Type the business's name exactly to confirm.");
  }
  const now = (deps.now ?? (() => new Date()))().toISOString();

  // The copy handed back before anything is removed.
  const rows = async (q: string, a: unknown[]) => (await sql.execute(q, a)).rows.map((x) => ({ ...x }));
  const archive = {
    kind: "mavin-sales-clear", tenant: r.tenant, clearedAt: now, clearedBy: caller.userId, counts: r.counts,
    invoices: await rows(`SELECT * FROM invoices WHERE tenant_id = ?`, [T]),
    invoice_items: await rows(`SELECT * FROM invoice_items WHERE tenant_id = ?`, [T]),
    customer_payments: await rows(`SELECT * FROM ledger_adjustments WHERE tenant_id = ? AND party_type = 'customer'`, [T]),
    fbr_submissions: await rows(`SELECT * FROM fbr_submissions WHERE tenant_id = ?`, [T]),
    handsets_released: await rows(`SELECT id, product_id, imei, invoice_id, sold_at FROM mobile_imei_units WHERE tenant_id = ? AND status = 'sold' AND invoice_id IN (SELECT id FROM invoices WHERE tenant_id = ?)`, [T, T]),
    stock_restored: r.stock,
  };

  const stmts: { sql: string; args: unknown[] }[] = [];
  for (const s of r.stock) {
    // Same as deleting one invoice: back into its batch (by product and batch number), or a new batch.
    const batch = s.batch_no
      ? (await sql.execute(
          `SELECT id FROM product_batches WHERE tenant_id = ? AND product_id = ? AND batch_no = ? AND branch_id IS ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
          [T, s.product_id, s.batch_no, s.branch_id],
        )).rows[0]
      : undefined;
    if (batch) stmts.push({ sql: `UPDATE product_batches SET qty = qty + ?, updated_at = ? WHERE id = ?`, args: [s.net, now, batch.id] });
    else {
      stmts.push({
        sql: `INSERT INTO product_batches (id, product_id, batch_no, qty, purchase_price, tenant_id, branch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [randomUUID(), s.product_id, s.batch_no, s.net, s.purchase_price, T, s.branch_id, now, now],
      });
    }
  }
  stmts.push(
    { sql: `UPDATE mobile_imei_units SET status = 'in_stock', invoice_id = NULL, sold_at = NULL, customer_name = NULL, customer_mobile = NULL, customer_cnic = NULL, updated_at = ? WHERE tenant_id = ? AND status = 'sold' AND invoice_id IN (SELECT id FROM invoices WHERE tenant_id = ?)`, args: [now, T, T] },
    { sql: `UPDATE pharmacy_rx_notifications SET invoice_id = NULL, updated_at = ? WHERE pharmacy_tenant_id = ? AND invoice_id IN (SELECT id FROM invoices WHERE tenant_id = ?)`, args: [now, T, T] },
    { sql: `DELETE FROM offline_exceptions WHERE tenant_id = ? AND invoice_id IN (SELECT id FROM invoices WHERE tenant_id = ?)`, args: [T, T] },
    { sql: `DELETE FROM invoice_items WHERE tenant_id = ?`, args: [T] },
    { sql: `DELETE FROM invoices WHERE tenant_id = ?`, args: [T] },
    { sql: `DELETE FROM ledger_adjustments WHERE tenant_id = ? AND party_type = 'customer'`, args: [T] },
    { sql: `DELETE FROM fbr_submissions WHERE tenant_id = ?`, args: [T] },
  );
  const c = r.counts;
  const summary = `FBR go-live: test sales cleared by MAVIN Super Admin: ${c.invoices} invoice(s) (${c.sales} sales, ${c.returns} returns, ${c.quotations} quotations, ${c.drafts} drafts, ${c.deleted} already deleted), ${c.customerPayments} customer payment(s), ${c.fbrRecords} FBR record(s); stock put back in ${c.stockBatches} batch(es), ${c.handsets} handset(s) back in stock.`;
  stmts.push(
    { sql: `INSERT INTO delete_history (id, tenant_id, date, delete_from, delete_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [randomUUID(), T, now, "All sales (FBR go-live)", "MAVIN Super Admin", summary, now] },
    { sql: `INSERT INTO server_audit_log (id, user_id, tenant_id, role, verb, tables, statement, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [randomUUID(), caller.userId, T, "super_admin", "CLEAR", "invoices,invoice_items,ledger_adjustments,fbr_submissions,product_batches", summary, null, now] },
  );
  await sql.batch(stmts);
  return { ok: true, summary, archive };
}
