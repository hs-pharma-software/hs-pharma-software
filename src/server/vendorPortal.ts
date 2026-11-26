/** Vendor portal (schema v109): a hospital's suppliers and vendors sign in
 * and see only what was sent to them.
 *
 * - Quote requests: the purchase officer's requests for rates that name this
 *   vendor. One vendor asked = a petty purchase, several = a quotation. The
 *   vendor quotes a rate per item; they never see another vendor's name or rate.
 * - Purchase orders issued to this vendor.
 * - Payments: each purchase order's invoice (submitted here), where it is
 *   (with the Purchase Cell, with the store for checking, with Finance) and
 *   what Finance has paid.
 *
 * A vendor login is a users row with platform_role 'vendor', linked to its
 * supplier in vendor_portal_logins. The server refuses such a login on every
 * other route (callerOf), so it never reaches /api/db or any business data. */
import { randomBytes, randomUUID } from "node:crypto";
import { HttpError, passwordHash } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface VendorActor {
  userId: string; tenantId: string; vendorId: string; vendorName: string; vendorNo: string | null; hospitalName: string; username: string;
}

const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;
const round = (n: number) => Math.round(n * 100) / 100;
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const RFQ_KIND_LABEL: Record<string, string> = { petty: "Petty purchase", quotation: "Quotation" };

/** The vendor behind a vendor login (and the hospital it belongs to). */
export async function vendorActorFor(sql: Sql, caller: Pick<Caller, "userId" | "platformRole">): Promise<VendorActor> {
  if (caller.platformRole !== "vendor") throw new HttpError(403, "The vendor portal is for vendor logins.");
  const r = (await sql.execute(
    `SELECT l.tenant_id, l.vendor_id, s.name AS vendor_name, s.vendor_no, t.name AS hospital_name, u.username
     FROM vendor_portal_logins l
     JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL AND u.is_active = 1
     JOIN suppliers s ON s.id = l.vendor_id AND s.tenant_id = l.tenant_id AND s.deleted_at IS NULL
     LEFT JOIN tenants t ON t.id = l.tenant_id
     WHERE l.user_id = ? AND l.deleted_at IS NULL`, [caller.userId])).rows[0];
  if (!r) throw new HttpError(403, "This login is not linked to a vendor. Ask the hospital's purchase officer.");
  return {
    userId: caller.userId, tenantId: String(r.tenant_id), vendorId: String(r.vendor_id), vendorName: String(r.vendor_name),
    vendorNo: str(r.vendor_no), hospitalName: str(r.hospital_name) ?? "Hospital", username: String(r.username),
  };
}

// ── What the vendor sees ───────────────────────────────────────────────────

export interface PortalRequestItem { id: string; productName: string; specification: string | null; qty: number; uom: string | null; rate: number | null; offeredSpec: string | null; available: boolean }
export interface PortalRequest {
  id: string; rfqNo: string; kind: "petty" | "quotation"; kindLabel: string; title: string | null; date: string; dueDate: string | null; note: string | null;
  status: "open" | "awarded" | "cancelled" | "closed"; myStatus: "requested" | "quoted" | "declined" | "awarded" | "not_awarded";
  canQuote: boolean; deliveryDays: number | null; validTill: string | null; remarks: string | null; items: PortalRequestItem[];
}

/** The requests for rates sent to this vendor, newest first. */
export async function portalRequests(sql: Sql, a: VendorActor): Promise<PortalRequest[]> {
  const rfqs = (await sql.execute(
    `SELECT r.id, r.rfq_no, r.kind, r.title, r.created_at, r.due_date, r.note, r.status,
            v.status AS my_status, v.delivery_days, v.valid_till, v.remarks
     FROM hospital_rfq_vendors v JOIN hospital_rfqs r ON r.id = v.rfq_id AND r.tenant_id = v.tenant_id AND r.deleted_at IS NULL
     WHERE v.tenant_id = ? AND v.vendor_id = ? AND v.deleted_at IS NULL
     ORDER BY r.created_at DESC LIMIT 200`, [a.tenantId, a.vendorId])).rows;
  if (!rfqs.length) return [];
  const ids = rfqs.map((r) => String(r.id));
  const marks = ids.map(() => "?").join(",");
  const items = (await sql.execute(
    `SELECT i.id, i.rfq_id, i.product_name, i.specification, i.qty, i.uom, q.rate, q.offered_spec, q.available
     FROM hospital_rfq_items i
     LEFT JOIN hospital_rfq_quotes q ON q.rfq_item_id = i.id AND q.tenant_id = i.tenant_id AND q.vendor_id = ? AND q.deleted_at IS NULL
     WHERE i.tenant_id = ? AND i.rfq_id IN (${marks}) AND i.deleted_at IS NULL ORDER BY i.sort, i.created_at`, [a.vendorId, a.tenantId, ...ids])).rows;
  return rfqs.map((r) => {
    const status = String(r.status) as PortalRequest["status"];
    const myStatus = String(r.my_status) as PortalRequest["myStatus"];
    const due = str(r.due_date);
    return {
      id: String(r.id), rfqNo: String(r.rfq_no), kind: String(r.kind) === "petty" ? "petty" : "quotation", kindLabel: RFQ_KIND_LABEL[String(r.kind)] ?? "Quotation",
      title: str(r.title), date: String(r.created_at).slice(0, 10), dueDate: due, note: str(r.note), status, myStatus,
      canQuote: status === "open" && (myStatus === "requested" || myStatus === "quoted") && (!due || due >= today()),
      deliveryDays: r.delivery_days == null ? null : num(r.delivery_days), validTill: str(r.valid_till), remarks: str(r.remarks),
      items: items.filter((i) => String(i.rfq_id) === String(r.id)).map((i) => ({
        id: String(i.id), productName: String(i.product_name), specification: str(i.specification), qty: num(i.qty), uom: str(i.uom),
        rate: i.rate == null ? null : num(i.rate), offeredSpec: str(i.offered_spec), available: i.available == null ? true : num(i.available) === 1,
      })),
    };
  });
}

async function invitation(sql: Sql, a: VendorActor, rfqId: unknown): Promise<{ rfq: Record<string, unknown>; invite: Record<string, unknown> }> {
  if (typeof rfqId !== "string" || !rfqId) throw new HttpError(400, "Which request?");
  const rfq = (await sql.execute(`SELECT * FROM hospital_rfqs WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [rfqId, a.tenantId])).rows[0];
  const invite = rfq && (await sql.execute(
    `SELECT * FROM hospital_rfq_vendors WHERE rfq_id = ? AND tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL`, [rfqId, a.tenantId, a.vendorId])).rows[0];
  // Not sent to this vendor: answered exactly like a request that does not exist.
  if (!rfq || !invite) throw new HttpError(404, "Request not found.");
  return { rfq, invite };
}

function assertQuotable(rfq: Record<string, unknown>, invite: Record<string, unknown>): void {
  if (String(rfq.status) !== "open") throw new HttpError(409, "This request is closed: rates can no longer be sent.");
  if (String(invite.status) === "declined") throw new HttpError(409, "You declined this request.");
  const due = str(rfq.due_date);
  if (due && due < today()) throw new HttpError(409, `The last date for rates was ${due}.`);
}

/** The vendor's rates for a request (sent again, they replace the earlier ones while it is open). */
export async function submitQuote(sql: Sql, a: VendorActor, b: Record<string, unknown>): Promise<{ ok: true }> {
  const { rfq, invite } = await invitation(sql, a, b.rfqId);
  assertQuotable(rfq, invite);
  const items = (await sql.execute(`SELECT id, product_name FROM hospital_rfq_items WHERE rfq_id = ? AND tenant_id = ? AND deleted_at IS NULL`, [rfq.id, a.tenantId])).rows;
  const byId = new Map(items.map((i) => [String(i.id), String(i.product_name)]));
  const lines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const given = new Map<string, { rate: number | null; spec: string | null; available: boolean }>();
  for (const l of lines) {
    const id = String(l?.itemId ?? "");
    if (!byId.has(id)) throw new HttpError(400, "An item is not part of this request.");
    const available = l.available !== false;
    const rate = available ? Number(l.rate) : null;
    if (available && !(Number.isFinite(rate) && (rate as number) > 0)) throw new HttpError(400, `Enter your rate for ${byId.get(id)} (or mark it not available).`);
    if (available && (rate as number) > 1e9) throw new HttpError(400, `The rate for ${byId.get(id)} is too large.`);
    given.set(id, { rate: rate == null ? null : round(rate), spec: text(l.offeredSpec, 500) || null, available });
  }
  if (![...given.values()].some((g) => g.available)) throw new HttpError(400, "Quote a rate for at least one item, or decline the request.");
  const missing = items.find((i) => !given.has(String(i.id)));
  if (missing) throw new HttpError(400, `Enter your rate for ${missing.product_name} (or mark it not available).`);
  const days = b.deliveryDays == null || b.deliveryDays === "" ? null : Math.round(Number(b.deliveryDays));
  if (days != null && !(days >= 0 && days <= 365)) throw new HttpError(400, "Delivery days: 0 to 365.");
  const validTill = typeof b.validTill === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.validTill) ? b.validTill : null;
  const t = now();
  const statements: { sql: string; args: unknown[] }[] = [
    { sql: `UPDATE hospital_rfq_quotes SET deleted_at = ?, updated_at = ? WHERE rfq_id = ? AND tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL`, args: [t, t, rfq.id, a.tenantId, a.vendorId] },
  ];
  for (const [itemId, g] of given) {
    statements.push({
      sql: `INSERT INTO hospital_rfq_quotes (id, tenant_id, rfq_id, rfq_item_id, vendor_id, rate, offered_spec, available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), a.tenantId, rfq.id, itemId, a.vendorId, g.rate, g.spec, g.available ? 1 : 0, t, t],
    });
  }
  statements.push({
    sql: `UPDATE hospital_rfq_vendors SET status = 'quoted', quoted_at = ?, delivery_days = ?, valid_till = ?, remarks = ?, decline_reason = NULL, updated_at = ? WHERE id = ?`,
    args: [t, days, validTill, text(b.remarks, 1000) || null, t, invite.id],
  });
  await sql.batch(statements);
  return { ok: true };
}

/** The vendor cannot supply this request. */
export async function declineRequest(sql: Sql, a: VendorActor, b: Record<string, unknown>): Promise<{ ok: true }> {
  const { rfq, invite } = await invitation(sql, a, b.rfqId);
  assertQuotable(rfq, invite);
  const t = now();
  await sql.batch([
    { sql: `UPDATE hospital_rfq_quotes SET deleted_at = ?, updated_at = ? WHERE rfq_id = ? AND tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL`, args: [t, t, rfq.id, a.tenantId, a.vendorId] },
    { sql: `UPDATE hospital_rfq_vendors SET status = 'declined', decline_reason = ?, updated_at = ? WHERE id = ?`, args: [text(b.reason, 500) || null, t, invite.id] },
  ]);
  return { ok: true };
}

export interface PortalOrderItem { productName: string; specification: string | null; qty: number; uom: string | null; rate: number; amount: number }
export interface PortalOrder {
  id: string; poNo: string; kind: "petty" | "quotation"; kindLabel: string; rfqNo: string | null; issuedAt: string; issuedBy: string | null;
  status: "issued" | "invoiced" | "cancelled"; total: number; deliveryDays: number | null; note: string | null; cancelReason: string | null; items: PortalOrderItem[];
}

/** Purchase orders issued to this vendor, newest first. */
export async function portalOrders(sql: Sql, a: VendorActor): Promise<PortalOrder[]> {
  const pos = (await sql.execute(
    `SELECT p.*, r.rfq_no FROM hospital_purchase_orders p LEFT JOIN hospital_rfqs r ON r.id = p.rfq_id AND r.tenant_id = p.tenant_id
     WHERE p.tenant_id = ? AND p.vendor_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 200`, [a.tenantId, a.vendorId])).rows;
  if (!pos.length) return [];
  const ids = pos.map((p) => String(p.id));
  const items = (await sql.execute(
    `SELECT po_id, product_name, specification, qty, uom, rate FROM hospital_po_items WHERE tenant_id = ? AND po_id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL ORDER BY created_at`,
    [a.tenantId, ...ids])).rows;
  return pos.map((p) => ({
    id: String(p.id), poNo: String(p.po_no), kind: String(p.kind) === "petty" ? "petty" : "quotation", kindLabel: RFQ_KIND_LABEL[String(p.kind)] ?? "Quotation",
    rfqNo: str(p.rfq_no), issuedAt: String(p.issued_at ?? p.created_at).slice(0, 10), issuedBy: str(p.issued_by_name),
    status: String(p.status) as PortalOrder["status"], total: num(p.total), deliveryDays: p.delivery_days == null ? null : num(p.delivery_days),
    note: str(p.note), cancelReason: str(p.cancel_reason),
    items: items.filter((i) => String(i.po_id) === String(p.id)).map((i) => ({
      productName: String(i.product_name), specification: str(i.specification), qty: num(i.qty), uom: str(i.uom), rate: num(i.rate), amount: round(num(i.qty) * num(i.rate)),
    })),
  }));
}

export type PaymentStage = "not_invoiced" | "with_purchase_cell" | "returned_to_vendor" | "with_store" | "returned_by_store" | "unpaid" | "part_paid" | "paid";
export const PAYMENT_STAGE_LABEL: Record<PaymentStage, string> = {
  not_invoiced: "Invoice not submitted", with_purchase_cell: "With the Purchase Cell", returned_to_vendor: "Returned to you",
  with_store: "With the store for checking", returned_by_store: "Returned by the store", unpaid: "Unpaid · with Finance", part_paid: "Part paid", paid: "Paid",
};

export interface PortalPayment {
  poId: string; poNo: string; poTotal: number; issuedAt: string;
  invoice: { id: string; invoiceNo: string; invoiceDate: string; amount: number; returnReason: string | null } | null;
  stage: PaymentStage; stageLabel: string; paid: number; balance: number; canSubmitInvoice: boolean;
  payments: { date: string; amount: number; method: string; reference: string | null }[];
}

/** Every purchase order with its invoice and payment status. */
export async function portalPayments(sql: Sql, a: VendorActor): Promise<PortalPayment[]> {
  const rows = (await sql.execute(
    `SELECT p.id AS po_id, p.po_no, p.total AS po_total, p.issued_at, p.created_at,
            i.id AS invoice_id, i.invoice_no, i.invoice_date, i.amount, i.status AS invoice_status, i.return_reason, i.store_purchase_id,
            sp.status AS sp_status, sp.paid AS sp_paid, sp.balance AS sp_balance, sp.total AS sp_total
     FROM hospital_purchase_orders p
     LEFT JOIN hospital_vendor_invoices i ON i.id = (
       SELECT x.id FROM hospital_vendor_invoices x WHERE x.po_id = p.id AND x.tenant_id = p.tenant_id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1)
     LEFT JOIN hospital_store_purchases sp ON sp.id = i.store_purchase_id AND sp.tenant_id = p.tenant_id AND sp.deleted_at IS NULL
     WHERE p.tenant_id = ? AND p.vendor_id = ? AND p.deleted_at IS NULL AND p.status != 'cancelled'
     ORDER BY p.created_at DESC LIMIT 200`, [a.tenantId, a.vendorId])).rows;
  const spIds = rows.map((r) => str(r.store_purchase_id)).filter((x): x is string => Boolean(x));
  const pays = spIds.length ? (await sql.execute(
    `SELECT doc_id, dated, amount, method, reference FROM hospital_vendor_payments
     WHERE tenant_id = ? AND doc_type = 'store_purchase' AND vendor_id = ? AND doc_id IN (${spIds.map(() => "?").join(",")}) AND deleted_at IS NULL ORDER BY dated, created_at`,
    [a.tenantId, a.vendorId, ...spIds])).rows : [];
  return rows.map((r) => {
    const inv = r.invoice_id ? String(r.invoice_status) : null;
    let stage: PaymentStage = "not_invoiced";
    let paid = 0;
    let balance = num(r.po_total);
    if (inv === "submitted") stage = "with_purchase_cell";
    else if (inv === "returned" || inv === "cancelled") stage = "returned_to_vendor";
    else if (inv === "forwarded") {
      const sp = str(r.sp_status);
      paid = num(r.sp_paid);
      balance = r.sp_balance == null ? num(r.amount) : num(r.sp_balance);
      stage = sp === "returned" ? "returned_by_store" : sp === "verified" ? (balance <= 0.004 ? "paid" : paid > 0.004 ? "part_paid" : "unpaid") : "with_store";
    }
    return {
      poId: String(r.po_id), poNo: String(r.po_no), poTotal: num(r.po_total), issuedAt: String(r.issued_at ?? r.created_at).slice(0, 10),
      invoice: r.invoice_id ? { id: String(r.invoice_id), invoiceNo: String(r.invoice_no), invoiceDate: String(r.invoice_date), amount: num(r.amount), returnReason: str(r.return_reason) } : null,
      stage, stageLabel: PAYMENT_STAGE_LABEL[stage], paid: round(paid), balance: round(balance),
      canSubmitInvoice: stage === "not_invoiced" || stage === "returned_to_vendor",
      payments: pays.filter((p) => String(p.doc_id) === str(r.store_purchase_id)).map((p) => ({
        date: String(p.dated).slice(0, 10), amount: num(p.amount), method: String(p.method), reference: str(p.reference),
      })),
    };
  });
}

/** The vendor's invoice for a purchase order: it goes to the Purchase Cell. */
export async function submitInvoice(sql: Sql, a: VendorActor, b: Record<string, unknown>): Promise<{ ok: true; id: string }> {
  const poId = typeof b.poId === "string" ? b.poId : "";
  const po = poId ? (await sql.execute(
    `SELECT * FROM hospital_purchase_orders WHERE id = ? AND tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL`, [poId, a.tenantId, a.vendorId])).rows[0] : undefined;
  if (!po) throw new HttpError(404, "Purchase order not found.");
  if (String(po.status) === "cancelled") throw new HttpError(409, "This purchase order was cancelled.");
  const open = (await sql.execute(
    `SELECT 1 FROM hospital_vendor_invoices WHERE po_id = ? AND tenant_id = ? AND deleted_at IS NULL AND status IN ('submitted', 'forwarded')`, [poId, a.tenantId])).rows[0];
  if (open) throw new HttpError(409, "An invoice for this purchase order is already with the hospital.");
  const invoiceNo = text(b.invoiceNo, 60);
  if (!invoiceNo) throw new HttpError(400, "Enter your invoice number.");
  const invoiceDate = typeof b.invoiceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.invoiceDate) ? b.invoiceDate : "";
  if (!invoiceDate) throw new HttpError(400, "Enter the invoice date.");
  if (invoiceDate > today()) throw new HttpError(400, "The invoice date cannot be in the future.");
  const id = randomUUID();
  const t = now();
  await sql.batch([
    {
      sql: `INSERT INTO hospital_vendor_invoices (id, tenant_id, po_id, vendor_id, invoice_no, invoice_date, amount, note, status, submitted_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`,
      args: [id, a.tenantId, poId, a.vendorId, invoiceNo, invoiceDate, num(po.total), text(b.note, 1000) || null, t, t, t],
    },
    { sql: `UPDATE hospital_purchase_orders SET status = 'invoiced', updated_at = ? WHERE id = ?`, args: [t, poId] },
  ]);
  return { ok: true, id };
}

/** One request from the vendor portal. */
export async function vendorAction(sql: Sql, a: VendorActor, b: Record<string, unknown>): Promise<unknown> {
  switch (b.action) {
    case "me": return { vendorName: a.vendorName, vendorNo: a.vendorNo, hospitalName: a.hospitalName, username: a.username };
    case "requests": return portalRequests(sql, a);
    case "quote": return submitQuote(sql, a, b);
    case "decline": return declineRequest(sql, a, b);
    case "orders": return portalOrders(sql, a);
    case "payments": return portalPayments(sql, a);
    case "submitInvoice": return submitInvoice(sql, a, b);
    default: throw new HttpError(400, "Unknown action.");
  }
}

// ── The hospital's side: vendor logins ─────────────────────────────────────

/** Vendor logins are made by the owner / administrator or the Purchase Cell, for a hospital. */
async function assertMayManage(sql: Sql, caller: Caller): Promise<string> {
  if (caller.platformRole) throw new HttpError(403, "Not available for this login.");
  if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a hospital.");
  const staffOk = caller.role !== "staff" || caller.permissions == null || caller.permissions.includes("hospital_purchase_cell");
  if (!staffOk) throw new HttpError(403, "Vendor logins are managed by the Purchase Cell or the administrator.");
  const t = (await sql.execute(`SELECT business_type FROM tenants WHERE id = ?`, [caller.tenantId])).rows[0];
  if (String(t?.business_type ?? "") !== "hospital") throw new HttpError(403, "The vendor portal is for hospitals.");
  return caller.tenantId;
}

export interface VendorLoginRow { vendorId: string; vendorName: string; vendorNo: string | null; phone: string | null; userId: string | null; username: string | null; active: boolean }

const MIN_PASSWORD = 6;

/** The Purchase Cell's Vendor Logins page. */
export async function vendorLoginAction(sql: Sql, caller: Caller, b: Record<string, unknown>): Promise<unknown> {
  const tenantId = await assertMayManage(sql, caller);
  const vendorOf = async (vendorId: unknown) => {
    const v = typeof vendorId === "string" ? (await sql.execute(`SELECT id, name FROM suppliers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [vendorId, tenantId])).rows[0] : undefined;
    if (!v) throw new HttpError(404, "Vendor not found.");
    return v;
  };
  const loginOf = async (vendorId: string) => (await sql.execute(
    `SELECT l.id, l.user_id, u.username, u.is_active FROM vendor_portal_logins l JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL
     WHERE l.tenant_id = ? AND l.vendor_id = ? AND l.deleted_at IS NULL`, [tenantId, vendorId])).rows[0];
  const t = now();
  switch (b.action) {
    case "list": {
      const rows = (await sql.execute(
        `SELECT s.id, s.name, s.vendor_no, s.phone, u.id AS user_id, u.username, u.is_active
         FROM suppliers s
         LEFT JOIN vendor_portal_logins l ON l.vendor_id = s.id AND l.tenant_id = s.tenant_id AND l.deleted_at IS NULL
         LEFT JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL
         WHERE s.tenant_id = ? AND s.deleted_at IS NULL ORDER BY s.name LIMIT 1000`, [tenantId])).rows;
      return rows.map((r): VendorLoginRow => ({
        vendorId: String(r.id), vendorName: String(r.name), vendorNo: str(r.vendor_no), phone: str(r.phone),
        userId: str(r.user_id), username: str(r.username), active: r.user_id != null && num(r.is_active) === 1,
      }));
    }
    case "create": {
      const v = await vendorOf(b.vendorId);
      if (await loginOf(String(v.id))) throw new HttpError(409, `${v.name} already has a login.`);
      const username = text(b.username, 60);
      if (!/^[A-Za-z0-9._@-]{3,60}$/.test(username)) throw new HttpError(400, "Username: at least 3 letters or digits (. _ - @ allowed, no spaces).");
      const password = typeof b.password === "string" ? b.password : "";
      if (password.length < MIN_PASSWORD) throw new HttpError(400, `The password must be at least ${MIN_PASSWORD} characters.`);
      if ((await sql.execute(`SELECT 1 FROM users WHERE username = ? AND deleted_at IS NULL`, [username])).rows[0]) throw new HttpError(409, `Username "${username}" is already taken.`);
      const userId = randomUUID();
      const salt = randomBytes(16).toString("hex");
      // A staff row of the hospital with no sections; platform_role 'vendor' keeps it out of everything but the portal.
      await sql.batch([
        {
          sql: `INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, permissions, platform_role, created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, ?, ?, 'staff', ?, 1, '[]', 'vendor', ?, ?, NULL)`,
          args: [userId, tenantId, username, passwordHash(password, salt), salt, String(v.name), t, t],
        },
        {
          sql: `INSERT INTO vendor_portal_logins (id, tenant_id, user_id, vendor_id, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [randomUUID(), tenantId, userId, v.id, caller.userId, t, t],
        },
      ]);
      return { ok: true, userId };
    }
    case "password": {
      const v = await vendorOf(b.vendorId);
      const l = await loginOf(String(v.id));
      if (!l) throw new HttpError(404, `${v.name} has no login yet.`);
      const password = typeof b.password === "string" ? b.password : "";
      if (password.length < MIN_PASSWORD) throw new HttpError(400, `The password must be at least ${MIN_PASSWORD} characters.`);
      const salt = randomBytes(16).toString("hex");
      // password_changed_at ends the sessions signed in with the old password.
      await sql.execute(`UPDATE users SET password_hash = ?, password_salt = ?, password_changed_at = ?, updated_at = ? WHERE id = ? AND platform_role = 'vendor'`,
        [passwordHash(password, salt), salt, t, t, l.user_id]);
      return { ok: true };
    }
    case "active": {
      const v = await vendorOf(b.vendorId);
      const l = await loginOf(String(v.id));
      if (!l) throw new HttpError(404, `${v.name} has no login yet.`);
      await sql.execute(`UPDATE users SET is_active = ?, updated_at = ? WHERE id = ? AND platform_role = 'vendor'`, [b.active ? 1 : 0, t, l.user_id]);
      return { ok: true };
    }
    default: throw new HttpError(400, "Unknown action.");
  }
}
