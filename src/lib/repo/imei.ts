/** Mobile shop: every IMEI-tracked handset is one row here. Bought in on a
 * purchase (or added to opening stock), sold on an invoice with the buyer's
 * name, CNIC and mobile, put back in stock when the sale is returned or
 * deleted, and sent back on a purchase return. Product stock (batches) is
 * still kept by the store system; this is the handset-by-handset register. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { isMissingSchemaError } from "../dbErrors";
import type { TenantRow } from "./base";

export type ImeiStatus = "in_stock" | "sold" | "returned";

export interface ImeiUnit extends TenantRow {
  product_id: string;
  imei: string;
  imei2: string | null;
  status: ImeiStatus;
  purchase_id: string | null;
  purchase_price: number;
  invoice_id: string | null;
  sold_at: string | null;
  customer_name: string | null;
  customer_mobile: string | null;
  customer_cnic: string | null;
  notes: string | null;
}

export const imeiRepo = createTenantRepo<ImeiUnit>("mobile_imei_units");

const NEEDS_V67 = "IMEI tracking needs the latest database update (v67). Ask the administrator to run it.";
async function v67<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingSchemaError(e)) throw new Error(NEEDS_V67);
    throw e;
  }
}

/** An IMEI is 15 digits. */
export function isValidImei(s: string): boolean {
  return /^\d{15}$/.test(s);
}

/** IMEIs typed or scanned one per line (or separated by commas / spaces). */
export function parseImeis(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
}

/** Problems with a list of IMEIs for `count` units (empty = fine). */
export function imeiListProblem(imeis: string[], count: number, what: string): string | null {
  const bad = imeis.filter((i) => !isValidImei(i));
  if (bad.length) return `${what}: ${bad.slice(0, 3).join(", ")} ${bad.length === 1 ? "is not" : "are not"} a 15-digit IMEI.`;
  if (imeis.length !== count) return `${what}: ${count} handset${count === 1 ? "" : "s"}, ${imeis.length} IMEI${imeis.length === 1 ? "" : "s"} entered.`;
  return null;
}

/** Which of these products are IMEI-tracked. */
export async function imeiTrackedIds(productIds: string[]): Promise<Set<string>> {
  if (!productIds.length) return new Set();
  try {
    const rows = await dbSelect<{ id: string }>(
      `SELECT id FROM products WHERE track_imei = 1 AND id IN (${productIds.map(() => "?").join(", ")})`, productIds
    );
    return new Set(rows.map((r) => r.id));
  } catch (e) {
    if (isMissingSchemaError(e)) return new Set();
    throw e;
  }
}

async function byImei(imei: string): Promise<ImeiUnit | null> {
  return (await dbSelect<ImeiUnit>(`SELECT * FROM mobile_imei_units WHERE tenant_id = ? AND imei = ?`, [requireCurrentTenantId(), imei]))[0] ?? null;
}

/** Puts handsets in stock (a purchase, or opening stock when purchaseId is null). */
export async function receiveImeis(p: { productId: string; imeis: string[]; purchaseId: string | null; price: number }): Promise<void> {
  await v67(async () => {
    for (const imei of p.imeis) {
      if (!isValidImei(imei)) throw new Error(`${imei} is not a 15-digit IMEI.`);
      const existing = await byImei(imei);
      if (existing && !existing.deleted_at && existing.status !== "returned") {
        throw new Error(`IMEI ${imei} is already ${existing.status === "sold" ? "sold" : "in stock"}.`);
      }
      const row = {
        product_id: p.productId, imei, status: "in_stock" as const, purchase_id: p.purchaseId, purchase_price: p.price,
        invoice_id: null, sold_at: null, customer_name: null, customer_mobile: null, customer_cnic: null,
      };
      // A handset that came back (returned to the supplier, or a deleted
      // purchase) can be bought in again under the same IMEI.
      if (existing) await imeiRepo.update(existing.id, { ...row, deleted_at: null } as Partial<ImeiUnit>);
      else await imeiRepo.create(row);
    }
  });
}

/** IMEIs of a purchase, per product. */
export async function imeisOfPurchase(purchaseId: string): Promise<Map<string, ImeiUnit[]>> {
  const map = new Map<string, ImeiUnit[]>();
  try {
    for (const u of await imeiRepo.list({ where: "purchase_id = ?", params: [purchaseId], orderBy: "created_at ASC" })) {
      map.set(u.product_id, [...(map.get(u.product_id) ?? []), u]);
    }
  } catch (e) {
    if (!isMissingSchemaError(e)) throw e;
  }
  return map;
}

/** Takes a purchase's handsets back out (purchase edited or deleted); refused
 * when one of them is already sold. */
export async function removePurchaseImeis(purchaseId: string): Promise<void> {
  const units = [...(await imeisOfPurchase(purchaseId)).values()].flat();
  const sold = units.filter((u) => u.status === "sold");
  if (sold.length) throw new Error(`IMEI ${sold.map((u) => u.imei).slice(0, 3).join(", ")} of this purchase ${sold.length === 1 ? "is" : "are"} sold already.`);
  for (const u of units) await imeiRepo.remove(u.id);
}

/** Handsets of a product in stock (optionally matching typed digits). */
export async function availableImeis(productId: string, term = ""): Promise<ImeiUnit[]> {
  return v67(() => imeiRepo.list({
    where: `product_id = ? AND status = 'in_stock'${term.trim() ? " AND (imei LIKE ? OR imei2 LIKE ?)" : ""}`,
    params: term.trim() ? [productId, `%${term.trim()}%`, `%${term.trim()}%`] : [productId],
    orderBy: "created_at ASC",
  }));
}

/** IMEIs sold on an invoice, per product. */
export async function imeisOfInvoice(invoiceId: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  try {
    for (const u of await imeiRepo.list({ where: "invoice_id = ? AND status = 'sold'", params: [invoiceId], orderBy: "imei ASC" })) {
      map.set(u.product_id, [...(map.get(u.product_id) ?? []), u.imei]);
    }
  } catch (e) {
    if (!isMissingSchemaError(e)) throw e;
  }
  return map;
}

/** Puts an invoice's handsets back in stock (sale deleted or edited). */
export async function releaseInvoiceImeis(invoiceId: string): Promise<void> {
  try {
    for (const u of await imeiRepo.list({ where: "invoice_id = ? AND status = 'sold'", params: [invoiceId] })) {
      await imeiRepo.update(u.id, { status: "in_stock", invoice_id: null, sold_at: null, customer_name: null, customer_mobile: null, customer_cnic: null });
    }
  } catch (e) {
    if (!isMissingSchemaError(e)) throw e;
  }
}

/** Sells handsets on an invoice to the buyer (an edited invoice's earlier
 * handsets go back to stock first). Each IMEI must be in stock for its product. */
export async function sellImeis(
  invoiceId: string,
  lines: { productId: string; productName: string; imeis: string[] }[],
  buyer: { name: string | null; mobile: string | null; cnic: string | null }
): Promise<void> {
  await v67(async () => {
    await releaseInvoiceImeis(invoiceId);
    const ts = nowIso();
    for (const l of lines) {
      for (const imei of l.imeis) {
        const u = await byImei(imei);
        if (!u || u.deleted_at || u.product_id !== l.productId) throw new Error(`IMEI ${imei} is not a ${l.productName} in stock.`);
        if (u.status !== "in_stock") throw new Error(`IMEI ${imei} is ${u.status === "sold" ? "already sold" : "not in stock"}.`);
        await imeiRepo.update(u.id, { status: "sold", invoice_id: invoiceId, sold_at: ts, customer_name: buyer.name, customer_mobile: buyer.mobile, customer_cnic: buyer.cnic });
      }
    }
  });
}

/** A sold handset comes back (sale return): in stock again. */
export async function returnSoldImeis(imeis: string[], note: string | null = null): Promise<void> {
  await v67(async () => {
    for (const imei of imeis) {
      const u = await byImei(imei);
      if (!u || u.deleted_at || u.status !== "sold") throw new Error(`IMEI ${imei} is not a sold handset.`);
      await imeiRepo.update(u.id, {
        status: "in_stock", invoice_id: null, sold_at: null, customer_name: null, customer_mobile: null, customer_cnic: null,
        notes: [u.notes, note ?? `Returned by ${u.customer_name ?? "customer"} ${nowIso().slice(0, 10)}`].filter(Boolean).join("; "),
      });
    }
  });
}

/** Handsets sent back to the supplier (purchase return). */
export async function returnImeisToSupplier(imeis: string[]): Promise<void> {
  await v67(async () => {
    for (const imei of imeis) {
      const u = await byImei(imei);
      if (!u || u.deleted_at || u.status !== "in_stock") throw new Error(`IMEI ${imei} is not in stock.`);
      await imeiRepo.update(u.id, { status: "returned", notes: [u.notes, `Returned to supplier ${nowIso().slice(0, 10)}`].filter(Boolean).join("; ") });
    }
  });
}

export interface ImeiRegisterRow extends ImeiUnit {
  product_name: string;
  purchase_no: string | null;
  supplier_name: string | null;
  invoice_no: string | null;
}

/** The IMEI register: search by IMEI, product, buyer name, CNIC or mobile. */
export async function searchImeiRegister(term: string, status: ImeiStatus | "all" = "all"): Promise<ImeiRegisterRow[]> {
  const t = term.trim();
  return v67(() => dbSelect<ImeiRegisterRow>(
    `SELECT u.*, p.name AS product_name, pu.purchase_no, s.name AS supplier_name, i.invoice_no
     FROM mobile_imei_units u
     JOIN products p ON p.id = u.product_id
     LEFT JOIN purchases pu ON pu.id = u.purchase_id
     LEFT JOIN suppliers s ON s.id = pu.supplier_id
     LEFT JOIN invoices i ON i.id = u.invoice_id
     WHERE u.tenant_id = ? AND u.deleted_at IS NULL ${status === "all" ? "" : "AND u.status = ?"}
       ${t ? "AND (u.imei LIKE ? OR u.imei2 LIKE ? OR p.name LIKE ? OR u.customer_name LIKE ? OR u.customer_cnic LIKE ? OR u.customer_mobile LIKE ?)" : ""}
     ORDER BY u.updated_at DESC LIMIT 300`,
    [requireCurrentTenantId(), ...(status === "all" ? [] : [status]), ...(t ? Array(6).fill(`%${t}%`) : [])]
  ));
}

/** IMEIs for handsets already in stock without one (opening stock entered
 * before IMEI tracking): never more IMEIs than the product's stock. */
export async function addImeisToStock(productId: string, imeis: string[]): Promise<void> {
  if (!imeis.length) throw new Error("Scan or type at least one IMEI.");
  const bad = imeis.filter((i) => !isValidImei(i));
  if (bad.length) throw new Error(`${bad.slice(0, 3).join(", ")} ${bad.length === 1 ? "is not" : "are not"} a 15-digit IMEI.`);
  const tenantId = requireCurrentTenantId();
  const [p] = await dbSelect<{ name: string; track_imei: number }>(`SELECT name, track_imei FROM products WHERE id = ? AND tenant_id = ?`, [productId, tenantId]);
  if (!p) throw new Error("Product not found.");
  if (!p.track_imei) throw new Error(`${p.name} does not track IMEIs. Turn on Track IMEI on the product first.`);
  const [stock] = await dbSelect<{ qty: number }>(`SELECT COALESCE(SUM(qty), 0) AS qty FROM product_batches WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL`, [productId, tenantId]);
  const have = (await availableImeis(productId)).length;
  if (have + imeis.length > Number(stock?.qty ?? 0) + 1e-9) {
    throw new Error(`${p.name}: ${Number(stock?.qty ?? 0)} in stock and ${have} already have an IMEI, so at most ${Math.max(0, Number(stock?.qty ?? 0) - have)} more. Buy new handsets on a purchase.`);
  }
  const [last] = await dbSelect<{ purchase_price: number }>(
    `SELECT purchase_price FROM product_batches WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`, [productId, tenantId]
  );
  await receiveImeis({ productId, imeis, purchaseId: null, price: Number(last?.purchase_price ?? 0) });
}
