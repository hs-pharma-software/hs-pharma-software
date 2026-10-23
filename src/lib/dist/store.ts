/**
 * Wholesaler / Distributor data layer (Pharma or General mode per tenant).
 *
 * Same guarantees as the restaurant and electric modules: the tenant comes
 * from the session (never from caller data), every id is checked for
 * ownership, every permission is enforced HERE (screens only hide buttons),
 * prices / taxes / totals are computed here from stored data, and steps are
 * ordered with conditional updates (the Tauri SQL plugin uses a pool, so
 * there are no multi-statement transactions).
 *
 * Location freshness is judged on the DATABASE clock (`dbNow()`), which on
 * the web/mobile build is the Turso server's clock, never on a time sent by
 * the device. Bookings take the salesman's location from the stored points,
 * never from coordinates in the booking request.
 *
 * Relative imports only (runs under `node --test`).
 */
import type { RestDb as DistDb, RestContext as DistContext } from "../restaurant/store.ts";
import {
  ADMIN_ONLY,
  BOOKING_FLOW,
  CUSTOMER_FIELDS,
  DIST_PERMS,
  type AdminAction,
  type AtlStatus,
  type BookingStatus,
  type DistMode,
  type DistPerm,
  type DistSettings,
  calcDoc,
  canMove,
  cdslState,
  distanceKm,
  liveState,
  mergeSettings,
  normalizeCnic,
  normalizeMobile,
  normalizeNtn,
  targetProgress,
  toPaisa,
  toRupees,
  validCoords,
  whtAmount,
  whtTreatment,
} from "./engine.ts";

export type { DistDb, DistContext };
export const DIST_TYPE = "distributor";

export class DistError extends Error {
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT" | "SETUP";
  constructor(code: DistError["code"], message: string) {
    super(message);
    this.name = "DistError";
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
export interface DistCompany extends Base {
  code: string;
  name: string;
  logo: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  representative: string | null;
  supplier_id: string | null;
  is_active: number;
  sort_order: number;
}
export interface DistCategory extends Base {
  name: string;
  sort_order: number;
  is_active: number;
}
export interface DistProduct extends Base {
  company_id: string;
  category_id: string | null;
  code: string;
  barcode: string | null;
  name: string;
  unit: string;
  pack_size: number;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  drap_reg_no: string | null;
  brand: string | null;
  size: string | null;
  trade_price: number;
  retail_price: number | null;
  cost: number;
  avg_cost: number;
  min_price: number | null;
  sales_tax_rate: number;
  stock: number;
  reorder_level: number;
  is_active: number;
}
export interface DistCustomer extends Base {
  code: string;
  business_name: string;
  owner_name: string | null;
  ntn: string | null;
  cnic: string | null;
  mobile: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  territory: string | null;
  salesman_id: string | null;
  tax_class: string;
  status: "active" | "inactive";
  lat: number | null;
  lng: number | null;
  location_accuracy: number | null;
  located_at: string | null;
  location_source: string | null;
  located_by: string | null;
  cdsl_no: string | null;
  cdsl_expiry: string | null;
  cdsl_status: string | null;
  cdsl_verified_at: string | null;
  cdsl_verified_by: string | null;
  atl_status: AtlStatus;
  atl_checked_at: string | null;
  atl_source: string | null;
  atl_check_id: string | null;
  credit_limit: number | null;
  opening_balance: number;
  notes: string | null;
  created_by: string | null;
}
export interface DistSalesman extends Base {
  user_id: string | null;
  code: string;
  name: string;
  mobile: string | null;
  territory: string | null;
  company_ids: string | null;
  monthly_target: number;
  employment: string | null;
  is_active: number;
}
export interface DistBooking extends Base {
  booking_no: number;
  client_ref: string | null;
  salesman_id: string | null;
  customer_id: string;
  company_id: string | null;
  status: BookingStatus;
  date: string;
  gross: number;
  discount: number;
  sales_tax: number;
  total: number;
  notes: string | null;
  loc_point_id: string | null;
  loc_lat: number | null;
  loc_lng: number | null;
  loc_accuracy: number | null;
  loc_recorded_at: string | null;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  invoice_id: string | null;
  created_by: string | null;
}
export interface DistBookingItem extends Base {
  booking_id: string;
  product_id: string;
  code: string | null;
  name: string;
  unit: string | null;
  qty: number;
  price: number;
  discount: number;
  sales_tax_rate: number;
  sales_tax: number;
  line_total: number;
}
export type DistDocType = "sale" | "sale_return" | "purchase" | "purchase_return";
export interface DistDoc extends Base {
  doc_type: DistDocType;
  doc_no: number;
  date: string;
  party_type: "customer" | "supplier";
  party_id: string;
  party_name: string | null;
  party_ntn: string | null;
  party_cnic: string | null;
  party_address: string | null;
  salesman_id: string | null;
  booking_id: string | null;
  ref_doc_id: string | null;
  supplier_invoice_no: string | null;
  description: string | null;
  gross: number;
  discount: number;
  sales_tax: number;
  wht_section: string | null;
  wht_status: string | null;
  wht_rate: number;
  wht_base: number;
  wht_amount: number;
  wht_overridden: number;
  tax_snapshot: string | null;
  total: number;
  paid: number;
  balance: number;
  cost_total: number;
  status: string;
  created_by: string | null;
}
export interface DistDocItem extends Base {
  doc_id: string;
  product_id: string;
  ref_item_id: string | null;
  code: string | null;
  name: string;
  unit: string | null;
  company_id: string | null;
  category_id: string | null;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  price: number;
  discount: number;
  sales_tax_rate: number;
  sales_tax: number;
  line_total: number;
  cost: number;
  returned_qty: number;
}

export interface LineIn {
  productId: string;
  qty: number;
  /** Price per unit; defaults to the product's trade price (changing it needs permission). */
  price?: number | null;
  discount?: number;
  batchNo?: string | null;
  expiry?: string | null;
}
export interface PurchaseLineIn {
  productId: string;
  qty: number;
  cost: number;
  discount?: number;
  taxRate?: number;
  batchNo?: string | null;
  expiry?: string | null;
}
export interface PaymentIn {
  method: "cash" | "bank" | "cheque" | "digital";
  amount: number;
  reference?: string | null;
}

/** Optional authoritative ATL lookup. None ships with the app: FBR publishes
 * no API for the Active Taxpayers List (only the e.fbr.gov.pk portal and SMS
 * 9966), so status is recorded manually unless an adapter is configured. */
export interface AtlVerifier {
  name: string;
  check(identifier: string): Promise<{ status: "active" | "inactive"; reference?: string }>;
}

const DEFAULT_CATEGORIES: Record<DistMode, string[]> = {
  pharma: ["Tablets", "Capsules", "Syrups", "Injections", "Drops", "Creams & Ointments", "Medical Supplies", "Surgical Items", "Nutraceuticals"],
  general: ["Grocery", "Beverages", "Household Products", "Personal Care", "Food Products", "Confectionery", "Baby Care", "Stationery"],
};

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const json = <T>(v: string | null | undefined, fallback: T): T => {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const trimOrNull = (v: unknown) => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};

export function createDistStore(db: DistDb, context: () => DistContext) {
  // ── Session, permissions ────────────────────────────────────────────
  function tenant(): string {
    const c = context();
    if (!c.tenantId) throw new DistError("UNAUTHENTICATED", "Sign in to a distributor account first.");
    if (c.businessType !== DIST_TYPE) throw new DistError("FORBIDDEN", "This account is not a Wholesaler / Distributor.");
    return c.tenantId;
  }
  /** The distributor administrator is the tenant's owner login. */
  const isAdmin = () => {
    tenant();
    return context().role === "owner";
  };
  async function permsOf(userId: string | null) {
    if (!userId) return { perms: [] as string[], fields: [] as string[] };
    const r = await db.select<{ perms: string; editable_customer_fields: string | null }>(`SELECT perms, editable_customer_fields FROM dist_user_perms WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`, [tenant(), userId]);
    return { perms: json<string[]>(r[0]?.perms, []), fields: json<string[]>(r[0]?.editable_customer_fields, []) };
  }
  async function can(p: DistPerm): Promise<boolean> {
    if (isAdmin()) return true;
    return (await permsOf(context().userId)).perms.includes(p);
  }
  async function need(p: DistPerm) {
    if (!(await can(p))) throw new DistError("FORBIDDEN", `You don't have permission for this (${p}).`);
  }
  function needAdmin(action: AdminAction) {
    if (!isAdmin()) throw new DistError("FORBIDDEN", `Only the distributor administrator can do this (${action}).`);
  }

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
    if (changes > 0) await syncRow(table, id);
    return changes;
  }
  async function syncRow(table: string, id: string) {
    const row = await db.select(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [id, tenant()]);
    if (row[0]) await db.outbox(table, id, "update", row[0]);
  }
  async function owned<T>(table: string, id: string | null | undefined, label: string, includeDeleted = false): Promise<T> {
    if (!id) throw new DistError("INVALID", `${label} is required.`);
    const rows = await db.select<T>(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`, [id, tenant()]);
    if (!rows[0]) throw new DistError("NOT_FOUND", `${label} not found.`);
    return rows[0];
  }
  async function audit(action: string, recordType: string, recordId: string | null, f: { field?: string; old?: unknown; next?: unknown; reason?: string | null; detail?: unknown } = {}) {
    const c = context();
    const s = (v: unknown) => (v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
    await insert("dist_audit", {
      user_id: c.userId,
      user_name: c.userName,
      action,
      record_type: recordType,
      record_id: recordId,
      field: f.field ?? null,
      old_value: s(f.old),
      new_value: s(f.next),
      reason: f.reason ?? null,
      detail: s(f.detail),
    } as never);
  }
  /** Database clock (Turso server time on the web/mobile build). */
  async function dbNow(): Promise<string> {
    const r = await db.select<{ t: string }>(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS t`);
    return r[0].t;
  }
  const today = () => ymd(db.now());

  // ── Configuration ───────────────────────────────────────────────────
  async function config() {
    const r = await db.select<{ id: string; mode: DistMode; settings: string | null }>(`SELECT id, mode, settings FROM dist_config WHERE tenant_id = ? AND deleted_at IS NULL`, [tenant()]);
    return r[0] ? { id: r[0].id, mode: r[0].mode, settings: mergeSettings(json(r[0].settings, {})) } : null;
  }
  async function cfg() {
    const c = await config();
    if (!c) throw new DistError("SETUP", "The distributor administrator must first choose Pharma Distributor or General Distributor (Distributor Settings).");
    return c;
  }

  /** Salesman profile of the signed-in user, if any. */
  async function mySalesman(): Promise<DistSalesman | null> {
    const uid = context().userId;
    if (!uid) return null;
    const r = await db.select<DistSalesman>(`SELECT * FROM dist_salesmen WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`, [tenant(), uid]);
    return r[0] ?? null;
  }

  async function nextNo(table: string, col: string, where = "", params: unknown[] = []) {
    const r = await db.select<{ n: number | null }>(`SELECT MAX(${col}) AS n FROM ${table} WHERE tenant_id = ? ${where}`, [tenant(), ...params]);
    return (Number(r[0]?.n) || 0) + 1;
  }
  async function insertNumbered<T extends Base>(table: string, col: string, data: Partial<T>, where = "", params: unknown[] = []): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await insert<T>(table, { ...data, [col]: await nextNo(table, col, where, params) } as never);
      } catch (e) {
        if (/UNIQUE/i.test(String(e)) && /_no|doc_no|booking_no/.test(String(e) + col)) continue;
        throw e;
      }
    }
    throw new DistError("CONFLICT", "Could not number the document, try again.");
  }

  async function claimStock(productId: string, qty: number, allowNegative: boolean) {
    const { changes } = await db.execute(
      `UPDATE dist_products SET stock = ROUND(stock - ?, 3), updated_at = ? WHERE id = ? AND tenant_id = ? AND (? = 1 OR ROUND(stock - ?, 3) >= 0)`,
      [qty, iso(db.now()), productId, tenant(), allowNegative ? 1 : 0, qty]
    );
    if (changes) await syncRow("dist_products", productId);
    return changes > 0;
  }
  async function addStock(productId: string, qty: number) {
    await db.execute(`UPDATE dist_products SET stock = ROUND(stock + ?, 3), updated_at = ? WHERE id = ? AND tenant_id = ?`, [qty, iso(db.now()), productId, tenant()]);
    await syncRow("dist_products", productId);
  }
  async function stockMove(productId: string, qty: number, reason: string, docId: string | null, itemId: string | null, unitCost: number | null, note?: string) {
    await insert("dist_stock_moves", { product_id: productId, qty, reason, doc_id: docId, doc_item_id: itemId, unit_cost: unitCost, note: note ?? null, created_by: context().userName } as never);
  }

  /** Customer the current user may act on (salesmen: assigned or their own). */
  async function customerFor(id: string, opts: { forBooking?: boolean } = {}): Promise<DistCustomer> {
    const c = await owned<DistCustomer>("dist_customers", id, "Customer");
    if (!isAdmin() && !(await can("bookings.view_all"))) {
      const me = await mySalesman();
      if (me && c.salesman_id && c.salesman_id !== me.id && c.created_by !== context().userId) throw new DistError("FORBIDDEN", "This customer is assigned to another salesman.");
    }
    if (opts.forBooking && c.status !== "active") throw new DistError("CONFLICT", `${c.business_name} is inactive.`);
    return c;
  }

  async function assertCdsl(c: DistCustomer, settings: DistSettings, mode: DistMode) {
    if (mode !== "pharma") return;
    const st = cdslState(c.cdsl_no, c.cdsl_expiry, today(), settings.cdsl.alertDays);
    if (settings.cdsl.blockSaleWhenExpired && (st === "expired" || (settings.cdsl.required && st === "missing")))
      throw new DistError("CONFLICT", `${c.business_name}: CDSL ${st === "missing" ? "number / expiry missing" : `expired on ${c.cdsl_expiry}`}. Update the licence before selling.`);
  }

  /** Prices lines from stored products, enforcing price / discount permissions. */
  async function priceLines(lines: LineIn[], opts: { companyId?: string | null; salesman?: DistSalesman | null }) {
    if (!lines?.length) throw new DistError("INVALID", "Add at least one product.");
    const allowed = opts.salesman ? json<string[]>(opts.salesman.company_ids, []) : [];
    const prepared: { p: DistProduct; qty: number; price: number; discount: number; batchNo: string | null; expiry: string | null }[] = [];
    for (const l of lines) {
      const p = await owned<DistProduct>("dist_products", l.productId, "Product");
      if (!p.is_active) throw new DistError("CONFLICT", `${p.name} is inactive.`);
      if (opts.companyId && p.company_id !== opts.companyId) throw new DistError("INVALID", `${p.name} is not a product of the selected company.`);
      if (allowed.length && !allowed.includes(p.company_id)) throw new DistError("FORBIDDEN", `${p.name}: its company is not assigned to you.`);
      const qty = Math.round(Number(l.qty) * 1000) / 1000;
      if (!(qty > 0)) throw new DistError("INVALID", `Enter a quantity for ${p.name}.`);
      const price = l.price == null || String(l.price) === "" ? p.trade_price : Number(l.price);
      if (!Number.isFinite(price) || price < 0) throw new DistError("INVALID", `Invalid price for ${p.name}.`);
      if (toPaisa(price) !== toPaisa(p.trade_price)) await need("invoices.edit_price");
      if (p.min_price != null && price < p.min_price && !isAdmin()) throw new DistError("FORBIDDEN", `${p.name} can't be sold below Rs ${p.min_price}.`);
      const discount = Math.max(0, Number(l.discount) || 0);
      if (discount > 0) await need("invoices.discount");
      prepared.push({ p, qty, price, discount, batchNo: trimOrNull(l.batchNo), expiry: trimOrNull(l.expiry) });
    }
    return prepared;
  }

  // ── Location helpers ────────────────────────────────────────────────
  async function activeSession(salesmanId: string) {
    const r = await db.select<{ id: string; status: string; started_at: string; last_point_at: string | null }>(
      `SELECT id, status, started_at, last_point_at FROM dist_loc_sessions WHERE tenant_id = ? AND salesman_id = ? AND status = 'active' AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      [tenant(), salesmanId]
    );
    return r[0] ?? null;
  }
  async function lastPoint(salesmanId: string) {
    const r = await db.select<{ id: string; session_id: string; lat: number; lng: number; accuracy: number | null; recorded_at: string; flag: string | null }>(
      `SELECT id, session_id, lat, lng, accuracy, recorded_at, flag FROM dist_loc_points WHERE tenant_id = ? AND salesman_id = ? AND deleted_at IS NULL ORDER BY recorded_at DESC LIMIT 1`,
      [tenant(), salesmanId]
    );
    return r[0] ?? null;
  }
  /** Throws unless the salesman shares location now with a fresh, accurate point. */
  async function requireFreshLocation(salesmanId: string, settings: DistSettings) {
    const session = await activeSession(salesmanId);
    if (!session) throw new DistError("CONFLICT", "Location sharing is off. Start location sharing before submitting a booking.");
    const p = await lastPoint(salesmanId);
    if (!p || p.session_id !== session.id) throw new DistError("CONFLICT", "No location received yet in this sharing session. Wait for a location fix and try again.");
    const now = await dbNow();
    const age = (new Date(now).getTime() - new Date(p.recorded_at).getTime()) / 1000;
    if (age > settings.location.maxAgeSeconds) throw new DistError("CONFLICT", `Your last location is ${Math.round(age)} s old (limit ${settings.location.maxAgeSeconds} s). Wait for a fresh location fix.`);
    if (p.accuracy == null || p.accuracy > settings.location.maxAccuracyMeters)
      throw new DistError("CONFLICT", `Location accuracy is ${p.accuracy == null ? "unknown" : `${Math.round(p.accuracy)} m`} (limit ${settings.location.maxAccuracyMeters} m). Move to open sky or enable precise location.`);
    if (p.flag) throw new DistError("CONFLICT", `Your last location was rejected (${p.flag}). Wait for a new fix.`);
    return p;
  }

  async function bookingEvent(bookingId: string, from: string | null, to: string, note?: string | null) {
    const c = context();
    await insert("dist_booking_events", { booking_id: bookingId, from_status: from, to_status: to, user_id: c.userId, user_name: c.userName, note: note ?? null } as never);
  }
  async function moveBooking(b: DistBooking, to: BookingStatus, patch: Record<string, unknown> = {}, note?: string | null) {
    if (!canMove(b.status, to)) throw new DistError("CONFLICT", `A ${b.status.replace("_", " ")} booking can't become ${to.replace("_", " ")}.`);
    const n = await update("dist_bookings", b.id, { ...patch, status: to }, { sql: "status = ?", params: [b.status] });
    if (!n) throw new DistError("CONFLICT", "The booking was just changed by someone else; reload it.");
    await bookingEvent(b.id, b.status, to, note);
  }

  async function docWithItems(id: string) {
    const doc = await owned<DistDoc>("dist_docs", id, "Document");
    const items = await db.select<DistDocItem>(`SELECT * FROM dist_doc_items WHERE tenant_id = ? AND doc_id = ? AND deleted_at IS NULL ORDER BY created_at, id`, [tenant(), id]);
    return { doc, items };
  }

  const api = {
    tenant,
    isAdmin,
    can,
    dbNow,

    // ── Configuration & permissions ──
    config,
    /** First-time choice of mode by the administrator. Changing it later is
     * refused once products or customers exist (catalogs would not fit). */
    async setup(mode: DistMode) {
      needAdmin("settings.manage");
      if (mode !== "pharma" && mode !== "general") throw new DistError("INVALID", "Choose Pharma Distributor or General Distributor.");
      const cur = await config();
      if (cur) {
        if (cur.mode === mode) return cur;
        const used = await db.select<{ n: number }>(`SELECT (SELECT COUNT(*) FROM dist_products WHERE tenant_id = ?) + (SELECT COUNT(*) FROM dist_customers WHERE tenant_id = ?) AS n`, [tenant(), tenant()]);
        if (used[0].n > 0) throw new DistError("CONFLICT", "The distributor type can't change after products or customers were added.");
        await update("dist_config", cur.id, { mode });
      } else await insert("dist_config", { mode, settings: JSON.stringify({}) } as never);
      await audit("config.mode", "config", null, { old: cur?.mode ?? null, next: mode });
      return cfg();
    },
    async saveSettings(next: DistSettings, reason?: string) {
      needAdmin("settings.manage");
      const cur = await cfg();
      const merged = mergeSettings(next);
      for (const r of Object.values(merged.wht.classes)) if (!(r.activeRate >= 0 && r.activeRate <= 100 && r.inactiveRate >= 0 && r.inactiveRate <= 100)) throw new DistError("INVALID", "Tax rates must be between 0 and 100 %.");
      if (!(merged.location.maxAgeSeconds >= 10) || !(merged.location.maxAccuracyMeters >= 5)) throw new DistError("INVALID", "Location freshness must be at least 10 s and accuracy at least 5 m.");
      await update("dist_config", cur.id, { settings: JSON.stringify(merged) });
      await audit("config.settings", "config", cur.id, { old: cur.settings, next: merged, reason: reason ?? null });
      return merged;
    },
    async listUsers() {
      await need("salesmen.view").catch(() => needAdmin("permissions.manage"));
      return db.select<{ id: string; username: string; display_name: string | null; role: string; is_active: number }>(
        `SELECT id, username, display_name, role, is_active FROM users WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY role, display_name`,
        [tenant()]
      );
    },
    async getPerms(userId: string) {
      if (userId !== context().userId) needAdmin("permissions.manage");
      return permsOf(userId);
    },
    async myPerms() {
      return isAdmin() ? { perms: [...DIST_PERMS] as string[], fields: [...CUSTOMER_FIELDS] as string[], admin: true } : { ...(await permsOf(context().userId)), admin: false };
    },
    /** Only the administrator grants permissions; admin-only actions can't be granted. */
    async setPerms(userId: string, perms: string[], editableCustomerFields: string[] = []) {
      needAdmin("permissions.manage");
      const u = await db.select<{ id: string; role: string }>(`SELECT id, role FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [userId, tenant()]);
      if (!u[0]) throw new DistError("NOT_FOUND", "User not found in this business.");
      if (u[0].role !== "staff") throw new DistError("INVALID", "Only sub-user (staff) logins get a permission set; the administrator has all permissions.");
      const bad = perms.filter((p) => !(DIST_PERMS as readonly string[]).includes(p));
      if (bad.length) throw new DistError("INVALID", `Not grantable: ${bad.join(", ")}${bad.some((b) => (ADMIN_ONLY as readonly string[]).includes(b)) ? " (administrator only)" : ""}.`);
      const fields = editableCustomerFields.filter((f) => (CUSTOMER_FIELDS as readonly string[]).includes(f));
      const before = await permsOf(userId);
      const cur = await db.select<{ id: string }>(`SELECT id FROM dist_user_perms WHERE tenant_id = ? AND user_id = ?`, [tenant(), userId]);
      const data = { perms: JSON.stringify([...new Set(perms)]), editable_customer_fields: JSON.stringify(fields), updated_by: context().userId };
      if (cur[0]) await update("dist_user_perms", cur[0].id, { ...data, deleted_at: null });
      else await insert("dist_user_perms", { user_id: userId, ...data } as never);
      await audit("permissions.set", "user", userId, { old: before, next: { perms, fields } });
    },

    // ── Companies ──
    async listCompanies(opts: { search?: string; includeInactive?: boolean } = {}) {
      await need("catalog.view");
      const q = opts.search?.trim() ? `%${opts.search.trim().toUpperCase()}%` : null;
      return db.select<DistCompany & { products: number }>(
        `SELECT c.*, (SELECT COUNT(*) FROM dist_products p WHERE p.tenant_id = c.tenant_id AND p.company_id = c.id AND p.deleted_at IS NULL) AS products
         FROM dist_companies c WHERE c.tenant_id = ? AND c.deleted_at IS NULL ${opts.includeInactive ? "" : "AND c.is_active = 1"} ${q ? "AND (UPPER(c.name) LIKE ? OR UPPER(c.code) LIKE ?)" : ""}
         ORDER BY c.sort_order, c.name`,
        q ? [tenant(), q, q] : [tenant()]
      );
    },
    async getCompany(id: string) {
      await need("catalog.view");
      return owned<DistCompany>("dist_companies", id, "Company");
    },
    async saveCompany(input: Partial<DistCompany>) {
      await need("companies.manage");
      const name = trimOrNull(input.name);
      const code = trimOrNull(input.code)?.toUpperCase();
      if (!name || !code) throw new DistError("INVALID", "Company name and code are required.");
      if (input.supplier_id) await owned("suppliers", input.supplier_id, "Supplier");
      const dup = await db.select(`SELECT id FROM dist_companies WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL AND id <> ?`, [tenant(), code, input.id ?? ""]);
      if (dup.length) throw new DistError("CONFLICT", `Company code ${code} is already used.`);
      const data = {
        code, name,
        logo: trimOrNull(input.logo), contact_person: trimOrNull(input.contact_person), phone: trimOrNull(input.phone), email: trimOrNull(input.email),
        address: trimOrNull(input.address), description: trimOrNull(input.description), representative: trimOrNull(input.representative),
        supplier_id: input.supplier_id || null, is_active: input.is_active === 0 ? 0 : 1, sort_order: Number(input.sort_order) || 0,
      };
      if (input.id) {
        await owned("dist_companies", input.id, "Company");
        await update("dist_companies", input.id, data);
        await audit("company.update", "company", input.id, { next: data });
        return owned<DistCompany>("dist_companies", input.id, "Company");
      }
      const row = await insert<DistCompany>("dist_companies", data as never);
      await audit("company.create", "company", row.id, { next: data });
      return row;
    },

    // ── Categories ──
    async listCategories(includeInactive = false) {
      await need("catalog.view");
      return db.select<DistCategory>(`SELECT * FROM dist_categories WHERE tenant_id = ? AND deleted_at IS NULL ${includeInactive ? "" : "AND is_active = 1"} ORDER BY sort_order, name`, [tenant()]);
    },
    async seedCategories() {
      await need("catalog.manage");
      const { mode } = await cfg();
      const have = new Set((await api.listCategories(true)).map((c) => c.name.toLowerCase()));
      let order = have.size;
      let added = 0;
      for (const name of DEFAULT_CATEGORIES[mode]) {
        if (have.has(name.toLowerCase())) continue;
        await insert("dist_categories", { name, sort_order: order++, is_active: 1 } as never);
        added++;
      }
      return added;
    },
    async saveCategory(input: Partial<DistCategory>) {
      await need("catalog.manage");
      const name = trimOrNull(input.name);
      if (!name) throw new DistError("INVALID", "Category name is required.");
      const data = { name, sort_order: Number(input.sort_order) || 0, is_active: input.is_active === 0 ? 0 : 1 };
      if (input.id) {
        await owned("dist_categories", input.id, "Category");
        await update("dist_categories", input.id, data);
        return owned<DistCategory>("dist_categories", input.id, "Category");
      }
      return insert<DistCategory>("dist_categories", data as never);
    },
    async reorderCategories(ids: string[]) {
      await need("catalog.manage");
      for (const [i, id] of ids.entries()) {
        await owned("dist_categories", id, "Category");
        await update("dist_categories", id, { sort_order: i });
      }
    },

    // ── Products ──
    async listProducts(opts: { search?: string; companyId?: string | null; categoryId?: string | null; includeInactive?: boolean } = {}) {
      await need("catalog.view");
      const where = ["p.tenant_id = ?", "p.deleted_at IS NULL"];
      const params: unknown[] = [tenant()];
      if (!opts.includeInactive) where.push("p.is_active = 1");
      if (opts.companyId) {
        await owned("dist_companies", opts.companyId, "Company");
        where.push("p.company_id = ?");
        params.push(opts.companyId);
      }
      if (opts.categoryId) {
        where.push("p.category_id = ?");
        params.push(opts.categoryId);
      }
      if (opts.search?.trim()) {
        const q = `%${opts.search.trim().toUpperCase()}%`;
        where.push("(UPPER(p.name) LIKE ? OR UPPER(p.code) LIKE ? OR UPPER(COALESCE(p.barcode, '')) LIKE ? OR UPPER(COALESCE(p.generic_name, '')) LIKE ? OR UPPER(COALESCE(p.brand, '')) LIKE ?)");
        params.push(q, q, q, q, q);
      }
      const canCost = isAdmin() || (await can("purchases.view"));
      const rows = await db.select<DistProduct & { company_name: string; category_name: string | null }>(
        `SELECT p.*, c.name AS company_name, k.name AS category_name FROM dist_products p
         JOIN dist_companies c ON c.id = p.company_id AND c.tenant_id = p.tenant_id
         LEFT JOIN dist_categories k ON k.id = p.category_id AND k.tenant_id = p.tenant_id
         WHERE ${where.join(" AND ")} ORDER BY c.name, p.name LIMIT 2000`,
        params
      );
      // Purchase cost is only shown to users who may see purchases.
      return canCost ? rows : rows.map((r) => ({ ...r, cost: 0, avg_cost: 0 }));
    },
    async findProduct(code: string) {
      await need("catalog.view");
      const c = code.trim().toUpperCase();
      if (!c) return null;
      const r = await db.select<DistProduct>(`SELECT * FROM dist_products WHERE tenant_id = ? AND deleted_at IS NULL AND (UPPER(code) = ? OR UPPER(COALESCE(barcode, '')) = ?) LIMIT 1`, [tenant(), c, c]);
      return r[0] ?? null;
    },
    async getProduct(id: string) {
      await need("catalog.view");
      return owned<DistProduct>("dist_products", id, "Product");
    },
    async saveProduct(input: Partial<DistProduct> & { openingQty?: number }) {
      await need("catalog.manage");
      const { mode } = await cfg();
      const name = trimOrNull(input.name);
      const code = trimOrNull(input.code)?.toUpperCase();
      if (!name || !code) throw new DistError("INVALID", "Product name and code are required.");
      await owned("dist_companies", input.company_id, "Company");
      if (input.category_id) await owned("dist_categories", input.category_id, "Category");
      const dup = await db.select(`SELECT id FROM dist_products WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL AND id <> ?`, [tenant(), code, input.id ?? ""]);
      if (dup.length) throw new DistError("CONFLICT", `Product code ${code} is already used.`);
      const barcode = trimOrNull(input.barcode);
      if (barcode) {
        const d2 = await db.select(`SELECT id FROM dist_products WHERE tenant_id = ? AND barcode = ? AND deleted_at IS NULL AND id <> ?`, [tenant(), barcode, input.id ?? ""]);
        if (d2.length) throw new DistError("CONFLICT", `Barcode ${barcode} is already used.`);
      }
      const n = (v: unknown, label: string, required = false) => {
        if (v == null || String(v) === "") {
          if (required) throw new DistError("INVALID", `${label} is required.`);
          return null;
        }
        const x = Number(v);
        if (!Number.isFinite(x) || x < 0) throw new DistError("INVALID", `${label} must be 0 or more.`);
        return x;
      };
      const data = {
        company_id: input.company_id, category_id: input.category_id || null, code, barcode, name,
        unit: trimOrNull(input.unit) ?? "pcs", pack_size: n(input.pack_size, "Pack size") ?? 1,
        generic_name: mode === "pharma" ? trimOrNull(input.generic_name) : null, strength: mode === "pharma" ? trimOrNull(input.strength) : null,
        dosage_form: mode === "pharma" ? trimOrNull(input.dosage_form) : null, drap_reg_no: mode === "pharma" ? trimOrNull(input.drap_reg_no) : null,
        brand: trimOrNull(input.brand), size: trimOrNull(input.size),
        trade_price: n(input.trade_price, "Trade price", true)!, retail_price: n(input.retail_price, "Retail price"), cost: n(input.cost, "Cost") ?? 0,
        min_price: n(input.min_price, "Minimum price"), sales_tax_rate: n(input.sales_tax_rate, "Sales tax rate") ?? 0, reorder_level: n(input.reorder_level, "Reorder level") ?? 0,
        is_active: input.is_active === 0 ? 0 : 1,
      };
      if (input.id) {
        const before = await owned<DistProduct>("dist_products", input.id, "Product");
        await update("dist_products", input.id, data);
        if (before.trade_price !== data.trade_price) await audit("product.price", "product", input.id, { field: "trade_price", old: before.trade_price, next: data.trade_price });
        return owned<DistProduct>("dist_products", input.id, "Product");
      }
      const row = await insert<DistProduct>("dist_products", { ...data, stock: 0, avg_cost: data.cost } as never);
      const opening = Number(input.openingQty) || 0;
      if (opening > 0) {
        await addStock(row.id, opening);
        await stockMove(row.id, opening, "opening", null, null, data.cost, "Opening stock");
      }
      await audit("product.create", "product", row.id, { next: { code, name } });
      return owned<DistProduct>("dist_products", row.id, "Product");
    },

    // ── Customers ──
    async listCustomers(opts: { search?: string; salesmanId?: string; territory?: string; status?: string; missingGeo?: boolean } = {}) {
      await need("customers.view");
      const where = ["c.tenant_id = ?", "c.deleted_at IS NULL"];
      const params: unknown[] = [tenant()];
      if (!isAdmin() && !(await can("bookings.view_all"))) {
        const me = await mySalesman();
        if (me) {
          where.push("(c.salesman_id IS NULL OR c.salesman_id = ? OR c.created_by = ?)");
          params.push(me.id, context().userId);
        }
      }
      if (opts.salesmanId) {
        where.push("c.salesman_id = ?");
        params.push(opts.salesmanId);
      }
      if (opts.territory) {
        where.push("c.territory = ?");
        params.push(opts.territory);
      }
      if (opts.status) {
        where.push("c.status = ?");
        params.push(opts.status);
      }
      if (opts.missingGeo) where.push("(c.lat IS NULL OR c.lng IS NULL)");
      if (opts.search?.trim()) {
        const q = `%${opts.search.trim().toUpperCase()}%`;
        where.push("(UPPER(c.business_name) LIKE ? OR UPPER(COALESCE(c.owner_name, '')) LIKE ? OR c.code LIKE ? OR COALESCE(c.mobile, '') LIKE ? OR COALESCE(c.ntn, '') LIKE ?)");
        params.push(q, q, q, `%${opts.search.trim()}%`, `%${opts.search.trim()}%`);
      }
      return db.select<DistCustomer & { salesman_name: string | null }>(
        `SELECT c.*, s.name AS salesman_name FROM dist_customers c LEFT JOIN dist_salesmen s ON s.id = c.salesman_id AND s.tenant_id = c.tenant_id
         WHERE ${where.join(" AND ")} ORDER BY c.business_name LIMIT 5000`,
        params
      );
    },
    async getCustomer(id: string) {
      await need("customers.view");
      return customerFor(id);
    },
    async createCustomer(input: Partial<DistCustomer> & { location?: { lat: number; lng: number; accuracy?: number | null; source: "device" | "manual_pin" } | null }) {
      await need("customers.add");
      const { mode, settings } = await cfg();
      const business = trimOrNull(input.business_name);
      if (!business) throw new DistError("INVALID", "Business name is required.");
      let ntn: string | null, cnic: string | null, mobile: string | null;
      try {
        ntn = normalizeNtn(input.ntn);
        cnic = normalizeCnic(input.cnic);
        mobile = normalizeMobile(input.mobile);
      } catch (e) {
        throw new DistError("INVALID", (e as Error).message);
      }
      if (!mobile) throw new DistError("INVALID", "Mobile number is required.");
      let cdsl_no: string | null = null;
      let cdsl_expiry: string | null = null;
      if (mode === "pharma") {
        cdsl_no = trimOrNull(input.cdsl_no);
        cdsl_expiry = trimOrNull(input.cdsl_expiry);
        if (settings.cdsl.required && (!cdsl_no || !cdsl_expiry)) throw new DistError("INVALID", "CDSL number and CDSL expiry date are required for pharma customers.");
        if (cdsl_expiry && !/^\d{4}-\d{2}-\d{2}$/.test(cdsl_expiry)) throw new DistError("INVALID", "CDSL expiry must be a date (YYYY-MM-DD).");
      }
      const me = await mySalesman();
      const code = trimOrNull(input.code)?.toUpperCase() ?? `C-${String(await nextNo("dist_customers", "CAST(SUBSTR(code, 3) AS INTEGER)", "AND code LIKE 'C-%'")).padStart(5, "0")}`;
      const salesmanId = input.salesman_id && isAdmin() ? (await owned<DistSalesman>("dist_salesmen", input.salesman_id, "Salesman")).id : me?.id ?? null;
      const loc = input.location ?? null;
      if (loc && !validCoords(loc.lat, loc.lng)) throw new DistError("INVALID", "The captured location is not valid.");
      const row = await insert<DistCustomer>("dist_customers", {
        code, business_name: business, owner_name: trimOrNull(input.owner_name), ntn, cnic, mobile,
        phone2: trimOrNull(input.phone2), email: trimOrNull(input.email), address: trimOrNull(input.address), territory: trimOrNull(input.territory),
        salesman_id: salesmanId, tax_class: settings.wht.classes[input.tax_class ?? ""] ? input.tax_class : "retailer", status: "active",
        lat: loc?.lat ?? null, lng: loc?.lng ?? null, location_accuracy: loc?.accuracy ?? null, located_at: loc ? await dbNow() : null,
        location_source: loc?.source ?? null, located_by: loc ? context().userId : null,
        cdsl_no, cdsl_expiry, cdsl_status: cdsl_no ? "unverified" : null, atl_status: "unverified",
        credit_limit: input.credit_limit ?? null, opening_balance: Math.max(0, Number(input.opening_balance) || 0), notes: trimOrNull(input.notes), created_by: context().userId,
      } as never);
      await audit("customer.create", "customer", row.id, { next: { code, business, ntn, mode } });
      return row;
    },
    /** Sub-users may change only the fields the administrator allowed them. */
    async updateCustomer(id: string, patch: Partial<DistCustomer>) {
      await need("customers.edit");
      const { mode, settings } = await cfg();
      const c = await customerFor(id);
      const allowed = isAdmin() ? [...CUSTOMER_FIELDS] : (await permsOf(context().userId)).fields;
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === "location") continue;
        if (!(CUSTOMER_FIELDS as readonly string[]).includes(k)) {
          if (["status", "salesman_id", "credit_limit", "opening_balance", "atl_status", "cdsl_status"].includes(k) && !isAdmin()) throw new DistError("FORBIDDEN", `Only the administrator can change ${k}.`);
          if (!["status", "salesman_id", "credit_limit", "opening_balance"].includes(k)) continue;
        } else if (!allowed.includes(k)) throw new DistError("FORBIDDEN", `You may not change the customer's ${k.replace("_", " ")}.`);
        data[k] = v;
      }
      try {
        if ("ntn" in data) data.ntn = normalizeNtn(data.ntn as string);
        if ("cnic" in data) data.cnic = normalizeCnic(data.cnic as string);
        if ("mobile" in data) data.mobile = normalizeMobile(data.mobile as string);
      } catch (e) {
        throw new DistError("INVALID", (e as Error).message);
      }
      if ("business_name" in data && !trimOrNull(data.business_name)) throw new DistError("INVALID", "Business name is required.");
      if (mode !== "pharma") {
        delete data.cdsl_no;
        delete data.cdsl_expiry;
      } else if (("cdsl_no" in data || "cdsl_expiry" in data) && settings.cdsl.required && (!trimOrNull(data.cdsl_no ?? c.cdsl_no) || !trimOrNull(data.cdsl_expiry ?? c.cdsl_expiry)))
        throw new DistError("INVALID", "CDSL number and expiry are required.");
      if ("tax_class" in data && !settings.wht.classes[String(data.tax_class)]) throw new DistError("INVALID", "Unknown tax class.");
      if ("salesman_id" in data && data.salesman_id) await owned("dist_salesmen", String(data.salesman_id), "Salesman");
      // A new NTN / CNIC invalidates the previous ATL result; new CDSL needs re-verification.
      if (("ntn" in data && data.ntn !== c.ntn) || ("cnic" in data && data.cnic !== c.cnic)) Object.assign(data, { atl_status: "unverified", atl_checked_at: null, atl_source: null, atl_check_id: null });
      if (("cdsl_no" in data && data.cdsl_no !== c.cdsl_no) || ("cdsl_expiry" in data && data.cdsl_expiry !== c.cdsl_expiry)) Object.assign(data, { cdsl_status: "unverified", cdsl_verified_at: null, cdsl_verified_by: null });
      if (!Object.keys(data).length) return c;
      await update("dist_customers", id, data);
      for (const k of Object.keys(data)) if ((c as unknown as Record<string, unknown>)[k] !== data[k]) await audit("customer.update", "customer", id, { field: k, old: (c as unknown as Record<string, unknown>)[k], next: data[k] });
      return owned<DistCustomer>("dist_customers", id, "Customer");
    },
    /** Business location: from the device (explicit capture) or a pin placed on
     * the map by an authorised user. Never the salesman's tracking location. */
    async setCustomerLocation(id: string, loc: { lat: number; lng: number; accuracy?: number | null; source: "device" | "manual_pin" }) {
      await need("customers.edit");
      const c = await customerFor(id);
      if (!isAdmin() && !(await permsOf(context().userId)).fields.includes("location")) throw new DistError("FORBIDDEN", "You may not change customer locations.");
      if (!validCoords(loc.lat, loc.lng)) throw new DistError("INVALID", "The location is not valid.");
      if (loc.source !== "device" && loc.source !== "manual_pin") throw new DistError("INVALID", "Unknown location source.");
      const next = { lat: Number(loc.lat), lng: Number(loc.lng), location_accuracy: loc.accuracy ?? null, located_at: await dbNow(), location_source: loc.source, located_by: context().userId };
      await update("dist_customers", id, next);
      await audit("customer.location", "customer", id, { old: { lat: c.lat, lng: c.lng, source: c.location_source }, next });
    },
    async setCustomerStatus(id: string, status: "active" | "inactive", reason: string) {
      needAdmin("customers.delete");
      const c = await owned<DistCustomer>("dist_customers", id, "Customer");
      if (!reason?.trim()) throw new DistError("INVALID", "Give a reason.");
      await update("dist_customers", id, { status });
      await audit(status === "inactive" ? "customer.deactivate" : "customer.activate", "customer", id, { old: c.status, next: status, reason });
    },
    /** Soft delete by the administrator only. Invoices keep their customer
     * snapshot and stay available; the customer just leaves the lists. */
    async deleteCustomer(id: string, reason: string) {
      needAdmin("customers.delete");
      const c = await owned<DistCustomer>("dist_customers", id, "Customer");
      if (!reason?.trim()) throw new DistError("INVALID", "Give a reason for deleting the customer.");
      await update("dist_customers", id, { status: "inactive", deleted_at: iso(db.now()) });
      await audit("customer.delete", "customer", id, { old: { code: c.code, business_name: c.business_name }, reason });
    },
    /** Records an ATL (Active Taxpayers List) result checked by an authorised
     * user on FBR's portal / SMS 9966 (or returned by a configured adapter). */
    async recordAtlCheck(customerId: string, input: { result: "active" | "inactive"; source: string; reference?: string | null; checkedAt?: string | null; note?: string | null }) {
      await need("customers.verify");
      const c = await owned<DistCustomer>("dist_customers", customerId, "Customer");
      const identifier = c.ntn || c.cnic;
      if (!identifier) throw new DistError("INVALID", "The customer has no NTN or CNIC to check.");
      if (input.result !== "active" && input.result !== "inactive") throw new DistError("INVALID", "Result must be active or inactive.");
      if (!trimOrNull(input.source)) throw new DistError("INVALID", "Say where the status was checked (e.g. FBR ATL portal, SMS 9966).");
      const checkedAt = input.checkedAt && !Number.isNaN(Date.parse(input.checkedAt)) ? new Date(input.checkedAt).toISOString() : await dbNow();
      if (checkedAt > (await dbNow())) throw new DistError("INVALID", "The check date can't be in the future.");
      const row = await insert<Base & { id: string }>("dist_tax_checks", { customer_id: c.id, identifier, result: input.result, source: input.source.trim(), reference: trimOrNull(input.reference), checked_by: context().userId, checked_at: checkedAt, note: trimOrNull(input.note) } as never);
      await update("dist_customers", c.id, { atl_status: input.result, atl_checked_at: checkedAt, atl_source: input.source.trim(), atl_check_id: row.id });
      await audit("customer.atl", "customer", c.id, { old: c.atl_status, next: input.result, detail: { source: input.source, reference: input.reference ?? null } });
      return row;
    },
    /** Calls a configured verifier. Failures and timeouts change nothing (the
     * customer stays as it was — never marked active by default). */
    async verifyAtl(customerId: string, verifier: AtlVerifier | null, timeoutMs = 10000) {
      await need("customers.verify");
      const c = await owned<DistCustomer>("dist_customers", customerId, "Customer");
      if (!verifier) return { ok: false as const, error: "No authoritative ATL verification service is configured. Check FBR's ATL portal or SMS 9966 and record the result." };
      const identifier = c.ntn || c.cnic;
      if (!identifier) return { ok: false as const, error: "The customer has no NTN or CNIC." };
      try {
        const r = await Promise.race([verifier.check(identifier), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]);
        await api.recordAtlCheck(customerId, { result: r.status, source: verifier.name, reference: r.reference ?? null });
        return { ok: true as const, status: r.status };
      } catch (e) {
        await audit("customer.atl_failed", "customer", c.id, { detail: { verifier: verifier.name, error: (e as Error).message } });
        return { ok: false as const, error: (e as Error).message === "timeout" ? "The verification service did not answer in time. Status left unchanged (unverified)." : `Verification failed: ${(e as Error).message}` };
      }
    },
    async taxChecks(customerId: string) {
      await need("customers.view");
      await owned("dist_customers", customerId, "Customer", true);
      return db.select(`SELECT * FROM dist_tax_checks WHERE tenant_id = ? AND customer_id = ? ORDER BY checked_at DESC`, [tenant(), customerId]);
    },
    async verifyCdsl(customerId: string, status: "verified" | "rejected", note: string) {
      await need("customers.verify");
      const { mode } = await cfg();
      if (mode !== "pharma") throw new DistError("INVALID", "CDSL applies to pharma distributors only.");
      const c = await owned<DistCustomer>("dist_customers", customerId, "Customer");
      if (!c.cdsl_no) throw new DistError("INVALID", "The customer has no CDSL number.");
      await update("dist_customers", c.id, { cdsl_status: status, cdsl_verified_at: await dbNow(), cdsl_verified_by: context().userId });
      await audit("customer.cdsl", "customer", c.id, { old: c.cdsl_status, next: status, reason: note || null });
    },
    async cdslAlerts() {
      await need("customers.view");
      const { mode, settings } = await cfg();
      if (mode !== "pharma") return [];
      const rows = await api.listCustomers({ status: "active" });
      return rows.map((c) => ({ ...c, cdsl_state: cdslState(c.cdsl_no, c.cdsl_expiry, today(), settings.cdsl.alertDays) })).filter((c) => c.cdsl_state !== "valid");
    },

    // ── Salesmen & targets ──
    async listSalesmen(includeInactive = false) {
      if (!isAdmin()) await need("salesmen.view");
      const { settings } = await cfg();
      const rows = await db.select<DistSalesman & { session_status: string | null; last_point_at: string | null }>(
        `SELECT s.*, (SELECT status FROM dist_loc_sessions x WHERE x.tenant_id = s.tenant_id AND x.salesman_id = s.id ORDER BY x.started_at DESC LIMIT 1) AS session_status,
                (SELECT MAX(recorded_at) FROM dist_loc_points p WHERE p.tenant_id = s.tenant_id AND p.salesman_id = s.id) AS last_point_at
         FROM dist_salesmen s WHERE s.tenant_id = ? AND s.deleted_at IS NULL ${includeInactive ? "" : "AND s.is_active = 1"} ORDER BY s.name`,
        [tenant()]
      );
      const now = await dbNow();
      return rows.map((r) => ({ ...r, live: liveState(r.session_status ? { status: r.session_status } : null, r.last_point_at, now, settings.location.maxAgeSeconds) }));
    },
    async saveSalesman(input: Partial<DistSalesman> & { companyIds?: string[] }) {
      needAdmin("salesmen.manage");
      const name = trimOrNull(input.name);
      const code = trimOrNull(input.code)?.toUpperCase();
      if (!name || !code) throw new DistError("INVALID", "Salesman name and code are required.");
      if (input.user_id) {
        const u = await db.select<{ role: string }>(`SELECT role FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [input.user_id, tenant()]);
        if (!u[0]) throw new DistError("NOT_FOUND", "Login not found in this business.");
        if (u[0].role !== "staff") throw new DistError("INVALID", "Link a sub-user (staff) login to a salesman.");
      }
      for (const cid of input.companyIds ?? []) await owned("dist_companies", cid, "Company");
      const dup = await db.select(`SELECT id FROM dist_salesmen WHERE tenant_id = ? AND deleted_at IS NULL AND id <> ? AND (code = ? OR (? IS NOT NULL AND user_id = ?))`, [tenant(), input.id ?? "", code, input.user_id ?? null, input.user_id ?? null]);
      if (dup.length) throw new DistError("CONFLICT", "That code or login already belongs to another salesman.");
      let mobile: string | null;
      try {
        mobile = normalizeMobile(input.mobile);
      } catch (e) {
        throw new DistError("INVALID", (e as Error).message);
      }
      const data = { user_id: input.user_id || null, code, name, mobile, territory: trimOrNull(input.territory), company_ids: JSON.stringify(input.companyIds ?? json(input.company_ids, [])), monthly_target: Math.max(0, Number(input.monthly_target) || 0), employment: trimOrNull(input.employment), is_active: input.is_active === 0 ? 0 : 1 };
      if (input.id) {
        await owned("dist_salesmen", input.id, "Salesman");
        await update("dist_salesmen", input.id, data);
        await audit("salesman.update", "salesman", input.id, { next: data });
        return owned<DistSalesman>("dist_salesmen", input.id, "Salesman");
      }
      const row = await insert<DistSalesman>("dist_salesmen", data as never);
      await audit("salesman.create", "salesman", row.id, { next: data });
      return row;
    },
    async setTarget(salesmanId: string, month: string, amount: number) {
      needAdmin("targets.set");
      if (!/^\d{4}-\d{2}$/.test(month)) throw new DistError("INVALID", "Month must be YYYY-MM.");
      if (!(Number(amount) >= 0)) throw new DistError("INVALID", "Target must be 0 or more.");
      await owned("dist_salesmen", salesmanId, "Salesman");
      const cur = await db.select<{ id: string; amount: number }>(`SELECT id, amount FROM dist_targets WHERE tenant_id = ? AND salesman_id = ? AND month = ?`, [tenant(), salesmanId, month]);
      if (cur[0]) await update("dist_targets", cur[0].id, { amount: Number(amount), set_by: context().userId });
      else await insert("dist_targets", { salesman_id: salesmanId, month, amount: Number(amount), set_by: context().userId } as never);
      await audit("target.set", "salesman", salesmanId, { field: month, old: cur[0]?.amount ?? null, next: Number(amount) });
    },
    me: mySalesman,

    // ── Location sharing ──
    async startSharing(userAgent?: string) {
      const me = await mySalesman();
      if (!me || !me.is_active) throw new DistError("FORBIDDEN", "Only an active salesman login can share its location.");
      const cur = await activeSession(me.id);
      if (cur) return cur;
      const now = await dbNow();
      const s = await insert<Base & { id: string; status: string }>("dist_loc_sessions", { salesman_id: me.id, status: "active", started_at: now, user_agent: trimOrNull(userAgent)?.slice(0, 200) ?? null } as never);
      await audit("location.start", "salesman", me.id);
      return s;
    },
    async stopSharing(reason: string = "stopped by salesman") {
      const me = await mySalesman();
      if (!me) throw new DistError("FORBIDDEN", "Only a salesman login can stop location sharing.");
      const cur = await activeSession(me.id);
      if (!cur) return;
      await update("dist_loc_sessions", cur.id, { status: "stopped", stopped_at: await dbNow(), stop_reason: reason }, { sql: "status = 'active'", params: [] });
      await audit("location.stop", "salesman", me.id, { reason });
    },
    /** A location fix from the salesman's own device while sharing is on.
     * Stored with the database clock; implausible jumps are flagged. */
    async reportLocation(p: { lat: number; lng: number; accuracy?: number | null; deviceAt?: string | null }) {
      const me = await mySalesman();
      if (!me) throw new DistError("FORBIDDEN", "Only a salesman login can report a location.");
      const session = await activeSession(me.id);
      if (!session) throw new DistError("CONFLICT", "Location sharing is not active. Start sharing first.");
      if (!validCoords(p.lat, p.lng)) throw new DistError("INVALID", "Invalid coordinates.");
      const { settings } = await cfg();
      const accuracy = p.accuracy == null || !Number.isFinite(Number(p.accuracy)) ? null : Math.max(0, Number(p.accuracy));
      const now = await dbNow();
      let flag: string | null = null;
      const prev = await lastPoint(me.id);
      if (prev) {
        const hours = (new Date(now).getTime() - new Date(prev.recorded_at).getTime()) / 36e5;
        const km = distanceKm(prev, { lat: Number(p.lat), lng: Number(p.lng) });
        if (km > 1 && hours > 0 && km / hours > settings.location.maxSpeedKmh) flag = `implausible jump ${km.toFixed(1)} km`;
      }
      if (p.deviceAt && Math.abs(new Date(p.deviceAt).getTime() - new Date(now).getTime()) > 10 * 60e3) flag = flag ?? "device clock differs from server by over 10 min";
      const row = await insert<Base & { id: string }>("dist_loc_points", { session_id: session.id, salesman_id: me.id, lat: Number(p.lat), lng: Number(p.lng), accuracy, device_at: trimOrNull(p.deviceAt), recorded_at: now, flag } as never);
      await update("dist_loc_sessions", session.id, { last_point_at: now });
      return { id: row.id, recorded_at: now, flag };
    },
    /** Latest location and live state of one salesman (self, or users allowed to view locations). */
    async salesmanLocation(salesmanId: string) {
      const me = await mySalesman();
      if (me?.id !== salesmanId) await need("locations.view");
      await owned("dist_salesmen", salesmanId, "Salesman");
      const { settings } = await cfg();
      const [session, point, now] = await Promise.all([activeSession(salesmanId), lastPoint(salesmanId), dbNow()]);
      const last = await db.select<{ status: string }>(`SELECT status FROM dist_loc_sessions WHERE tenant_id = ? AND salesman_id = ? ORDER BY started_at DESC LIMIT 1`, [tenant(), salesmanId]);
      return { point, session, state: liveState(session ?? (last[0] ? { status: last[0].status } : null), point?.recorded_at ?? null, now, settings.location.maxAgeSeconds), now, maxAgeSeconds: settings.location.maxAgeSeconds };
    },
    async liveMap() {
      await need("locations.view");
      const list = await api.listSalesmen();
      const out = [];
      for (const s of list) out.push({ salesman: s, ...(await api.salesmanLocation(s.id)) });
      return out;
    },
    async locationHistory(salesmanId: string, from: string, to: string) {
      const me = await mySalesman();
      if (me?.id !== salesmanId) await need("locations.view");
      await owned("dist_salesmen", salesmanId, "Salesman");
      return db.select(`SELECT lat, lng, accuracy, recorded_at, flag FROM dist_loc_points WHERE tenant_id = ? AND salesman_id = ? AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at LIMIT 5000`, [tenant(), salesmanId, from, to]);
    },
    /** Deletes tracking points older than the retention period (admin). */
    async purgeOldLocations() {
      needAdmin("settings.manage");
      const { settings } = await cfg();
      const { changes } = await db.execute(`DELETE FROM dist_loc_points WHERE tenant_id = ? AND recorded_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`, [tenant(), `-${settings.location.retentionDays} days`]);
      await audit("location.purge", "location", null, { detail: { removed: changes, days: settings.location.retentionDays } });
      return changes;
    },

    // ── Bookings ──
    async createBooking(input: { clientRef?: string | null; customerId: string; companyId?: string | null; lines: LineIn[]; notes?: string | null; salesmanId?: string | null }) {
      await need("bookings.create");
      const { mode, settings } = await cfg();
      if (input.clientRef) {
        const dup = await db.select<DistBooking>(`SELECT * FROM dist_bookings WHERE tenant_id = ? AND client_ref = ?`, [tenant(), input.clientRef]);
        if (dup[0]) return api.getBooking(dup[0].id); // repeated tap / retry
      }
      const me = await mySalesman();
      const salesman = me ?? (input.salesmanId && isAdmin() ? await owned<DistSalesman>("dist_salesmen", input.salesmanId, "Salesman") : null);
      const customer = await customerFor(input.customerId, { forBooking: true });
      await assertCdsl(customer, settings, mode);
      if (input.companyId) await owned("dist_companies", input.companyId, "Company");
      const prepared = await priceLines(input.lines, { companyId: input.companyId, salesman });
      const calc = calcDoc(prepared.map((x) => ({ qty: x.qty, price: x.price, discount: x.discount, taxRate: x.p.sales_tax_rate })), 0);
      const b = await insertNumbered<DistBooking>("dist_bookings", "booking_no", {
        client_ref: trimOrNull(input.clientRef), salesman_id: salesman?.id ?? null, customer_id: customer.id, company_id: input.companyId || null, status: "draft", date: today(),
        gross: toRupees(calc.grossPaisa), discount: toRupees(calc.discountPaisa), sales_tax: toRupees(calc.taxPaisa), total: toRupees(calc.totalPaisa), notes: trimOrNull(input.notes), created_by: context().userId,
      } as never);
      for (const [i, x] of prepared.entries()) {
        const c = calc.lines[i];
        await insert("dist_booking_items", { booking_id: b.id, product_id: x.p.id, code: x.p.code, name: x.p.name, unit: x.p.unit, qty: x.qty, price: x.price, discount: toRupees(c.discountPaisa), sales_tax_rate: x.p.sales_tax_rate, sales_tax: toRupees(c.taxPaisa), line_total: toRupees(c.totalPaisa) } as never);
      }
      await bookingEvent(b.id, null, "draft");
      return api.getBooking(b.id);
    },
    async getBooking(id: string) {
      const b = await owned<DistBooking>("dist_bookings", id, "Booking");
      const me = await mySalesman();
      if (!(await can("bookings.view_all")) && !(await can("bookings.approve")) && b.salesman_id !== me?.id && b.created_by !== context().userId) throw new DistError("NOT_FOUND", "Booking not found.");
      const [items, events] = await Promise.all([
        db.select<DistBookingItem>(`SELECT * FROM dist_booking_items WHERE tenant_id = ? AND booking_id = ? AND deleted_at IS NULL ORDER BY created_at, id`, [tenant(), id]),
        db.select<{ id: string; from_status: string | null; to_status: string; user_name: string | null; note: string | null; created_at: string }>(`SELECT * FROM dist_booking_events WHERE tenant_id = ? AND booking_id = ? ORDER BY created_at`, [tenant(), id]),
      ]);
      return { booking: b, items, events };
    },
    async listBookings(opts: { status?: string; salesmanId?: string; from?: string; to?: string; customerId?: string } = {}) {
      const where = ["b.tenant_id = ?", "b.deleted_at IS NULL"];
      const params: unknown[] = [tenant()];
      if (!(await can("bookings.view_all")) && !(await can("bookings.approve"))) {
        const me = await mySalesman();
        where.push("(b.salesman_id = ? OR b.created_by = ?)");
        params.push(me?.id ?? "-", context().userId);
      }
      for (const [k, col] of [["status", "b.status"], ["salesmanId", "b.salesman_id"], ["customerId", "b.customer_id"]] as const) {
        if (opts[k]) {
          where.push(`${col} = ?`);
          params.push(opts[k]);
        }
      }
      if (opts.from && opts.to) {
        where.push("b.date BETWEEN ? AND ?");
        params.push(opts.from, opts.to);
      }
      return db.select<DistBooking & { customer_name: string; salesman_name: string | null; company_name: string | null }>(
        `SELECT b.*, c.business_name AS customer_name, s.name AS salesman_name, k.name AS company_name FROM dist_bookings b
         JOIN dist_customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
         LEFT JOIN dist_salesmen s ON s.id = b.salesman_id AND s.tenant_id = b.tenant_id
         LEFT JOIN dist_companies k ON k.id = b.company_id AND k.tenant_id = b.tenant_id
         WHERE ${where.join(" AND ")} ORDER BY b.date DESC, b.booking_no DESC LIMIT 2000`,
        params
      );
    },
    /** Submits a draft. A salesman needs live location sharing with a fresh,
     * accurate fix (checked on the database clock); the booking records that
     * stored point — no coordinates are taken from the request. */
    async submitBooking(id: string) {
      await need("bookings.submit");
      const { settings } = await cfg();
      const { booking } = await api.getBooking(id);
      if (booking.status !== "draft") throw new DistError("CONFLICT", `Only a draft can be submitted (this one is ${booking.status}).`);
      const me = await mySalesman();
      let loc: Record<string, unknown> = {};
      if (me && settings.location.requiredForBooking) {
        const p = await requireFreshLocation(me.id, settings);
        loc = { loc_point_id: p.id, loc_lat: p.lat, loc_lng: p.lng, loc_accuracy: p.accuracy, loc_recorded_at: p.recorded_at };
      }
      const to: BookingStatus = settings.booking.requireApproval ? "pending_approval" : "approved";
      await moveBooking(booking, to, { ...loc, submitted_at: await dbNow() });
      return api.getBooking(id);
    },
    async decideBooking(id: string, decision: "approved" | "rejected", note?: string) {
      await need("bookings.approve");
      const b = await owned<DistBooking>("dist_bookings", id, "Booking");
      if (decision === "rejected" && !note?.trim()) throw new DistError("INVALID", "Give a reason for rejecting.");
      await moveBooking(b, decision, { decided_by: context().userId, decided_at: await dbNow(), decision_note: note ?? null }, note);
      return api.getBooking(id);
    },
    async cancelBooking(id: string, reason: string) {
      const { booking: b } = await api.getBooking(id);
      if (!reason?.trim()) throw new DistError("INVALID", "Give a reason for cancelling.");
      if (b.status === "approved") await need("bookings.approve");
      else if (b.created_by !== context().userId) await need("bookings.approve");
      await moveBooking(b, "cancelled", {}, reason);
    },
    /** Approved booking -> sales invoice (once). Lines, quantities, prices and
     * customer come from the booking; changing them needs the matching
     * invoice permission. The booking is claimed first so it can never be
     * invoiced twice. */
    async convertBooking(id: string, opts: { lines?: LineIn[]; customerId?: string; billDiscount?: number; payments?: PaymentIn[]; description?: string | null; wht?: WhtOverride } = {}) {
      await need("invoices.create");
      const { booking, items } = await api.getBooking(id);
      if (booking.status !== "approved") throw new DistError("CONFLICT", "Only an approved booking can be converted to an invoice.");
      if (opts.customerId && opts.customerId !== booking.customer_id) await need("invoices.edit_customer");
      const lines: LineIn[] = opts.lines ?? items.map((i) => ({ productId: i.product_id, qty: i.qty, price: i.price, discount: i.discount }));
      if (opts.lines) {
        const key = (l: { productId?: string; product_id?: string }) => l.productId ?? l.product_id;
        const same = opts.lines.length === items.length && opts.lines.every((l) => items.some((i) => i.product_id === key(l)));
        if (!same) await need("invoices.edit_lines");
        if (opts.lines.some((l) => { const i = items.find((x) => x.product_id === l.productId); return i && Number(i.qty) !== Number(l.qty); })) await need("invoices.edit_qty");
      }
      const claimed = await update("dist_bookings", id, { status: "converted" }, { sql: "status = 'approved'", params: [] });
      if (!claimed) throw new DistError("CONFLICT", "This booking was already converted.");
      try {
        // Booking prices were already authorised; re-check only changed ones.
        const doc = await createSaleInternal({ customerId: opts.customerId ?? booking.customer_id, lines, billDiscount: opts.billDiscount, payments: opts.payments, description: opts.description, wht: opts.wht, bookingId: id, salesmanId: booking.salesman_id, bookingItems: items });
        await update("dist_bookings", id, { invoice_id: doc.doc.id });
        await bookingEvent(id, "approved", "converted", `Invoice #${doc.doc.doc_no}`);
        return doc;
      } catch (e) {
        await db.execute(`UPDATE dist_bookings SET status = 'approved', updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'converted' AND invoice_id IS NULL`, [iso(db.now()), id, tenant()]);
        await syncRow("dist_bookings", id);
        throw e;
      }
    },

    // ── Invoices ──
    async previewWht(customerId: string, lines: LineIn[], billDiscount = 0) {
      await need("invoices.view");
      const { settings } = await cfg();
      const c = await owned<DistCustomer>("dist_customers", customerId, "Customer");
      const prepared = await Promise.all(lines.map(async (l) => ({ p: await owned<DistProduct>("dist_products", l.productId, "Product"), l })));
      const calc = calcDoc(prepared.map(({ p, l }) => ({ qty: Number(l.qty) || 0, price: l.price == null ? p.trade_price : Number(l.price), discount: Number(l.discount) || 0, taxRate: p.sales_tax_rate })), billDiscount);
      const t = whtTreatment(settings, { ntn: c.ntn, cnic: c.cnic, taxClass: c.tax_class, atlStatus: c.atl_status, atlCheckedAt: c.atl_checked_at, atlSource: c.atl_source }, await dbNow());
      const { basePaisa, amountPaisa } = whtAmount(settings, calc, t.rate);
      return { treatment: t, base: toRupees(basePaisa), amount: toRupees(amountPaisa), goods: toRupees(calc.totalPaisa), payable: toRupees(calc.totalPaisa + amountPaisa) };
    },
    async createSale(input: { customerId: string; lines: LineIn[]; billDiscount?: number; payments?: PaymentIn[]; description?: string | null; wht?: WhtOverride; salesmanId?: string | null; date?: string }) {
      await need("invoices.create");
      if (input.salesmanId) await owned("dist_salesmen", input.salesmanId, "Salesman");
      return createSaleInternal({ ...input, bookingId: null, salesmanId: input.salesmanId ?? (await mySalesman())?.id ?? null });
    },
    async getDoc(id: string) {
      const d = await docWithItems(id);
      await need(d.doc.doc_type.startsWith("purchase") ? "purchases.view" : "invoices.view");
      return d;
    },
    async listDocs(opts: { type: DistDocType; from?: string; to?: string; partyId?: string; search?: string }) {
      await need(opts.type.startsWith("purchase") ? "purchases.view" : "invoices.view");
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
        where.push("(CAST(doc_no AS TEXT) = ? OR UPPER(COALESCE(party_name, '')) LIKE ?)");
        params.push(opts.search.trim(), `%${opts.search.trim().toUpperCase()}%`);
      }
      return db.select<DistDoc>(`SELECT * FROM dist_docs WHERE ${where.join(" AND ")} ORDER BY date DESC, doc_no DESC LIMIT 2000`, params);
    },
    /** Sales return / credit note against an invoice (finalized invoices are
     * never edited). Withholding tax is reversed at the invoice's own rate. */
    async createSaleReturn(input: { invoiceId: string; lines: { itemId: string; qty: number }[]; reason: string; refund?: PaymentIn | null }) {
      await need("invoices.return");
      return returnInternal("sale", input);
    },
    async createPurchase(input: { supplierId: string; supplierInvoiceNo?: string | null; date?: string; lines: PurchaseLineIn[]; billDiscount?: number; payments?: PaymentIn[]; description?: string | null }) {
      await need("purchases.create");
      // Distributors use dist_companies as supplier principals; fall back to the
      // generic suppliers table so existing records remain accessible.
      const [company] = await db.select<{ id: string; name: string; address: string | null }>(
        `SELECT id, name, address FROM dist_companies WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [input.supplierId, tenant()]
      );
      const sup: { id: string; name: string; ntn?: string | null; address: string | null } =
        company ?? (await owned<{ id: string; name: string; ntn?: string | null; address: string | null }>("suppliers", input.supplierId, "Supplier"));
      if (!input.lines?.length) throw new DistError("INVALID", "Add at least one product.");
      const prepared = [];
      for (const l of input.lines) {
        const p = await owned<DistProduct>("dist_products", l.productId, "Product");
        const qty = Math.round(Number(l.qty) * 1000) / 1000;
        if (!(qty > 0)) throw new DistError("INVALID", `Enter a quantity for ${p.name}.`);
        const cost = Number(l.cost);
        if (!(cost >= 0)) throw new DistError("INVALID", `Invalid cost for ${p.name}.`);
        if (p.cost > 0 && toPaisa(cost) !== toPaisa(p.cost)) await need("purchases.edit_price");
        const discount = Math.max(0, Number(l.discount) || 0);
        if (discount > 0) await need("purchases.discount");
        const taxRate = Math.max(0, Number(l.taxRate) || 0);
        if (taxRate > 0) await need("purchases.edit_tax");
        prepared.push({ p, qty, cost, discount, taxRate, batchNo: trimOrNull(l.batchNo), expiry: trimOrNull(l.expiry) });
      }
      if ((Number(input.billDiscount) || 0) > 0) await need("purchases.discount");
      const calc = calcDoc(prepared.map((x) => ({ qty: x.qty, price: x.cost, discount: x.discount, taxRate: x.taxRate })), Number(input.billDiscount) || 0);
      const payments = (input.payments ?? []).filter((x) => Number(x.amount) > 0);
      const paid = Math.min(calc.totalPaisa, payments.reduce((s, x) => s + toPaisa(x.amount), 0));
      const doc = await insertNumbered<DistDoc>("dist_docs", "doc_no", {
        doc_type: "purchase", date: input.date || today(), party_type: "supplier", party_id: sup.id, party_name: sup.name, party_address: sup.address,
        supplier_invoice_no: trimOrNull(input.supplierInvoiceNo), description: trimOrNull(input.description),
        gross: toRupees(calc.grossPaisa), discount: toRupees(calc.discountPaisa), sales_tax: toRupees(calc.taxPaisa), total: toRupees(calc.totalPaisa),
        paid: toRupees(paid), balance: toRupees(calc.totalPaisa - paid), status: "final", created_by: context().userName,
      } as never, "AND doc_type = ?", ["purchase"]);
      for (const [i, x] of prepared.entries()) {
        const c = calc.lines[i];
        const item = await insert<DistDocItem>("dist_doc_items", {
          doc_id: doc.id, product_id: x.p.id, code: x.p.code, name: x.p.name, unit: x.p.unit, company_id: x.p.company_id, category_id: x.p.category_id, batch_no: x.batchNo, expiry: x.expiry,
          qty: x.qty, price: x.cost, discount: toRupees(c.discountPaisa), sales_tax_rate: x.taxRate, sales_tax: toRupees(c.taxPaisa), line_total: toRupees(c.totalPaisa), cost: x.cost,
        } as never);
        const fresh = await owned<DistProduct>("dist_products", x.p.id, "Product");
        const unitCost = toRupees(c.grossPaisa - c.discountPaisa) / x.qty;
        const avg = fresh.stock > 0 ? (fresh.stock * fresh.avg_cost + x.qty * unitCost) / (fresh.stock + x.qty) : unitCost;
        await update("dist_products", x.p.id, { avg_cost: Math.round(avg * 10000) / 10000, cost: x.cost });
        await addStock(x.p.id, x.qty);
        await stockMove(x.p.id, x.qty, "purchase", doc.id, item.id, unitCost);
      }
      for (const pm of payments) await insert("dist_payments", { party_type: "supplier", party_id: sup.id, doc_id: doc.id, amount: Number(pm.amount), method: pm.method, date: doc.date, reference: pm.reference ?? null, created_by: context().userName } as never);
      await audit("purchase.create", "doc", doc.id, { detail: { no: doc.doc_no, total: doc.total } });
      return docWithItems(doc.id);
    },
    async createPurchaseReturn(input: { purchaseId: string; lines: { itemId: string; qty: number }[]; reason: string; refund?: PaymentIn | null }) {
      await need("purchases.return");
      return returnInternal("purchase", input);
    },

    // ── Payments & balances ──
    async receivePayment(input: { partyType: "customer" | "supplier"; partyId: string; amount: number; method: PaymentIn["method"]; docId?: string | null; reference?: string | null; note?: string | null }) {
      await need("payments.receive");
      const table = input.partyType === "customer" ? "dist_customers" : "suppliers";
      await owned(table, input.partyId, input.partyType === "customer" ? "Customer" : "Supplier", true);
      const amount = Number(input.amount);
      if (!(amount > 0)) throw new DistError("INVALID", "Enter an amount.");
      if (input.docId) {
        const d = await owned<DistDoc>("dist_docs", input.docId, "Document");
        if (d.party_id !== input.partyId) throw new DistError("INVALID", "That document belongs to someone else.");
        if (toPaisa(amount) > toPaisa(d.balance)) throw new DistError("INVALID", `Only Rs ${d.balance} is due on this document.`);
        const ok = await update("dist_docs", d.id, { paid: toRupees(toPaisa(d.paid) + toPaisa(amount)), balance: toRupees(toPaisa(d.balance) - toPaisa(amount)) }, { sql: "balance = ?", params: [d.balance] });
        if (!ok) throw new DistError("CONFLICT", "The document changed; reload.");
      }
      const row = await insert("dist_payments", { party_type: input.partyType, party_id: input.partyId, doc_id: input.docId ?? null, amount, method: input.method, date: today(), reference: trimOrNull(input.reference), note: trimOrNull(input.note), created_by: context().userName } as never);
      await audit("payment", input.partyType, input.partyId, { next: { amount, method: input.method, doc: input.docId ?? null } });
      return row;
    },
    async balances(type: "customer" | "supplier") {
      await need(type === "customer" ? "invoices.view" : "purchases.view");
      const [docIn, docOut] = type === "customer" ? ["sale", "sale_return"] : ["purchase", "purchase_return"];
      const rows = await db.select<{ id: string; name: string; phone: string | null; opening: number; billed: number; returned: number; paid: number }>(
        `SELECT p.id, ${type === "customer" ? "p.business_name" : "p.name"} AS name, ${type === "customer" ? "p.mobile" : "p.phone"} AS phone, COALESCE(p.opening_balance, 0) AS opening,
                COALESCE((SELECT SUM(total + wht_amount) FROM dist_docs d WHERE d.tenant_id = p.tenant_id AND d.party_id = p.id AND d.doc_type = '${docIn}' AND d.deleted_at IS NULL), 0) AS billed,
                COALESCE((SELECT SUM(total + wht_amount) FROM dist_docs d WHERE d.tenant_id = p.tenant_id AND d.party_id = p.id AND d.doc_type = '${docOut}' AND d.deleted_at IS NULL), 0) AS returned,
                COALESCE((SELECT SUM(amount) FROM dist_payments x WHERE x.tenant_id = p.tenant_id AND x.party_type = '${type}' AND x.party_id = p.id AND x.deleted_at IS NULL), 0) AS paid
         FROM ${type === "customer" ? "dist_customers" : "suppliers"} p WHERE p.tenant_id = ? ORDER BY name`,
        [tenant()]
      );
      return rows.map((r) => ({ ...r, balance: toRupees(toPaisa(r.opening) + toPaisa(r.billed) - toPaisa(r.returned) - toPaisa(r.paid)) })).filter((r) => r.billed || r.paid || r.opening);
    },
    async ledger(type: "customer" | "supplier", id: string) {
      await need(type === "customer" ? "invoices.view" : "purchases.view");
      await owned(type === "customer" ? "dist_customers" : "suppliers", id, type, true);
      const docs = await db.select<DistDoc>(`SELECT * FROM dist_docs WHERE tenant_id = ? AND party_type = ? AND party_id = ? AND deleted_at IS NULL ORDER BY date, doc_no`, [tenant(), type, id]);
      const payments = await db.select(`SELECT * FROM dist_payments WHERE tenant_id = ? AND party_type = ? AND party_id = ? AND deleted_at IS NULL ORDER BY date, created_at`, [tenant(), type, id]);
      return { docs, payments };
    },

    // ── Targets, dashboards, reports ──
    /** One salesman's month on every metric, with breakdowns. The configured
     * metric drives achievement for both dashboards. Bookings count by
     * booking value, invoices by invoice value: a converted booking is never
     * counted in both. */
    async performance(salesmanId: string, month: string) {
      const me = await mySalesman();
      if (me?.id !== salesmanId) await need("targets.view");
      const s = await owned<DistSalesman>("dist_salesmen", salesmanId, "Salesman", true);
      const { settings } = await cfg();
      const from = `${month}-01`;
      const to = `${month}-31`;
      const t = await db.select<{ amount: number }>(`SELECT amount FROM dist_targets WHERE tenant_id = ? AND salesman_id = ? AND month = ?`, [tenant(), salesmanId, month]);
      const target = t[0]?.amount ?? s.monthly_target ?? 0;
      const bookings = await db.select<{ status: string; n: number; total: number }>(`SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM dist_bookings WHERE tenant_id = ? AND salesman_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY status`, [tenant(), salesmanId, from, to]);
      const docs = await db.select<{ doc_type: string; n: number; total: number }>(`SELECT doc_type, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM dist_docs WHERE tenant_id = ? AND salesman_id = ? AND doc_type IN ('sale', 'sale_return') AND date BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY doc_type`, [tenant(), salesmanId, from, to]);
      const collected = await db.select<{ total: number }>(`SELECT COALESCE(SUM(x.amount), 0) AS total FROM dist_payments x JOIN dist_docs d ON d.id = x.doc_id AND d.tenant_id = x.tenant_id WHERE x.tenant_id = ? AND d.salesman_id = ? AND x.party_type = 'customer' AND x.date BETWEEN ? AND ?`, [tenant(), salesmanId, from, to]);
      const by = (st: string[]) => bookings.filter((b) => st.includes(b.status)).reduce((a, b) => ({ n: a.n + b.n, total: toRupees(toPaisa(a.total) + toPaisa(b.total)) }), { n: 0, total: 0 });
      const sale = docs.find((d) => d.doc_type === "sale") ?? { n: 0, total: 0 };
      const ret = docs.find((d) => d.doc_type === "sale_return") ?? { n: 0, total: 0 };
      const metrics = {
        bookings: by(["submitted", "pending_approval", "approved", "converted"]).total,
        approved: by(["approved", "converted"]).total,
        invoiced: sale.total,
        net_sales: toRupees(toPaisa(sale.total) - toPaisa(ret.total)),
      };
      const achieved = metrics[settings.target.metric];
      const progress = targetProgress(target, achieved, month, today(), settings.target.onTrackRatio);
      const breakdown = async (dim: "day" | "week" | "company" | "category" | "customer") => {
        const useDocs = settings.target.metric === "invoiced" || settings.target.metric === "net_sales";
        const label = { day: "x.date", week: "strftime('%W', x.date)", company: "COALESCE(k.name, '-')", category: "COALESCE(g.name, '-')", customer: "c.business_name" }[dim];
        const sign = useDocs ? "CASE WHEN x.doc_type = 'sale_return' THEN -1 ELSE 1 END" : "1";
        const src = useDocs
          ? `FROM dist_doc_items i JOIN dist_docs x ON x.id = i.doc_id AND x.tenant_id = i.tenant_id LEFT JOIN dist_customers c ON c.id = x.party_id AND c.tenant_id = x.tenant_id
             WHERE x.tenant_id = ? AND x.salesman_id = ? AND x.date BETWEEN ? AND ? AND x.doc_type IN ('sale'${settings.target.metric === "net_sales" ? ", 'sale_return'" : ""}) AND x.deleted_at IS NULL`
          : `FROM dist_booking_items i JOIN dist_bookings x ON x.id = i.booking_id AND x.tenant_id = i.tenant_id LEFT JOIN dist_customers c ON c.id = x.customer_id AND c.tenant_id = x.tenant_id
             WHERE x.tenant_id = ? AND x.salesman_id = ? AND x.date BETWEEN ? AND ? AND x.status IN (${settings.target.metric === "bookings" ? "'submitted','pending_approval','approved','converted'" : "'approved','converted'"}) AND x.deleted_at IS NULL`;
        return db.select<{ label: string; amount: number }>(
          `SELECT ${label} AS label, ROUND(SUM(${sign} * i.line_total), 2) AS amount ${src.replace("WHERE", `LEFT JOIN dist_products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id LEFT JOIN dist_companies k ON k.id = p.company_id AND k.tenant_id = p.tenant_id LEFT JOIN dist_categories g ON g.id = p.category_id AND g.tenant_id = p.tenant_id WHERE`)} GROUP BY 1 ORDER BY ${dim === "day" || dim === "week" ? "1" : "2 DESC"}`,
          [tenant(), salesmanId, from, to]
        );
      };
      return {
        salesman: s,
        month,
        metric: settings.target.metric,
        progress,
        metrics,
        counts: { draft: by(["draft"]).n, pending: by(["submitted", "pending_approval"]).n, approved: by(["approved"]).n, converted: by(["converted"]).n, rejected: by(["rejected"]).n, cancelled: by(["cancelled"]).n, invoices: sale.n, returns: ret.n },
        values: { bookingValue: metrics.bookings, approvedValue: metrics.approved, invoiced: sale.total, returns: ret.total, netSales: metrics.net_sales, collected: collected[0]?.total ?? 0 },
        breakdowns: { day: await breakdown("day"), week: await breakdown("week"), company: await breakdown("company"), category: await breakdown("category"), customer: await breakdown("customer") },
      };
    },
    async salesBy(dim: "company" | "category" | "salesman" | "customer" | "day", from: string, to: string) {
      await need("reports.view");
      const label = { company: "COALESCE(k.name, '-')", category: "COALESCE(g.name, '-')", salesman: "COALESCE(s.name, '(none)')", customer: "COALESCE(d.party_name, '-')", day: "d.date" }[dim];
      return db.select<{ label: string; qty: number; amount: number }>(
        `SELECT ${label} AS label, ROUND(SUM(CASE WHEN d.doc_type = 'sale' THEN i.qty ELSE -i.qty END), 3) AS qty,
                ROUND(SUM(CASE WHEN d.doc_type = 'sale' THEN i.line_total ELSE -i.line_total END), 2) AS amount
         FROM dist_doc_items i JOIN dist_docs d ON d.id = i.doc_id AND d.tenant_id = i.tenant_id
         LEFT JOIN dist_companies k ON k.id = i.company_id AND k.tenant_id = i.tenant_id
         LEFT JOIN dist_categories g ON g.id = i.category_id AND g.tenant_id = i.tenant_id
         LEFT JOIN dist_salesmen s ON s.id = d.salesman_id AND s.tenant_id = d.tenant_id
         WHERE i.tenant_id = ? AND d.doc_type IN ('sale', 'sale_return') AND d.date BETWEEN ? AND ? AND i.deleted_at IS NULL
         GROUP BY 1 ORDER BY ${dim === "day" ? "1" : "3 DESC"}`,
        [tenant(), from, to]
      );
    },
    /** Withholding tax collected (net of credit notes) by section and status, per customer. */
    async whtReport(from: string, to: string) {
      await need("reports.view");
      return db.select<{ party_name: string; party_ntn: string | null; wht_section: string | null; wht_status: string | null; invoices: number; base: number; wht: number; overridden: number }>(
        `SELECT party_name, party_ntn, wht_section, wht_status, COUNT(*) AS invoices,
                ROUND(SUM(CASE WHEN doc_type = 'sale' THEN wht_base ELSE -wht_base END), 2) AS base,
                ROUND(SUM(CASE WHEN doc_type = 'sale' THEN wht_amount ELSE -wht_amount END), 2) AS wht,
                SUM(wht_overridden) AS overridden
         FROM dist_docs WHERE tenant_id = ? AND doc_type IN ('sale', 'sale_return') AND date BETWEEN ? AND ? AND deleted_at IS NULL
         GROUP BY party_id, wht_section, wht_status ORDER BY party_name`,
        [tenant(), from, to]
      );
    },
    async bookingConversion(from: string, to: string) {
      await need("reports.view");
      return db.select<{ status: string; n: number; total: number; invoiced: number }>(
        `SELECT b.status, COUNT(*) AS n, ROUND(SUM(b.total), 2) AS total, ROUND(SUM(COALESCE(d.total, 0)), 2) AS invoiced
         FROM dist_bookings b LEFT JOIN dist_docs d ON d.id = b.invoice_id AND d.tenant_id = b.tenant_id
         WHERE b.tenant_id = ? AND b.date BETWEEN ? AND ? AND b.deleted_at IS NULL GROUP BY b.status`,
        [tenant(), from, to]
      );
    },
    async stockMoves(productId?: string | null) {
      await need("catalog.view");
      return db.select(
        `SELECT m.*, p.name, p.code, p.unit FROM dist_stock_moves m JOIN dist_products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? ${productId ? "AND m.product_id = ?" : ""} ORDER BY m.created_at DESC LIMIT 1000`,
        productId ? [tenant(), productId] : [tenant()]
      );
    },
    async audits(limit = 500) {
      needAdmin("settings.manage");
      return db.select<{ id: string; created_at: string; user_name: string | null; action: string; record_type: string | null; record_id: string | null; field: string | null; old_value: string | null; new_value: string | null; reason: string | null; detail: string | null }>(`SELECT * FROM dist_audit WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`, [tenant(), limit]);
    },
    async adminSummary(from: string, to: string) {
      await need("reports.view");
      const r = await db.select<{ doc_type: string; n: number; total: number; wht: number }>(`SELECT doc_type, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(wht_amount), 0) AS wht FROM dist_docs WHERE tenant_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY doc_type`, [tenant(), from, to]);
      const b = await db.select<{ status: string; n: number; total: number }>(`SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM dist_bookings WHERE tenant_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY status`, [tenant(), from, to]);
      const get = (t: string) => r.find((x) => x.doc_type === t) ?? { n: 0, total: 0, wht: 0 };
      return { sales: get("sale"), returns: get("sale_return"), purchases: get("purchase"), purchaseReturns: get("purchase_return"), bookings: b };
    },
  };

  interface WhtOverride {
    rate?: number | null;
    amount?: number | null;
    base?: "net_incl_sales_tax" | "net_excl_sales_tax" | null;
    reason?: string | null;
  }

  async function createSaleInternal(input: { customerId: string; lines: LineIn[]; billDiscount?: number; payments?: PaymentIn[]; description?: string | null; wht?: WhtOverride; bookingId: string | null; salesmanId: string | null; date?: string; bookingItems?: DistBookingItem[] }) {
    const { mode, settings } = await cfg();
    const customer = await owned<DistCustomer>("dist_customers", input.customerId, "Customer");
    if (customer.status !== "active") throw new DistError("CONFLICT", `${customer.business_name} is inactive.`);
    await assertCdsl(customer, settings, mode);
    if (input.description?.trim()) await need("invoices.edit_description");
    // Lines from a booking keep their authorised price / discount; anything else is checked.
    const fromBooking = (l: LineIn) => input.bookingItems?.find((i) => i.product_id === l.productId && toPaisa(i.price) === toPaisa(l.price ?? i.price) && toPaisa(i.discount) === toPaisa(l.discount ?? i.discount));
    const prepared: Awaited<ReturnType<typeof priceLines>> = [];
    for (const l of input.lines) {
      const b = fromBooking(l);
      if (b) {
        const p = await owned<DistProduct>("dist_products", l.productId, "Product");
        prepared.push({ p, qty: Math.round(Number(l.qty) * 1000) / 1000, price: b.price, discount: b.discount, batchNo: trimOrNull(l.batchNo), expiry: trimOrNull(l.expiry) });
      } else prepared.push(...(await priceLines([l], {})));
    }
    const billDiscount = Math.max(0, Number(input.billDiscount) || 0);
    if (billDiscount > 0) await need("invoices.discount");
    const calc = calcDoc(prepared.map((x) => ({ qty: x.qty, price: x.price, discount: x.discount, taxRate: x.p.sales_tax_rate })), billDiscount);

    // Withholding tax: from the customer's recorded ATL status (never assumed active).
    const now = await dbNow();
    const t = whtTreatment(settings, { ntn: customer.ntn, cnic: customer.cnic, taxClass: customer.tax_class, atlStatus: customer.atl_status, atlCheckedAt: customer.atl_checked_at, atlSource: customer.atl_source }, now);
    const o = input.wht ?? {};
    const overriding = o.rate != null || o.amount != null || o.base != null;
    if (t.blocked && !overriding) throw new DistError("CONFLICT", t.blocked);
    if (overriding && !o.reason?.trim()) throw new DistError("INVALID", "Give a reason for changing the withholding tax.");
    let rate = t.rate;
    if (o.rate != null && Number(o.rate) !== t.rate) {
      await need("invoices.edit_wht_rate");
      if (!(Number(o.rate) >= 0 && Number(o.rate) <= 100)) throw new DistError("INVALID", "Withholding rate must be 0-100 %.");
      rate = Number(o.rate);
    }
    const effSettings = o.base && o.base !== settings.wht.base ? (await need("invoices.edit_tax_base"), { ...settings, wht: { ...settings.wht, base: o.base } }) : settings;
    const computed = whtAmount(effSettings, calc, rate);
    const basePaisa = computed.basePaisa;
    let amountPaisa = computed.amountPaisa;
    const computedPaisa = amountPaisa;
    if (o.amount != null && toPaisa(Number(o.amount)) !== amountPaisa) {
      await need("invoices.edit_wht_amount");
      if (!(Number(o.amount) >= 0)) throw new DistError("INVALID", "Withholding amount must be 0 or more.");
      amountPaisa = toPaisa(Number(o.amount));
    }
    const overridden = rate !== t.rate || amountPaisa !== computedPaisa || effSettings !== settings;
    const snapshot = {
      ntn: customer.ntn, cnic: customer.cnic, taxClass: customer.tax_class, atlStatus: customer.atl_status, atlCheckedAt: customer.atl_checked_at, atlSource: customer.atl_source, atlCheckId: customer.atl_check_id,
      treatment: t, base: effSettings.wht.base, rounding: settings.wht.rounding, computedRate: t.rate, computedAmount: toRupees(computedPaisa),
      appliedRate: rate, appliedAmount: toRupees(amountPaisa), overridden, overrideReason: overridden ? o.reason : null, at: now, by: context().userName,
    };

    const payable = calc.totalPaisa + amountPaisa;
    const payments = (input.payments ?? []).filter((x) => Number(x.amount) > 0);
    if (payments.length) await need("payments.receive");
    const paid = Math.min(payable, payments.reduce((s, x) => s + toPaisa(x.amount), 0));

    // Stock claims first (each one conditional), undone if anything fails.
    const taken: { id: string; qty: number }[] = [];
    try {
      for (const x of prepared) {
        if (!(await claimStock(x.p.id, x.qty, settings.stock.allowNegative))) throw new DistError("CONFLICT", `Only ${(await owned<DistProduct>("dist_products", x.p.id, "Product")).stock} ${x.p.unit} of ${x.p.name} in stock.`);
        taken.push({ id: x.p.id, qty: x.qty });
      }
      const doc = await insertNumbered<DistDoc>("dist_docs", "doc_no", {
        doc_type: "sale", date: input.date || today(), party_type: "customer", party_id: customer.id, party_name: customer.business_name, party_ntn: customer.ntn, party_cnic: customer.cnic, party_address: customer.address,
        salesman_id: input.salesmanId, booking_id: input.bookingId, description: trimOrNull(input.description),
        gross: toRupees(calc.grossPaisa), discount: toRupees(calc.discountPaisa), sales_tax: toRupees(calc.taxPaisa),
        wht_section: t.section, wht_status: t.status, wht_rate: rate, wht_base: toRupees(basePaisa), wht_amount: toRupees(amountPaisa), wht_overridden: overridden ? 1 : 0, tax_snapshot: JSON.stringify(snapshot),
        total: toRupees(calc.totalPaisa), paid: toRupees(paid), balance: toRupees(payable - paid),
        cost_total: toRupees(prepared.reduce((s, x) => s + Math.round(toPaisa(x.p.avg_cost) * x.qty), 0)), status: "final", created_by: context().userName,
      } as never, "AND doc_type = ?", ["sale"]);
      for (const [i, x] of prepared.entries()) {
        const c = calc.lines[i];
        const item = await insert<DistDocItem>("dist_doc_items", {
          doc_id: doc.id, product_id: x.p.id, code: x.p.code, name: x.p.name, unit: x.p.unit, company_id: x.p.company_id, category_id: x.p.category_id, batch_no: x.batchNo, expiry: x.expiry,
          qty: x.qty, price: x.price, discount: toRupees(c.discountPaisa), sales_tax_rate: x.p.sales_tax_rate, sales_tax: toRupees(c.taxPaisa), line_total: toRupees(c.totalPaisa), cost: x.p.avg_cost,
        } as never);
        await stockMove(x.p.id, -x.qty, "sale", doc.id, item.id, x.p.avg_cost);
      }
      for (const pm of payments) await insert("dist_payments", { party_type: "customer", party_id: customer.id, doc_id: doc.id, amount: Number(pm.amount), method: pm.method, date: doc.date, reference: pm.reference ?? null, created_by: context().userName } as never);
      await audit("invoice.create", "doc", doc.id, { detail: { no: doc.doc_no, total: doc.total, wht: doc.wht_amount, booking: input.bookingId } });
      if (overridden) await audit("invoice.wht_override", "doc", doc.id, { field: "wht", old: { rate: t.rate, amount: toRupees(computedPaisa), base: settings.wht.base }, next: { rate, amount: toRupees(amountPaisa), base: effSettings.wht.base }, reason: o.reason ?? null });
      return docWithItems(doc.id);
    } catch (e) {
      for (const x of taken) await addStock(x.id, x.qty);
      throw e;
    }
  }

  async function returnInternal(kind: "sale" | "purchase", input: { invoiceId?: string; purchaseId?: string; lines: { itemId: string; qty: number }[]; reason: string; refund?: PaymentIn | null }) {
    const { settings } = await cfg();
    if (!input.reason?.trim()) throw new DistError("INVALID", "Give a reason for the return.");
    const orig = await owned<DistDoc>("dist_docs", kind === "sale" ? input.invoiceId : input.purchaseId, "Document");
    if (orig.doc_type !== kind) throw new DistError("INVALID", `That is not a ${kind} document.`);
    const items = await db.select<DistDocItem>(`SELECT * FROM dist_doc_items WHERE tenant_id = ? AND doc_id = ? AND deleted_at IS NULL`, [tenant(), orig.id]);
    const picked = input.lines.filter((l) => Number(l.qty) > 0).map((l) => {
      const it = items.find((i) => i.id === l.itemId);
      if (!it) throw new DistError("NOT_FOUND", "Line not found on this document.");
      return { it, qty: Math.round(Number(l.qty) * 1000) / 1000 };
    });
    if (!picked.length) throw new DistError("INVALID", "Enter a quantity to return.");
    const claimed: { id: string; qty: number }[] = [];
    const stockTaken: { id: string; qty: number }[] = [];
    try {
      for (const { it, qty } of picked) {
        const { changes } = await db.execute(`UPDATE dist_doc_items SET returned_qty = ROUND(returned_qty + ?, 3), updated_at = ? WHERE id = ? AND tenant_id = ? AND ROUND(qty - returned_qty - ?, 3) >= 0`, [qty, iso(db.now()), it.id, tenant(), qty]);
        if (!changes) throw new DistError("CONFLICT", `Only ${Math.round((it.qty - it.returned_qty) * 1000) / 1000} of ${it.name} can still be returned.`);
        claimed.push({ id: it.id, qty });
        await syncRow("dist_doc_items", it.id);
      }
      if (kind === "purchase")
        for (const { it, qty } of picked) {
          if (!(await claimStock(it.product_id, qty, settings.stock.allowNegative))) throw new DistError("CONFLICT", `Not enough stock of ${it.name} to return.`);
          stockTaken.push({ id: it.product_id, qty });
        }
      const calc = calcDoc(picked.map(({ it, qty }) => ({ qty, price: it.price, discount: (it.discount * qty) / it.qty, taxRate: it.sales_tax_rate })), 0);
      // Withholding reversed at the original invoice's applied rate and base.
      const snap = json<{ base?: string }>(orig.tax_snapshot, {});
      const basePaisa = calc.totalPaisa - (snap.base === "net_excl_sales_tax" ? calc.taxPaisa : 0);
      const whtPaisa = kind === "sale" ? Math.round((basePaisa * orig.wht_rate) / 100) : 0;
      const doc = await insertNumbered<DistDoc>("dist_docs", "doc_no", {
        doc_type: `${kind}_return`, date: today(), party_type: orig.party_type, party_id: orig.party_id, party_name: orig.party_name, party_ntn: orig.party_ntn, party_cnic: orig.party_cnic, party_address: orig.party_address,
        salesman_id: orig.salesman_id, ref_doc_id: orig.id, description: input.reason.trim(),
        gross: toRupees(calc.grossPaisa), discount: toRupees(calc.discountPaisa), sales_tax: toRupees(calc.taxPaisa),
        wht_section: orig.wht_section, wht_status: orig.wht_status, wht_rate: kind === "sale" ? orig.wht_rate : 0, wht_base: kind === "sale" ? toRupees(basePaisa) : 0, wht_amount: toRupees(whtPaisa),
        tax_snapshot: orig.tax_snapshot, total: toRupees(calc.totalPaisa), paid: 0, balance: 0, status: "final", created_by: context().userName,
      } as never, "AND doc_type = ?", [`${kind}_return`]);
      for (const [i, { it, qty }] of picked.entries()) {
        const c = calc.lines[i];
        const item = await insert<DistDocItem>("dist_doc_items", { doc_id: doc.id, product_id: it.product_id, ref_item_id: it.id, code: it.code, name: it.name, unit: it.unit, company_id: it.company_id, category_id: it.category_id, qty, price: it.price, discount: toRupees(c.discountPaisa), sales_tax_rate: it.sales_tax_rate, sales_tax: toRupees(c.taxPaisa), line_total: toRupees(c.totalPaisa), cost: it.cost } as never);
        if (kind === "sale") await addStock(it.product_id, qty);
        await stockMove(it.product_id, kind === "sale" ? qty : -qty, `${kind}_return`, doc.id, item.id, it.cost);
      }
      if (input.refund && Number(input.refund.amount) > 0) {
        await need("payments.receive");
        await insert("dist_payments", { party_type: orig.party_type, party_id: orig.party_id, doc_id: doc.id, amount: -Math.abs(Number(input.refund.amount)), method: input.refund.method, date: today(), note: "Refund", created_by: context().userName } as never);
      }
      await audit(`${kind}.return`, "doc", doc.id, { detail: { against: orig.doc_no, total: doc.total, wht: doc.wht_amount }, reason: input.reason });
      return docWithItems(doc.id);
    } catch (e) {
      for (const s of stockTaken) await addStock(s.id, s.qty);
      for (const c of claimed) {
        await db.execute(`UPDATE dist_doc_items SET returned_qty = ROUND(returned_qty - ?, 3) WHERE id = ? AND tenant_id = ?`, [c.qty, c.id, tenant()]);
        await syncRow("dist_doc_items", c.id);
      }
      throw e;
    }
  }

  return api;
}

export type DistStore = ReturnType<typeof createDistStore>;
export { BOOKING_FLOW };
