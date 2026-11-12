/** New sales and purchases from the MAVIN Business Android app.
 *
 * The app sends what the cashier entered; the server works out the rest the
 * same way the web forms do (components/invoices/InvoiceFormModal.tsx and
 * components/purchases/PurchaseFormModal.tsx), with the same helpers:
 * prices from the price list, tax from the product, category discounts,
 * earliest-expiry batches first (allocateBatches), the line math
 * (saleLineMath / purchaseLineMath) and the business's next number.
 *
 * Every statement goes through `run`, which in production is runForCaller:
 * the same permission check (sqlPolicy), business and branch scoping
 * (tenantScope) and audit log as the web. Unlike the web form, a document is
 * written as ONE atomic batch: header, lines, stock and price list together,
 * and a sale whose stock is no longer there is refused as a whole.
 *
 * Saving twice is harmless: the app chooses the document id, and a request
 * for an id that already exists answers with the saved document. */
import { allocateBatches, STOCK_EPS, type BatchStock } from "../lib/batchAllocation";
import { saleLineMath } from "../lib/saleLineMath";
import { purchaseLineMath } from "../lib/purchaseMath";
import { toBaseUnitQty, effectivePacking } from "../lib/uom";
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** A statement as the browser sends it to /api/db. */
export interface Stmt { sql: string; args: unknown[] }
/** A result as runForCaller returns it. */
export interface Res { columns: string[]; rows: unknown[][]; rowsAffected: number }
/** Runs statements for the caller (several together = one atomic batch). */
export type Runner = (stmts: Stmt[], batch: boolean) => Promise<Res[]>;

type Row = Record<string, unknown>;
const rowsOf = (r: Res | undefined): Row[] => (r ? r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) : []);
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown, max = 200): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};
const pct = (v: unknown) => Math.min(100, Math.max(0, Number(v) || 0));
const round2 = (n: number) => Math.round(n * 100) / 100;
/** A record id (products, customers, suppliers). */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The id the app chooses for a new document: long enough to be unique (a UUID). */
const DOC_ID = /^[A-Za-z0-9-]{16,64}$/;

/** Today in Pakistan (the web uses the browser's date; app users are in Pakistan). */
export function pkToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function newId(): string {
  return crypto.randomUUID();
}

/** A staff login limited to some sections needs this one (the web hides the
 * section; the menu keys are config/nav.ts's "invoices" and "purchase"). */
export function requireModule(caller: Caller, moduleKey: "invoices" | "purchase"): void {
  if (caller.role === "staff" && Array.isArray(caller.permissions) && !caller.permissions.includes(moduleKey)) {
    throw new HttpError(403, `Your login has no access to ${moduleKey === "invoices" ? "Invoices" : "Purchase"}. Ask the owner to allow it.`);
  }
}

/** The stock check at the end of a sale batch: a batch below zero makes the
 * whole batch fail (json() of a non-JSON text raises an error), so nothing of
 * the sale is written. It runs only for offending rows. */
const STOCK_GUARD = "STOCK_GUARD";
function stockGuard(batchIds: string[], tenantId: string): Stmt {
  return {
    sql: `SELECT json('${STOCK_GUARD}{' || id) AS stock_check FROM product_batches WHERE id IN (${batchIds.map(() => "?").join(", ")}) AND tenant_id = ? AND qty < ?`,
    args: [...batchIds, tenantId, -STOCK_EPS],
  };
}
const isStockGuard = (e: unknown) => /malformed JSON/i.test(String((e as Error)?.message ?? e));
const isDuplicateId = (e: unknown) => /UNIQUE constraint failed: (invoices|purchases)\.id|PRIMARY KEY/i.test(String((e as Error)?.message ?? e));

/** The next number of a numbered document, as nextDocNo (lib/repo/docNumbers.ts). */
async function nextNo(run: Runner, table: "invoices" | "purchases", tenantId: string): Promise<number> {
  const scope = table === "invoices" ? "COALESCE(is_quotation, 0) = 0" : "1 = 1";
  const col = table === "invoices" ? "invoice_no" : "purchase_no";
  const [r] = await run([{ sql: `SELECT MAX(${col}) AS n FROM ${table} WHERE tenant_id = ? AND ${scope}`, args: [tenantId] }], false);
  return num(rowsOf(r)[0]?.n) + 1;
}

/** As settleDocNo: if an older document of the business has this number, this one takes the next free one. */
async function settleNo(run: Runner, table: "invoices" | "purchases", tenantId: string, id: string, no: number, createdAt: string): Promise<number> {
  const scope = table === "invoices" ? "COALESCE(is_quotation, 0) = 0" : "1 = 1";
  const col = table === "invoices" ? "invoice_no" : "purchase_no";
  let current = no;
  for (let i = 0; i < 10; i++) {
    const [r] = await run([{ sql: `SELECT id, created_at FROM ${table} WHERE tenant_id = ? AND ${col} = ? AND id != ? AND ${scope}`, args: [tenantId, current, id] }], false);
    const olderExists = rowsOf(r).some((o) => String(o.created_at) < createdAt || (String(o.created_at) === createdAt && String(o.id) < id));
    if (!olderExists) return current;
    current = await nextNo(run, table, tenantId);
    await run([{ sql: `UPDATE ${table} SET ${col} = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, args: [current, new Date().toISOString(), id, tenantId] }], false);
  }
  return current;
}

// ── Sales ──────────────────────────────────────────────────────────────────

export interface SaleLineInput { productId: string; unit?: "pack" | "loose"; qty: number; bonus?: number; discountPct?: number | null }
export interface SaleInput {
  id: string;
  lines: SaleLineInput[];
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  salesmanId?: string | null;
  invOn?: "cash" | "credit";
  discountRs?: number;
  charges?: number;
  paid?: number;
  description?: string | null;
}
export interface SaleResult { id: string; invoiceNo: number; payable: number; paid: number; balance: number; duplicate: boolean }

async function existingSale(run: Runner, tenantId: string, id: string): Promise<SaleResult | null> {
  const [r] = await run([{ sql: `SELECT id, invoice_no, payable, paid, balance FROM invoices WHERE id = ? AND tenant_id = ?`, args: [id, tenantId] }], false);
  const row = rowsOf(r)[0];
  return row ? { id, invoiceNo: num(row.invoice_no), payable: num(row.payable), paid: num(row.paid), balance: num(row.balance), duplicate: true } : null;
}

export function checkSaleInput(raw: unknown): SaleInput {
  const s = (raw ?? {}) as Partial<SaleInput>;
  if (typeof s.id !== "string" || !DOC_ID.test(s.id)) throw new HttpError(400, "Missing or invalid sale id.");
  if (!Array.isArray(s.lines) || s.lines.length === 0) throw new HttpError(400, "Add at least one product line.");
  if (s.lines.length > 100) throw new HttpError(400, "A sale can have up to 100 lines.");
  for (const l of s.lines) {
    if (typeof l?.productId !== "string" || !ID.test(l.productId)) throw new HttpError(400, "A line has no product.");
    if (!(Number(l.qty) > 0)) throw new HttpError(400, "Every line needs a quantity greater than 0.");
    if (Number(l.bonus ?? 0) < 0) throw new HttpError(400, "Bonus can't be negative.");
    if (l.discountPct != null && (Number(l.discountPct) < 0 || Number(l.discountPct) > 100)) throw new HttpError(400, "Discount must be between 0 and 100%.");
  }
  for (const k of ["discountRs", "charges", "paid"] as const) if (Number(s[k] ?? 0) < 0) throw new HttpError(400, `${k} can't be negative.`);
  return s as SaleInput;
}

/** Saves a sale (invoice) in one atomic batch. */
export async function createSale(run: Runner, tenantId: string, raw: unknown, today = pkToday()): Promise<SaleResult> {
  const s = checkSaleInput(raw);
  const dup = await existingSale(run, tenantId, s.id);
  if (dup) return dup;

  // The plan's monthly invoice cap (as the web form checks).
  const monthStart = `${today.slice(0, 7)}-01`;
  const reads = await run([
    { sql: `SELECT sp.max_invoices_per_month AS cap FROM tenants t LEFT JOIN subscription_plans sp ON sp.id = t.subscription_plan_id WHERE t.id = ?`, args: [tenantId] },
    { sql: `SELECT COUNT(*) AS n FROM invoices WHERE deleted_at IS NULL AND tenant_id = ? AND is_return = 0 AND is_quotation = 0 AND date >= ?`, args: [tenantId, monthStart] },
  ], false);
  const cap = rowsOf(reads[0])[0]?.cap;
  if (cap != null && num(rowsOf(reads[1])[0]?.n) >= num(cap)) {
    throw new HttpError(403, `Your plan allows up to ${num(cap)} invoices per month - that limit has been reached for this month.`);
  }

  // Products, latest prices, category discounts and the batches with stock (this branch: tenantScope).
  const productIds = [...new Set(s.lines.map((l) => l.productId))];
  const inList = productIds.map(() => "?").join(", ");
  const [pr, pl, bt] = await run([
    { sql: `SELECT p.id, p.name, p.packing, p.base_unit_id, p.gst_rate_pct, p.is_narcotic, p.track_imei,
                   (SELECT sc.flat_discount_pct FROM sub_categories sc WHERE sc.id = p.sub_category_id) AS sub_disc,
                   (SELECT c.flat_discount_pct FROM categories c WHERE c.id = p.category_id) AS cat_disc
            FROM products p WHERE p.id IN (${inList}) AND p.deleted_at IS NULL`, args: productIds },
    { sql: `SELECT product_id, sale_price, created_at FROM price_list WHERE product_id IN (${inList}) AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`, args: [...productIds, tenantId] },
    { sql: `SELECT id, product_id, batch_no, expiry_date, qty, purchase_price FROM product_batches
            WHERE product_id IN (${inList}) AND tenant_id = ? AND deleted_at IS NULL AND qty > 0
            ORDER BY (expiry_date IS NULL), expiry_date ASC`, args: [...productIds, tenantId] },
  ], false);
  const products = new Map(rowsOf(pr).map((p) => [String(p.id), p]));
  const prices = new Map<string, number>();
  for (const r of rowsOf(pl)) if (!prices.has(String(r.product_id))) prices.set(String(r.product_id), num(r.sale_price));
  const batchesOf = new Map<string, BatchStock[]>();
  for (const b of rowsOf(bt)) {
    const list = batchesOf.get(String(b.product_id)) ?? [];
    list.push({ id: String(b.id), batch_no: (b.batch_no as string | null) ?? null, expiry_date: (b.expiry_date as string | null) ?? null, qty: num(b.qty), purchase_price: num(b.purchase_price) });
    batchesOf.set(String(b.product_id), list);
  }

  const customerName = str(s.customerName);
  const customerPhone = str(s.customerPhone, 40);
  if (s.customerId) {
    const [c] = await run([{ sql: `SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, args: [s.customerId, tenantId] }], false);
    if (!rowsOf(c)[0]) throw new HttpError(400, "That customer was not found.");
  }
  if (s.salesmanId) {
    const [m] = await run([{ sql: `SELECT id FROM salesmen WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, args: [s.salesmanId, tenantId] }], false);
    if (!rowsOf(m)[0]) throw new HttpError(400, "That salesman was not found.");
  }

  // Lines: price per pack, quantities in packs (base units), split over batches earliest expiry first.
  const now = new Date().toISOString();
  const used = new Map<string, number>();
  const itemStmts: Stmt[] = [];
  const takes = new Map<string, number>();
  let total = 0, lineDiscount = 0, tax = 0;
  for (const l of s.lines) {
    const p = products.get(l.productId);
    if (!p) throw new HttpError(400, "A product on this sale was not found.");
    const name = String(p.name);
    if (num(p.track_imei) === 1) throw new HttpError(400, `${name} needs IMEI numbers. Sell it in the web version.`);
    if (num(p.is_narcotic) === 1 && (!customerName || !customerPhone)) throw new HttpError(400, `${name} is a controlled medicine: enter the buyer's name and mobile.`);
    const packing = effectivePacking(num(p.packing));
    const loose = l.unit === "loose";
    const qty = toBaseUnitQty(Number(l.qty), loose, packing);
    const bonus = toBaseUnitQty(Number(l.bonus ?? 0), loose, packing);
    const batches = batchesOf.get(l.productId) ?? [];
    // Price: the latest price list entry, else the batch's purchase price (as the web form).
    const price = prices.get(l.productId) ?? batches[0]?.purchase_price ?? 0;
    const discountPct = l.discountPct != null ? pct(l.discountPct) : pct(num(p.sub_disc) > 0 ? p.sub_disc : p.cat_disc);
    const taxPct = num(p.gst_rate_pct);
    const { parts, short } = allocateBatches(batches, qty, bonus, used);
    if (short > STOCK_EPS) throw new HttpError(409, `Not enough stock of ${name}: ${Math.round((loose ? short * packing : short) * 1000) / 1000} ${loose ? "units" : "packs"} more needed than all its batches hold.`);
    for (const part of parts) {
      const m = saleLineMath(price, part.qty, discountPct, 0, taxPct);
      total += price * part.qty;
      lineDiscount += m.discountRs;
      tax += m.tax;
      takes.set(part.batch.id, (takes.get(part.batch.id) ?? 0) + part.qty + part.bonus);
      itemStmts.push({
        sql: `INSERT INTO invoice_items (id, invoice_id, product_id, batch_no, packing, uom_id, avail_qty, qty, bonus_qty, purchase_price, sale_price, tax_pct, further_tax_pct, tax_rs, discount_pct, discount_rs, total, tenant_id, created_at, updated_at, deleted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        args: [newId(), s.id, l.productId, part.batch.batch_no, num(p.packing) || 1, (p.base_unit_id as string | null) ?? null, part.batch.qty, part.qty, part.bonus, part.batch.purchase_price, price, taxPct, m.tax, discountPct, m.discountRs, m.total, tenantId, now, now],
      });
    }
  }
  const discountRs = round2(num(s.discountRs));
  const charges = round2(num(s.charges));
  const payable = round2(total - lineDiscount - discountRs + charges + tax);
  if (payable < 0) throw new HttpError(400, "The discount is more than the bill.");
  const paid = round2(num(s.paid));
  const balance = round2(payable - paid);
  const invOn = s.invOn === "credit" ? "credit" : "cash";
  if (invOn === "credit" && !s.customerId && !customerName) throw new HttpError(400, "A credit sale needs a customer.");

  const invoiceNo = await nextNo(run, "invoices", tenantId);
  const header: Stmt = {
    sql: `INSERT INTO invoices (id, invoice_no, date, inv_on, invoice_type, description, salesman_id, customer_id, customer_name, customer_phone,
            total, charges, discount_pct, discount_rs, tax_pct, payable, paid, balance, is_return, is_memorized, is_quotation, converted_invoice_id,
            tenant_id, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, 'retail', ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, 0, 0, 0, NULL, ?, ?, ?, NULL)`,
    args: [s.id, invoiceNo, today, invOn, str(s.description, 500), s.salesmanId || null, s.customerId || null, customerName, customerPhone,
      round2(total), charges, discountRs, payable, paid, balance, tenantId, now, now],
  };
  const stockStmts: Stmt[] = [...takes].map(([batchId, q]) => ({
    // As deductStock (lib/repo/stock.ts), without its "enough stock" condition: the guard below refuses the whole sale instead.
    sql: `UPDATE product_batches SET qty = CASE WHEN ABS(qty + ?) <= ? THEN 0 ELSE qty + ? END, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    args: [-q, STOCK_EPS, -q, now, batchId, tenantId],
  }));
  try {
    await run([header, ...itemStmts, ...stockStmts, stockGuard([...takes.keys()], tenantId)], true);
  } catch (e) {
    if (isStockGuard(e)) throw new HttpError(409, "Stock changed while saving (another sale took it). Nothing was saved. Refresh and try again.");
    // Sent twice at the same moment: the other request saved it.
    if (isDuplicateId(e)) {
      const again = await existingSale(run, tenantId, s.id);
      if (again) return again;
    }
    throw e;
  }
  const no = await settleNo(run, "invoices", tenantId, s.id, invoiceNo, now);
  return { id: s.id, invoiceNo: no, payable, paid, balance, duplicate: false };
}

// ── Purchases ──────────────────────────────────────────────────────────────

export interface PurchaseLineInput {
  productId: string;
  unit?: "pack" | "loose";
  qty: number;
  bonus?: number;
  purchasePrice: number;
  salePrice?: number | null;
  batchNo?: string | null;
  expiryDate?: string | null;
  stPct?: number;
  whtPct?: number;
  discPct?: number;
}
export interface PurchaseInput {
  id: string;
  supplierId: string;
  supplierInvoiceNo?: string | null;
  paymentMethod?: "Cash" | "Bank";
  discountRs?: number;
  paid?: number;
  description?: string | null;
  lines: PurchaseLineInput[];
}
export interface PurchaseResult { id: string; purchaseNo: number; payable: number; paid: number; balance: number; duplicate: boolean }

async function existingPurchase(run: Runner, tenantId: string, id: string): Promise<PurchaseResult | null> {
  const [r] = await run([{ sql: `SELECT id, purchase_no, payable, paid_amount, balance FROM purchases WHERE id = ? AND tenant_id = ?`, args: [id, tenantId] }], false);
  const row = rowsOf(r)[0];
  return row ? { id, purchaseNo: num(row.purchase_no), payable: num(row.payable), paid: num(row.paid_amount), balance: num(row.balance), duplicate: true } : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function checkPurchaseInput(raw: unknown): PurchaseInput {
  const s = (raw ?? {}) as Partial<PurchaseInput>;
  if (typeof s.id !== "string" || !DOC_ID.test(s.id)) throw new HttpError(400, "Missing or invalid purchase id.");
  if (typeof s.supplierId !== "string" || !ID.test(s.supplierId)) throw new HttpError(400, "Choose a supplier.");
  if (!Array.isArray(s.lines) || s.lines.length === 0) throw new HttpError(400, "Add at least one product line.");
  if (s.lines.length > 100) throw new HttpError(400, "A purchase can have up to 100 lines.");
  for (const l of s.lines) {
    if (typeof l?.productId !== "string" || !ID.test(l.productId)) throw new HttpError(400, "A line has no product.");
    // As the web form's linesProblems: nothing negative, extra discount at most 100%.
    for (const [k, label] of [["purchasePrice", "Purchase rate"], ["salePrice", "Sale rate"], ["qty", "Quantity"], ["bonus", "Bonus"], ["stPct", "S.T %"], ["whtPct", "W.T %"], ["discPct", "Extra discount %"]] as const) {
      if (Number(l[k] ?? 0) < 0) throw new HttpError(400, `${label} can't be negative.`);
    }
    if (!(Number(l.qty) > 0) && !(Number(l.bonus ?? 0) > 0)) throw new HttpError(400, "Every line needs a quantity.");
    if (Number(l.discPct ?? 0) > 100) throw new HttpError(400, "Extra discount can't be more than 100%.");
    if (l.expiryDate && !DATE.test(String(l.expiryDate))) throw new HttpError(400, "Expiry dates must be YYYY-MM-DD.");
  }
  for (const k of ["discountRs", "paid"] as const) if (Number(s[k] ?? 0) < 0) throw new HttpError(400, `${k} can't be negative.`);
  return s as PurchaseInput;
}

/** Saves a purchase (stock in) in one atomic batch. */
export async function createPurchase(run: Runner, tenantId: string, raw: unknown, today = pkToday()): Promise<PurchaseResult> {
  const s = checkPurchaseInput(raw);
  const dup = await existingPurchase(run, tenantId, s.id);
  if (dup) return dup;

  const productIds = [...new Set(s.lines.map((l) => l.productId))];
  const inList = productIds.map(() => "?").join(", ");
  const batchNos = [...new Set(s.lines.map((l) => str(l.batchNo, 60)).filter((b): b is string => Boolean(b)))];
  const reads = await run([
    { sql: `SELECT id FROM suppliers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, args: [s.supplierId, tenantId] },
    { sql: `SELECT id, name, packing, base_unit_id, track_imei FROM products WHERE id IN (${inList}) AND deleted_at IS NULL`, args: productIds },
    { sql: `SELECT product_id, sale_price, created_at FROM price_list WHERE product_id IN (${inList}) AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`, args: [...productIds, tenantId] },
    { sql: `SELECT product_id FROM product_suppliers WHERE supplier_id = ? AND product_id IN (${inList}) AND tenant_id = ? AND deleted_at IS NULL`, args: [s.supplierId, ...productIds, tenantId] },
    ...(batchNos.length
      ? [{ sql: `SELECT id, product_id, batch_no, qty FROM product_batches WHERE product_id IN (${inList}) AND batch_no IN (${batchNos.map(() => "?").join(", ")}) AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`, args: [...productIds, ...batchNos, tenantId] }]
      : []),
  ], false);
  if (!rowsOf(reads[0])[0]) throw new HttpError(400, "That supplier was not found.");
  const products = new Map(rowsOf(reads[1]).map((p) => [String(p.id), p]));
  const prices = new Map<string, number>();
  for (const r of rowsOf(reads[2])) if (!prices.has(String(r.product_id))) prices.set(String(r.product_id), num(r.sale_price));
  const assigned = new Set(rowsOf(reads[3]).map((r) => String(r.product_id)));
  // receiveStock: a batch number this product already has gets the quantity added (the first such batch).
  const existingBatch = new Map<string, { id: string; qty: number }>();
  for (const b of rowsOf(reads[4])) {
    const key = `${b.product_id}|${b.batch_no}`;
    if (!existingBatch.has(key)) existingBatch.set(key, { id: String(b.id), qty: num(b.qty) });
  }

  const now = new Date().toISOString();
  const lineStmts: Stmt[] = [];
  let subtotal = 0, tax = 0;
  for (const l of s.lines) {
    const p = products.get(l.productId);
    if (!p) throw new HttpError(400, "A product on this purchase was not found.");
    const name = String(p.name);
    if (num(p.track_imei) === 1) throw new HttpError(400, `${name} needs IMEI numbers. Buy it in the web version.`);
    const packing = effectivePacking(num(p.packing));
    const loose = l.unit === "loose";
    // Everything is stored in packs (base units), as the web form normalises it.
    const qty = toBaseUnitQty(num(l.qty), loose, packing);
    const bonus = toBaseUnitQty(num(l.bonus), loose, packing);
    const purchasePrice = loose ? num(l.purchasePrice) * packing : num(l.purchasePrice);
    const stPct = num(l.stPct), whtPct = num(l.whtPct), discPct = pct(l.discPct);
    const shown = purchaseLineMath(num(l.purchasePrice), num(l.qty), num(l.bonus), stPct, whtPct, discPct);
    subtotal += shown.total;
    tax += shown.st + shown.wht;
    const netRate = purchaseLineMath(purchasePrice, qty, bonus, 0, 0, discPct).netRate;
    const amount = purchaseLineMath(purchasePrice, qty, bonus, 0, 0, discPct).amount;
    const batchNo = str(l.batchNo, 60);
    const expiry = str(l.expiryDate, 10);
    const key = `${l.productId}|${batchNo}`;
    const have = batchNo ? existingBatch.get(key) : undefined;
    let availAfter: number;
    if (have) {
      // As changeBatchQty with a purchase price, then the expiry when given.
      lineStmts.push({
        sql: `UPDATE product_batches SET qty = CASE WHEN ABS(qty + ?) <= ? THEN 0 ELSE qty + ? END, updated_at = ?${netRate ? ", purchase_price = ?" : ""}${expiry ? ", expiry_date = ?" : ""} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        args: [qty + bonus, STOCK_EPS, qty + bonus, now, ...(netRate ? [netRate] : []), ...(expiry ? [expiry] : []), have.id, tenantId],
      });
      have.qty += qty + bonus;
      availAfter = have.qty;
    } else {
      const batchId = newId();
      lineStmts.push({
        sql: `INSERT INTO product_batches (id, product_id, tenant_id, batch_no, expiry_date, qty, location, purchase_price, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
        args: [batchId, l.productId, tenantId, batchNo, expiry, qty + bonus, netRate, now, now],
      });
      if (batchNo) existingBatch.set(key, { id: batchId, qty: qty + bonus });
      availAfter = qty + bonus;
    }
    lineStmts.push({
      sql: `INSERT INTO purchase_items (id, tenant_id, purchase_id, product_id, location, batch_no, expiry_date, uom_id, purchase_price, booked_qty, received_qty, avail_qty, amount, st_pct, wht_pct, disc_pct, total${bonus > 0 ? ", bonus_qty" : ""}, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${bonus > 0 ? ", ?" : ""}, ?, ?, NULL)`,
      args: [newId(), tenantId, s.id, l.productId, batchNo, expiry, (p.base_unit_id as string | null) ?? null, purchasePrice, qty, qty, availAfter, amount, stPct, whtPct, discPct, shown.total, ...(bonus > 0 ? [bonus] : []), now, now],
    });
    // A new price-list entry only when the retail price was changed on this purchase.
    if (l.salePrice != null) {
      const salePrice = loose ? num(l.salePrice) * packing : num(l.salePrice);
      if (Math.abs(salePrice - (prices.get(l.productId) ?? 0)) > 0.0001) {
        lineStmts.push({
          sql: `INSERT INTO price_list (id, product_id, tenant_id, batch_no, sale_price, wholesale_price, mrp, comment, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, 0, 0, 'Updated via Purchase', ?, ?, NULL)`,
          args: [newId(), l.productId, tenantId, batchNo, salePrice, now, now],
        });
        prices.set(l.productId, salePrice);
      }
    }
    // Buying a product from a supplier assigns it to that supplier.
    if (!assigned.has(l.productId)) {
      lineStmts.push({
        sql: `INSERT INTO product_suppliers (id, tenant_id, product_id, supplier_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        args: [newId(), tenantId, l.productId, s.supplierId, now, now],
      });
      assigned.add(l.productId);
    }
  }
  const discountRs = round2(num(s.discountRs));
  const payable = round2(subtotal - discountRs);
  if (payable < 0) throw new HttpError(400, "The discount is more than the purchase.");
  const paid = round2(num(s.paid));
  const balance = round2(payable - paid);

  const purchaseNo = await nextNo(run, "purchases", tenantId);
  const header: Stmt = {
    sql: `INSERT INTO purchases (id, tenant_id, purchase_no, date, order_id, supplier_id, supplier_invoice_no, discount_rs, discount_pct, tax, payable, paid_amount, balance,
            description, payment_method, bank_id, slip_no, advance_payment, is_return, original_purchase_id, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, ?, ?, NULL)`,
    args: [s.id, tenantId, purchaseNo, today, s.supplierId, str(s.supplierInvoiceNo, 60), discountRs, round2(tax), payable, paid, balance,
      str(s.description, 500), s.paymentMethod === "Bank" ? "Bank" : "Cash", now, now],
  };
  try {
    await run([header, ...lineStmts], true);
  } catch (e) {
    if (isDuplicateId(e)) {
      const again = await existingPurchase(run, tenantId, s.id);
      if (again) return again;
    }
    throw e;
  }
  const no = await settleNo(run, "purchases", tenantId, s.id, purchaseNo, now);
  return { id: s.id, purchaseNo: no, payable, paid, balance, duplicate: false };
}
