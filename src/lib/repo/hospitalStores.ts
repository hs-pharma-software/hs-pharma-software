/** Hospital stores and store purchases (v103).
 *
 * The purchase officer enters a vendor's invoice with each item's store
 * (no sale price: the hospital does not sell it) and posts it to the stores;
 * a posted purchase cannot be edited. Each store keeper sees their store's
 * items: they verify them (with the quantity actually received; each item
 * gets a stock entry number and date, and the stock enters the store) or
 * return the purchase to the purchase officer with a reason, who cancels it
 * or posts it again with a comment. When every item is verified, the
 * purchase goes to Finance for payment (Vendor Payments). */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { currentActor, type Actor } from "./medicalRecord";
import { staffRepo } from "./staff";
import { suppliersRepo } from "./suppliers";
import { localDate } from "../localDate";
import { dayMonthYear, type LedgerMove, type LedgerView, type MoveKind, type SearchItem } from "../stockLedger";
import { STORE_ROLES, isStoreId, staffStores, storeLabel, type StoreId } from "../../config/hospitalStores";

export type StorePurchaseStatus = "draft" | "posted" | "returned" | "verified" | "cancelled";
export const STORE_PURCHASE_STATUS: Record<StorePurchaseStatus, string> = {
  draft: "Draft", posted: "Posted to store", returned: "Returned by store", verified: "Verified · with Finance", cancelled: "Cancelled",
};

export interface StorePurchase extends TenantRow {
  purchase_no: string; vendor_id: string | null; vendor_invoice_no: string | null; date: string; status: StorePurchaseStatus;
  total: number; paid: number; balance: number; note: string | null; return_reason: string | null; created_by_name: string | null;
  posted_at: string | null; posted_by_name: string | null; returned_at: string | null; returned_by_name: string | null; verified_at: string | null; cancelled_at: string | null;
}
export interface StorePurchaseItem extends TenantRow {
  purchase_id: string; store: StoreId; product_id: string | null; product_name: string; company_name: string | null; qty: number; received_qty: number | null;
  rate: number; status: "pending" | "verified" | "returned"; entry_no: string | null; entered_on: string | null; verified_by_name: string | null;
}
export interface StoreMove extends TenantRow {
  store: StoreId; product_id: string | null; product_name: string; company_name: string | null; vendor_id: string | null; qty: number; unit_cost: number;
  kind: "receipt" | "issue" | "return_in" | "return_out" | "dead" | "adjust"; ref_type: string | null; ref_id: string | null; entry_no: string | null; date: string; notes: string | null; by_name: string | null;
}

export const storePurchasesRepo = createTenantRepo<StorePurchase>("hospital_store_purchases");
export const storePurchaseItemsRepo = createTenantRepo<StorePurchaseItem>("hospital_store_purchase_items");
export const storeStockRepo = createTenantRepo<StoreMove>("hospital_store_stock");

const round = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const who = (a: Actor) => (a.designation ? `${a.name}, ${a.designation}` : a.name);

/** The stores the signed-in person works in (all for the owner / admin). */
export async function myStores(): Promise<StoreId[]> {
  const a = await currentActor();
  if (a.full) return ["stationery", "general", "lab", "radiology", "medicine"];
  const roles = a.roles?.length ? a.roles : [a.role ?? ""];
  if (!roles.some((r) => STORE_ROLES.includes(r))) return [];
  const me = a.userId ? (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0] : null;
  return staffStores(me?.stores);
}

async function needStore(store: StoreId): Promise<Actor> {
  const a = await currentActor();
  if (!(await myStores()).includes(store)) throw new Error(`You do not work in the ${storeLabel(store)}.`);
  return a;
}

async function needPurchaseOfficer(): Promise<Actor> {
  const a = await currentActor();
  const roles = a.roles?.length ? a.roles : [a.role ?? ""];
  if (!a.full && !roles.includes("purchase_officer")) throw new Error("Store purchases are made by the purchase officer.");
  return a;
}

async function nextNo(table: string, column: string, prefix: string, width: number): Promise<string> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(CAST(substr(${column}, ${prefix.length + 2}) AS INTEGER)) AS n FROM ${table} WHERE tenant_id = ? AND ${column} GLOB '${prefix}-[0-9]*'`,
    [requireCurrentTenantId()]
  );
  return `${prefix}-${String((Number(rows[0]?.n) || 0) + 1).padStart(width, "0")}`;
}

export interface StorePurchaseInput {
  id?: string | null; vendorId: string; vendorInvoiceNo?: string | null; date?: string | null; note?: string | null;
  items: { productId?: string | null; productName: string; companyName?: string | null; qty: number; rate: number; store: StoreId }[];
}

/** Saves a draft (or a purchase the store returned): the vendor's invoice with each item's store. */
export async function saveStorePurchase(x: StorePurchaseInput): Promise<StorePurchase> {
  const a = await needPurchaseOfficer();
  const old = x.id ? await storePurchasesRepo.get(x.id) : null;
  if (x.id && !old) throw new Error("Purchase not found.");
  if (old && old.status !== "draft" && old.status !== "returned") throw new Error("A purchase posted to the store cannot be changed.");
  if (!x.vendorId || !(await suppliersRepo.get(x.vendorId))) throw new Error("Choose the vendor.");
  const items = x.items.filter((i) => i.productName?.trim());
  if (!items.length) throw new Error("Add at least one item.");
  for (const i of items) {
    if (!isStoreId(i.store)) throw new Error(`Choose the store of ${i.productName}.`);
    if (!(Number(i.qty) > 0)) throw new Error(`Enter the quantity of ${i.productName}.`);
    if (!(Number(i.rate) >= 0)) throw new Error(`Enter the purchase rate of ${i.productName}.`);
  }
  const total = round(items.reduce((s, i) => s + Number(i.qty) * Number(i.rate), 0));
  let p: StorePurchase;
  if (x.id && old) {
    p = (await storePurchasesRepo.update(x.id, { vendor_id: x.vendorId, vendor_invoice_no: x.vendorInvoiceNo?.trim() || null, date: x.date || old.date, note: x.note?.trim() || null, total, balance: total }))!;
    // Items already verified stay; the rest are entered again.
    for (const it of await storePurchaseItemsRepo.list({ where: "purchase_id = ? AND status != 'verified'", params: [x.id] })) await storePurchaseItemsRepo.remove(it.id);
  } else {
    p = await storePurchasesRepo.create({
      purchase_no: await nextNo("hospital_store_purchases", "purchase_no", "SP", 4), vendor_id: x.vendorId, vendor_invoice_no: x.vendorInvoiceNo?.trim() || null,
      date: x.date || localDate(), status: "draft", total, paid: 0, balance: total, note: x.note?.trim() || null, created_by_name: who(a),
    });
  }
  for (const i of items) {
    await storePurchaseItemsRepo.create({
      purchase_id: p.id, store: i.store, product_id: i.productId ?? null, product_name: i.productName.trim(), company_name: i.companyName?.trim() || null,
      qty: round3(Number(i.qty)), received_qty: null, rate: round(Number(i.rate)), status: "pending",
    });
  }
  // The whole purchase: items already received count as received.
  const all = await storePurchaseItemsRepo.list({ where: "purchase_id = ?", params: [p.id] });
  const sum = round(all.reduce((t, i) => t + (i.status === "verified" ? Number(i.received_qty ?? 0) : Number(i.qty)) * Number(i.rate), 0));
  return (await storePurchasesRepo.update(p.id, { total: sum, balance: round(sum - Number(p.paid || 0)) }))!;
}

/** Posts the purchase to the stores (again, after a return, with a comment). Posted, it cannot be edited. */
export async function postStorePurchase(id: string, comment?: string | null): Promise<StorePurchase> {
  const a = await needPurchaseOfficer();
  const p = await storePurchasesRepo.get(id);
  if (!p) throw new Error("Purchase not found.");
  if (p.status !== "draft" && p.status !== "returned") throw new Error("This purchase is already with the store.");
  if (p.status === "returned" && !comment?.trim()) throw new Error("Write a comment for the store keeper about what was corrected.");
  for (const it of await storePurchaseItemsRepo.list({ where: "purchase_id = ? AND status = 'returned'", params: [id] })) await storePurchaseItemsRepo.update(it.id, { status: "pending" });
  return (await storePurchasesRepo.update(id, {
    status: "posted", posted_at: new Date().toISOString(), posted_by_name: who(a),
    ...(comment?.trim() ? { note: [p.note, `Re-posted: ${comment.trim()}`].filter(Boolean).join("\n") } : {}),
  }))!;
}

/** Cancels a draft or a purchase the store returned. */
export async function cancelStorePurchase(id: string, reason: string): Promise<StorePurchase> {
  await needPurchaseOfficer();
  const p = await storePurchasesRepo.get(id);
  if (!p) throw new Error("Purchase not found.");
  if (p.status !== "draft" && p.status !== "returned") throw new Error("Only a draft or a purchase the store returned can be cancelled.");
  if (!reason.trim()) throw new Error("Write why it is cancelled.");
  if ((await storePurchaseItemsRepo.list({ where: "purchase_id = ? AND status = 'verified'", params: [id] })).length) throw new Error("Some items were already received into a store; this purchase cannot be cancelled.");
  return (await storePurchasesRepo.update(id, { status: "cancelled", cancelled_at: new Date().toISOString(), note: [p.note, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") }))!;
}

export interface StorePurchaseRow extends StorePurchase { vendor_name: string | null; vendor_no: string | null; items: number; stores: string }

export async function listStorePurchases(f: { status?: StorePurchaseStatus | ""; search?: string } = {}): Promise<StorePurchaseRow[]> {
  const T = requireCurrentTenantId();
  const where = ["p.tenant_id = ?", "p.deleted_at IS NULL"];
  const params: unknown[] = [T];
  if (f.status) { where.push("p.status = ?"); params.push(f.status); }
  const q = f.search?.trim();
  if (q) { where.push("(p.purchase_no LIKE ? OR p.vendor_invoice_no LIKE ? OR s.name LIKE ? OR s.vendor_no LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  return dbSelect<StorePurchaseRow>(
    `SELECT p.*, s.name AS vendor_name, s.vendor_no,
       (SELECT COUNT(*) FROM hospital_store_purchase_items i WHERE i.purchase_id = p.id AND i.tenant_id = p.tenant_id AND i.deleted_at IS NULL) AS items,
       COALESCE((SELECT GROUP_CONCAT(DISTINCT i.store) FROM hospital_store_purchase_items i WHERE i.purchase_id = p.id AND i.tenant_id = p.tenant_id AND i.deleted_at IS NULL), '') AS stores
     FROM hospital_store_purchases p LEFT JOIN suppliers s ON s.id = p.vendor_id
     WHERE ${where.join(" AND ")} ORDER BY p.date DESC, p.purchase_no DESC LIMIT 500`,
    params
  );
}

export async function getStorePurchase(id: string): Promise<{ purchase: StorePurchase; items: StorePurchaseItem[] } | null> {
  const purchase = await storePurchasesRepo.get(id);
  if (!purchase) return null;
  return { purchase, items: await storePurchaseItemsRepo.list({ where: "purchase_id = ?", params: [id], orderBy: "created_at ASC" }) };
}

export interface StoreArrival { purchase: StorePurchase & { vendor_name: string | null; vendor_no: string | null }; items: StorePurchaseItem[] }

/** A store's arrivals: posted purchases with this store's items waiting to be verified. */
export async function storeArrivals(store: StoreId): Promise<StoreArrival[]> {
  await needStore(store);
  const T = requireCurrentTenantId();
  const items = await dbSelect<StorePurchaseItem>(
    `SELECT i.* FROM hospital_store_purchase_items i JOIN hospital_store_purchases p ON p.id = i.purchase_id AND p.tenant_id = i.tenant_id
     WHERE i.tenant_id = ? AND i.deleted_at IS NULL AND i.store = ? AND i.status = 'pending' AND p.status = 'posted' AND p.deleted_at IS NULL
     ORDER BY i.created_at`,
    [T, store]
  );
  const ids = [...new Set(items.map((i) => i.purchase_id))];
  if (!ids.length) return [];
  const purchases = await dbSelect<StoreArrival["purchase"]>(
    `SELECT p.*, s.name AS vendor_name, s.vendor_no FROM hospital_store_purchases p LEFT JOIN suppliers s ON s.id = p.vendor_id
     WHERE p.tenant_id = ? AND p.id IN (${ids.map(() => "?").join(", ")}) ORDER BY p.posted_at`,
    [T, ...ids]
  );
  return purchases.map((p) => ({ purchase: p, items: items.filter((i) => i.purchase_id === p.id) }));
}

/** The store keeper verifies their store's items of a purchase, with the quantity received (default: as ordered).
 * Each item gets a stock entry number and today's date, and its stock enters the store. When every item of
 * the purchase is verified, it goes to Finance for payment. */
export async function verifyStoreItems(purchaseId: string, store: StoreId, received: Record<string, number> = {}): Promise<StorePurchase> {
  const a = await needStore(store);
  const p = await storePurchasesRepo.get(purchaseId);
  if (!p || p.status !== "posted") throw new Error("This purchase is not waiting for the store.");
  const items = await storePurchaseItemsRepo.list({ where: "purchase_id = ? AND store = ? AND status = 'pending'", params: [purchaseId, store] });
  if (!items.length) throw new Error("Nothing of this purchase is waiting in this store.");
  const today = localDate();
  // Every item is checked before any is received.
  for (const it of items) {
    const qty = round3(received[it.id] ?? Number(it.qty));
    if (!(qty >= 0)) throw new Error(`The received quantity of ${it.product_name} cannot be negative.`);
    if (qty > Number(it.qty) + 1e-9) throw new Error(`More ${it.product_name} received (${qty}) than ordered (${it.qty}): the purchase officer corrects the purchase.`);
  }
  for (const it of items) {
    const qty = round3(received[it.id] ?? Number(it.qty));
    const entry = await nextNo("hospital_store_purchase_items", "entry_no", "SE", 6);
    await storePurchaseItemsRepo.update(it.id, { received_qty: qty, status: "verified", entry_no: entry, entered_on: today, verified_by_name: who(a) });
    if (qty > 0) {
      await storeStockRepo.create({
        store, product_id: it.product_id, product_name: it.product_name, company_name: it.company_name, vendor_id: p.vendor_id, qty, unit_cost: Number(it.rate),
        kind: "receipt", ref_type: "store_purchase", ref_id: purchaseId, entry_no: entry, date: today, notes: qty < Number(it.qty) ? `Ordered ${it.qty}, received ${qty}` : null, by_name: who(a),
      });
    }
  }
  const all = await storePurchaseItemsRepo.list({ where: "purchase_id = ?", params: [purchaseId] });
  if (all.every((i) => i.status === "verified")) {
    const total = round(all.reduce((s, i) => s + Number(i.received_qty ?? 0) * Number(i.rate), 0));
    return (await storePurchasesRepo.update(purchaseId, { status: "verified", verified_at: new Date().toISOString(), total, balance: round(total - Number(p.paid || 0)) }))!;
  }
  return (await storePurchasesRepo.get(purchaseId))!;
}

/** The store keeper returns the purchase to the purchase officer with the reason. */
export async function returnStorePurchase(purchaseId: string, store: StoreId, reason: string): Promise<StorePurchase> {
  const a = await needStore(store);
  if (!reason.trim()) throw new Error("Write why the purchase is returned.");
  const p = await storePurchasesRepo.get(purchaseId);
  if (!p || p.status !== "posted") throw new Error("This purchase is not waiting for the store.");
  for (const it of await storePurchaseItemsRepo.list({ where: "purchase_id = ? AND store = ? AND status = 'pending'", params: [purchaseId, store] })) {
    await storePurchaseItemsRepo.update(it.id, { status: "returned" });
  }
  return (await storePurchasesRepo.update(purchaseId, {
    status: "returned", return_reason: `${storeLabel(store)}: ${reason.trim()}`, returned_at: new Date().toISOString(), returned_by_name: who(a),
  }))!;
}

export interface StoreStockRow { product_id: string | null; product_name: string; company_name: string | null; qty: number; value: number; last_in: string | null; last_out: string | null }

/** What a store holds now: each item's quantity (all movements), value at its purchase rates, and last receipt / issue. */
export async function storeStock(store: StoreId, search = ""): Promise<StoreStockRow[]> {
  await needStore(store);
  const T = requireCurrentTenantId();
  const q = search.trim();
  return dbSelect<StoreStockRow>(
    `SELECT product_id, MIN(product_name) AS product_name, MAX(company_name) AS company_name, ROUND(SUM(qty), 3) AS qty,
            ROUND(SUM(qty * unit_cost), 2) AS value,
            MAX(CASE WHEN qty > 0 THEN date END) AS last_in, MAX(CASE WHEN qty < 0 THEN date END) AS last_out
     FROM hospital_store_stock WHERE tenant_id = ? AND store = ? AND deleted_at IS NULL
       ${q ? "AND (product_name LIKE ? OR company_name LIKE ?)" : ""}
     GROUP BY COALESCE(product_id, LOWER(product_name)) ORDER BY product_name COLLATE NOCASE`,
    [T, store, ...(q ? [`%${q}%`, `%${q}%`] : [])]
  );
}

// ── Store dashboard, stock register and dead stock (F4) ──────────────────

export interface StoreDashboard {
  pendingArrivals: number; pendingIndents: number; pendingReturns: number; returnedToOfficer: number;
  lowStock: StoreStockRow[]; deadItems: StoreStockRow[]; notices: { at: string; text: string }[];
}

const daysAgo = (n: number) => { const d = new Date(`${localDate()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

/** A store's dashboard: entries waiting, low stock (5 or less, or a fifth of what was received), dead items (nothing issued in a month), notices. */
export async function storeDashboard(store: StoreId): Promise<StoreDashboard> {
  await needStore(store);
  const T = requireCurrentTenantId();
  const [stock, received, counts, notices] = await Promise.all([
    storeStock(store),
    dbSelect<{ k: string; q: number }>(`SELECT COALESCE(product_id, LOWER(product_name)) AS k, SUM(qty) AS q FROM hospital_store_stock WHERE tenant_id = ? AND store = ? AND kind = 'receipt' AND deleted_at IS NULL GROUP BY k`, [T, store]),
    dbSelect<{ arrivals: number; indents: number; returns: number; back: number }>(
      `SELECT
         (SELECT COUNT(*) FROM hospital_store_purchase_items i JOIN hospital_store_purchases p ON p.id = i.purchase_id AND p.tenant_id = i.tenant_id
            WHERE i.tenant_id = ? AND i.store = ? AND i.status = 'pending' AND p.status = 'posted' AND i.deleted_at IS NULL) AS arrivals,
         (SELECT COUNT(*) FROM hospital_indents WHERE tenant_id = ? AND store = ? AND status = 'pending' AND deleted_at IS NULL) AS indents,
         (SELECT COUNT(*) FROM hospital_indent_items it JOIN hospital_indents d ON d.id = it.indent_id AND d.tenant_id = it.tenant_id
            WHERE it.tenant_id = ? AND d.store = ? AND it.return_status = 'pending' AND it.deleted_at IS NULL) AS returns,
         (SELECT COUNT(DISTINCT i.purchase_id) FROM hospital_store_purchase_items i JOIN hospital_store_purchases p ON p.id = i.purchase_id AND p.tenant_id = i.tenant_id
            WHERE i.tenant_id = ? AND i.store = ? AND p.status = 'returned' AND i.deleted_at IS NULL) AS back`,
      [T, store, T, store, T, store, T, store]
    ).catch(() => [{ arrivals: 0, indents: 0, returns: 0, back: 0 }]),
    dbSelect<{ at: string; text: string }>(
      `SELECT p.posted_at AS at, 'Purchase ' || p.purchase_no || ' posted again: ' || COALESCE(p.note, '') AS text FROM hospital_store_purchases p
         WHERE p.tenant_id = ? AND p.status = 'posted' AND p.note LIKE '%Re-posted:%' AND EXISTS (SELECT 1 FROM hospital_store_purchase_items i WHERE i.purchase_id = p.id AND i.store = ? AND i.status = 'pending')
       UNION ALL
       SELECT it.updated_at, 'Return of ' || it.product_name || ' from ' || COALESCE(d.department, d.requested_by_name, 'a ward') || ': ' || COALESCE(it.return_note, '') FROM hospital_indent_items it
         JOIN hospital_indents d ON d.id = it.indent_id AND d.tenant_id = it.tenant_id WHERE it.tenant_id = ? AND d.store = ? AND it.return_status = 'pending'
       UNION ALL
       SELECT d.created_at, 'Indent ' || d.indent_no || ' from ' || COALESCE(d.department, d.requested_by_name, 'a ward') FROM hospital_indents d
         WHERE d.tenant_id = ? AND d.store = ? AND d.status = 'pending'
       ORDER BY at DESC LIMIT 20`,
      [T, store, T, store, T, store]
    ).catch(() => []),
  ]);
  const got = new Map(received.map((r) => [r.k, Number(r.q) || 0]));
  const keyOf = (r: StoreStockRow) => r.product_id ?? r.product_name.toLowerCase();
  const monthAgo = daysAgo(30);
  const c = counts[0] ?? { arrivals: 0, indents: 0, returns: 0, back: 0 };
  return {
    pendingArrivals: Number(c.arrivals) || 0, pendingIndents: Number(c.indents) || 0, pendingReturns: Number(c.returns) || 0, returnedToOfficer: Number(c.back) || 0,
    lowStock: stock.filter((r) => r.qty <= Math.max(5, 0.2 * (got.get(keyOf(r)) ?? 0))),
    deadItems: stock.filter((r) => r.qty > 0 && (r.last_out ?? r.last_in ?? "") < monthAgo),
    notices,
  };
}

export interface RegisterRow extends StoreMove { vendor_name: string | null; vendor_no: string | null }

export interface StockHistoryRow extends RegisterRow {
  indent_no: string | null;
  department: string | null;
  requested_by_name: string | null;
  received_at: string | null;
  received_by_name: string | null;
}

/** Recorded movements of one item, including indent and receipt details. */
export async function storeItemHistory(
  store: StoreId,
  item: { productId: string | null; productName: string },
  range: { from?: string; to?: string } = {}
): Promise<StockHistoryRow[]> {
  await needStore(store);
  if (!item.productId && !item.productName.trim()) throw new Error("Choose an item.");
  if (range.from && range.to && range.from > range.to) throw new Error("The start date must not be after the end date.");
  const where = [
    "m.tenant_id = ?", "m.store = ?", "m.deleted_at IS NULL",
    item.productId ? "m.product_id = ?" : "m.product_id IS NULL AND LOWER(TRIM(m.product_name)) = LOWER(TRIM(?))",
  ];
  const params: unknown[] = [requireCurrentTenantId(), store, item.productId ?? item.productName];
  if (range.from) { where.push("m.date >= ?"); params.push(range.from); }
  if (range.to) { where.push("m.date <= ?"); params.push(range.to); }
  return dbSelect<StockHistoryRow>(
    `SELECT m.*, s.name AS vendor_name, s.vendor_no, i.indent_no, i.department, i.requested_by_name, i.received_at, i.received_by_name
     FROM hospital_store_stock m
     LEFT JOIN suppliers s ON s.id = m.vendor_id AND s.tenant_id = m.tenant_id
     LEFT JOIN hospital_indents i ON m.ref_type = 'indent' AND i.id = m.ref_id AND i.tenant_id = m.tenant_id AND i.deleted_at IS NULL
     WHERE ${where.join(" AND ")}
     ORDER BY m.date DESC, m.created_at DESC, m.id DESC`,
    params
  );
}

/** A store item's key: its product, or its name when it has none. */
const ITEM_KEY = "COALESCE(m.product_id, LOWER(m.product_name))";

export interface StoreSearchItem extends SearchItem { productId: string | null }

/** Everything that was ever in a store (also what is finished), with its company, generic name and vendors. */
export async function storeSearchItems(store: StoreId): Promise<StoreSearchItem[]> {
  await needStore(store);
  const T = requireCurrentTenantId();
  const [items, vendors] = await Promise.all([
    dbSelect<{ k: string; product_id: string | null; name: string; company: string | null; generic: string | null; qty: number }>(
      `SELECT ${ITEM_KEY} AS k, m.product_id, MIN(m.product_name) AS name, MAX(NULLIF(TRIM(m.company_name), '')) AS company,
              MAX(NULLIF(TRIM(p.description), '')) AS generic, ROUND(SUM(m.qty), 3) AS qty
       FROM hospital_store_stock m LEFT JOIN products p ON p.id = m.product_id AND (p.tenant_id = m.tenant_id OR p.tenant_id IS NULL)
       WHERE m.tenant_id = ? AND m.store = ? AND m.deleted_at IS NULL
       GROUP BY k ORDER BY name COLLATE NOCASE`,
      [T, store]
    ),
    dbSelect<{ k: string; name: string; vendor_no: string | null }>(
      `SELECT ${ITEM_KEY} AS k, s.name, s.vendor_no
       FROM hospital_store_stock m JOIN suppliers s ON s.id = m.vendor_id AND s.tenant_id = m.tenant_id
       WHERE m.tenant_id = ? AND m.store = ? AND m.deleted_at IS NULL
       GROUP BY k, s.id ORDER BY MAX(m.date), MAX(m.created_at)`,
      [T, store]
    ),
  ]);
  return items.map((i) => {
    const mine = vendors.filter((v) => v.k === i.k);
    return {
      id: i.k, productId: i.product_id, name: i.name, company: i.company, generic: i.generic, stock: Number(i.qty) || 0,
      codes: mine.map((v) => v.vendor_no), distributors: mine.map((v) => v.name),
    };
  });
}

const STORE_MOVES: Record<StoreMove["kind"], { kind: MoveKind; label: string }> = {
  receipt: { kind: "purchase", label: "Arrived" }, issue: { kind: "issue", label: "Issued" }, return_in: { kind: "return_in", label: "Returned in" },
  return_out: { kind: "purchase_return", label: "Returned out" }, dead: { kind: "dead", label: "Dead stock" }, adjust: { kind: "adjust", label: "Adjusted" },
};

/** A store item's history: each arrival with its vendor, each issue with its indent and ward, and the stock left. */
export async function storeItemLedger(store: StoreId, item: { productId: string | null; productName: string }): Promise<LedgerView> {
  const rows = await storeItemHistory(store, item);
  const generic = item.productId
    ? (await dbSelect<{ d: string | null }>(`SELECT NULLIF(TRIM(description), '') AS d FROM products WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`, [item.productId, requireCurrentTenantId()]))[0]?.d ?? null
    : null;
  const moves: LedgerMove[] = rows.map((r) => {
    const number = r.indent_no ?? r.entry_no;
    return {
      id: r.id, date: r.date, at: r.created_at, ...STORE_MOVES[r.kind], qty: Number(r.qty),
      supplied: r.kind === "receipt",
      ref: !number ? null : r.kind === "issue" ? `Indent ${number}` : `Entry ${r.entry_no ?? number}`,
      party: r.kind === "issue" ? r.department ?? r.requested_by_name : r.vendor_name,
      details: [
        ...(r.kind === "receipt" ? [r.vendor_no ? `Vendor ${r.vendor_no}` : "", r.by_name ? `Received by ${r.by_name}` : ""] : []),
        ...(r.kind === "issue" ? [
          r.requested_by_name ? `Requested by ${r.requested_by_name}` : "",
          r.received_at ? `Receipt confirmed ${dayMonthYear(r.received_at)}${r.received_by_name ? ` by ${r.received_by_name}` : ""}` : "Receipt not confirmed",
        ] : []),
        r.notes ?? "",
        r.kind !== "receipt" && r.by_name ? `By ${r.by_name}` : "",
      ].filter(Boolean),
    };
  });
  return {
    name: item.productName, company: rows.find((r) => r.company_name)?.company_name ?? null, generic, units: {},
    available: Math.round(rows.reduce((s, r) => s + Number(r.qty), 0) * 1000) / 1000, moves,
  };
}

/** A store's stock register: every movement, by vendor (name or number), item, company and dates. */
export async function storeRegister(store: StoreId, f: { from?: string; to?: string; vendor?: string; product?: string; company?: string } = {}): Promise<RegisterRow[]> {
  await needStore(store);
  const T = requireCurrentTenantId();
  const where = ["m.tenant_id = ?", "m.store = ?", "m.deleted_at IS NULL"];
  const params: unknown[] = [T, store];
  if (f.from) { where.push("m.date >= ?"); params.push(f.from); }
  if (f.to) { where.push("m.date <= ?"); params.push(f.to); }
  if (f.vendor?.trim()) { where.push("(s.name LIKE ? OR s.vendor_no LIKE ?)"); params.push(`%${f.vendor.trim()}%`, `%${f.vendor.trim()}%`); }
  if (f.product?.trim()) { where.push("m.product_name LIKE ?"); params.push(`%${f.product.trim()}%`); }
  if (f.company?.trim()) { where.push("m.company_name LIKE ?"); params.push(`%${f.company.trim()}%`); }
  return dbSelect<RegisterRow>(
    `SELECT m.*, s.name AS vendor_name, s.vendor_no FROM hospital_store_stock m LEFT JOIN suppliers s ON s.id = m.vendor_id
     WHERE ${where.join(" AND ")} ORDER BY m.date DESC, m.created_at DESC LIMIT 1000`,
    params
  );
}

export const DEAD_REASONS = ["Broken", "Condemned", "Expired", "Damaged", "Lost", "Other"];

/** Writes off items from the store (broken, condemned by staff ...) into its dead stock register. */
export async function recordDeadStock(store: StoreId, x: { productId?: string | null; productName: string; qty: number; reason: string; note?: string | null }): Promise<StoreMove> {
  const a = await needStore(store);
  if (!DEAD_REASONS.includes(x.reason)) throw new Error("Choose the reason.");
  const qty = round3(Number(x.qty));
  if (!(qty > 0)) throw new Error("Enter the quantity.");
  const row = (await storeStock(store)).find((r) => (x.productId ? r.product_id === x.productId : r.product_name.toLowerCase() === x.productName.trim().toLowerCase()));
  if (!row || row.qty + 1e-9 < qty) throw new Error(`Only ${row?.qty ?? 0} of ${x.productName} in the ${storeLabel(store)}.`);
  return storeStockRepo.create({
    store, product_id: row.product_id, product_name: row.product_name, company_name: row.company_name, vendor_id: null, qty: -qty,
    unit_cost: row.qty > 0 ? Math.round((row.value / row.qty) * 100) / 100 : 0, kind: "dead", ref_type: null, ref_id: null, entry_no: null, date: localDate(),
    notes: [x.reason, x.note?.trim()].filter(Boolean).join(": "), by_name: who(a),
  });
}

/** A store's dead stock register. */
export async function deadStockRegister(store: StoreId): Promise<StoreMove[]> {
  await needStore(store);
  return storeStockRepo.list({ where: "store = ? AND kind = 'dead'", params: [store], orderBy: "date DESC, created_at DESC" });
}
