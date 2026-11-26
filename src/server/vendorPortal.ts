/** eProcurement vendor portal (schema v109, v110), at ep.mavin.pk.
 *
 * A vendor has ONE account (ep_vendors + a users row with platform_role
 * 'vendor') linked to every hospital that uses them: one vendor_portal_logins
 * row per hospital, pointing at that hospital's own supplier row. The portal
 * shows what every linked hospital sent this vendor, each marked with the
 * hospital's name; each hospital still sees only its own dealings.
 *
 * - Quote requests that name this vendor. One vendor asked = a petty
 *   purchase, several = a quotation. The vendor quotes a rate per item and
 *   never sees another vendor's name or rate.
 * - Purchase orders issued to this vendor.
 * - Payments: each order's invoice (submitted here), where it is and what
 *   Finance has paid.
 *
 * The hospital's side (eprocurementAction): the shared vendor directory
 * (portal vendors of all hospitals, searchable by name, number, email,
 * phone and address; picking one adds them to the hospital's suppliers),
 * the shared item list (items every hospital has asked rates for), and the
 * vendor logins.
 *
 * The server refuses a vendor login on every other route (callerOf), so it
 * never reaches /api/db or any business data. ep_* tables and
 * vendor_portal_logins are server-only (sqlPolicy.ts). */
import { randomBytes, randomUUID } from "node:crypto";
import { HttpError, passwordHash } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** One hospital this vendor account supplies: its supplier row there. */
export interface VendorLink { tenantId: string; vendorId: string; hospitalName: string }
/** The vendor behind a vendor login, with every hospital (eProcurement switched on) it supplies. */
export interface VendorActor {
  userId: string; username: string; epVendorId: string | null; vendorName: string; vendorNo: string | null; links: VendorLink[];
}

const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;
const round = (n: number) => Math.round(n * 100) / 100;
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export const RFQ_KIND_LABEL: Record<string, string> = { petty: "Petty purchase", quotation: "Quotation" };

export async function vendorActorFor(sql: Sql, caller: Pick<Caller, "userId" | "platformRole">): Promise<VendorActor> {
  if (caller.platformRole !== "vendor") throw new HttpError(403, "The vendor portal is for vendor logins.");
  const user = (await sql.execute(`SELECT username FROM users WHERE id = ? AND deleted_at IS NULL AND is_active = 1 AND platform_role = 'vendor'`, [caller.userId])).rows[0];
  const all = user ? (await sql.execute(
    `SELECT l.tenant_id, l.vendor_id, COALESCE(l.is_active, 1) AS link_active, s.name AS supplier_name, s.vendor_no, t.name AS hospital_name, t.eprocurement_allowed
     FROM vendor_portal_logins l
     JOIN suppliers s ON s.id = l.vendor_id AND s.tenant_id = l.tenant_id AND s.deleted_at IS NULL
     JOIN tenants t ON t.id = l.tenant_id
     WHERE l.user_id = ? AND l.deleted_at IS NULL ORDER BY t.name`, [caller.userId])).rows : [];
  if (!user || !all.length) throw new HttpError(403, "This login is not linked to a vendor. Ask the hospital's purchase officer.");
  // eProcurement is a special service the Super Admin switches on per hospital; a hospital can also turn a vendor off.
  const active = all.filter((r) => num(r.eprocurement_allowed) === 1 && num(r.link_active) === 1);
  if (!active.length) throw new HttpError(403, "The vendor portal is not active for any of your hospitals.");
  const ep = (await sql.execute(`SELECT id, name, vendor_code FROM ep_vendors WHERE user_id = ? AND deleted_at IS NULL`, [caller.userId])).rows[0];
  return {
    userId: caller.userId, username: String(user.username), epVendorId: ep ? String(ep.id) : null,
    vendorName: ep ? String(ep.name) : String(active[0].supplier_name), vendorNo: ep ? str(ep.vendor_code) : str(active[0].vendor_no),
    links: active.map((r) => ({ tenantId: String(r.tenant_id), vendorId: String(r.vendor_id), hospitalName: str(r.hospital_name) ?? "Hospital" })),
  };
}

/** The hospital (link) a record belongs to; not one of this vendor's hospitals = not found. */
async function linkOfRow(sql: Sql, a: VendorActor, table: "hospital_rfqs" | "hospital_purchase_orders", id: unknown, notFound: string): Promise<VendorLink> {
  if (typeof id !== "string" || !id) throw new HttpError(400, notFound);
  const r = (await sql.execute(`SELECT tenant_id FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])).rows[0];
  const link = r && a.links.find((l) => l.tenantId === String(r.tenant_id));
  if (!link) throw new HttpError(404, notFound);
  return link;
}

// ── What the vendor sees (per hospital, then all hospitals together) ─────────

export interface PortalRequestItem { id: string; productName: string; specification: string | null; qty: number; uom: string | null; rate: number | null; offeredSpec: string | null; available: boolean }
export interface PortalRequest {
  id: string; hospitalName: string; rfqNo: string; kind: "petty" | "quotation"; kindLabel: string; title: string | null; date: string; dueDate: string | null; note: string | null;
  status: "open" | "awarded" | "cancelled" | "closed"; myStatus: "requested" | "quoted" | "declined" | "awarded" | "not_awarded";
  canQuote: boolean; deliveryDays: number | null; validTill: string | null; remarks: string | null; items: PortalRequestItem[];
}

async function requestsOf(sql: Sql, L: VendorLink): Promise<PortalRequest[]> {
  const rfqs = (await sql.execute(
    `SELECT r.id, r.rfq_no, r.kind, r.title, r.created_at, r.due_date, r.note, r.status,
            v.status AS my_status, v.delivery_days, v.valid_till, v.remarks
     FROM hospital_rfq_vendors v JOIN hospital_rfqs r ON r.id = v.rfq_id AND r.tenant_id = v.tenant_id AND r.deleted_at IS NULL
     WHERE v.tenant_id = ? AND v.vendor_id = ? AND v.deleted_at IS NULL
     ORDER BY r.created_at DESC LIMIT 200`, [L.tenantId, L.vendorId])).rows;
  if (!rfqs.length) return [];
  const ids = rfqs.map((r) => String(r.id));
  const items = (await sql.execute(
    `SELECT i.id, i.rfq_id, i.product_name, i.specification, i.qty, i.uom, q.rate, q.offered_spec, q.available
     FROM hospital_rfq_items i
     LEFT JOIN hospital_rfq_quotes q ON q.rfq_item_id = i.id AND q.tenant_id = i.tenant_id AND q.vendor_id = ? AND q.deleted_at IS NULL
     WHERE i.tenant_id = ? AND i.rfq_id IN (${ids.map(() => "?").join(",")}) AND i.deleted_at IS NULL ORDER BY i.sort, i.created_at`, [L.vendorId, L.tenantId, ...ids])).rows;
  return rfqs.map((r) => {
    const status = String(r.status) as PortalRequest["status"];
    const myStatus = String(r.my_status) as PortalRequest["myStatus"];
    const due = str(r.due_date);
    return {
      id: String(r.id), hospitalName: L.hospitalName, rfqNo: String(r.rfq_no), kind: String(r.kind) === "petty" ? "petty" : "quotation", kindLabel: RFQ_KIND_LABEL[String(r.kind)] ?? "Quotation",
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

/** The requests for rates sent to this vendor by all their hospitals, newest first. */
export async function portalRequests(sql: Sql, a: VendorActor): Promise<PortalRequest[]> {
  return (await Promise.all(a.links.map((L) => requestsOf(sql, L)))).flat().sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}

async function invitation(sql: Sql, a: VendorActor, rfqId: unknown): Promise<{ L: VendorLink; rfq: Record<string, unknown>; invite: Record<string, unknown> }> {
  // A request of another hospital, or not sent to this vendor: answered exactly like one that does not exist.
  const L = await linkOfRow(sql, a, "hospital_rfqs", rfqId, "Request not found.");
  const rfq = (await sql.execute(`SELECT * FROM hospital_rfqs WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [rfqId, L.tenantId])).rows[0];
  const invite = rfq && (await sql.execute(
    `SELECT * FROM hospital_rfq_vendors WHERE rfq_id = ? AND tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL`, [rfqId, L.tenantId, L.vendorId])).rows[0];
  if (!rfq || !invite) throw new HttpError(404, "Request not found.");
  return { L, rfq, invite };
}

function assertQuotable(rfq: Record<string, unknown>, invite: Record<string, unknown>): void {
  if (String(rfq.status) !== "open") throw new HttpError(409, "This request is closed: rates can no longer be sent.");
  if (String(invite.status) === "declined") throw new HttpError(409, "You declined this request.");
  const due = str(rfq.due_date);
  if (due && due < today()) throw new HttpError(409, `The last date for rates was ${due}.`);
}

/** The vendor's rates for a request (sent again, they replace the earlier ones while it is open). */
export async function submitQuote(sql: Sql, a: VendorActor, b: Record<string, unknown>): Promise<{ ok: true }> {
  const { L, rfq, invite } = await invitation(sql, a, b.rfqId);
  assertQuotable(rfq, invite);
  const items = (await sql.execute(`SELECT id, product_name FROM hospital_rfq_items WHERE rfq_id = ? AND tenant_id = ? AND deleted_at IS NULL`, [rfq.id, L.tenantId])).rows;
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
    { sql: `UPDATE hospital_rfq_quotes SET deleted_at = ?, updated_at = ? WHERE rfq_id = ? AND tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL`, args: [t, t, rfq.id, L.tenantId, L.vendorId] },
  ];
  for (const [itemId, g] of given) {
    statements.push({
      sql: `INSERT INTO hospital_rfq_quotes (id, tenant_id, rfq_id, rfq_item_id, vendor_id, rate, offered_spec, available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), L.tenantId, rfq.id, itemId, L.vendorId, g.rate, g.spec, g.available ? 1 : 0, t, t],
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
  const { L, rfq, invite } = await invitation(sql, a, b.rfqId);
  assertQuotable(rfq, invite);
  const t = now();
  await sql.batch([
    { sql: `UPDATE hospital_rfq_quotes SET deleted_at = ?, updated_at = ? WHERE rfq_id = ? AND tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL`, args: [t, t, rfq.id, L.tenantId, L.vendorId] },
    { sql: `UPDATE hospital_rfq_vendors SET status = 'declined', decline_reason = ?, updated_at = ? WHERE id = ?`, args: [text(b.reason, 500) || null, t, invite.id] },
  ]);
  return { ok: true };
}

export interface PortalOrderItem { productName: string; specification: string | null; qty: number; uom: string | null; rate: number; amount: number }
export interface PortalOrder {
  id: string; hospitalName: string; poNo: string; kind: "petty" | "quotation"; kindLabel: string; rfqNo: string | null; issuedAt: string; issuedBy: string | null;
  status: "issued" | "invoiced" | "cancelled"; total: number; deliveryDays: number | null; note: string | null; cancelReason: string | null; items: PortalOrderItem[];
}

async function ordersOf(sql: Sql, L: VendorLink): Promise<PortalOrder[]> {
  const pos = (await sql.execute(
    `SELECT p.*, r.rfq_no FROM hospital_purchase_orders p LEFT JOIN hospital_rfqs r ON r.id = p.rfq_id AND r.tenant_id = p.tenant_id
     WHERE p.tenant_id = ? AND p.vendor_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 200`, [L.tenantId, L.vendorId])).rows;
  if (!pos.length) return [];
  const ids = pos.map((p) => String(p.id));
  const items = (await sql.execute(
    `SELECT po_id, product_name, specification, qty, uom, rate FROM hospital_po_items WHERE tenant_id = ? AND po_id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL ORDER BY created_at`,
    [L.tenantId, ...ids])).rows;
  return pos.map((p) => ({
    id: String(p.id), hospitalName: L.hospitalName, poNo: String(p.po_no), kind: String(p.kind) === "petty" ? "petty" : "quotation", kindLabel: RFQ_KIND_LABEL[String(p.kind)] ?? "Quotation",
    rfqNo: str(p.rfq_no), issuedAt: String(p.issued_at ?? p.created_at).slice(0, 10), issuedBy: str(p.issued_by_name),
    status: String(p.status) as PortalOrder["status"], total: num(p.total), deliveryDays: p.delivery_days == null ? null : num(p.delivery_days),
    note: str(p.note), cancelReason: str(p.cancel_reason),
    items: items.filter((i) => String(i.po_id) === String(p.id)).map((i) => ({
      productName: String(i.product_name), specification: str(i.specification), qty: num(i.qty), uom: str(i.uom), rate: num(i.rate), amount: round(num(i.qty) * num(i.rate)),
    })),
  }));
}

/** Purchase orders issued to this vendor by all their hospitals, newest first. */
export async function portalOrders(sql: Sql, a: VendorActor): Promise<PortalOrder[]> {
  return (await Promise.all(a.links.map((L) => ordersOf(sql, L)))).flat().sort((x, y) => (x.issuedAt < y.issuedAt ? 1 : x.issuedAt > y.issuedAt ? -1 : 0));
}

export type PaymentStage = "not_invoiced" | "with_purchase_cell" | "returned_to_vendor" | "with_store" | "returned_by_store" | "unpaid" | "part_paid" | "paid";
export const PAYMENT_STAGE_LABEL: Record<PaymentStage, string> = {
  not_invoiced: "Invoice not submitted", with_purchase_cell: "With the Purchase Cell", returned_to_vendor: "Returned to you",
  with_store: "With the store for checking", returned_by_store: "Returned by the store", unpaid: "Unpaid · with Finance", part_paid: "Part paid", paid: "Paid",
};

export interface PortalPayment {
  poId: string; hospitalName: string; poNo: string; poTotal: number; issuedAt: string;
  invoice: { id: string; invoiceNo: string; invoiceDate: string; amount: number; returnReason: string | null } | null;
  stage: PaymentStage; stageLabel: string; paid: number; balance: number; canSubmitInvoice: boolean;
  payments: { date: string; amount: number; method: string; reference: string | null }[];
}

async function paymentsOf(sql: Sql, L: VendorLink): Promise<PortalPayment[]> {
  const rows = (await sql.execute(
    `SELECT p.id AS po_id, p.po_no, p.total AS po_total, p.issued_at, p.created_at,
            i.id AS invoice_id, i.invoice_no, i.invoice_date, i.amount, i.status AS invoice_status, i.return_reason, i.store_purchase_id,
            sp.status AS sp_status, sp.paid AS sp_paid, sp.balance AS sp_balance, sp.total AS sp_total
     FROM hospital_purchase_orders p
     LEFT JOIN hospital_vendor_invoices i ON i.id = (
       SELECT x.id FROM hospital_vendor_invoices x WHERE x.po_id = p.id AND x.tenant_id = p.tenant_id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1)
     LEFT JOIN hospital_store_purchases sp ON sp.id = i.store_purchase_id AND sp.tenant_id = p.tenant_id AND sp.deleted_at IS NULL
     WHERE p.tenant_id = ? AND p.vendor_id = ? AND p.deleted_at IS NULL AND p.status != 'cancelled'
     ORDER BY p.created_at DESC LIMIT 200`, [L.tenantId, L.vendorId])).rows;
  const spIds = rows.map((r) => str(r.store_purchase_id)).filter((x): x is string => Boolean(x));
  const pays = spIds.length ? (await sql.execute(
    `SELECT doc_id, dated, amount, method, reference FROM hospital_vendor_payments
     WHERE tenant_id = ? AND doc_type = 'store_purchase' AND vendor_id = ? AND doc_id IN (${spIds.map(() => "?").join(",")}) AND deleted_at IS NULL ORDER BY dated, created_at`,
    [L.tenantId, L.vendorId, ...spIds])).rows : [];
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
      poId: String(r.po_id), hospitalName: L.hospitalName, poNo: String(r.po_no), poTotal: num(r.po_total), issuedAt: String(r.issued_at ?? r.created_at).slice(0, 10),
      invoice: r.invoice_id ? { id: String(r.invoice_id), invoiceNo: String(r.invoice_no), invoiceDate: String(r.invoice_date), amount: num(r.amount), returnReason: str(r.return_reason) } : null,
      stage, stageLabel: PAYMENT_STAGE_LABEL[stage], paid: round(paid), balance: round(balance),
      canSubmitInvoice: stage === "not_invoiced" || stage === "returned_to_vendor",
      payments: pays.filter((p) => String(p.doc_id) === str(r.store_purchase_id)).map((p) => ({
        date: String(p.dated).slice(0, 10), amount: num(p.amount), method: String(p.method), reference: str(p.reference),
      })),
    };
  });
}

/** Every purchase order of every hospital with its invoice and payment status. */
export async function portalPayments(sql: Sql, a: VendorActor): Promise<PortalPayment[]> {
  return (await Promise.all(a.links.map((L) => paymentsOf(sql, L)))).flat().sort((x, y) => (x.issuedAt < y.issuedAt ? 1 : x.issuedAt > y.issuedAt ? -1 : 0));
}

/** The vendor's invoice for a purchase order: it goes to that hospital's Purchase Cell. */
export async function submitInvoice(sql: Sql, a: VendorActor, b: Record<string, unknown>): Promise<{ ok: true; id: string }> {
  const L = await linkOfRow(sql, a, "hospital_purchase_orders", b.poId, "Purchase order not found.");
  const poId = String(b.poId);
  const po = (await sql.execute(
    `SELECT * FROM hospital_purchase_orders WHERE id = ? AND tenant_id = ? AND vendor_id = ? AND deleted_at IS NULL`, [poId, L.tenantId, L.vendorId])).rows[0];
  if (!po) throw new HttpError(404, "Purchase order not found.");
  if (String(po.status) === "cancelled") throw new HttpError(409, "This purchase order was cancelled.");
  const open = (await sql.execute(
    `SELECT 1 FROM hospital_vendor_invoices WHERE po_id = ? AND tenant_id = ? AND deleted_at IS NULL AND status IN ('submitted', 'forwarded')`, [poId, L.tenantId])).rows[0];
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
      args: [id, L.tenantId, poId, L.vendorId, invoiceNo, invoiceDate, num(po.total), text(b.note, 1000) || null, t, t, t],
    },
    { sql: `UPDATE hospital_purchase_orders SET status = 'invoiced', updated_at = ? WHERE id = ?`, args: [t, poId] },
  ]);
  return { ok: true, id };
}

/** One request from the vendor portal. */
export async function vendorAction(sql: Sql, a: VendorActor, b: Record<string, unknown>): Promise<unknown> {
  switch (b.action) {
    case "me": {
      const hospitals = a.links.map((l) => l.hospitalName);
      return { vendorName: a.vendorName, vendorNo: a.vendorNo, username: a.username, hospitals, hospitalName: hospitals.length === 1 ? hospitals[0] : `${hospitals.length} hospitals` };
    }
    case "requests": return portalRequests(sql, a);
    case "quote": return submitQuote(sql, a, b);
    case "decline": return declineRequest(sql, a, b);
    case "orders": return portalOrders(sql, a);
    case "payments": return portalPayments(sql, a);
    case "submitInvoice": return submitInvoice(sql, a, b);
    default: throw new HttpError(400, "Unknown action.");
  }
}

// ── The hospital's side ─────────────────────────────────────────────────────

/** eProcurement is run by the owner / administrator or the Purchase Cell, in a
 * hospital whose eProcurement service the Super Admin has switched on. */
async function assertMayManage(sql: Sql, caller: Caller): Promise<string> {
  if (caller.platformRole) throw new HttpError(403, "Not available for this login.");
  if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a hospital.");
  const staffOk = caller.role !== "staff" || caller.permissions == null || caller.permissions.includes("hospital_purchase_cell");
  if (!staffOk) throw new HttpError(403, "eProcurement is used by the Purchase Cell or the administrator.");
  const t = (await sql.execute(`SELECT business_type, eprocurement_allowed FROM tenants WHERE id = ?`, [caller.tenantId])).rows[0];
  if (String(t?.business_type ?? "") !== "hospital") throw new HttpError(403, "The vendor portal is for hospitals.");
  if (num(t?.eprocurement_allowed) !== 1) throw new HttpError(403, "eProcurement is not active for this hospital. Contact MAVIN.pk to switch it on.");
  return caller.tenantId;
}

async function nextSupplierNo(sql: Sql, tenantId: string): Promise<string> {
  const r = (await sql.execute(`SELECT MAX(CAST(substr(vendor_no, 3) AS INTEGER)) AS n FROM suppliers WHERE tenant_id = ? AND vendor_no GLOB 'V-[0-9]*'`, [tenantId])).rows[0];
  return `V-${String(num(r?.n) + 1).padStart(4, "0")}`;
}
async function nextEpCode(sql: Sql): Promise<string> {
  const r = (await sql.execute(`SELECT MAX(CAST(substr(vendor_code, 4) AS INTEGER)) AS n FROM ep_vendors WHERE vendor_code GLOB 'EP-[0-9]*'`)).rows[0];
  return `EP-${String(num(r?.n) + 1).padStart(4, "0")}`;
}

/** A vendor in the New Order search: this hospital's own supplier, or a portal vendor of the shared directory. */
export interface VendorOption {
  key: string; source: "own" | "directory"; supplierId: string | null; epVendorId: string | null;
  name: string; number: string | null; email: string | null; phone: string | null; address: string | null; onPortal: boolean;
}
/** An item in the New Order search: this hospital's own product, or one from the shared item list. */
export interface ItemOption { key: string; source: "own" | "shared"; productId: string | null; name: string; uom: string | null; specification: string | null; company: string | null }

async function searchVendors(sql: Sql, tenantId: string, q: string): Promise<VendorOption[]> {
  const L = like(q);
  const own = (await sql.execute(
    `SELECT s.id, s.name, s.vendor_no, s.email, s.phone, s.address,
            (SELECT COUNT(*) FROM vendor_portal_logins l WHERE l.vendor_id = s.id AND l.tenant_id = s.tenant_id AND l.deleted_at IS NULL AND COALESCE(l.is_active, 1) = 1) AS on_portal
     FROM suppliers s WHERE s.tenant_id = ? AND s.deleted_at IS NULL
       ${q ? "AND (s.name LIKE ? ESCAPE '\\' OR s.vendor_no LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\' OR s.address LIKE ? ESCAPE '\\' OR s.company_name LIKE ? ESCAPE '\\')" : ""}
     ORDER BY s.name LIMIT 30`, [tenantId, ...(q ? [L, L, L, L, L, L] : [])])).rows;
  // Portal vendors of other hospitals (already linked here: shown above as this hospital's own).
  const dir = (await sql.execute(
    `SELECT e.id, e.name, e.vendor_code, e.email, e.phone, e.address
     FROM ep_vendors e JOIN users u ON u.id = e.user_id AND u.deleted_at IS NULL AND u.is_active = 1
     WHERE e.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM vendor_portal_logins l WHERE l.user_id = e.user_id AND l.tenant_id = ? AND l.deleted_at IS NULL)
       ${q ? "AND (e.name LIKE ? ESCAPE '\\' OR e.vendor_code LIKE ? ESCAPE '\\' OR e.email LIKE ? ESCAPE '\\' OR e.phone LIKE ? ESCAPE '\\' OR e.address LIKE ? ESCAPE '\\')" : ""}
     ORDER BY e.name LIMIT 20`, [tenantId, ...(q ? [L, L, L, L, L] : [])])).rows;
  return [
    ...own.map((s): VendorOption => ({
      key: `s:${s.id}`, source: "own", supplierId: String(s.id), epVendorId: null, name: String(s.name), number: str(s.vendor_no),
      email: str(s.email), phone: str(s.phone), address: str(s.address), onPortal: num(s.on_portal) > 0,
    })),
    ...dir.map((e): VendorOption => ({
      key: `e:${e.id}`, source: "directory", supplierId: null, epVendorId: String(e.id), name: String(e.name), number: str(e.vendor_code),
      email: str(e.email), phone: str(e.phone), address: str(e.address), onPortal: true,
    })),
  ];
}

/** Adds a directory vendor to this hospital: a supplier row here, linked to the vendor's one account. */
async function addDirectoryVendor(sql: Sql, tenantId: string, caller: Caller, epVendorId: unknown): Promise<{ supplierId: string }> {
  const e = typeof epVendorId === "string" ? (await sql.execute(
    `SELECT e.* FROM ep_vendors e JOIN users u ON u.id = e.user_id AND u.deleted_at IS NULL AND u.is_active = 1 WHERE e.id = ? AND e.deleted_at IS NULL`, [epVendorId])).rows[0] : undefined;
  if (!e) throw new HttpError(404, "Vendor not found in the eProcurement directory.");
  const existing = (await sql.execute(
    `SELECT vendor_id FROM vendor_portal_logins WHERE user_id = ? AND tenant_id = ? AND deleted_at IS NULL`, [e.user_id, tenantId])).rows[0];
  if (existing) return { supplierId: String(existing.vendor_id) };
  const supplierId = randomUUID();
  const t = now();
  await sql.batch([
    {
      sql: `INSERT INTO suppliers (id, tenant_id, name, email, phone, address, vendor_no, party_kind, balance_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'vendor', 'payable', ?, ?)`,
      args: [supplierId, tenantId, e.name, e.email ?? null, e.phone ?? null, e.address ?? null, await nextSupplierNo(sql, tenantId), t, t],
    },
    {
      sql: `INSERT INTO vendor_portal_logins (id, tenant_id, user_id, vendor_id, ep_vendor_id, is_active, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      args: [randomUUID(), tenantId, e.user_id, supplierId, e.id, caller.userId, t, t],
    },
  ]);
  return { supplierId };
}

async function searchItems(sql: Sql, tenantId: string, q: string): Promise<ItemOption[]> {
  if (!q) return [];
  const L = like(q);
  const own = (await sql.execute(
    `SELECT id, name, company_name, description FROM products WHERE tenant_id = ? AND deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\')
     ORDER BY name LIMIT 15`, [tenantId, L, L])).rows;
  const ownNames = new Set(own.map((p) => String(p.name).trim().toLowerCase()));
  const shared = (await sql.execute(
    `SELECT id, name, uom, specification FROM ep_items WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR specification LIKE ? ESCAPE '\\') ORDER BY uses DESC, name LIMIT 15`, [L, L])).rows;
  return [
    ...own.map((p): ItemOption => ({ key: `p:${p.id}`, source: "own", productId: String(p.id), name: String(p.name), uom: null, specification: str(p.description), company: str(p.company_name) })),
    ...shared.filter((i) => !ownNames.has(String(i.name).trim().toLowerCase())).map((i): ItemOption => ({
      key: `i:${i.id}`, source: "shared", productId: null, name: String(i.name), uom: str(i.uom), specification: str(i.specification), company: null,
    })),
  ];
}

/** Items a hospital asked rates for join the shared list (each counted, so the common ones come first). */
async function recordItems(sql: Sql, tenantId: string, raw: unknown): Promise<{ ok: true }> {
  const list = (Array.isArray(raw) ? raw : []).slice(0, 200) as Record<string, unknown>[];
  const t = now();
  for (const x of list) {
    const name = text(x?.name, 200);
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, " ");
    const found = (await sql.execute(`SELECT id, uom, specification FROM ep_items WHERE name_key = ? AND deleted_at IS NULL`, [key])).rows[0];
    if (found) {
      await sql.execute(`UPDATE ep_items SET uses = uses + 1, uom = COALESCE(uom, ?), specification = COALESCE(specification, ?), updated_at = ? WHERE id = ?`,
        [text(x.uom, 30) || null, text(x.specification, 300) || null, t, found.id]);
    } else {
      await sql.execute(`INSERT INTO ep_items (id, name, name_key, uom, specification, uses, created_by_tenant, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [randomUUID(), name, key, text(x.uom, 30) || null, text(x.specification, 300) || null, tenantId, t, t]);
    }
  }
  return { ok: true };
}

/** Purchase Cell > eProcurement: the shared vendor directory and item list. */
export async function eprocurementAction(sql: Sql, caller: Caller, b: Record<string, unknown>): Promise<unknown> {
  const tenantId = await assertMayManage(sql, caller);
  const q = text(b.q, 80);
  switch (b.action) {
    case "searchVendors": return searchVendors(sql, tenantId, q);
    case "addDirectoryVendor": return addDirectoryVendor(sql, tenantId, caller, b.epVendorId);
    case "searchItems": return searchItems(sql, tenantId, q);
    case "recordItems": return recordItems(sql, tenantId, b.items);
    default: throw new HttpError(400, "Unknown action.");
  }
}

export interface VendorLoginRow {
  vendorId: string; vendorName: string; vendorNo: string | null; phone: string | null; userId: string | null; username: string | null;
  /** On for this hospital (each hospital turns a vendor on or off for itself). */
  active: boolean;
  /** This hospital made the vendor's account, so it may set a new password (the account may serve other hospitals too). */
  canResetPassword: boolean;
  /** Other hospitals this vendor also supplies through the portal. */
  sharedWith: number;
}

const MIN_PASSWORD = 6;

/** Purchase Cell > eProcurement > Vendor Logins. */
export async function vendorLoginAction(sql: Sql, caller: Caller, b: Record<string, unknown>): Promise<unknown> {
  const tenantId = await assertMayManage(sql, caller);
  const vendorOf = async (vendorId: unknown) => {
    const v = typeof vendorId === "string" ? (await sql.execute(`SELECT * FROM suppliers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [vendorId, tenantId])).rows[0] : undefined;
    if (!v) throw new HttpError(404, "Vendor not found.");
    return v;
  };
  const loginOf = async (vendorId: string) => (await sql.execute(
    `SELECT l.id, l.user_id, u.tenant_id AS user_tenant, e.created_by_tenant FROM vendor_portal_logins l
     JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL LEFT JOIN ep_vendors e ON e.user_id = l.user_id AND e.deleted_at IS NULL
     WHERE l.tenant_id = ? AND l.vendor_id = ? AND l.deleted_at IS NULL`, [tenantId, vendorId])).rows[0];
  // Accounts from v109 (one hospital each) carry the hospital on the users row.
  const ownsAccount = (l: Record<string, unknown>) => (l.created_by_tenant != null ? String(l.created_by_tenant) === tenantId : String(l.user_tenant ?? "") === tenantId);
  const t = now();
  switch (b.action) {
    case "list": {
      const rows = (await sql.execute(
        `SELECT s.id, s.name, s.vendor_no, s.phone, u.id AS user_id, u.username, u.is_active AS user_active, u.tenant_id AS user_tenant, COALESCE(l.is_active, 1) AS link_active,
                e.created_by_tenant,
                (SELECT COUNT(*) FROM vendor_portal_logins o WHERE o.user_id = l.user_id AND o.tenant_id != s.tenant_id AND o.deleted_at IS NULL) AS shared_with
         FROM suppliers s
         LEFT JOIN vendor_portal_logins l ON l.vendor_id = s.id AND l.tenant_id = s.tenant_id AND l.deleted_at IS NULL
         LEFT JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL
         LEFT JOIN ep_vendors e ON e.user_id = l.user_id AND e.deleted_at IS NULL
         WHERE s.tenant_id = ? AND s.deleted_at IS NULL ORDER BY s.name LIMIT 1000`, [tenantId])).rows;
      return rows.map((r): VendorLoginRow => ({
        vendorId: String(r.id), vendorName: String(r.name), vendorNo: str(r.vendor_no), phone: str(r.phone),
        userId: str(r.user_id), username: str(r.username), active: r.user_id != null && num(r.user_active) === 1 && num(r.link_active) === 1,
        canResetPassword: r.user_id != null && ownsAccount(r), sharedWith: num(r.shared_with),
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
      const epId = randomUUID();
      const salt = randomBytes(16).toString("hex");
      // The vendor's own account (no business: platform_role 'vendor' keeps it out of everything but the portal),
      // listed in the shared directory so other hospitals can add the same vendor.
      await sql.batch([
        {
          sql: `INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, permissions, platform_role, created_at, updated_at, deleted_at)
                VALUES (?, NULL, ?, ?, ?, 'staff', ?, 1, '[]', 'vendor', ?, ?, NULL)`,
          args: [userId, username, passwordHash(password, salt), salt, String(v.name), t, t],
        },
        {
          sql: `INSERT INTO ep_vendors (id, vendor_code, user_id, name, email, phone, address, created_by_tenant, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [epId, await nextEpCode(sql), userId, String(v.name), str(v.email), str(v.phone), str(v.address), tenantId, t, t],
        },
        {
          sql: `INSERT INTO vendor_portal_logins (id, tenant_id, user_id, vendor_id, ep_vendor_id, is_active, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          args: [randomUUID(), tenantId, userId, v.id, epId, caller.userId, t, t],
        },
      ]);
      return { ok: true, userId };
    }
    case "password": {
      const v = await vendorOf(b.vendorId);
      const l = await loginOf(String(v.id));
      if (!l) throw new HttpError(404, `${v.name} has no login yet.`);
      // The account may serve other hospitals: only the hospital that made it sets a new password.
      if (!ownsAccount(l)) throw new HttpError(403, `${v.name}'s account was made by another hospital: the vendor changes the password in the portal.`);
      const password = typeof b.password === "string" ? b.password : "";
      if (password.length < MIN_PASSWORD) throw new HttpError(400, `The password must be at least ${MIN_PASSWORD} characters.`);
      const salt = randomBytes(16).toString("hex");
      // password_changed_at ends the sessions signed in with the old password.
      await sql.execute(`UPDATE users SET password_hash = ?, password_salt = ?, password_changed_at = ?, updated_at = ? WHERE id = ? AND platform_role = 'vendor'`,
        [passwordHash(password, salt), salt, t, t, l.user_id]);
      return { ok: true };
    }
    case "active": {
      // On or off for this hospital only; the vendor's other hospitals are not affected.
      const v = await vendorOf(b.vendorId);
      const l = await loginOf(String(v.id));
      if (!l) throw new HttpError(404, `${v.name} has no login yet.`);
      await sql.execute(`UPDATE vendor_portal_logins SET is_active = ?, updated_at = ? WHERE id = ?`, [b.active ? 1 : 0, t, l.id]);
      return { ok: true };
    }
    default: throw new HttpError(400, "Unknown action.");
  }
}
