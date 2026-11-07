/** Online store on top of the POS: the business's existing products and stock
 * are the source of truth; only products it lists (web_products, per
 * business) are public, and cost, supplier and batch details never are.
 *
 * Stock is RESERVED when an order is placed: an order's lines are inserted
 * only if the stock left after other open orders covers them, and all of an
 * order's lines commit together or none do (web_guard), so two customers
 * cannot buy the last unit twice. A pending order holds stock until
 * `reserved_until` (Store settings: hold hours); a confirmed one until it is
 * billed or cancelled. Billing happens in the POS invoice screen (prefilled
 * from the order), which deducts stock and posts the sale as usual; the order
 * then only links to that invoice, so nothing is deducted or invoiced twice,
 * and no FBR submission happens because an order was placed. */
import { randomBytes, randomUUID } from "node:crypto";
import { HttpError } from "../db";
import type { Sql } from "../subSupers";
import { audit, iso, json, rateLimited, requireSite, type Site } from "./core";
import { pageSlug } from "../../lib/web/sections";
import { businessType } from "../../config/businessTypes";

/** Pharmacies: every product ordered online needs a prescription (the pharmacist reviews it before confirming). */
export const rxRequiredForOrders = (typeId: string | null | undefined) => businessType(typeId).family === "pharmacy";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => Math.round(n * 100) / 100;

/** Products this business can list: its own, and shared-catalogue products it has stock of. */
const OWNED = `(p.tenant_id = :t OR p.id IN (SELECT product_id FROM product_batches WHERE tenant_id = :t AND deleted_at IS NULL))`;
const named = (sqlText: string, t: string) => ({ sql: sqlText.replace(/:t/g, "?"), n: (sqlText.match(/:t/g) ?? []).length, t });
const argsFor = (q: { n: number; t: string }) => Array.from({ length: q.n }, () => q.t);

/** Sellable stock of a product for this business (unexpired batches). Arguments: tenant, [product if "?"], today. */
export const stockSql = (product: string) => `COALESCE((SELECT SUM(b.qty) FROM product_batches b WHERE b.tenant_id = ? AND b.product_id = ${product} AND b.deleted_at IS NULL AND b.qty > 0
  AND (b.expiry_date IS NULL OR b.expiry_date = '' OR substr(b.expiry_date, 1, 10) >= ?)), 0)`;
/** Units held by open web orders not yet billed. Arguments: tenant, [product if "?"], now. */
export const reservedSql = (product: string) => `COALESCE((SELECT SUM(i.qty) FROM web_order_items i JOIN web_orders o ON o.id = i.order_id
  WHERE o.tenant_id = ? AND i.product_id = ${product} AND o.invoice_id IS NULL AND o.status IN ('pending','confirmed','preparing','ready','dispatched')
  AND (o.status != 'pending' OR o.reserved_until > ?)), 0)`;
/** The POS sale price (most recent price list entry of this business). */
const POS_PRICE_SQL = `(SELECT pl.sale_price FROM price_list pl WHERE pl.tenant_id = ? AND pl.product_id = p.id AND pl.deleted_at IS NULL AND pl.sale_price > 0 ORDER BY pl.updated_at DESC, pl.created_at DESC LIMIT 1)`;

export async function available(sql: Sql, tenantId: string, productId: string, now = new Date()): Promise<number> {
  const r = (await sql.execute(`SELECT ${stockSql("?")} - ${reservedSql("?")} AS n`, [tenantId, productId, today(), tenantId, productId, iso(now)])).rows[0];
  return Math.max(0, Number(r?.n ?? 0));
}

// ── Listings (business side) ──────────────────────────────────────────────

export async function listProductsForListing(sql: Sql, tenantId: string, f: { q?: unknown; onlyListed?: unknown; offset?: unknown }) {
  const q = typeof f.q === "string" ? f.q.trim().slice(0, 60) : "";
  const where = [`p.deleted_at IS NULL`, OWNED];
  const args: unknown[] = [];
  if (q) { where.push(`(p.name LIKE ? OR p.barcode = ?)`); args.push(`%${q}%`, q); }
  if (f.onlyListed) where.push(`w.show_online = 1`);
  const base = named(`FROM products p LEFT JOIN web_products w ON w.product_id = p.id AND w.tenant_id = :t
     LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(" AND ")}`, tenantId);
  // :t placeholders come first (join, owned check), then the search arguments.
  const offset = Math.max(0, Number(f.offset) || 0);
  const rows = (await sql.execute(
    `SELECT p.id, p.name, p.barcode, c.name AS category, p.is_narcotic, w.show_online, w.allow_order, w.title, w.description, w.images, w.online_price,
            w.featured, w.online_category, w.rx_required, w.stock_visibility, w.slug, ${POS_PRICE_SQL} AS pos_price, ${stockSql("p.id")} AS stock
     ${base.sql} ORDER BY w.show_online DESC, p.name LIMIT 100 OFFSET ?`,
    [tenantId, tenantId, today(), ...argsFor(base), ...args, offset],
  )).rows;
  return rows.map((r) => ({
    productId: String(r.id), name: String(r.name), barcode: (r.barcode as string | null) ?? null, category: (r.category as string | null) ?? null,
    narcotic: Number(r.is_narcotic) === 1, posPrice: r.pos_price == null ? null : Number(r.pos_price), stock: Number(r.stock) || 0,
    listing: r.slug ? {
      showOnline: Number(r.show_online) === 1, allowOrder: Number(r.allow_order) === 1, title: (r.title as string | null) ?? "", description: (r.description as string | null) ?? "",
      images: json<{ url: string; alt: string }[]>(r.images, []), onlinePrice: r.online_price == null ? null : Number(r.online_price), featured: Number(r.featured) === 1,
      onlineCategory: (r.online_category as string | null) ?? "", rxRequired: Number(r.rx_required) === 1, stockVisibility: String(r.stock_visibility), slug: String(r.slug),
    } : null,
  }));
}

export interface ListingInput {
  showOnline?: unknown; allowOrder?: unknown; title?: unknown; description?: unknown; images?: unknown; onlinePrice?: unknown;
  featured?: unknown; onlineCategory?: unknown; rxRequired?: unknown; stockVisibility?: unknown;
}

export async function saveListing(sql: Sql, actor: string, tenantId: string, productId: string, l: ListingInput) {
  const site = await requireSite(sql, tenantId);
  if (!site.storeEnabled) throw new HttpError(403, "The online store is not switched on for this business.");
  const own = named(`SELECT p.id, p.name, p.is_narcotic FROM products p WHERE p.id = ? AND p.deleted_at IS NULL AND ${OWNED}`, tenantId);
  const p = (await sql.execute(own.sql, [productId, ...argsFor(own)])).rows[0];
  if (!p) throw new HttpError(404, "Product not found in your stock list.");
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const images = (Array.isArray(l.images) ? l.images : []).slice(0, 6).map((im) => {
    const o = (im ?? {}) as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!/^https:\/\/[^\s<>"']+$/i.test(url)) throw new HttpError(400, "Product images must be uploaded images.");
    return { url, alt: text(o.alt, 160) };
  });
  const price = l.onlinePrice === null || l.onlinePrice === "" || l.onlinePrice === undefined ? null : Number(l.onlinePrice);
  if (price !== null && (!Number.isFinite(price) || price <= 0 || price > 10_000_000)) throw new HttpError(400, "Online price must be a positive amount, or empty to use the POS price.");
  const vis = ["hide", "status", "qty"].includes(String(l.stockVisibility)) ? String(l.stockVisibility) : "status";
  // A controlled (narcotic) medicine is never orderable online.
  const allowOrder = Boolean(l.allowOrder) && Number(p.is_narcotic) !== 1;
  // A pharmacy's orderable products always need a prescription.
  const rxRequired = Boolean(l.rxRequired) || (allowOrder && rxRequiredForOrders(site.businessType));
  const title = text(l.title, 140);
  const now = iso();
  const existing = (await sql.execute(`SELECT slug FROM web_products WHERE tenant_id = ? AND product_id = ?`, [tenantId, productId])).rows[0];
  let slug = existing ? String(existing.slug) : pageSlug(title || String(p.name)) || "item";
  if (!existing) {
    for (let i = 2; (await sql.execute(`SELECT 1 FROM web_products WHERE tenant_id = ? AND slug = ?`, [tenantId, slug])).rows.length; i++) slug = `${pageSlug(title || String(p.name))}-${i}`;
  }
  await sql.execute(
    `INSERT INTO web_products (tenant_id, product_id, slug, show_online, allow_order, title, description, images, online_price, featured, online_category, rx_required, stock_visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, product_id) DO UPDATE SET show_online = excluded.show_online, allow_order = excluded.allow_order, title = excluded.title,
       description = excluded.description, images = excluded.images, online_price = excluded.online_price, featured = excluded.featured,
       online_category = excluded.online_category, rx_required = excluded.rx_required, stock_visibility = excluded.stock_visibility, updated_at = excluded.updated_at`,
    [tenantId, productId, slug, l.showOnline ? 1 : 0, allowOrder ? 1 : 0, title || null, text(l.description, 3000) || null, JSON.stringify(images), price,
      l.featured ? 1 : 0, text(l.onlineCategory, 60) || null, rxRequired ? 1 : 0, vis, now, now],
  );
  await audit(sql, tenantId, actor, "listing_saved", { productId, showOnline: Boolean(l.showOnline), allowOrder, rxRequired });
  return { slug, allowOrder, rxRequired };
}

// ── Public catalogue ──────────────────────────────────────────────────────

export interface PublicProduct {
  slug: string; name: string; description: string; images: { url: string; alt: string }[]; price: number | null; category: string;
  featured: boolean; orderable: boolean; rxRequired: boolean; stock: { visibility: string; inStock: boolean; qty: number | null };
}

/** Listed products, as the public sees them: never cost, supplier, batch or internal notes. */
export async function publicCatalog(sql: Sql, site: Site, f: { q?: string; category?: string; slug?: string; featured?: boolean; limit?: number; now?: Date } = {}): Promise<PublicProduct[]> {
  const t = site.tenantId;
  const where = [`w.tenant_id = ?`, `w.show_online = 1`, `p.deleted_at IS NULL`];
  const args: unknown[] = [];
  if (f.slug) { where.push(`w.slug = ?`); args.push(f.slug); }
  if (f.featured) where.push(`w.featured = 1`);
  if (f.category) { where.push(`COALESCE(w.online_category, c.name) = ?`); args.push(f.category); }
  if (f.q) { where.push(`(COALESCE(w.title, p.name) LIKE ? OR w.description LIKE ?)`); args.push(`%${f.q.slice(0, 60)}%`, `%${f.q.slice(0, 60)}%`); }
  const now = iso(f.now);
  const listRows = (await sql.execute(
    `SELECT w.slug, COALESCE(w.title, p.name) AS name, w.description, w.images, COALESCE(w.online_price, ${POS_PRICE_SQL}) AS price,
            COALESCE(w.online_category, c.name, '') AS category, w.featured, w.allow_order, w.rx_required, w.stock_visibility, p.is_narcotic,
            ${stockSql("p.id")} - ${reservedSql("p.id")} AS avail
     FROM web_products w JOIN products p ON p.id = w.product_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(" AND ")} ORDER BY w.featured DESC, name LIMIT ?`,
    [t, t, today(), t, now, t, ...args, Math.min(f.limit ?? 200, 500)],
  )).rows;
  return listRows.map((r) => {
    const avail = Math.max(0, Number(r.avail) || 0);
    const price = r.price == null ? null : money(Number(r.price));
    const vis = String(r.stock_visibility);
    return {
      slug: String(r.slug), name: String(r.name), description: String(r.description ?? ""), images: json(r.images, []), price, category: String(r.category ?? ""),
      featured: Number(r.featured) === 1, rxRequired: Number(r.rx_required) === 1 || (Number(r.allow_order) === 1 && rxRequiredForOrders(site.businessType)),
      orderable: site.storeEnabled && Number(r.allow_order) === 1 && Number(r.is_narcotic) !== 1 && price !== null && avail > 0,
      stock: { visibility: vis, inStock: avail > 0, qty: vis === "qty" ? avail : null },
    };
  });
}

export async function publicCategories(sql: Sql, site: Site): Promise<string[]> {
  return (await sql.execute(
    `SELECT DISTINCT COALESCE(w.online_category, c.name) AS cat FROM web_products w JOIN products p ON p.id = w.product_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE w.tenant_id = ? AND w.show_online = 1 AND p.deleted_at IS NULL AND COALESCE(w.online_category, c.name) IS NOT NULL ORDER BY cat LIMIT 100`,
    [site.tenantId],
  )).rows.map((r) => String(r.cat));
}

// ── Checkout ──────────────────────────────────────────────────────────────

export const MAX_RX_FILES = 3;
export const MAX_RX_BYTES = 4 * 1024 * 1024;

export interface CheckoutInput {
  idempotencyKey?: unknown; items?: unknown; name?: unknown; phone?: unknown; email?: unknown; address?: unknown; notes?: unknown;
  fulfillment?: unknown; zone?: unknown; payment?: unknown; prescriptions?: unknown;
}

/** Recognises the file by its first bytes (the declared type is not trusted). */
export function sniffFile(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.length > 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

export async function placeOrder(sql: Sql, site: Site, input: CheckoutInput, ip: string | null = null, now = new Date()) {
  const t = site.tenantId;
  if (!site.storeEnabled || site.publicSuspended || !site.tenantActive) throw new HttpError(403, "This store is not taking orders right now.");
  const key = typeof input.idempotencyKey === "string" && /^[\w-]{16,64}$/.test(input.idempotencyKey) ? input.idempotencyKey : "";
  if (!key) throw new HttpError(400, "Refresh the page and try again.");
  // The same checkout sent twice (double click, retry) returns the first order.
  const dup = (await sql.execute(`SELECT public_token, order_no FROM web_orders WHERE tenant_id = ? AND idempotency_key = ?`, [t, key])).rows[0];
  if (dup) return { token: String(dup.public_token), orderNo: Number(dup.order_no), repeated: true };
  if (rateLimited(`order:${t}:${ip ?? "?"}`, 10, 3600_000, now.getTime())) throw new HttpError(429, "Too many orders from this connection. Try again later or call the shop.");

  const text = (v: unknown, max: number, label: string, required = false) => {
    const s = typeof v === "string" ? v.trim().slice(0, max) : "";
    if (required && !s) throw new HttpError(400, `Enter your ${label}.`);
    return s;
  };
  const name = text(input.name, 80, "name", true);
  const phone = text(input.phone, 20, "phone number", true).replace(/[\s-]/g, "");
  if (!/^\+?\d{10,15}$/.test(phone)) throw new HttpError(400, "Enter a valid phone number, e.g. 03001234567.");
  const email = text(input.email, 120, "email");
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "Enter a valid email or leave it empty.");
  const recent = Number((await sql.execute(`SELECT COUNT(*) AS n FROM web_orders WHERE tenant_id = ? AND phone = ? AND created_at > ?`, [t, phone, iso(new Date(now.getTime() - 3600_000))])).rows[0]?.n ?? 0);
  if (recent >= 5) throw new HttpError(429, "Several orders were just placed with this number. Call the shop to add more.");

  const st = site.storeSettings;
  const fulfillment = input.fulfillment === "delivery" ? "delivery" : "pickup";
  if (fulfillment === "delivery" && !st.delivery) throw new HttpError(400, "Delivery is not available; choose pickup.");
  if (fulfillment === "pickup" && !st.pickup) throw new HttpError(400, "Pickup is not available; choose delivery.");
  let zone: string | null = null;
  let delivery = 0;
  let address = "";
  if (fulfillment === "delivery") {
    const z = st.zones.find((x) => x.name === input.zone);
    if (!z) throw new HttpError(400, "Choose your delivery area.");
    zone = z.name;
    delivery = money(z.charge);
    address = text(input.address, 300, "delivery address", true);
  }
  const payment = String(input.payment ?? "");
  const allowed = { cod: st.payment.cod && fulfillment === "delivery", pickup: st.payment.pickup && fulfillment === "pickup", bank: st.payment.bank };
  if (!(payment in allowed) || !allowed[payment as keyof typeof allowed]) throw new HttpError(400, "Choose a way to pay that is offered.");

  // Lines: merge duplicates, server prices only.
  const raw = Array.isArray(input.items) ? input.items : [];
  if (!raw.length) throw new HttpError(400, "Your cart is empty.");
  if (raw.length > 40) throw new HttpError(400, "At most 40 different items per order.");
  const want = new Map<string, number>();
  for (const it of raw) {
    const o = (it ?? {}) as Record<string, unknown>;
    const slug = typeof o.slug === "string" ? o.slug : "";
    const qty = Number(o.qty);
    if (!slug || !Number.isInteger(qty) || qty < 1 || qty > 999) throw new HttpError(400, "Check the quantities in your cart.");
    want.set(slug, (want.get(slug) ?? 0) + qty);
  }
  const lines: { productId: string; name: string; qty: number; price: number; rx: boolean }[] = [];
  for (const [slug, qty] of want) {
    const p = (await sql.execute(
      `SELECT w.product_id, COALESCE(w.title, p.name) AS name, w.allow_order, w.rx_required, p.is_narcotic, COALESCE(w.online_price, ${POS_PRICE_SQL}) AS price
       FROM web_products w JOIN products p ON p.id = w.product_id WHERE w.tenant_id = ? AND w.slug = ? AND w.show_online = 1 AND p.deleted_at IS NULL`,
      [t, t, slug],
    )).rows[0];
    if (!p || Number(p.allow_order) !== 1 || Number(p.is_narcotic) === 1 || p.price == null) throw new HttpError(409, "An item in your cart can no longer be ordered online. Remove it and try again.");
    lines.push({ productId: String(p.product_id), name: String(p.name), qty, price: money(Number(p.price)), rx: Number(p.rx_required) === 1 || rxRequiredForOrders(site.businessType) });
  }
  const subtotal = money(lines.reduce((n, l) => n + l.qty * l.price, 0));
  if (subtotal < st.minOrder) throw new HttpError(400, `The minimum order is Rs ${st.minOrder.toLocaleString("en-PK")}.`);
  const rxRequired = lines.some((l) => l.rx);

  // Private prescription files.
  const files: { name: string; mime: string; data: string; size: number }[] = [];
  const rawFiles = Array.isArray(input.prescriptions) ? input.prescriptions : [];
  if (rawFiles.length > MAX_RX_FILES) throw new HttpError(400, `Attach at most ${MAX_RX_FILES} prescription files.`);
  for (const f of rawFiles) {
    const o = (f ?? {}) as Record<string, unknown>;
    const b64 = typeof o.data === "string" ? o.data.replace(/^data:[^;]+;base64,/, "") : "";
    const buf = Buffer.from(b64, "base64");
    if (!buf.length || buf.length > MAX_RX_BYTES) throw new HttpError(400, "Each prescription file must be under 4 MB.");
    const mime = sniffFile(buf);
    if (!mime) throw new HttpError(400, "Prescriptions must be a photo (JPG, PNG, WebP) or a PDF.");
    files.push({ name: (typeof o.name === "string" ? o.name : "prescription").replace(/[^\w.\- ]/g, "").slice(0, 80) || "prescription", mime, data: buf.toString("base64"), size: buf.length });
  }
  if (rxRequired && !files.length) throw new HttpError(400, "Some items need a prescription. Attach a photo of it.");

  const id = randomUUID();
  const token = randomBytes(24).toString("base64url");
  const t0 = iso(now);
  const hold = iso(new Date(now.getTime() + st.reserveHours * 3600_000));
  const total = money(subtotal + delivery);
  const stmts: { sql: string; args: unknown[] }[] = [
    {
      sql: `INSERT INTO web_orders (id, tenant_id, order_no, public_token, idempotency_key, status, payment_method, payment_status, fulfillment, zone, customer_name, phone, email, address, notes,
              subtotal, delivery_charge, total, rx_required, rx_status, reserved_until, ip, created_at, updated_at)
            SELECT ?, ?, COALESCE(MAX(order_no), 0) + 1, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM web_orders WHERE tenant_id = ?`,
      args: [id, t, token, key, payment, payment === "bank" ? "awaiting_transfer" : "unpaid", fulfillment, zone, name, phone, email || null, address || null, text(input.notes, 500, "notes") || null,
        subtotal, delivery, total, rxRequired ? 1 : 0, rxRequired ? "pending_review" : null, hold, ip, t0, t0, t],
    },
  ];
  // Each line goes in only if enough unreserved stock remains (other open orders count, this one does not yet).
  for (const l of lines) {
    stmts.push({
      sql: `INSERT INTO web_order_items (id, order_id, tenant_id, product_id, name, qty, unit_price, line_total, rx_required)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (${stockSql("?")}) - (${reservedSql("?")}) >= ?`,
      args: [randomUUID(), id, t, l.productId, l.name, l.qty, l.price, money(l.qty * l.price), l.rx ? 1 : 0, t, l.productId, today(), t, l.productId, t0, l.qty],
    });
  }
  // If any line was refused, this fails the CHECK and the whole order rolls back.
  stmts.push({ sql: `INSERT INTO web_guard (x) SELECT 1 WHERE (SELECT COUNT(*) FROM web_order_items WHERE order_id = ?) != ?`, args: [id, lines.length] });
  for (const f of files) stmts.push({ sql: `INSERT INTO web_files (id, tenant_id, order_id, kind, name, mime, size, data, created_at) VALUES (?, ?, ?, 'prescription', ?, ?, ?, ?, ?)`, args: [randomUUID(), t, id, f.name, f.mime, f.size, f.data, t0] });
  stmts.push({ sql: `INSERT INTO web_order_events (id, order_id, tenant_id, actor, action, note, created_at) VALUES (?, ?, ?, 'customer', 'placed', ?, ?)`, args: [randomUUID(), id, t, `${lines.length} item(s), Rs ${total}`, t0] });
  try {
    await sql.batch(stmts);
  } catch (e) {
    const msg = String(e);
    if (/CHECK constraint/i.test(msg)) throw new HttpError(409, "Some items just sold out or have less stock than you asked for. Check your cart and try again.");
    if (/UNIQUE/i.test(msg) && /idempotency|web_orders/i.test(msg)) {
      const again = (await sql.execute(`SELECT public_token, order_no FROM web_orders WHERE tenant_id = ? AND idempotency_key = ?`, [t, key])).rows[0];
      if (again) return { token: String(again.public_token), orderNo: Number(again.order_no), repeated: true };
      throw new HttpError(409, "Another order was placed at the same moment. Try again.");
    }
    throw e;
  }
  const no = Number((await sql.execute(`SELECT order_no FROM web_orders WHERE id = ?`, [id])).rows[0]?.order_no ?? 0);
  return { token, orderNo: no, repeated: false };
}

/** The customer's view of their order (by its unguessable link). */
export async function orderByToken(sql: Sql, tenantId: string, token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const o = (await sql.execute(`SELECT * FROM web_orders WHERE public_token = ? AND tenant_id = ?`, [token, tenantId])).rows[0];
  if (!o) return null;
  const items = (await sql.execute(`SELECT name, qty, unit_price, line_total FROM web_order_items WHERE order_id = ?`, [o.id])).rows;
  return {
    orderNo: Number(o.order_no), status: String(o.status), paymentMethod: String(o.payment_method), paymentStatus: String(o.payment_status), fulfillment: String(o.fulfillment),
    zone: (o.zone as string | null) ?? null, subtotal: Number(o.subtotal), delivery: Number(o.delivery_charge), total: Number(o.total),
    rxStatus: (o.rx_status as string | null) ?? null, createdAt: String(o.created_at), name: String(o.customer_name),
    items: items.map((i) => ({ name: String(i.name), qty: Number(i.qty), price: Number(i.unit_price), total: Number(i.line_total) })),
  };
}

// ── Orders (business side) ────────────────────────────────────────────────

export const ORDER_FLOW: Record<string, string[]> = {
  pending: ["confirmed", "rejected", "cancelled"],
  confirmed: ["preparing", "ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["dispatched", "completed", "cancelled"],
  dispatched: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  rejected: [],
};

export async function listOrders(sql: Sql, tenantId: string, f: { status?: unknown; offset?: unknown }) {
  const st = typeof f.status === "string" && (f.status in ORDER_FLOW || f.status === "open") ? f.status : "open";
  const where = st === "open" ? `status IN ('pending','confirmed','preparing','ready','dispatched')` : `status = ?`;
  const rows = (await sql.execute(
    `SELECT id, order_no, status, payment_method, payment_status, fulfillment, customer_name, phone, total, rx_required, rx_status, reserved_until, invoice_id, created_at
     FROM web_orders WHERE tenant_id = ? AND ${where} ORDER BY created_at DESC LIMIT 100 OFFSET ?`,
    st === "open" ? [tenantId, Math.max(0, Number(f.offset) || 0)] : [tenantId, st, Math.max(0, Number(f.offset) || 0)],
  )).rows;
  const now = iso();
  return rows.map((r) => ({
    id: String(r.id), orderNo: Number(r.order_no), status: String(r.status), paymentMethod: String(r.payment_method), paymentStatus: String(r.payment_status),
    fulfillment: String(r.fulfillment), name: String(r.customer_name), phone: String(r.phone), total: Number(r.total), rxRequired: Number(r.rx_required) === 1,
    rxStatus: (r.rx_status as string | null) ?? null, holdExpired: r.status === "pending" && String(r.reserved_until ?? "") <= now, invoiceId: (r.invoice_id as string | null) ?? null, createdAt: String(r.created_at),
  }));
}

export async function orderDetail(sql: Sql, tenantId: string, id: string) {
  const o = (await sql.execute(`SELECT * FROM web_orders WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!o) throw new HttpError(404, "Order not found.");
  const items = (await sql.execute(`SELECT product_id, name, qty, unit_price, line_total, rx_required FROM web_order_items WHERE order_id = ? AND tenant_id = ?`, [id, tenantId])).rows;
  const events = (await sql.execute(`SELECT actor, action, note, created_at FROM web_order_events WHERE order_id = ? AND tenant_id = ? ORDER BY created_at`, [id, tenantId])).rows;
  const files = (await sql.execute(`SELECT id, name, mime, size FROM web_files WHERE order_id = ? AND tenant_id = ?`, [id, tenantId])).rows;
  return {
    id, orderNo: Number(o.order_no), status: String(o.status), paymentMethod: String(o.payment_method), paymentStatus: String(o.payment_status), fulfillment: String(o.fulfillment),
    zone: (o.zone as string | null) ?? null, name: String(o.customer_name), phone: String(o.phone), email: (o.email as string | null) ?? null, address: (o.address as string | null) ?? null,
    notes: (o.notes as string | null) ?? null, subtotal: Number(o.subtotal), delivery: Number(o.delivery_charge), total: Number(o.total),
    rxRequired: Number(o.rx_required) === 1, rxStatus: (o.rx_status as string | null) ?? null, reservedUntil: (o.reserved_until as string | null) ?? null,
    invoiceId: (o.invoice_id as string | null) ?? null, createdAt: String(o.created_at), next: ORDER_FLOW[String(o.status)] ?? [],
    items: items.map((i) => ({ productId: String(i.product_id), name: String(i.name), qty: Number(i.qty), price: Number(i.unit_price), total: Number(i.line_total), rx: Number(i.rx_required) === 1 })),
    events: events.map((e) => ({ actor: String(e.actor), action: String(e.action), note: (e.note as string | null) ?? null, at: String(e.created_at) })),
    files: files.map((f) => ({ id: String(f.id), name: String(f.name ?? "prescription"), mime: String(f.mime), size: Number(f.size) })),
  };
}

const event = (orderId: string, tenantId: string, actor: string, action: string, note: string | null) => ({
  sql: `INSERT INTO web_order_events (id, order_id, tenant_id, actor, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  args: [randomUUID(), orderId, tenantId, actor, action, note, iso()],
});

/** Moves an order along its flow. Confirming re-checks stock and needs an approved prescription where one is required. */
export async function setOrderStatus(sql: Sql, actor: string, tenantId: string, id: string, next: unknown, note: unknown) {
  const o = (await sql.execute(`SELECT * FROM web_orders WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!o) throw new HttpError(404, "Order not found.");
  const to = String(next);
  if (!(ORDER_FLOW[String(o.status)] ?? []).includes(to)) throw new HttpError(409, `An order that is ${o.status} cannot become ${to}.`);
  const why = typeof note === "string" ? note.trim().slice(0, 300) : "";
  if ((to === "cancelled" || to === "rejected") && why.length < 3) throw new HttpError(400, "Say why, for the record and the customer.");
  if (to === "confirmed") {
    if (Number(o.rx_required) === 1 && o.rx_status !== "approved") throw new HttpError(409, "Approve the prescription first.");
    if (String(o.payment_method) === "bank" && o.payment_status !== "paid") { /* allowed: payment is checked separately before dispatch */ }
    // The hold may have lapsed: check the stock is still there (this order's own hold excluded).
    const items = (await sql.execute(`SELECT product_id, SUM(qty) AS q FROM web_order_items WHERE order_id = ? GROUP BY product_id`, [id])).rows;
    for (const it of items) {
      const own = String(o.reserved_until ?? "") > iso() ? Number(it.q) : 0;
      if ((await available(sql, tenantId, String(it.product_id))) + own < Number(it.q)) throw new HttpError(409, "Not enough stock now for this order. Edit it in the POS or cancel it.");
    }
  }
  if ((to === "dispatched" || to === "completed") && String(o.payment_method) === "bank" && o.payment_status !== "paid") throw new HttpError(409, "Confirm the bank transfer first.");
  if (to === "completed" && !o.invoice_id) throw new HttpError(409, "Bill the order in the POS first (Create invoice), so stock and accounts are updated.");
  const claimed = await sql.execute(`UPDATE web_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = ?`, [to, iso(), id, tenantId, o.status]);
  if (!claimed.rowsAffected) throw new HttpError(409, "The order was just changed by someone else. Reload it.");
  await sql.batch([event(id, tenantId, actor, to, why || null)]);
  await audit(sql, tenantId, actor, "order_status", { id, from: o.status, to });
}

/** Payment kept separate from fulfilment: bank transfers stay pending until staff confirm them. */
export async function setPaymentStatus(sql: Sql, actor: string, tenantId: string, id: string, status: unknown, note: unknown) {
  const allowed = ["unpaid", "awaiting_transfer", "paid", "refunded"];
  if (!allowed.includes(String(status))) throw new HttpError(400, "Unknown payment status.");
  const r = await sql.execute(`UPDATE web_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [status, iso(), id, tenantId]);
  if (!r.rowsAffected) throw new HttpError(404, "Order not found.");
  await sql.batch([event(id, tenantId, actor, `payment_${status}`, typeof note === "string" ? note.slice(0, 300) || null : null)]);
  await audit(sql, tenantId, actor, "order_payment", { id, status });
}

/** Prescription review: approve, reject (the order is rejected too) or ask the customer to clarify. */
export async function reviewPrescription(sql: Sql, actor: string, tenantId: string, id: string, decision: unknown, note: unknown) {
  const d = String(decision);
  if (!["approved", "rejected", "clarification"].includes(d)) throw new HttpError(400, "Approve, reject or ask for clarification.");
  const why = typeof note === "string" ? note.trim().slice(0, 300) : "";
  if (d !== "approved" && why.length < 3) throw new HttpError(400, "Write what is wrong or what you need.");
  const o = (await sql.execute(`SELECT status, rx_required FROM web_orders WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!o) throw new HttpError(404, "Order not found.");
  if (Number(o.rx_required) !== 1) throw new HttpError(400, "This order has no prescription items.");
  if (!["pending", "confirmed"].includes(String(o.status))) throw new HttpError(409, "The order is past review.");
  await sql.batch([
    { sql: `UPDATE web_orders SET rx_status = ?, status = CASE WHEN ? = 'rejected' THEN 'rejected' ELSE status END, updated_at = ? WHERE id = ? AND tenant_id = ?`, args: [d, d, iso(), id, tenantId] },
    event(id, tenantId, actor, `prescription_${d}`, why || null),
  ]);
  await audit(sql, tenantId, actor, "prescription_review", { id, decision: d });
}

/** A private prescription file, for staff of the same business only (the route checks the login). */
export async function prescriptionFile(sql: Sql, tenantId: string, fileId: string) {
  const f = (await sql.execute(`SELECT name, mime, data FROM web_files WHERE id = ? AND tenant_id = ? AND kind = 'prescription'`, [fileId, tenantId])).rows[0];
  if (!f) throw new HttpError(404, "File not found.");
  return { name: String(f.name ?? "prescription"), mime: String(f.mime), data: Buffer.from(String(f.data), "base64") };
}

/** What the POS invoice screen needs to bill the order. */
export async function orderForInvoice(sql: Sql, tenantId: string, id: string) {
  const o = (await sql.execute(`SELECT status, invoice_id, customer_name, phone, notes, order_no, delivery_charge FROM web_orders WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!o) throw new HttpError(404, "Order not found.");
  if (o.invoice_id) throw new HttpError(409, "This order has already been billed.");
  if (!["confirmed", "preparing", "ready", "dispatched"].includes(String(o.status))) throw new HttpError(409, "Confirm the order before billing it.");
  const items = (await sql.execute(`SELECT product_id, name, qty, unit_price FROM web_order_items WHERE order_id = ? AND tenant_id = ?`, [id, tenantId])).rows;
  return {
    orderNo: Number(o.order_no), customerName: String(o.customer_name), phone: String(o.phone), notes: (o.notes as string | null) ?? null, delivery: Number(o.delivery_charge),
    items: items.map((i) => ({ productId: String(i.product_id), name: String(i.name), qty: Number(i.qty), price: Number(i.unit_price) })),
  };
}

/** Links the saved POS invoice to the order, once: stock was deducted by the invoice, so the hold ends. */
export async function linkInvoice(sql: Sql, actor: string, tenantId: string, id: string, invoiceId: unknown) {
  if (typeof invoiceId !== "string" || !invoiceId) throw new HttpError(400, "Missing invoice.");
  const inv = (await sql.execute(`SELECT id FROM invoices WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [invoiceId, tenantId])).rows[0];
  if (!inv) throw new HttpError(404, "Invoice not found in this business.");
  const r = await sql.execute(`UPDATE web_orders SET invoice_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND invoice_id IS NULL`, [invoiceId, iso(), id, tenantId]);
  if (!r.rowsAffected) throw new HttpError(409, "This order was already billed.");
  await sql.batch([event(id, tenantId, actor, "invoiced", invoiceId)]);
  await audit(sql, tenantId, actor, "order_invoiced", { id, invoiceId });
}

// ── Requests (contact, appointment, quotation) ────────────────────────────

export async function submitRequest(sql: Sql, site: Site, input: Record<string, unknown>, ip: string | null) {
  if (site.publicSuspended || !site.tenantActive || !site.websiteEnabled) throw new HttpError(403, "This website is not taking requests right now.");
  if (rateLimited(`req:${site.tenantId}:${ip ?? "?"}`, 8, 3600_000)) throw new HttpError(429, "Too many requests from this connection. Try again later.");
  if (typeof input.website === "string" && input.website) return { ok: true }; // honeypot: bots fill the hidden field
  const kind = ["contact", "appointment", "quotation"].includes(String(input.kind)) ? String(input.kind) : "contact";
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = text(input.name, 80);
  const phone = text(input.phone, 20).replace(/[\s-]/g, "");
  const email = text(input.email, 120);
  const message = text(input.message, 2000);
  if (name.length < 2) throw new HttpError(400, "Enter your name.");
  if (!phone && !email) throw new HttpError(400, "Enter a phone number or an email so we can reply.");
  if (phone && !/^\+?\d{10,15}$/.test(phone)) throw new HttpError(400, "Enter a valid phone number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "Enter a valid email.");
  const data = { preferredDate: text(input.preferredDate, 20), doctor: text(input.doctor, 80), items: text(input.items, 1000) };
  await sql.execute(`INSERT INTO web_requests (id, tenant_id, kind, name, phone, email, message, data, status, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    [randomUUID(), site.tenantId, kind, name, phone || null, email || null, message || null, JSON.stringify(data), ip, iso()]);
  return { ok: true };
}

export async function listRequests(sql: Sql, tenantId: string) {
  return (await sql.execute(`SELECT id, kind, name, phone, email, message, data, status, created_at FROM web_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`, [tenantId])).rows
    .map((r) => ({ id: String(r.id), kind: String(r.kind), name: String(r.name), phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, message: (r.message as string | null) ?? null, data: json<Record<string, string>>(r.data, {}), status: String(r.status), createdAt: String(r.created_at) }));
}

export async function setRequestStatus(sql: Sql, tenantId: string, id: string, status: unknown) {
  if (!["new", "handled", "spam"].includes(String(status))) throw new HttpError(400, "Unknown status.");
  const r = await sql.execute(`UPDATE web_requests SET status = ? WHERE id = ? AND tenant_id = ?`, [status, id, tenantId]);
  if (!r.rowsAffected) throw new HttpError(404, "Request not found.");
}
