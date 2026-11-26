/** Hospital Purchase Cell > Purchase Orders (schema v109).
 *
 * The purchase officer asks vendors for rates (a request for quotation:
 * items with specification, quantity and unit). One vendor asked makes it a
 * petty purchase, several a quotation. Each vendor quotes in the vendor
 * portal (src/server/vendorPortal.ts); here the officer compares the rates
 * side by side and issues a purchase order to the chosen vendor for each
 * item (one order per vendor). The vendor then submits an invoice against
 * the order; the officer forwards it to the stores as a store purchase
 * (repo/hospitalStores.ts), where the store keepers verify it and Finance
 * pays it (repo/vendorPayments.ts). */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { currentActor, type Actor } from "./medicalRecord";
import { suppliersRepo } from "./suppliers";
import { postStorePurchase, saveStorePurchase } from "./hospitalStores";
import { isStoreId, type StoreId } from "../../config/hospitalStores";

export type RfqKind = "petty" | "quotation";
export type RfqStatus = "open" | "awarded" | "cancelled";
export const RFQ_KIND_LABEL: Record<RfqKind, string> = { petty: "Petty purchase", quotation: "Quotation" };
export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = { open: "Waiting for rates", awarded: "Order issued", cancelled: "Cancelled" };

export interface Rfq extends TenantRow {
  rfq_no: string; kind: RfqKind; title: string | null; status: RfqStatus; due_date: string | null; note: string | null; created_by_name: string | null;
  awarded_at: string | null; awarded_by_name: string | null; cancelled_at: string | null; cancel_reason: string | null;
}
export interface RfqItem extends TenantRow { rfq_id: string; product_id: string | null; product_name: string; specification: string | null; qty: number; uom: string | null; store: StoreId | null; sort: number }
export interface RfqVendor extends TenantRow {
  rfq_id: string; vendor_id: string; status: "requested" | "quoted" | "declined" | "awarded" | "not_awarded";
  quoted_at: string | null; delivery_days: number | null; valid_till: string | null; remarks: string | null; decline_reason: string | null;
}
export interface RfqQuote extends TenantRow { rfq_id: string; rfq_item_id: string; vendor_id: string; rate: number | null; offered_spec: string | null; available: number }
export type PoStatus = "issued" | "invoiced" | "cancelled";
export const PO_STATUS_LABEL: Record<PoStatus, string> = { issued: "Issued · waiting for invoice", invoiced: "Invoice received", cancelled: "Cancelled" };
export interface PurchaseOrder extends TenantRow {
  po_no: string; rfq_id: string | null; vendor_id: string; kind: RfqKind; status: PoStatus; total: number; delivery_days: number | null; note: string | null;
  issued_by_name: string | null; issued_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
}
export interface PoItem extends TenantRow { po_id: string; rfq_item_id: string | null; product_id: string | null; product_name: string; specification: string | null; qty: number; uom: string | null; rate: number; store: StoreId | null }
export type VendorInvoiceStatus = "submitted" | "forwarded" | "returned" | "cancelled";
export interface VendorInvoice extends TenantRow {
  po_id: string; vendor_id: string; invoice_no: string; invoice_date: string; amount: number; note: string | null; status: VendorInvoiceStatus;
  store_purchase_id: string | null; return_reason: string | null; submitted_at: string | null; forwarded_at: string | null; forwarded_by_name: string | null; returned_at: string | null;
}

export const rfqsRepo = createTenantRepo<Rfq>("hospital_rfqs");
export const rfqItemsRepo = createTenantRepo<RfqItem>("hospital_rfq_items");
export const rfqVendorsRepo = createTenantRepo<RfqVendor>("hospital_rfq_vendors");
export const purchaseOrdersRepo = createTenantRepo<PurchaseOrder>("hospital_purchase_orders");
export const poItemsRepo = createTenantRepo<PoItem>("hospital_po_items");
export const vendorInvoicesRepo = createTenantRepo<VendorInvoice>("hospital_vendor_invoices");

const round = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const who = (a: Actor) => (a.designation ? `${a.name}, ${a.designation}` : a.name);

async function needPurchaseOfficer(): Promise<Actor> {
  const a = await currentActor();
  const roles = a.roles?.length ? a.roles : [a.role ?? ""];
  if (!a.full && !roles.includes("purchase_officer")) throw new Error("Purchase orders are made by the purchase officer.");
  return a;
}

async function nextNo(table: string, column: string, prefix: string): Promise<string> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(CAST(substr(${column}, ${prefix.length + 2}) AS INTEGER)) AS n FROM ${table} WHERE tenant_id = ? AND ${column} GLOB '${prefix}-[0-9]*'`,
    [requireCurrentTenantId()]
  );
  return `${prefix}-${String((Number(rows[0]?.n) || 0) + 1).padStart(4, "0")}`;
}

// ── Requests for quotation ─────────────────────────────────────────────────

export interface RfqInput {
  title?: string | null; dueDate?: string | null; note?: string | null; vendorIds: string[];
  items: { productId?: string | null; productName: string; specification?: string | null; qty: number; uom?: string | null; store?: StoreId | "" | null }[];
}

/** Sends a request for rates to the chosen vendors (they see it in the vendor portal). */
export async function createRfq(x: RfqInput): Promise<Rfq> {
  const a = await needPurchaseOfficer();
  const vendorIds = [...new Set((x.vendorIds ?? []).filter(Boolean))];
  if (!vendorIds.length) throw new Error("Choose at least one vendor.");
  for (const id of vendorIds) if (!(await suppliersRepo.get(id))) throw new Error("A chosen vendor was not found.");
  const items = (x.items ?? []).filter((i) => i.productName?.trim());
  if (!items.length) throw new Error("Add at least one product.");
  for (const i of items) {
    if (!(Number(i.qty) > 0)) throw new Error(`Enter the quantity of ${i.productName}.`);
    if (i.store && !isStoreId(i.store)) throw new Error(`Unknown store for ${i.productName}.`);
  }
  if (x.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(x.dueDate)) throw new Error("Choose the last date for rates.");
  const rfq = await rfqsRepo.create({
    rfq_no: await nextNo("hospital_rfqs", "rfq_no", "RFQ"), kind: vendorIds.length === 1 ? "petty" : "quotation", title: x.title?.trim() || null,
    status: "open", due_date: x.dueDate || null, note: x.note?.trim() || null, created_by_name: who(a),
  });
  let sort = 0;
  for (const i of items) {
    await rfqItemsRepo.create({
      rfq_id: rfq.id, product_id: i.productId ?? null, product_name: i.productName.trim(), specification: i.specification?.trim() || null,
      qty: round3(Number(i.qty)), uom: i.uom?.trim() || null, store: i.store && isStoreId(i.store) ? i.store : null, sort: sort++,
    });
  }
  for (const v of vendorIds) await rfqVendorsRepo.create({ rfq_id: rfq.id, vendor_id: v, status: "requested" });
  return rfq;
}

export interface RfqRow extends Rfq { items: number; vendors: number; quoted: number; vendor_names: string | null }

export async function listRfqs(f: { status?: RfqStatus | ""; search?: string } = {}): Promise<RfqRow[]> {
  const T = requireCurrentTenantId();
  const q = f.search?.trim();
  return dbSelect<RfqRow>(
    `SELECT r.*,
       (SELECT COUNT(*) FROM hospital_rfq_items i WHERE i.rfq_id = r.id AND i.tenant_id = r.tenant_id AND i.deleted_at IS NULL) AS items,
       (SELECT COUNT(*) FROM hospital_rfq_vendors v WHERE v.rfq_id = r.id AND v.tenant_id = r.tenant_id AND v.deleted_at IS NULL) AS vendors,
       (SELECT COUNT(*) FROM hospital_rfq_vendors v WHERE v.rfq_id = r.id AND v.tenant_id = r.tenant_id AND v.deleted_at IS NULL AND v.status IN ('quoted', 'awarded', 'not_awarded')) AS quoted,
       (SELECT GROUP_CONCAT(s.name, ', ') FROM hospital_rfq_vendors v JOIN suppliers s ON s.id = v.vendor_id WHERE v.rfq_id = r.id AND v.tenant_id = r.tenant_id AND v.deleted_at IS NULL) AS vendor_names
     FROM hospital_rfqs r
     WHERE r.tenant_id = ? AND r.deleted_at IS NULL ${f.status ? "AND r.status = ?" : ""}
       ${q ? `AND (r.rfq_no LIKE ? OR r.title LIKE ? OR EXISTS (SELECT 1 FROM hospital_rfq_items i WHERE i.rfq_id = r.id AND i.tenant_id = r.tenant_id AND i.product_name LIKE ?)
               OR EXISTS (SELECT 1 FROM hospital_rfq_vendors v JOIN suppliers s ON s.id = v.vendor_id WHERE v.rfq_id = r.id AND v.tenant_id = r.tenant_id AND s.name LIKE ?))` : ""}
     ORDER BY r.created_at DESC LIMIT 300`,
    [T, ...(f.status ? [f.status] : []), ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [])]
  );
}

export interface RfqVendorView extends RfqVendor { vendor_name: string; vendor_no: string | null }
export interface RfqDetail { rfq: Rfq; items: RfqItem[]; vendors: RfqVendorView[]; quotes: RfqQuote[]; orders: (PurchaseOrder & { vendor_name: string | null })[] }

/** One request with every vendor's rates (for the comparison). */
export async function getRfq(id: string): Promise<RfqDetail | null> {
  const T = requireCurrentTenantId();
  const rfq = await rfqsRepo.get(id);
  if (!rfq) return null;
  const [items, vendors, quotes, orders] = await Promise.all([
    rfqItemsRepo.list({ where: "rfq_id = ?", params: [id], orderBy: "sort ASC, created_at ASC" }),
    dbSelect<RfqVendorView>(
      `SELECT v.*, s.name AS vendor_name, s.vendor_no FROM hospital_rfq_vendors v JOIN suppliers s ON s.id = v.vendor_id
       WHERE v.rfq_id = ? AND v.tenant_id = ? AND v.deleted_at IS NULL ORDER BY s.name`, [id, T]),
    dbSelect<RfqQuote>(`SELECT * FROM hospital_rfq_quotes WHERE rfq_id = ? AND tenant_id = ? AND deleted_at IS NULL`, [id, T]),
    dbSelect<PurchaseOrder & { vendor_name: string | null }>(
      `SELECT p.*, s.name AS vendor_name FROM hospital_purchase_orders p LEFT JOIN suppliers s ON s.id = p.vendor_id
       WHERE p.rfq_id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL ORDER BY p.po_no`, [id, T]),
  ]);
  return { rfq, items, vendors, quotes, orders };
}

/** The usable quote of a vendor for an item (available, with a rate). */
export function quoteFor(d: Pick<RfqDetail, "quotes">, itemId: string, vendorId: string): RfqQuote | null {
  const q = d.quotes.find((x) => x.rfq_item_id === itemId && x.vendor_id === vendorId);
  return q && Number(q.available) === 1 && Number(q.rate) > 0 ? q : null;
}

/** For each item, the vendor with the lowest quoted rate (none when nobody quoted it). */
export function lowestBids(d: RfqDetail): Record<string, string> {
  const out: Record<string, string> = {};
  for (const it of d.items) {
    let best: { vendor: string; rate: number } | null = null;
    for (const v of d.vendors) {
      if (v.status === "declined") continue;
      const q = quoteFor(d, it.id, v.vendor_id);
      if (q && (!best || Number(q.rate) < best.rate)) best = { vendor: v.vendor_id, rate: Number(q.rate) };
    }
    if (best) out[it.id] = best.vendor;
  }
  return out;
}

/** Issues the purchase orders: each item to its chosen vendor at the rate that vendor quoted; one order per vendor. */
export async function issuePurchaseOrders(rfqId: string, awards: Record<string, string>, opts: { note?: string | null } = {}): Promise<PurchaseOrder[]> {
  const a = await needPurchaseOfficer();
  const d = await getRfq(rfqId);
  if (!d) throw new Error("Request not found.");
  if (d.rfq.status !== "open") throw new Error(d.rfq.status === "awarded" ? "Purchase orders were already issued for this request." : "This request was cancelled.");
  const byVendor = new Map<string, { item: RfqItem; rate: number }[]>();
  for (const it of d.items) {
    const vendorId = awards[it.id];
    if (!vendorId) continue;
    const invite = d.vendors.find((v) => v.vendor_id === vendorId);
    if (!invite || invite.status === "declined") throw new Error(`${it.product_name}: that vendor was not asked or declined.`);
    const q = quoteFor(d, it.id, vendorId);
    if (!q) throw new Error(`${it.product_name}: ${invite.vendor_name} has not quoted a rate for it.`);
    byVendor.set(vendorId, [...(byVendor.get(vendorId) ?? []), { item: it, rate: Number(q.rate) }]);
  }
  if (!byVendor.size) throw new Error("Choose the vendor for at least one item.");
  const at = new Date().toISOString();
  const orders: PurchaseOrder[] = [];
  for (const [vendorId, lines] of byVendor) {
    const invite = d.vendors.find((v) => v.vendor_id === vendorId)!;
    const po = await purchaseOrdersRepo.create({
      po_no: await nextNo("hospital_purchase_orders", "po_no", "PO"), rfq_id: rfqId, vendor_id: vendorId, kind: d.rfq.kind, status: "issued",
      total: round(lines.reduce((s, l) => s + Number(l.item.qty) * l.rate, 0)), delivery_days: invite.delivery_days ?? null,
      note: opts.note?.trim() || null, issued_by_name: who(a), issued_at: at,
    });
    for (const l of lines) {
      await poItemsRepo.create({
        po_id: po.id, rfq_item_id: l.item.id, product_id: l.item.product_id, product_name: l.item.product_name, specification: l.item.specification,
        qty: Number(l.item.qty), uom: l.item.uom, rate: round(l.rate), store: l.item.store,
      });
    }
    orders.push(po);
  }
  for (const v of d.vendors) {
    if (v.status === "declined") continue;
    await rfqVendorsRepo.update(v.id, { status: byVendor.has(v.vendor_id) ? "awarded" : "not_awarded" });
  }
  await rfqsRepo.update(rfqId, { status: "awarded", awarded_at: at, awarded_by_name: who(a) });
  return orders;
}

export async function cancelRfq(id: string, reason: string): Promise<Rfq> {
  await needPurchaseOfficer();
  const r = await rfqsRepo.get(id);
  if (!r) throw new Error("Request not found.");
  if (r.status !== "open") throw new Error("Only a request still waiting for rates can be cancelled.");
  if (!reason?.trim()) throw new Error("Write why the request is cancelled.");
  return (await rfqsRepo.update(id, { status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason.trim() }))!;
}

// ── Purchase orders ─────────────────────────────────────────────────────────

export interface PoRow extends PurchaseOrder { vendor_name: string | null; vendor_no: string | null; rfq_no: string | null; items: number; invoice_status: VendorInvoiceStatus | null; invoice_no: string | null }

export async function listPurchaseOrders(f: { status?: PoStatus | ""; search?: string } = {}): Promise<PoRow[]> {
  const T = requireCurrentTenantId();
  const q = f.search?.trim();
  return dbSelect<PoRow>(
    `SELECT p.*, s.name AS vendor_name, s.vendor_no, r.rfq_no,
       (SELECT COUNT(*) FROM hospital_po_items i WHERE i.po_id = p.id AND i.tenant_id = p.tenant_id AND i.deleted_at IS NULL) AS items,
       inv.status AS invoice_status, inv.invoice_no
     FROM hospital_purchase_orders p
     LEFT JOIN suppliers s ON s.id = p.vendor_id
     LEFT JOIN hospital_rfqs r ON r.id = p.rfq_id
     LEFT JOIN hospital_vendor_invoices inv ON inv.id = (SELECT x.id FROM hospital_vendor_invoices x WHERE x.po_id = p.id AND x.tenant_id = p.tenant_id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1)
     WHERE p.tenant_id = ? AND p.deleted_at IS NULL ${f.status ? "AND p.status = ?" : ""}
       ${q ? "AND (p.po_no LIKE ? OR s.name LIKE ? OR r.rfq_no LIKE ? OR EXISTS (SELECT 1 FROM hospital_po_items i WHERE i.po_id = p.id AND i.tenant_id = p.tenant_id AND i.product_name LIKE ?))" : ""}
     ORDER BY p.created_at DESC LIMIT 300`,
    [T, ...(f.status ? [f.status] : []), ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [])]
  );
}

export async function getPurchaseOrder(id: string): Promise<{ po: PurchaseOrder; items: PoItem[]; vendorName: string; vendorNo: string | null } | null> {
  const po = await purchaseOrdersRepo.get(id);
  if (!po) return null;
  const vendor = await suppliersRepo.get(po.vendor_id);
  return { po, items: await poItemsRepo.list({ where: "po_id = ?", params: [id], orderBy: "created_at ASC" }), vendorName: vendor?.name ?? "—", vendorNo: vendor?.vendor_no ?? null };
}

/** Cancels an order the vendor has not invoiced yet. */
export async function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrder> {
  await needPurchaseOfficer();
  const po = await purchaseOrdersRepo.get(id);
  if (!po) throw new Error("Purchase order not found.");
  if (po.status !== "issued") throw new Error(po.status === "invoiced" ? "The vendor has invoiced this order: return the invoice first." : "Already cancelled.");
  if (!reason?.trim()) throw new Error("Write why the order is cancelled.");
  return (await purchaseOrdersRepo.update(id, { status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason.trim() }))!;
}

// ── Invoices from vendors (Purchase Cell > Purchase) ─────────────────────────

export interface VendorInvoiceRow extends VendorInvoice { vendor_name: string | null; vendor_no: string | null; po_no: string; store_purchase_no: string | null; store_purchase_status: string | null }

export async function listVendorInvoices(status: VendorInvoiceStatus | "" = "submitted"): Promise<VendorInvoiceRow[]> {
  const T = requireCurrentTenantId();
  return dbSelect<VendorInvoiceRow>(
    `SELECT i.*, s.name AS vendor_name, s.vendor_no, p.po_no, sp.purchase_no AS store_purchase_no, sp.status AS store_purchase_status
     FROM hospital_vendor_invoices i
     JOIN hospital_purchase_orders p ON p.id = i.po_id AND p.tenant_id = i.tenant_id
     LEFT JOIN suppliers s ON s.id = i.vendor_id
     LEFT JOIN hospital_store_purchases sp ON sp.id = i.store_purchase_id
     WHERE i.tenant_id = ? AND i.deleted_at IS NULL ${status ? "AND i.status = ?" : ""}
     ORDER BY i.created_at DESC LIMIT 300`,
    [T, ...(status ? [status] : [])]
  );
}

/** Forwards a vendor's invoice to the stores: it becomes a store purchase posted
 * for the store keepers to verify (each item to its store); verified, it goes to Finance. */
export async function forwardVendorInvoice(invoiceId: string, stores: Record<string, StoreId | "">): Promise<VendorInvoice> {
  const a = await needPurchaseOfficer();
  const inv = await vendorInvoicesRepo.get(invoiceId);
  if (!inv) throw new Error("Invoice not found.");
  if (inv.status !== "submitted") throw new Error("This invoice was already dealt with.");
  const items = await poItemsRepo.list({ where: "po_id = ?", params: [inv.po_id], orderBy: "created_at ASC" });
  if (!items.length) throw new Error("The purchase order has no items.");
  for (const it of items) {
    const s = stores[it.id] || it.store;
    if (!s || !isStoreId(s)) throw new Error(`Choose the store for ${it.product_name}.`);
  }
  const po = await purchaseOrdersRepo.get(inv.po_id);
  const sp = await saveStorePurchase({
    vendorId: inv.vendor_id, vendorInvoiceNo: inv.invoice_no, date: inv.invoice_date,
    note: [`From purchase order ${po?.po_no ?? ""} (vendor portal).`, inv.note].filter(Boolean).join("\n"),
    items: items.map((it) => ({ productId: it.product_id, productName: it.product_name, qty: Number(it.qty), rate: Number(it.rate), store: (stores[it.id] || it.store) as StoreId })),
  });
  await postStorePurchase(sp.id);
  return (await vendorInvoicesRepo.update(invoiceId, { status: "forwarded", store_purchase_id: sp.id, forwarded_at: new Date().toISOString(), forwarded_by_name: who(a) }))!;
}

/** Sends the invoice back to the vendor with the reason (they can submit a corrected one). */
export async function returnVendorInvoice(invoiceId: string, reason: string): Promise<VendorInvoice> {
  await needPurchaseOfficer();
  const inv = await vendorInvoicesRepo.get(invoiceId);
  if (!inv) throw new Error("Invoice not found.");
  if (inv.status !== "submitted") throw new Error("This invoice was already dealt with.");
  if (!reason?.trim()) throw new Error("Write why the invoice is returned.");
  const out = (await vendorInvoicesRepo.update(invoiceId, { status: "returned", return_reason: reason.trim(), returned_at: new Date().toISOString() }))!;
  await purchaseOrdersRepo.update(inv.po_id, { status: "issued" });
  return out;
}
