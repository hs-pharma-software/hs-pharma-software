/**
 * Electric / Electronics / Solar store data layer.
 *
 * Same guarantees as the restaurant module: the tenant comes from the
 * session (never from caller input), every id is checked for ownership,
 * permissions are enforced here, prices and totals are computed here from
 * stored data, and steps are ordered/idempotent instead of relying on
 * multi-statement transactions (the Tauri SQL plugin uses a pool).
 *
 * Relative imports only (runs under `node --test`).
 */

import type { RestDb as EsDb, RestContext as EsContext } from "../restaurant/store.ts";
import {
  type PaymentIn,
  type ProductType,
  SERIAL_DEFAULT,
  addQty,
  calcDoc,
  canDeduct,
  cleanSerials,
  cleanSpecs,
  fromMilli,
  roundQty,
  settle,
  toBaseQty,
  toMilli,
  toPaisa,
  toRupees,
  warrantyEnd,
  weightedAverage,
} from "./engine.ts";

export type { EsDb, EsContext };

export type EsAction = "es.sell" | "es.purchase" | "es.discount" | "es.return" | "es.catalog" | "es.stock" | "es.payments" | "es.settings";

export class EsError extends Error {
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT";
  constructor(code: EsError["code"], message: string) {
    super(message);
    this.name = "EsError";
    this.code = code;
  }
}

interface Base {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EsCategory extends Base {
  name: string;
  name_ur: string | null;
  grp: string | null;
  sort_order: number;
  is_active: number;
}

export interface EsProduct extends Base {
  category_id: string | null;
  product_type: ProductType;
  sku: string;
  barcode: string | null;
  name: string;
  name_ur: string | null;
  description: string | null;
  description_ur: string | null;
  brand: string | null;
  manufacturer: string | null;
  model: string | null;
  unit: string;
  purchase_unit: string | null;
  purchase_factor: number;
  cost: number;
  avg_cost: number;
  price: number;
  wholesale_price: number | null;
  min_price: number | null;
  tax_rate: number;
  supplier_id: string | null;
  reorder_level: number;
  location: string | null;
  image: string | null;
  is_active: number;
  serial_tracked: number;
  warranty_mfr_months: number | null;
  warranty_seller_months: number | null;
  specs: string | null;
  notes: string | null;
  stock: number;
  hs_code: string | null;
  fbr_sale_type: string | null;
  fbr_sale_rate: number | null;
  fbr_uom: string | null;
  sro_no: string | null;
  sro_item_serial_no: string | null;
  fbr_qty_factor: number | null;
}

export interface EsSerial extends Base {
  product_id: string;
  serial: string;
  status: "in_stock" | "sold" | "returned_to_supplier" | "defective";
  purchase_doc_id: string | null;
  sale_doc_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  seller_warranty_end: string | null;
  supplier_ref: string | null;
}

export type DocType = "sale" | "sale_return" | "purchase" | "purchase_return" | "quotation";

export interface EsDoc extends Base {
  doc_type: DocType;
  doc_no: number;
  date: string;
  party_type: "customer" | "supplier" | null;
  party_id: string | null;
  party_name: string | null;
  party_phone: string | null;
  party_address: string | null;
  lang: string | null;
  gross: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  cost_total: number;
  payments: string | null;
  status: "final" | "draft" | "converted" | "cancelled";
  ref_doc_id: string | null;
  supplier_invoice_no: string | null;
  notes: string | null;
  valid_until: string | null;
  fbr_status: string | null;
  fbr_invoice_no: string | null;
  created_by: string | null;
}

export interface EsDocItem extends Base {
  doc_id: string;
  product_id: string | null;
  ref_item_id: string | null;
  sku: string | null;
  name: string;
  name_ur: string | null;
  model: string | null;
  unit: string | null;
  unit_factor: number;
  qty: number;
  base_qty: number;
  price: number;
  discount: number;
  tax_rate: number;
  tax: number;
  line_total: number;
  cost: number;
  serials: string | null;
  warranty_months: number | null;
  warranty_end: string | null;
  returned_qty: number;
}

export interface EsClaim extends Base {
  serial_id: string | null;
  product_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  issue: string | null;
  status: "open" | "sent_to_supplier" | "repaired" | "replaced" | "rejected" | "closed";
  resolution: string | null;
  opened_at: string | null;
  closed_at: string | null;
}

export const ES_SETTINGS = {
  defaultTax: "es_tax_rate",
  qtyDecimals: "es_qty_decimals",
  allowNegative: "es_allow_negative",
  invoiceLang: "es_invoice_lang",
  invoicePaper: "es_invoice_paper",
  termsEn: "es_terms_en",
  termsUr: "es_terms_ur",
  businessNameUr: "es_business_name_ur",
  addressUr: "es_address_ur",
  units: "es_units",
  requireJameel: "es_require_jameel",
  whatsappCc: "es_whatsapp_cc",
} as const;

export const DEFAULT_UNITS = ["pcs", "m", "ft", "roll", "coil", "box", "pack", "carton", "set", "kit", "W", "kW"];

/** Starter categories (each tenant edits its own copy). */
export const DEFAULT_CATEGORIES: { grp: string; name: string; name_ur: string }[] = [
  { grp: "electrical", name: "Electrical Cables & Wires", name_ur: "بجلی کی تاریں اور کیبل" },
  { grp: "electrical", name: "Switches & Sockets", name_ur: "سوئچ اور ساکٹ" },
  { grp: "electrical", name: "Circuit Breakers", name_ur: "سرکٹ بریکر" },
  { grp: "electrical", name: "Distribution Boards", name_ur: "ڈسٹری بیوشن بورڈ" },
  { grp: "electrical", name: "Contactors & Relays", name_ur: "کنٹیکٹر اور ریلے" },
  { grp: "electrical", name: "Protection Devices", name_ur: "حفاظتی آلات" },
  { grp: "electrical", name: "Lighting & LED", name_ur: "لائٹنگ اور ایل ای ڈی" },
  { grp: "electrical", name: "Fans & Ventilation", name_ur: "پنکھے اور وینٹیلیشن" },
  { grp: "electrical", name: "Electrical Accessories", name_ur: "بجلی کا متفرق سامان" },
  { grp: "electronics", name: "Electronic Devices", name_ur: "الیکٹرانک آلات" },
  { grp: "electronics", name: "Power Supplies", name_ur: "پاور سپلائی" },
  { grp: "electronics", name: "Batteries & Chargers", name_ur: "بیٹریاں اور چارجر" },
  { grp: "electronics", name: "Electronic Components", name_ur: "الیکٹرانک پرزے" },
  { grp: "electronics", name: "Networking Equipment", name_ur: "نیٹ ورکنگ کا سامان" },
  { grp: "electronics", name: "CCTV & Security", name_ur: "سی سی ٹی وی اور سیکیورٹی" },
  { grp: "electronics", name: "Accessories & Peripherals", name_ur: "لوازمات" },
  { grp: "solar", name: "Solar Panels", name_ur: "سولر پینل" },
  { grp: "solar", name: "Solar Inverters", name_ur: "سولر انورٹر" },
  { grp: "solar", name: "Solar Batteries", name_ur: "سولر بیٹریاں" },
  { grp: "solar", name: "Charge Controllers", name_ur: "چارج کنٹرولر" },
  { grp: "solar", name: "Solar Cables", name_ur: "سولر کیبل" },
  { grp: "solar", name: "Mounting Structures", name_ur: "ماؤنٹنگ اسٹرکچر" },
  { grp: "solar", name: "DC Breakers & Protection", name_ur: "ڈی سی بریکر اور حفاظتی آلات" },
  { grp: "solar", name: "Connectors & Installation", name_ur: "کنیکٹر اور تنصیب کا سامان" },
  { grp: "solar", name: "Solar Kits & Bundles", name_ur: "مکمل سولر کٹس" },
];

const json = <T>(v: string | null | undefined, fallback: T): T => {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface SaleLineInput {
  productId: string;
  unit?: "base" | "purchase";
  qty: number;
  /** Optional price per entered unit; defaults to the product price. */
  price?: number;
  discount?: number;
  serials?: string[];
}

export interface PurchaseLineInput {
  productId: string;
  unit?: "base" | "purchase";
  qty: number;
  /** Cost per entered unit. */
  cost: number;
  discount?: number;
  taxRate?: number;
  serials?: string[];
}

export function createElectricStore(db: EsDb, context: () => EsContext) {
  function tenant(): string {
    const c = context();
    if (!c.tenantId) throw new EsError("UNAUTHENTICATED", "Sign in to a store account first.");
    if (c.businessType !== "electronics_solar") throw new EsError("FORBIDDEN", "This account is not an Electric / Electronics / Solar store.");
    return c.tenantId;
  }

  function need(action: EsAction) {
    const c = context();
    tenant();
    if (c.role === "super_admin") return;
    if (c.deniedActions.includes(action)) throw new EsError("FORBIDDEN", "You don't have permission for this action.");
  }

  const can = (action: EsAction) => {
    const c = context();
    return c.role === "super_admin" || !c.deniedActions.includes(action);
  };

  async function insert<T extends Base>(table: string, row: Partial<T>): Promise<T> {
    const ts = iso(db.now());
    const record = { ...row, id: row.id ?? db.newId(), tenant_id: tenant(), created_at: ts, updated_at: ts, deleted_at: null } as unknown as T;
    const keys = Object.keys(record);
    await db.execute(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => (record as unknown as Record<string, unknown>)[k] ?? null));
    await db.outbox(table, record.id, "insert", record as unknown as Record<string, unknown>);
    return record;
  }

  async function update(table: string, id: string, patch: Record<string, unknown>, guard?: { sql: string; params: unknown[] }): Promise<number> {
    const data: Record<string, unknown> = { ...patch, updated_at: iso(db.now()) };
    delete data.id;
    delete data.tenant_id;
    const keys = Object.keys(data);
    const { changes } = await db.execute(
      `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND tenant_id = ?${guard ? ` AND (${guard.sql})` : ""}`,
      [...keys.map((k) => data[k] ?? null), id, tenant(), ...(guard?.params ?? [])]
    );
    if (changes > 0) {
      const full = await db.select(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [id, tenant()]);
      if (full[0]) await db.outbox(table, id, "update", full[0]);
    }
    return changes;
  }

  async function owned<T>(table: string, id: string | null | undefined, label: string): Promise<T> {
    if (!id) throw new EsError("INVALID", `${label} is required.`);
    const rows = await db.select<T>(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [id, tenant()]);
    if (!rows[0]) throw new EsError("NOT_FOUND", `${label} not found.`);
    return rows[0];
  }

  /** customers / suppliers are the app's existing tenant-scoped tables. */
  async function party(type: "customer" | "supplier", id: string) {
    return owned<{ id: string; name: string; phone: string | null; address: string | null; opening_balance: number; balance_type: string | null }>(
      type === "customer" ? "customers" : "suppliers",
      id,
      type === "customer" ? "Customer" : "Supplier"
    );
  }

  async function audit(action: string, recordType: string, recordId: string | null, detail?: unknown) {
    const c = context();
    await insert("es_audit", {
      user_id: c.userId,
      user_name: c.userName,
      action,
      record_type: recordType,
      record_id: recordId,
      detail: detail === undefined ? null : typeof detail === "string" ? detail : JSON.stringify(detail),
    } as never);
  }

  async function getSetting(key: string): Promise<string | null> {
    const rows = await db.select<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [`${tenant()}::${key}`]);
    return rows[0]?.value ?? null;
  }

  async function putSetting(key: string, value: string) {
    const full = `${tenant()}::${key}`;
    const ts = iso(db.now());
    await db.execute(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [full, value, ts]);
    await db.outbox("settings", full, "update", { key: full, value, updated_at: ts });
  }

  async function nextDocNo(type: DocType): Promise<number> {
    const rows = await db.select<{ n: number | null }>(`SELECT MAX(doc_no) AS n FROM es_docs WHERE tenant_id = ? AND doc_type = ?`, [tenant(), type]);
    return (Number(rows[0]?.n) || 0) + 1;
  }

  /** Inserts a document with the next number for its type (retries on a
   * number taken concurrently; the unique index guards duplicates). */
  async function insertDoc(type: DocType, data: Partial<EsDoc>): Promise<EsDoc> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await insert<EsDoc>("es_docs", { ...data, doc_type: type, doc_no: await nextDocNo(type) } as never);
      } catch (e) {
        if (/UNIQUE/i.test(String(e))) continue;
        throw e;
      }
    }
    throw new EsError("CONFLICT", "Could not number the document, try again.");
  }

  /** Signed stock movement for one document line (idempotent per line and
   * reason); updates the product's running stock only when recorded. */
  async function move(productId: string, qty: number, reason: string, docId: string | null, itemId: string | null, unitCost: number | null, note?: string, applyStock = true) {
    try {
      await insert("es_stock_moves", { product_id: productId, qty, reason, doc_id: docId, doc_item_id: itemId, unit_cost: unitCost, note: note ?? null, created_by: context().userName } as never);
    } catch (e) {
      if (itemId && /UNIQUE/i.test(String(e))) return false; // already recorded
      throw e;
    }
    if (applyStock) {
      await db.execute(`UPDATE es_products SET stock = ROUND(stock + ?, 3), updated_at = ? WHERE id = ? AND tenant_id = ?`, [qty, iso(db.now()), productId, tenant()]);
      await syncRow("es_products", productId);
    }
    return true;
  }

  async function syncRow(table: string, id: string) {
    const row = await db.select(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [id, tenant()]);
    if (row[0]) await db.outbox(table, id, "update", row[0]);
  }

  /** Takes `qty` (base units) out of stock in ONE conditional statement, so
   * two counters can't both sell the last unit. False = not enough stock. */
  async function claimStock(productId: string, qty: number, allowNegative: boolean): Promise<boolean> {
    const { changes } = await db.execute(
      `UPDATE es_products SET stock = ROUND(stock - ?, 3), updated_at = ? WHERE id = ? AND tenant_id = ? AND (? = 1 OR ROUND(stock - ?, 3) >= 0)`,
      [qty, iso(db.now()), productId, tenant(), allowNegative ? 1 : 0, qty]
    );
    if (changes) await syncRow("es_products", productId);
    return changes > 0;
  }

  /** Moves a serial from `from` to `to` only if it is still in `from`. */
  async function claimSerial(productId: string, serial: string, from: string, to: string): Promise<boolean> {
    const { changes } = await db.execute(`UPDATE es_serials SET status = ?, updated_at = ? WHERE tenant_id = ? AND product_id = ? AND serial = ? AND status = ?`, [to, iso(db.now()), tenant(), productId, serial, from]);
    return changes > 0;
  }

  async function settingsBag() {
    const [neg, dec] = await Promise.all([getSetting(ES_SETTINGS.allowNegative), getSetting(ES_SETTINGS.qtyDecimals)]);
    return { allowNegative: neg === "true", qtyDecimals: dec != null && dec !== "" ? Math.min(3, Math.max(0, Number(dec))) : 3 };
  }

  async function docWithItems(id: string) {
    const doc = await owned<EsDoc>("es_docs", id, "Document");
    const items = await db.select<EsDocItem>(`SELECT * FROM es_doc_items WHERE tenant_id = ? AND doc_id = ? AND deleted_at IS NULL ORDER BY created_at, id`, [tenant(), id]);
    return { doc, items };
  }

  const api = {
    tenant,
    can,

    settings: {
      get: getSetting,
      async set(key: string, value: string) {
        if (!key.startsWith("ui_lang::")) need("es.settings");
        await putSetting(key, value);
      },
      /** Interface language of the signed-in user (per user, per tenant). */
      async getUserLang(): Promise<"en" | "ur"> {
        const v = await getSetting(`ui_lang::${context().userId ?? "anon"}`);
        return v === "ur" ? "ur" : "en";
      },
      async setUserLang(lang: "en" | "ur") {
        if (lang !== "en" && lang !== "ur") throw new EsError("INVALID", "Unknown language.");
        await putSetting(`ui_lang::${context().userId ?? "anon"}`, lang);
      },
    },

    // ── Categories ──
    async listCategories(includeInactive = false) {
      return db.select<EsCategory>(`SELECT * FROM es_categories WHERE tenant_id = ? AND deleted_at IS NULL ${includeInactive ? "" : "AND is_active = 1"} ORDER BY sort_order, name`, [tenant()]);
    },

    /** Adds the starter categories once (skips names that already exist). */
    async seedDefaultCategories() {
      need("es.catalog");
      const existing = new Set((await api.listCategories(true)).map((c) => c.name.toLowerCase()));
      let order = existing.size;
      let added = 0;
      for (const c of DEFAULT_CATEGORIES) {
        if (existing.has(c.name.toLowerCase())) continue;
        await insert("es_categories", { ...c, sort_order: order++, is_active: 1 } as never);
        added++;
      }
      return added;
    },

    async saveCategory(input: Partial<EsCategory>) {
      need("es.catalog");
      const name = String(input.name ?? "").trim();
      if (!name) throw new EsError("INVALID", "Category name is required.");
      const data = { name, name_ur: input.name_ur?.trim() || null, grp: input.grp || null, sort_order: Number(input.sort_order) || 0, is_active: input.is_active === 0 ? 0 : 1 };
      if (input.id) {
        await owned("es_categories", input.id, "Category");
        await update("es_categories", input.id, data);
        return owned<EsCategory>("es_categories", input.id, "Category");
      }
      return insert<EsCategory>("es_categories", data as never);
    },

    async reorderCategories(ids: string[]) {
      need("es.catalog");
      for (const [i, id] of ids.entries()) {
        await owned("es_categories", id, "Category");
        await update("es_categories", id, { sort_order: i });
      }
    },

    async deleteCategory(id: string) {
      need("es.catalog");
      await owned("es_categories", id, "Category");
      await update("es_categories", id, { deleted_at: iso(db.now()) });
    },

    // ── Products ──
    async listProducts(opts: { search?: string; categoryId?: string | null; type?: string | null; includeInactive?: boolean; stockFilter?: "low" | "out" | null } = {}) {
      const where = ["p.tenant_id = ?", "p.deleted_at IS NULL"];
      const params: unknown[] = [tenant()];
      if (!opts.includeInactive) where.push("p.is_active = 1");
      if (opts.categoryId) {
        where.push("p.category_id = ?");
        params.push(opts.categoryId);
      }
      if (opts.type) {
        where.push("p.product_type = ?");
        params.push(opts.type);
      }
      if (opts.stockFilter === "low") where.push("p.stock > 0 AND p.reorder_level > 0 AND p.stock <= p.reorder_level");
      if (opts.stockFilter === "out") where.push("p.stock <= 0");
      if (opts.search?.trim()) {
        const q = `%${opts.search.trim().toUpperCase()}%`;
        where.push("(UPPER(p.name) LIKE ? OR COALESCE(p.name_ur, '') LIKE ? OR UPPER(p.sku) LIKE ? OR UPPER(COALESCE(p.barcode, '')) LIKE ? OR UPPER(COALESCE(p.model, '')) LIKE ? OR UPPER(COALESCE(p.brand, '')) LIKE ?)");
        params.push(q, `%${opts.search.trim()}%`, q, q, q, q);
      }
      return db.select<EsProduct & { category_name: string | null; category_name_ur: string | null }>(
        `SELECT p.*, c.name AS category_name, c.name_ur AS category_name_ur FROM es_products p
         LEFT JOIN es_categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
         WHERE ${where.join(" AND ")} ORDER BY p.name LIMIT 1000`,
        params
      );
    },

    async getProduct(id: string) {
      return owned<EsProduct>("es_products", id, "Product");
    },

    async findByCode(code: string) {
      const c = code.trim().toUpperCase();
      if (!c) return null;
      const rows = await db.select<EsProduct>(`SELECT * FROM es_products WHERE tenant_id = ? AND deleted_at IS NULL AND (UPPER(barcode) = ? OR UPPER(sku) = ?) LIMIT 1`, [tenant(), c, c]);
      return rows[0] ?? null;
    },

    async saveProduct(input: Partial<Omit<EsProduct, "specs">> & { specs?: Record<string, unknown> | string | null; opening?: { qty: number; unitCost: number; serials?: string[] } | null }) {
      need("es.catalog");
      const name = String(input.name ?? "").trim();
      const sku = String(input.sku ?? "").trim().toUpperCase();
      if (!name) throw new EsError("INVALID", "Product name is required.");
      if (!sku) throw new EsError("INVALID", "Product code / SKU is required.");
      const type = (input.product_type ?? "general") as ProductType;
      if (!(type in SERIAL_DEFAULT)) throw new EsError("INVALID", "Unknown product type.");
      const unit = String(input.unit ?? "").trim();
      if (!unit) throw new EsError("INVALID", "Unit is required.");
      const num = (v: unknown, label: string, allowNull = true) => {
        if (v == null || String(v) === "") {
          if (allowNull) return null;
          throw new EsError("INVALID", `${label} is required.`);
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new EsError("INVALID", `${label} must be 0 or more.`);
        return n;
      };
      const price = num(input.price, "Selling price", false)!;
      const minPrice = num(input.min_price, "Minimum price");
      if (minPrice != null && minPrice > price) throw new EsError("INVALID", "Minimum price can't be above the selling price.");
      const factor = input.purchase_unit ? num(input.purchase_factor, "Units per purchase unit", false)! : 1;
      if (!(factor > 0)) throw new EsError("INVALID", "Units per purchase unit must be more than 0.");
      if (input.category_id) await owned("es_categories", input.category_id, "Category");
      if (input.supplier_id) await party("supplier", input.supplier_id);
      const barcode = input.barcode?.trim() || null;
      const dupSku = await db.select(`SELECT id FROM es_products WHERE tenant_id = ? AND sku = ? AND deleted_at IS NULL AND id <> ?`, [tenant(), sku, input.id ?? ""]);
      if (dupSku.length) throw new EsError("CONFLICT", `Code ${sku} is already used by another product.`);
      if (barcode) {
        const dupBar = await db.select(`SELECT id FROM es_products WHERE tenant_id = ? AND barcode = ? AND deleted_at IS NULL AND id <> ?`, [tenant(), barcode, input.id ?? ""]);
        if (dupBar.length) throw new EsError("CONFLICT", `Barcode ${barcode} is already used by another product.`);
      }
      let specs: Record<string, string | number>;
      try {
        specs = cleanSpecs(type, typeof input.specs === "string" ? json(input.specs, {}) : (input.specs ?? {}));
      } catch (e) {
        throw new EsError("INVALID", e instanceof Error ? e.message : String(e));
      }
      const data = {
        category_id: input.category_id || null,
        product_type: type,
        sku,
        barcode,
        name,
        name_ur: input.name_ur?.trim() || null,
        description: input.description?.trim() || null,
        description_ur: input.description_ur?.trim() || null,
        brand: input.brand?.trim() || null,
        manufacturer: input.manufacturer?.trim() || null,
        model: input.model?.trim() || null,
        unit,
        purchase_unit: input.purchase_unit?.trim() || null,
        purchase_factor: factor,
        cost: num(input.cost, "Purchase cost") ?? 0,
        price,
        wholesale_price: num(input.wholesale_price, "Wholesale price"),
        min_price: minPrice,
        tax_rate: num(input.tax_rate, "Tax rate") ?? 0,
        supplier_id: input.supplier_id || null,
        reorder_level: num(input.reorder_level, "Reorder level") ?? 0,
        location: input.location?.trim() || null,
        image: input.image || null,
        is_active: input.is_active === 0 ? 0 : 1,
        serial_tracked: input.serial_tracked == null ? (SERIAL_DEFAULT[type] ? 1 : 0) : input.serial_tracked ? 1 : 0,
        warranty_mfr_months: num(input.warranty_mfr_months, "Manufacturer warranty"),
        warranty_seller_months: num(input.warranty_seller_months, "Shop warranty"),
        specs: JSON.stringify(specs),
        notes: input.notes?.trim() || null,
        hs_code: input.hs_code?.trim() || null,
        fbr_sale_type: input.fbr_sale_type || null,
        fbr_sale_rate: num(input.fbr_sale_rate, "FBR rate"),
        fbr_uom: input.fbr_uom || null,
        sro_no: input.sro_no || null,
        sro_item_serial_no: input.sro_item_serial_no || null,
        fbr_qty_factor: num(input.fbr_qty_factor, "FBR quantity factor") ?? 1,
      };
      if (input.id) {
        const before = await owned<EsProduct>("es_products", input.id, "Product");
        if (before.serial_tracked && !data.serial_tracked && before.stock > 0) throw new EsError("CONFLICT", "Serial tracking can't be turned off while serial-numbered stock exists.");
        await update("es_products", input.id, data);
        if (before.price !== data.price || before.cost !== data.cost) await audit("product.price_change", "product", input.id, { price: [before.price, data.price], cost: [before.cost, data.cost] });
        return owned<EsProduct>("es_products", input.id, "Product");
      }
      const row = await insert<EsProduct>("es_products", { ...data, stock: 0, avg_cost: data.cost } as never);
      await audit("product.create", "product", row.id, { sku, name });
      if (input.opening && Number(input.opening.qty) > 0) {
        await api.receiveOpening(row.id, Number(input.opening.qty), Number(input.opening.unitCost) || data.cost, input.opening.serials ?? []);
      }
      return owned<EsProduct>("es_products", row.id, "Product");
    },

    async deleteProduct(id: string) {
      need("es.catalog");
      const p = await owned<EsProduct>("es_products", id, "Product");
      if (toMilli(p.stock) !== 0) throw new EsError("CONFLICT", "Bring the stock to zero (adjustment) before deleting; history is kept.");
      await update("es_products", id, { deleted_at: iso(db.now()), is_active: 0 });
      await audit("product.delete", "product", id, { sku: p.sku });
    },

    /** Opening stock (base units) with optional serials. */
    async receiveOpening(productId: string, qty: number, unitCost: number, serials: string[]) {
      need("es.stock");
      const p = await owned<EsProduct>("es_products", productId, "Product");
      const list = cleanSerials(serials);
      if (p.serial_tracked && list.length !== toMilli(qty) / 1000) throw new EsError("INVALID", `Enter exactly ${qty} serial numbers for ${p.name}.`);
      for (const s of list) {
        try {
          await insert("es_serials", { product_id: p.id, serial: s, status: "in_stock" } as never);
        } catch (e) {
          if (/UNIQUE/i.test(String(e))) throw new EsError("CONFLICT", `Serial ${s} already exists for ${p.name}.`);
          throw e;
        }
      }
      await update("es_products", p.id, { avg_cost: weightedAverage(p.stock, p.avg_cost, qty, unitCost) });
      await move(p.id, qty, "opening", null, null, unitCost, "Opening stock");
    },

    // ── Stock ──
    async adjustStock(productId: string, kind: "adjustment" | "count", qty: number, note: string, serials: string[] = []) {
      need("es.stock");
      if (!note?.trim()) throw new EsError("INVALID", "Give a reason for the stock change.");
      const p = await owned<EsProduct>("es_products", productId, "Product");
      const delta = kind === "count" ? fromMilli(toMilli(qty) - toMilli(p.stock)) : roundQty(qty);
      if (toMilli(delta) === 0) return p;
      if (kind === "count" && qty < 0) throw new EsError("INVALID", "A stock count can't be negative.");
      if (p.serial_tracked) {
        const list = cleanSerials(serials);
        if (list.length !== Math.abs(delta)) throw new EsError("INVALID", `Enter the ${Math.abs(delta)} serial numbers being ${delta > 0 ? "added" : "removed"}.`);
        for (const s of list) {
          if (delta > 0) await insert("es_serials", { product_id: p.id, serial: s, status: "in_stock" } as never).catch((e) => {
            if (/UNIQUE/i.test(String(e))) throw new EsError("CONFLICT", `Serial ${s} already exists.`);
            throw e;
          });
          else {
            const row = await db.select<EsSerial>(`SELECT * FROM es_serials WHERE tenant_id = ? AND product_id = ? AND serial = ? AND status = 'in_stock'`, [tenant(), p.id, s]);
            if (!row[0]) throw new EsError("INVALID", `Serial ${s} is not in stock.`);
            await update("es_serials", row[0].id, { status: "defective" });
          }
        }
      }
      if (delta < 0) {
        if (!(await claimStock(p.id, -delta, (await settingsBag()).allowNegative))) throw new EsError("CONFLICT", "Stock can't go below zero.");
        await move(p.id, delta, kind, null, null, p.avg_cost, note.trim(), false);
      } else await move(p.id, delta, kind, null, null, p.avg_cost, note.trim());
      await audit(`stock.${kind}`, "product", p.id, { delta, note });
      return owned<EsProduct>("es_products", p.id, "Product");
    },

    async stockMoves(productId?: string | null, limit = 500) {
      return db.select<{ id: string; created_at: string; product_id: string; name: string; name_ur: string | null; sku: string; qty: number; reason: string; doc_id: string | null; unit_cost: number | null; note: string | null; created_by: string | null; unit: string }>(
        `SELECT m.id, m.created_at, m.product_id, p.name, p.name_ur, p.sku, p.unit, m.qty, m.reason, m.doc_id, m.unit_cost, m.note, m.created_by
         FROM es_stock_moves m JOIN es_products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? ${productId ? "AND m.product_id = ?" : ""} ORDER BY m.created_at DESC LIMIT ?`,
        productId ? [tenant(), productId, limit] : [tenant(), limit]
      );
    },

    async serials(opts: { productId?: string; status?: string; search?: string } = {}) {
      const where = ["s.tenant_id = ?", "s.deleted_at IS NULL"];
      const params: unknown[] = [tenant()];
      if (opts.productId) {
        where.push("s.product_id = ?");
        params.push(opts.productId);
      }
      if (opts.status) {
        where.push("s.status = ?");
        params.push(opts.status);
      }
      if (opts.search?.trim()) {
        where.push("UPPER(s.serial) LIKE ?");
        params.push(`%${opts.search.trim().toUpperCase()}%`);
      }
      return db.select<EsSerial & { product_name: string; sku: string }>(
        `SELECT s.*, p.name AS product_name, p.sku FROM es_serials s JOIN es_products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
         WHERE ${where.join(" AND ")} ORDER BY s.updated_at DESC LIMIT 500`,
        params
      );
    },

    // ── Documents ──
    async getDoc(id: string) {
      return docWithItems(id);
    },

    async listDocs(opts: { type: DocType; from?: string; to?: string; partyId?: string; search?: string }) {
      const where = ["tenant_id = ?", "doc_type = ?", "deleted_at IS NULL"];
      const params: unknown[] = [tenant(), opts.type];
      if (opts.from && opts.to) {
        where.push("date BETWEEN ? AND ?");
        params.push(opts.from, opts.to);
      }
      if (opts.partyId) {
        where.push("party_id = ?");
        params.push(opts.partyId);
      }
      if (opts.search?.trim()) {
        where.push("(CAST(doc_no AS TEXT) = ? OR UPPER(COALESCE(party_name, '')) LIKE ? OR COALESCE(party_phone, '') LIKE ?)");
        params.push(opts.search.trim(), `%${opts.search.trim().toUpperCase()}%`, `%${opts.search.trim()}%`);
      }
      return db.select<EsDoc>(`SELECT * FROM es_docs WHERE ${where.join(" AND ")} ORDER BY date DESC, doc_no DESC LIMIT 1000`, params);
    },

    /** Prices and validates sale/quotation lines from stored products. */
    async priceSaleLines(lines: SaleLineInput[], billDiscount: number, forQuotation: boolean) {
      if (!lines.length) throw new EsError("INVALID", "Add at least one product.");
      const { allowNegative, qtyDecimals } = await settingsBag();
      const prepared: { p: EsProduct; unit: "base" | "purchase"; qty: number; baseQty: number; price: number; discount: number; serials: string[] }[] = [];
      const needByProduct = new Map<string, number>();
      for (const l of lines) {
        const p = await owned<EsProduct>("es_products", l.productId, "Product");
        if (!p.is_active) throw new EsError("CONFLICT", `${p.name} is inactive.`);
        const unit = l.unit === "purchase" && p.purchase_unit ? "purchase" : "base";
        const qty = roundQty(Number(l.qty), qtyDecimals);
        if (!(qty > 0)) throw new EsError("INVALID", `Enter a quantity for ${p.name}.`);
        const baseQty = toBaseQty(p, qty, unit);
        const listPrice = unit === "purchase" ? p.price * p.purchase_factor : p.price;
        const price = l.price != null && String(l.price) !== "" ? Number(l.price) : listPrice;
        if (!Number.isFinite(price) || price < 0) throw new EsError("INVALID", `Invalid price for ${p.name}.`);
        const minUnit = p.min_price != null ? (unit === "purchase" ? p.min_price * p.purchase_factor : p.min_price) : null;
        if (minUnit != null && price < minUnit && !can("es.discount")) throw new EsError("FORBIDDEN", `${p.name} can't be sold below Rs ${minUnit} without discount permission.`);
        const discount = Math.max(0, Number(l.discount) || 0);
        if (discount > 0 && !can("es.discount")) throw new EsError("FORBIDDEN", "You don't have permission to give discounts.");
        const serials = cleanSerials(l.serials);
        if (!forQuotation && p.serial_tracked) {
          if (!Number.isInteger(baseQty) || serials.length !== baseQty) throw new EsError("INVALID", `Select exactly ${baseQty} serial number(s) for ${p.name}.`);
          for (const s of serials) {
            const row = await db.select<EsSerial>(`SELECT * FROM es_serials WHERE tenant_id = ? AND product_id = ? AND serial = ? AND deleted_at IS NULL`, [tenant(), p.id, s]);
            if (!row[0]) throw new EsError("INVALID", `Serial ${s} does not belong to ${p.name}.`);
            if (row[0].status !== "in_stock") throw new EsError("CONFLICT", `Serial ${s} is not in stock (${row[0].status}).`);
          }
        }
        needByProduct.set(p.id, addQty(needByProduct.get(p.id) ?? 0, baseQty));
        prepared.push({ p, unit, qty, baseQty, price, discount, serials });
      }
      if (!forQuotation) {
        for (const [pid, q] of needByProduct) {
          const p = prepared.find((x) => x.p.id === pid)!.p;
          if (!canDeduct(p.stock, q, allowNegative)) throw new EsError("CONFLICT", `Only ${p.stock} ${p.unit} of ${p.name} in stock.`);
        }
      }
      if (billDiscount > 0 && !can("es.discount")) throw new EsError("FORBIDDEN", "You don't have permission to give discounts.");
      const calc = calcDoc(prepared.map((x) => ({ qty: x.qty, price: x.price, discount: x.discount, taxRate: x.p.tax_rate })), billDiscount);
      return { prepared, calc };
    },

    async createSale(input: {
      customerId?: string | null;
      customerName?: string | null;
      customerPhone?: string | null;
      customerAddress?: string | null;
      date?: string;
      lang?: string;
      lines: SaleLineInput[];
      billDiscount?: number;
      payments?: PaymentIn[];
      notes?: string | null;
      fromQuotationId?: string | null;
    }) {
      need("es.sell");
      const date = input.date || ymd(db.now());
      if (date > ymd(db.now())) throw new EsError("INVALID", "Invoice date can't be in the future.");
      const cust = input.customerId ? await party("customer", input.customerId) : null;
      const quotation = input.fromQuotationId ? await owned<EsDoc>("es_docs", input.fromQuotationId, "Quotation") : null;
      if (quotation && (quotation.doc_type !== "quotation" || quotation.status !== "final")) throw new EsError("CONFLICT", "This quotation was already converted or is not valid.");
      const { prepared, calc } = await api.priceSaleLines(input.lines, Number(input.billDiscount) || 0, false);
      const payments = (input.payments ?? []).filter((p) => toPaisa(p.amount) > 0);
      const { paidPaisa, balancePaisa, changePaisa } = settle(calc.totalPaisa, payments);
      if (balancePaisa > 0 && !cust) throw new EsError("INVALID", "A credit (unpaid) sale needs a saved customer.");
      const nonCash = payments.filter((p) => p.method !== "cash").reduce((s, p) => s + toPaisa(p.amount), 0);
      if (nonCash > calc.totalPaisa) throw new EsError("INVALID", "Card/bank/wallet payments can't exceed the invoice total.");
      // Claim the quotation, the stock and the serials before writing the
      // invoice; if any claim fails, everything claimed so far is put back.
      const { allowNegative } = await settingsBag();
      const stockTaken: { id: string; qty: number }[] = [];
      const serialsTaken: { pid: string; s: string }[] = [];
      let quotationTaken = false;
      const rollback = async () => {
        for (const t of stockTaken) {
          await db.execute(`UPDATE es_products SET stock = ROUND(stock + ?, 3), updated_at = ? WHERE id = ? AND tenant_id = ?`, [t.qty, iso(db.now()), t.id, tenant()]);
          await syncRow("es_products", t.id);
        }
        for (const t of serialsTaken) await claimSerial(t.pid, t.s, "sold", "in_stock");
        if (quotationTaken) await update("es_docs", quotation!.id, { status: "final" });
      };
      try {
        if (quotation) {
          if (!(await update("es_docs", quotation.id, { status: "converted" }, { sql: "status = 'final'", params: [] }))) throw new EsError("CONFLICT", "This quotation was just converted.");
          quotationTaken = true;
        }
        const needBy = new Map<string, number>();
        for (const x of prepared) needBy.set(x.p.id, addQty(needBy.get(x.p.id) ?? 0, x.baseQty));
        for (const [pid, q] of needBy) {
          if (!(await claimStock(pid, q, allowNegative))) {
            const p = prepared.find((x) => x.p.id === pid)!.p;
            throw new EsError("CONFLICT", `${p.name} just went out of stock.`);
          }
          stockTaken.push({ id: pid, qty: q });
        }
        for (const x of prepared) {
          for (const s of x.serials) {
            if (!(await claimSerial(x.p.id, s, "in_stock", "sold"))) throw new EsError("CONFLICT", `Serial ${s} was just sold.`);
            serialsTaken.push({ pid: x.p.id, s });
          }
        }
      } catch (e) {
        await rollback();
        throw e;
      }
      const costPaisa = prepared.reduce((s, x) => s + Math.round(toPaisa(x.p.avg_cost) * x.baseQty), 0);
      const doc = await insertDoc("sale", {
        date,
        party_type: "customer",
        party_id: cust?.id ?? null,
        party_name: cust?.name ?? (input.customerName?.trim() || null),
        party_phone: input.customerPhone?.trim() || cust?.phone || null,
        party_address: input.customerAddress?.trim() || cust?.address || null,
        lang: input.lang ?? null,
        gross: toRupees(calc.grossPaisa),
        discount: toRupees(calc.discountPaisa),
        tax: toRupees(calc.taxPaisa),
        total: toRupees(calc.totalPaisa),
        paid: toRupees(paidPaisa),
        balance: toRupees(balancePaisa),
        cost_total: toRupees(costPaisa),
        payments: JSON.stringify(payments),
        status: "final",
        ref_doc_id: quotation?.id ?? null,
        notes: input.notes?.trim() || null,
        created_by: context().userName,
      });
      for (const [i, x] of prepared.entries()) {
        const months = Math.max(x.p.warranty_mfr_months ?? 0, x.p.warranty_seller_months ?? 0) || null;
        const item = await insert<EsDocItem>("es_doc_items", {
          doc_id: doc.id,
          product_id: x.p.id,
          sku: x.p.sku,
          name: x.p.name,
          name_ur: x.p.name_ur,
          model: x.p.model,
          unit: x.unit === "purchase" ? x.p.purchase_unit : x.p.unit,
          unit_factor: x.unit === "purchase" ? x.p.purchase_factor : 1,
          qty: x.qty,
          base_qty: x.baseQty,
          price: x.price,
          discount: toRupees(calc.lines[i].discountPaisa),
          tax_rate: x.p.tax_rate,
          tax: toRupees(calc.lines[i].taxPaisa),
          line_total: toRupees(calc.lines[i].totalPaisa),
          cost: x.p.avg_cost,
          serials: x.serials.length ? JSON.stringify(x.serials) : null,
          warranty_months: months,
          warranty_end: months ? warrantyEnd(date, months) : null,
        } as never);
        // Stock was already taken by claimStock: record the movement only.
        await move(x.p.id, -x.baseQty, "sale", doc.id, item.id, x.p.avg_cost, undefined, false);
        for (const s of x.serials) {
          await db.execute(
            `UPDATE es_serials SET status = 'sold', sale_doc_id = ?, customer_id = ?, customer_name = ?, warranty_start = ?, warranty_end = ?, seller_warranty_end = ?, updated_at = ?
             WHERE tenant_id = ? AND product_id = ? AND serial = ? AND status = 'sold'`,
            [doc.id, cust?.id ?? null, doc.party_name, date, warrantyEnd(date, x.p.warranty_mfr_months), warrantyEnd(date, x.p.warranty_seller_months), iso(db.now()), tenant(), x.p.id, s]
          );
          const row = await db.select(`SELECT * FROM es_serials WHERE tenant_id = ? AND product_id = ? AND serial = ?`, [tenant(), x.p.id, s]);
          if (row[0]) await db.outbox("es_serials", (row[0] as { id: string }).id, "update", row[0]);
        }
      }
      // Record what was kept: change handed back comes off the cash once.
      let changeLeft = changePaisa;
      for (const p of payments) {
        let amount = toPaisa(p.amount);
        if (p.method === "cash" && changeLeft > 0) {
          const off = Math.min(changeLeft, amount);
          amount -= off;
          changeLeft -= off;
        }
        if (amount > 0) await insert("es_payments", { party_type: "customer", party_id: cust?.id ?? null, doc_id: doc.id, amount: toRupees(amount), method: p.method, date, created_by: context().userName } as never);
      }
      await audit("sale.create", "doc", doc.id, { no: doc.doc_no, total: doc.total, quotation: quotation?.doc_no ?? null });
      return { ...(await docWithItems(doc.id)), change: toRupees(changePaisa) };
    },

    async createQuotation(input: { customerId?: string | null; customerName?: string | null; customerPhone?: string | null; date?: string; validUntil?: string | null; lang?: string; lines: SaleLineInput[]; billDiscount?: number; notes?: string | null }) {
      need("es.sell");
      const date = input.date || ymd(db.now());
      const cust = input.customerId ? await party("customer", input.customerId) : null;
      const { prepared, calc } = await api.priceSaleLines(input.lines, Number(input.billDiscount) || 0, true);
      const doc = await insertDoc("quotation", {
        date,
        party_type: "customer",
        party_id: cust?.id ?? null,
        party_name: cust?.name ?? (input.customerName?.trim() || null),
        party_phone: input.customerPhone?.trim() || cust?.phone || null,
        lang: input.lang ?? null,
        gross: toRupees(calc.grossPaisa),
        discount: toRupees(calc.discountPaisa),
        tax: toRupees(calc.taxPaisa),
        total: toRupees(calc.totalPaisa),
        paid: 0,
        balance: toRupees(calc.totalPaisa),
        status: "final",
        valid_until: input.validUntil || null,
        notes: input.notes?.trim() || null,
        created_by: context().userName,
      });
      for (const [i, x] of prepared.entries()) {
        await insert("es_doc_items", {
          doc_id: doc.id,
          product_id: x.p.id,
          sku: x.p.sku,
          name: x.p.name,
          name_ur: x.p.name_ur,
          model: x.p.model,
          unit: x.unit === "purchase" ? x.p.purchase_unit : x.p.unit,
          unit_factor: x.unit === "purchase" ? x.p.purchase_factor : 1,
          qty: x.qty,
          base_qty: x.baseQty,
          price: x.price,
          discount: toRupees(calc.lines[i].discountPaisa),
          tax_rate: x.p.tax_rate,
          tax: toRupees(calc.lines[i].taxPaisa),
          line_total: toRupees(calc.lines[i].totalPaisa),
          cost: x.p.avg_cost,
        } as never);
      }
      await audit("quotation.create", "doc", doc.id, { no: doc.doc_no, total: doc.total });
      return docWithItems(doc.id);
    },

    /** Quotation → sale at the quoted prices (stock and serials checked now). */
    async convertQuotation(quotationId: string, opts: { serials?: Record<string, string[]>; payments?: PaymentIn[]; date?: string }) {
      const { doc, items } = await docWithItems(quotationId);
      if (doc.doc_type !== "quotation") throw new EsError("INVALID", "Not a quotation.");
      const extra = toPaisa(doc.discount) - items.reduce((s, i) => s + toPaisa(i.discount), 0);
      return api.createSale({
        customerId: doc.party_id,
        customerName: doc.party_name,
        customerPhone: doc.party_phone,
        lang: doc.lang ?? undefined,
        date: opts.date,
        lines: items.map((i) => ({ productId: i.product_id!, unit: i.unit_factor !== 1 ? "purchase" : "base", qty: i.qty, price: i.price, discount: i.discount, serials: opts.serials?.[i.id] ?? [] })),
        billDiscount: Math.max(0, toRupees(extra)),
        payments: opts.payments,
        notes: doc.notes,
        fromQuotationId: doc.id,
      });
    },

    async createPurchase(input: { supplierId: string; supplierInvoiceNo?: string | null; date?: string; lines: PurchaseLineInput[]; billDiscount?: number; payments?: PaymentIn[]; notes?: string | null }) {
      need("es.purchase");
      const date = input.date || ymd(db.now());
      const sup = await party("supplier", input.supplierId);
      if (!input.lines.length) throw new EsError("INVALID", "Add at least one product.");
      const { qtyDecimals } = await settingsBag();
      const prepared: { p: EsProduct; unit: "base" | "purchase"; qty: number; baseQty: number; cost: number; discount: number; taxRate: number; serials: string[] }[] = [];
      const seen = new Set<string>();
      for (const l of input.lines) {
        const p = await owned<EsProduct>("es_products", l.productId, "Product");
        const unit = l.unit === "purchase" && p.purchase_unit ? "purchase" : "base";
        const qty = roundQty(Number(l.qty), qtyDecimals);
        if (!(qty > 0)) throw new EsError("INVALID", `Enter a quantity for ${p.name}.`);
        const cost = Number(l.cost);
        if (!Number.isFinite(cost) || cost < 0) throw new EsError("INVALID", `Invalid cost for ${p.name}.`);
        const baseQty = toBaseQty(p, qty, unit);
        const serials = cleanSerials(l.serials);
        if (p.serial_tracked) {
          if (!Number.isInteger(baseQty) || serials.length !== baseQty) throw new EsError("INVALID", `Enter exactly ${baseQty} serial number(s) for ${p.name}.`);
          for (const s of serials) {
            if (seen.has(`${p.id}:${s}`)) throw new EsError("INVALID", `Serial ${s} is entered twice.`);
            seen.add(`${p.id}:${s}`);
            const exists = await db.select(`SELECT id FROM es_serials WHERE tenant_id = ? AND product_id = ? AND serial = ?`, [tenant(), p.id, s]);
            if (exists.length) throw new EsError("CONFLICT", `Serial ${s} is already recorded for ${p.name}.`);
          }
        }
        prepared.push({ p, unit, qty, baseQty, cost, discount: Math.max(0, Number(l.discount) || 0), taxRate: Math.max(0, Number(l.taxRate) || 0), serials });
      }
      const calc = calcDoc(prepared.map((x) => ({ qty: x.qty, price: x.cost, discount: x.discount, taxRate: x.taxRate })), Number(input.billDiscount) || 0);
      const payments = (input.payments ?? []).filter((p) => toPaisa(p.amount) > 0);
      const paid = Math.min(payments.reduce((s, p) => s + toPaisa(p.amount), 0), calc.totalPaisa);
      const doc = await insertDoc("purchase", {
        date,
        party_type: "supplier",
        party_id: sup.id,
        party_name: sup.name,
        party_phone: sup.phone,
        gross: toRupees(calc.grossPaisa),
        discount: toRupees(calc.discountPaisa),
        tax: toRupees(calc.taxPaisa),
        total: toRupees(calc.totalPaisa),
        paid: toRupees(paid),
        balance: toRupees(calc.totalPaisa - paid),
        payments: JSON.stringify(payments),
        status: "final",
        supplier_invoice_no: input.supplierInvoiceNo?.trim() || null,
        notes: input.notes?.trim() || null,
        created_by: context().userName,
      });
      for (const [i, x] of prepared.entries()) {
        // Landed cost per base unit = line value after discount (tax excluded) / base qty.
        const unitCost = Math.round(((calc.lines[i].grossPaisa - calc.lines[i].discountPaisa) / x.baseQty / 100) * 10000) / 10000;
        const item = await insert<EsDocItem>("es_doc_items", {
          doc_id: doc.id,
          product_id: x.p.id,
          sku: x.p.sku,
          name: x.p.name,
          name_ur: x.p.name_ur,
          model: x.p.model,
          unit: x.unit === "purchase" ? x.p.purchase_unit : x.p.unit,
          unit_factor: x.unit === "purchase" ? x.p.purchase_factor : 1,
          qty: x.qty,
          base_qty: x.baseQty,
          price: x.cost,
          discount: toRupees(calc.lines[i].discountPaisa),
          tax_rate: x.taxRate,
          tax: toRupees(calc.lines[i].taxPaisa),
          line_total: toRupees(calc.lines[i].totalPaisa),
          cost: unitCost,
          serials: x.serials.length ? JSON.stringify(x.serials) : null,
        } as never);
        const fresh = await owned<EsProduct>("es_products", x.p.id, "Product");
        await update("es_products", x.p.id, { avg_cost: weightedAverage(fresh.stock, fresh.avg_cost, x.baseQty, unitCost), cost: unitCost });
        await move(x.p.id, x.baseQty, "purchase", doc.id, item.id, unitCost);
        for (const s of x.serials) await insert("es_serials", { product_id: x.p.id, serial: s, status: "in_stock", purchase_doc_id: doc.id, supplier_ref: input.supplierInvoiceNo ?? null } as never);
      }
      for (const p of payments) await insert("es_payments", { party_type: "supplier", party_id: sup.id, doc_id: doc.id, amount: p.amount, method: p.method, date, created_by: context().userName } as never);
      await audit("purchase.create", "doc", doc.id, { no: doc.doc_no, total: doc.total, supplier: sup.name });
      return docWithItems(doc.id);
    },

    /** Return of lines from a sale (to stock) or purchase (to supplier). The
     * returned quantity can never exceed what is left on each original line. */
    async createReturn(input: { originalId: string; lines: { itemId: string; qty: number; serials?: string[] }[]; refund?: PaymentIn | null; reason: string; date?: string }) {
      need("es.return");
      if (!input.reason?.trim()) throw new EsError("INVALID", "Give a reason for the return.");
      const { doc: orig, items } = await docWithItems(input.originalId);
      if (orig.doc_type !== "sale" && orig.doc_type !== "purchase") throw new EsError("INVALID", "Only sales and purchases can be returned.");
      const type: DocType = orig.doc_type === "sale" ? "sale_return" : "purchase_return";
      const date = input.date || ymd(db.now());
      const chosen: { it: EsDocItem; qty: number; baseQty: number; serials: string[]; ratio: number }[] = [];
      for (const l of input.lines) {
        const it = items.find((x) => x.id === l.itemId);
        if (!it) throw new EsError("NOT_FOUND", "Line not found on this document.");
        const qty = roundQty(Number(l.qty));
        if (!(qty > 0)) continue;
        if (toMilli(it.returned_qty) + toMilli(qty) > toMilli(it.qty)) throw new EsError("CONFLICT", `Only ${fromMilli(toMilli(it.qty) - toMilli(it.returned_qty))} of ${it.name} can still be returned.`);
        const serials = cleanSerials(l.serials);
        const lineSerials = json<string[]>(it.serials, []);
        const baseQty = fromMilli(Math.round(toMilli(qty) * it.unit_factor));
        if (lineSerials.length) {
          if (serials.length !== baseQty) throw new EsError("INVALID", `Choose the ${baseQty} serial number(s) being returned for ${it.name}.`);
          for (const s of serials) if (!lineSerials.includes(s)) throw new EsError("INVALID", `Serial ${s} was not on this document.`);
        }
        chosen.push({ it, qty, baseQty, serials, ratio: qty / it.qty });
      }
      if (!chosen.length) throw new EsError("INVALID", "Choose what is being returned.");
      // Claim the quantities on the original lines (no double return) and, for
      // a purchase return, the stock and serials leaving; undo all on failure.
      const claimed: typeof chosen = [];
      const stockTaken: { id: string; qty: number }[] = [];
      const serialsTaken: { pid: string; s: string }[] = [];
      try {
        for (const c of chosen) {
          const ok = await update("es_doc_items", c.it.id, { returned_qty: addQty(c.it.returned_qty, c.qty) }, { sql: "returned_qty = ?", params: [c.it.returned_qty] });
          if (!ok) throw new EsError("CONFLICT", "The document changed; reload and try again.");
          claimed.push(c);
        }
        if (type === "purchase_return") {
          const { allowNegative } = await settingsBag();
          for (const c of chosen) {
            if (!(await claimStock(c.it.product_id!, c.baseQty, allowNegative))) throw new EsError("CONFLICT", `Not enough ${c.it.name} in stock to return.`);
            stockTaken.push({ id: c.it.product_id!, qty: c.baseQty });
            for (const s of c.serials) {
              if (!(await claimSerial(c.it.product_id!, s, "in_stock", "returned_to_supplier"))) throw new EsError("CONFLICT", `Serial ${s} is not in stock.`);
              serialsTaken.push({ pid: c.it.product_id!, s });
            }
          }
        }
      } catch (e) {
        for (const c of claimed) await update("es_doc_items", c.it.id, { returned_qty: c.it.returned_qty });
        for (const t of stockTaken) {
          await db.execute(`UPDATE es_products SET stock = ROUND(stock + ?, 3), updated_at = ? WHERE id = ? AND tenant_id = ?`, [t.qty, iso(db.now()), t.id, tenant()]);
          await syncRow("es_products", t.id);
        }
        for (const t of serialsTaken) await claimSerial(t.pid, t.s, "returned_to_supplier", "in_stock");
        throw e;
      }
      const part = (v: number, r: number) => Math.round(toPaisa(v) * r);
      const lines = claimed.map((c) => ({ gross: Math.round(toPaisa(c.it.price) * c.qty), discount: part(c.it.discount, c.ratio), tax: part(c.it.tax, c.ratio) }));
      const gross = lines.reduce((s, l) => s + l.gross, 0);
      const discount = lines.reduce((s, l) => s + l.discount, 0);
      const tax = lines.reduce((s, l) => s + l.tax, 0);
      const total = gross - discount + tax;
      const refund = input.refund && toPaisa(input.refund.amount) > 0 ? input.refund : null;
      if (refund && toPaisa(refund.amount) > total) throw new EsError("INVALID", "Refund can't exceed the returned amount.");
      const doc = await insertDoc(type, {
        date,
        party_type: orig.party_type,
        party_id: orig.party_id,
        party_name: orig.party_name,
        party_phone: orig.party_phone,
        lang: orig.lang,
        gross: toRupees(gross),
        discount: toRupees(discount),
        tax: toRupees(tax),
        total: toRupees(total),
        paid: refund ? refund.amount : 0,
        balance: toRupees(total - (refund ? toPaisa(refund.amount) : 0)),
        cost_total: toRupees(claimed.reduce((s, c) => s + Math.round(toPaisa(c.it.cost) * c.baseQty), 0)),
        payments: JSON.stringify(refund ? [refund] : []),
        status: "final",
        ref_doc_id: orig.id,
        notes: input.reason.trim(),
        created_by: context().userName,
      });
      for (const [i, c] of claimed.entries()) {
        const item = await insert<EsDocItem>("es_doc_items", {
          doc_id: doc.id,
          product_id: c.it.product_id,
          ref_item_id: c.it.id,
          sku: c.it.sku,
          name: c.it.name,
          name_ur: c.it.name_ur,
          model: c.it.model,
          unit: c.it.unit,
          unit_factor: c.it.unit_factor,
          qty: c.qty,
          base_qty: c.baseQty,
          price: c.it.price,
          discount: toRupees(lines[i].discount),
          tax_rate: c.it.tax_rate,
          tax: toRupees(lines[i].tax),
          line_total: toRupees(lines[i].gross - lines[i].discount + lines[i].tax),
          cost: c.it.cost,
          serials: c.serials.length ? JSON.stringify(c.serials) : null,
        } as never);
        // Purchase-return stock was already taken by claimStock.
        await move(c.it.product_id!, type === "sale_return" ? c.baseQty : -c.baseQty, type, doc.id, item.id, c.it.cost, undefined, type === "sale_return");
        for (const s of c.serials) {
          await db.execute(
            `UPDATE es_serials SET status = ?, ${type === "sale_return" ? "sale_doc_id = NULL, customer_id = NULL, customer_name = NULL, warranty_start = NULL, warranty_end = NULL, seller_warranty_end = NULL," : ""} updated_at = ? WHERE tenant_id = ? AND product_id = ? AND serial = ?`,
            [type === "sale_return" ? "in_stock" : "returned_to_supplier", iso(db.now()), tenant(), c.it.product_id, s]
          );
        }
      }
      if (refund) {
        // A refund is money flowing back: negative payment on the party ledger.
        await insert("es_payments", { party_type: orig.party_type ?? "customer", party_id: orig.party_id, doc_id: doc.id, amount: -refund.amount, method: refund.method, date, note: "Refund", created_by: context().userName } as never);
      }
      await audit(`${type}.create`, "doc", doc.id, { original: orig.doc_no, total: doc.total, reason: input.reason });
      return docWithItems(doc.id);
    },

    /** Adds/edits a customer or supplier in the app's shared, tenant-scoped
     * party tables (so they also appear in the general ledger screens). */
    async saveParty(type: "customer" | "supplier", input: { id?: string; name: string; phone?: string | null; address?: string | null; opening_balance?: number; balance_type?: string }) {
      need(type === "customer" ? "es.sell" : "es.purchase");
      const name = String(input.name ?? "").trim();
      if (!name) throw new EsError("INVALID", "Name is required.");
      const table = type === "customer" ? "customers" : "suppliers";
      const data = {
        name,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        opening_balance: Math.max(0, Number(input.opening_balance) || 0),
        balance_type: input.balance_type === (type === "customer" ? "payable" : "receivable") ? input.balance_type : type === "customer" ? "receivable" : "payable",
      };
      if (input.id) {
        await party(type, input.id);
        await update(table, input.id, data);
        return party(type, input.id);
      }
      return insert(table, data as never);
    },

    async listParties(type: "customer" | "supplier") {
      return db.select<{ id: string; name: string; phone: string | null; address: string | null }>(`SELECT id, name, phone, address FROM ${type === "customer" ? "customers" : "suppliers"} WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name`, [tenant()]);
    },

    // ── Payments and balances ──
    async receivePayment(input: { partyType: "customer" | "supplier"; partyId: string; amount: number; method: PaymentIn["method"]; docId?: string | null; note?: string; date?: string }) {
      need("es.payments");
      const pt = await party(input.partyType, input.partyId);
      const amount = Number(input.amount);
      if (!(amount > 0)) throw new EsError("INVALID", "Enter an amount.");
      if (input.docId) {
        const d = await owned<EsDoc>("es_docs", input.docId, "Document");
        if (d.party_id !== pt.id) throw new EsError("INVALID", "That document belongs to someone else.");
        if (toPaisa(amount) > toPaisa(d.balance)) throw new EsError("INVALID", `Only Rs ${d.balance} is due on this document.`);
        const ok = await update("es_docs", d.id, { paid: toRupees(toPaisa(d.paid) + toPaisa(amount)), balance: toRupees(toPaisa(d.balance) - toPaisa(amount)) }, { sql: "balance = ?", params: [d.balance] });
        if (!ok) throw new EsError("CONFLICT", "The document changed; reload.");
      }
      const row = await insert("es_payments", { party_type: input.partyType, party_id: pt.id, doc_id: input.docId ?? null, amount, method: input.method, date: input.date || ymd(db.now()), note: input.note ?? null, created_by: context().userName } as never);
      await audit("payment.receive", input.partyType, pt.id, { amount, method: input.method, doc: input.docId ?? null });
      return row;
    },

    /** Balance owed: customers owe the store (+), the store owes suppliers (+). */
    async balances(type: "customer" | "supplier") {
      const table = type === "customer" ? "customers" : "suppliers";
      const [docIn, docOut] = type === "customer" ? ["sale", "sale_return"] : ["purchase", "purchase_return"];
      return db.select<{ id: string; name: string; phone: string | null; opening: number; billed: number; returned: number; paid: number; balance: number }>(
        `SELECT p.id, p.name, p.phone,
                COALESCE(p.opening_balance, 0) * (CASE WHEN p.balance_type = '${type === "customer" ? "payable" : "receivable"}' THEN -1 ELSE 1 END) AS opening,
                COALESCE((SELECT SUM(total) FROM es_docs d WHERE d.tenant_id = p.tenant_id AND d.party_id = p.id AND d.doc_type = '${docIn}' AND d.deleted_at IS NULL), 0) AS billed,
                COALESCE((SELECT SUM(total) FROM es_docs d WHERE d.tenant_id = p.tenant_id AND d.party_id = p.id AND d.doc_type = '${docOut}' AND d.deleted_at IS NULL), 0) AS returned,
                COALESCE((SELECT SUM(amount) FROM es_payments x WHERE x.tenant_id = p.tenant_id AND x.party_type = '${type}' AND x.party_id = p.id AND x.deleted_at IS NULL), 0) AS paid,
                0 AS balance
         FROM ${table} p WHERE p.tenant_id = ? AND p.deleted_at IS NULL ORDER BY p.name`,
        [tenant()]
      ).then((rows) => rows.map((r) => ({ ...r, balance: toRupees(toPaisa(r.opening) + toPaisa(r.billed) - toPaisa(r.returned) - toPaisa(r.paid)) })));
    },

    async ledger(type: "customer" | "supplier", id: string) {
      const pt = await party(type, id);
      const docs = await db.select<EsDoc>(`SELECT * FROM es_docs WHERE tenant_id = ? AND party_id = ? AND doc_type IN (${type === "customer" ? "'sale','sale_return'" : "'purchase','purchase_return'"}) AND deleted_at IS NULL ORDER BY date, doc_no`, [tenant(), pt.id]);
      const pays = await db.select<{ id: string; date: string; amount: number; method: string; doc_id: string | null; note: string | null }>(`SELECT id, date, amount, method, doc_id, note FROM es_payments WHERE tenant_id = ? AND party_type = ? AND party_id = ? AND deleted_at IS NULL ORDER BY date, created_at`, [tenant(), type, pt.id]);
      return { party: pt, docs, payments: pays };
    },

    // ── Warranty ──
    async lookupSerial(serial: string) {
      const rows = await db.select<EsSerial & { product_name: string; sku: string; model: string | null }>(
        `SELECT s.*, p.name AS product_name, p.sku, p.model FROM es_serials s JOIN es_products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
         WHERE s.tenant_id = ? AND UPPER(s.serial) = ?`,
        [tenant(), serial.trim().toUpperCase()]
      );
      return rows;
    },

    async listClaims(status?: string) {
      return db.select<EsClaim & { serial: string | null; product_name: string | null }>(
        `SELECT c.*, s.serial, p.name AS product_name FROM es_warranty_claims c
         LEFT JOIN es_serials s ON s.id = c.serial_id AND s.tenant_id = c.tenant_id
         LEFT JOIN es_products p ON p.id = c.product_id AND p.tenant_id = c.tenant_id
         WHERE c.tenant_id = ? AND c.deleted_at IS NULL ${status ? "AND c.status = ?" : ""} ORDER BY c.created_at DESC`,
        status ? [tenant(), status] : [tenant()]
      );
    },

    async openClaim(input: { serialId: string; issue: string }) {
      need("es.sell");
      const s = await owned<EsSerial>("es_serials", input.serialId, "Serial number");
      if (!input.issue?.trim()) throw new EsError("INVALID", "Describe the problem.");
      const claim = await insert<EsClaim>("es_warranty_claims", {
        serial_id: s.id,
        product_id: s.product_id,
        customer_id: s.customer_id,
        customer_name: s.customer_name,
        issue: input.issue.trim(),
        status: "open",
        opened_at: ymd(db.now()),
      } as never);
      await audit("warranty.open", "serial", s.id, { claim: claim.id, issue: input.issue });
      return claim;
    },

    async updateClaim(id: string, status: EsClaim["status"], resolution?: string) {
      need("es.sell");
      const c = await owned<EsClaim>("es_warranty_claims", id, "Warranty claim");
      if (!["open", "sent_to_supplier", "repaired", "replaced", "rejected", "closed"].includes(status)) throw new EsError("INVALID", "Unknown status.");
      await update("es_warranty_claims", id, { status, resolution: resolution ?? c.resolution, closed_at: ["closed", "rejected", "replaced", "repaired"].includes(status) ? ymd(db.now()) : null });
      await audit("warranty.update", "claim", id, { from: c.status, to: status, resolution });
    },

    // ── Digital invoice: authorised access and audit ──
    /** The only way screens load a document for print/PDF/share: checks the
     * tenant owns it and records the access. */
    async invoiceForOutput(id: string, action: "print" | "pdf" | "share_whatsapp" | "share_email" | "view") {
      const out = await docWithItems(id);
      await audit(`doc.${action}`, "doc", id, { type: out.doc.doc_type, no: out.doc.doc_no });
      return out;
    },

    async setFbrResult(docId: string, ok: boolean, fbrNo: string | null, error: string | null) {
      const d = await owned<EsDoc>("es_docs", docId, "Document");
      if (d.doc_type !== "sale") throw new EsError("INVALID", "Only sales invoices go to FBR.");
      await update("es_docs", docId, { fbr_status: ok ? "accepted" : "rejected", fbr_invoice_no: ok ? fbrNo : d.fbr_invoice_no });
      await audit(ok ? "fbr.accepted" : "fbr.rejected", "doc", docId, { fbrNo, error });
    },

    async audits(limit = 500) {
      return db.select<{ id: string; created_at: string; user_name: string | null; action: string; record_type: string | null; detail: string | null }>(`SELECT * FROM es_audit WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`, [tenant(), limit]);
    },

    // ── Dashboard and reports ──
    async summary(from: string, to: string) {
      const rows = await db.select<{ doc_type: string; n: number; total: number; tax: number; cost: number; discount: number }>(
        `SELECT doc_type, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(tax), 0) AS tax, COALESCE(SUM(cost_total), 0) AS cost, COALESCE(SUM(discount), 0) AS discount
         FROM es_docs WHERE tenant_id = ? AND deleted_at IS NULL AND status IN ('final', 'converted') AND date BETWEEN ? AND ? GROUP BY doc_type`,
        [tenant(), from, to]
      );
      const by = (t: string) => rows.find((r) => r.doc_type === t) ?? { n: 0, total: 0, tax: 0, cost: 0, discount: 0 };
      const sale = by("sale");
      const sret = by("sale_return");
      const pur = by("purchase");
      const pret = by("purchase_return");
      // Gross profit: revenue excluding tax minus cost of goods (weighted average), net of returns.
      const revenue = toPaisa(sale.total) - toPaisa(sale.tax) - (toPaisa(sret.total) - toPaisa(sret.tax));
      const cogs = toPaisa(sale.cost) - toPaisa(sret.cost);
      return {
        salesCount: sale.n,
        sales: toRupees(toPaisa(sale.total) - toPaisa(sret.total)),
        salesGross: sale.total,
        returns: sret.total,
        returnCount: sret.n,
        purchases: toRupees(toPaisa(pur.total) - toPaisa(pret.total)),
        purchaseCount: pur.n,
        tax: toRupees(toPaisa(sale.tax) - toPaisa(sret.tax)),
        discounts: sale.discount,
        revenueExTax: toRupees(revenue),
        cogs: toRupees(cogs),
        grossProfit: toRupees(revenue - cogs),
        quotations: by("quotation").n,
      };
    },

    async salesBy(dim: "product" | "category" | "payment" | "day", from: string, to: string) {
      const p = [tenant(), from, to];
      if (dim === "payment") {
        return db.select<{ label: string; label_ur?: string | null; qty: number; amount: number }>(
          `SELECT x.method AS label, COUNT(*) AS qty, SUM(x.amount) AS amount FROM es_payments x JOIN es_docs d ON d.id = x.doc_id AND d.tenant_id = x.tenant_id
           WHERE x.tenant_id = ? AND x.party_type = 'customer' AND d.date BETWEEN ? AND ? AND x.deleted_at IS NULL GROUP BY x.method ORDER BY amount DESC`,
          p
        );
      }
      if (dim === "day") return db.select<{ label: string; label_ur?: string | null; qty: number; amount: number }>(`SELECT date AS label, COUNT(*) AS qty, SUM(total) AS amount FROM es_docs WHERE tenant_id = ? AND doc_type = 'sale' AND date BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY date ORDER BY date`, p);
      const key = dim === "product" ? "i.product_id" : "pr.category_id";
      const label = dim === "product" ? "MAX(i.name)" : "COALESCE(MAX(c.name), '-')";
      return db.select<{ label: string; label_ur: string | null; qty: number; amount: number }>(
        `SELECT ${label} AS label, ${dim === "product" ? "MAX(i.name_ur)" : "MAX(c.name_ur)"} AS label_ur,
                SUM(CASE WHEN d.doc_type = 'sale' THEN i.base_qty ELSE -i.base_qty END) AS qty,
                SUM(CASE WHEN d.doc_type = 'sale' THEN i.line_total - i.tax ELSE -(i.line_total - i.tax) END) AS amount
         FROM es_doc_items i JOIN es_docs d ON d.id = i.doc_id AND d.tenant_id = i.tenant_id
         LEFT JOIN es_products pr ON pr.id = i.product_id AND pr.tenant_id = i.tenant_id
         LEFT JOIN es_categories c ON c.id = pr.category_id AND c.tenant_id = pr.tenant_id
         WHERE i.tenant_id = ? AND d.doc_type IN ('sale', 'sale_return') AND d.date BETWEEN ? AND ? AND i.deleted_at IS NULL
         GROUP BY ${key} ORDER BY amount DESC LIMIT 50`,
        p
      );
    },

    async dashboard(day: string) {
      const monthStart = `${day.slice(0, 7)}-01`;
      const [today, month, products, receivables, payables, recentSales, recentPurchases, best, cats, pay, claims, soldSerials, expiring] = await Promise.all([
        api.summary(day, day),
        api.summary(monthStart, day),
        db.select<{ stock: number; avg_cost: number; reorder_level: number; name: string; name_ur: string | null; unit: string; id: string }>(`SELECT id, name, name_ur, unit, stock, avg_cost, reorder_level FROM es_products WHERE tenant_id = ? AND deleted_at IS NULL AND is_active = 1`, [tenant()]),
        api.balances("customer"),
        api.balances("supplier"),
        api.listDocs({ type: "sale" }).then((r) => r.slice(0, 8)),
        api.listDocs({ type: "purchase" }).then((r) => r.slice(0, 8)),
        api.salesBy("product", monthStart, day),
        api.salesBy("category", monthStart, day),
        api.salesBy("payment", monthStart, day),
        db.select<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM es_warranty_claims WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY status`, [tenant()]),
        db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM es_serials s JOIN es_docs d ON d.id = s.sale_doc_id AND d.tenant_id = s.tenant_id WHERE s.tenant_id = ? AND s.status = 'sold' AND d.date BETWEEN ? AND ?`, [tenant(), monthStart, day]),
        db.select<EsSerial & { product_name: string }>(
          `SELECT s.*, p.name AS product_name FROM es_serials s JOIN es_products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
           WHERE s.tenant_id = ? AND s.status = 'sold' AND s.warranty_end IS NOT NULL AND s.warranty_end BETWEEN ? AND date(?, '+30 day') ORDER BY s.warranty_end LIMIT 20`,
          [tenant(), day, day]
        ),
      ]);
      return {
        today,
        month,
        inventoryValue: toRupees(products.reduce((s, p) => s + Math.round(toPaisa(p.avg_cost) * Math.max(0, p.stock)), 0)),
        lowStock: products.filter((p) => p.reorder_level > 0 && p.stock > 0 && p.stock <= p.reorder_level),
        outOfStock: products.filter((p) => p.stock <= 0),
        receivable: toRupees(receivables.reduce((s, r) => s + Math.max(0, toPaisa(r.balance)), 0)),
        payable: toRupees(payables.reduce((s, r) => s + Math.max(0, toPaisa(r.balance)), 0)),
        recentSales,
        recentPurchases,
        bestSellers: best.slice(0, 8),
        byCategory: cats,
        payments: pay,
        claims,
        serialsSold: soldSerials[0]?.n ?? 0,
        warrantyExpiring: expiring,
      };
    },
  };
  return api;
}

export type ElectricStore = ReturnType<typeof createElectricStore>;
