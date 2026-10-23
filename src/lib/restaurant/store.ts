/**
 * Restaurant data layer. Every read and write is scoped to the tenant taken
 * from the session context (never from caller input), every id a caller
 * passes is checked for ownership, permissions are enforced here (not only
 * in the UI), and prices/discounts/tax are always computed here from stored
 * menu data, so a caller cannot inject a price.
 *
 * The database is behind the `RestDb` port: in the app it is the local SQLite
 * (synced to Turso through the outbox); in tests it is node:sqlite running
 * the same migration SQL. Relative imports only (runs under `node --test`).
 *
 * Note on atomicity: the Tauri SQL plugin runs statements on a connection
 * pool, so multi-statement transactions are not reliable. Operations here
 * are made safe instead with conditional updates (`WHERE status = ...`),
 * unique indexes and idempotent steps, ordered so a retry cannot double
 * charge, double deduct stock or double submit.
 */

import {
  type DealComponent,
  type DealLike,
  type KitchenStatus,
  type Line,
  type MenuItemLike,
  type OfferLike,
  type OrderStatus,
  type OrderType,
  type PayMethod,
  type Payment,
  type PriceOption,
  type TableStatus,
  type TaxSettings,
  applyOffers,
  canKitchenMove,
  canOrderMove,
  canTableMove,
  computeBill,
  lineGross,
  paymentStatus,
  toPaisa,
  toRupees,
  unitPricePaisa,
  validateDeal,
  ymd,
} from "./engine.ts";

// ── Ports ─────────────────────────────────────────────────────────────

export interface RestDb {
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Returns rows changed (used for conditional-update claims). */
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Mirrors a write into the sync outbox (no-op in tests). */
  outbox(table: string, id: string, op: "insert" | "update" | "delete", row: Record<string, unknown> | null): Promise<void>;
  newId(): string;
  now(): Date;
}

export interface RestContext {
  tenantId: string | null;
  businessType: string | null;
  userId: string | null;
  userName: string | null;
  role: "super_admin" | "owner" | "staff" | null;
  /** Actions denied to this user (tenant-wide denials included). */
  deniedActions: string[];
}

export type RestAction = "rest.order" | "rest.discount" | "rest.void" | "rest.refund" | "rest.menu" | "rest.settings";

export class RestError extends Error {
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT";
  constructor(code: RestError["code"], message: string) {
    super(message);
    this.name = "RestError";
    this.code = code;
  }
}

// ── Row types ─────────────────────────────────────────────────────────

interface Base {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CategoryRow extends Base {
  name: string;
  description: string | null;
  sort_order: number;
  is_active: number;
  avail_from: string | null;
  avail_to: string | null;
}

export interface MenuItemRow extends Base {
  category_id: string | null;
  code: string;
  name: string;
  description: string | null;
  price: number;
  takeaway_price: number | null;
  variants: string | null;
  modifiers: string | null;
  station: string | null;
  prep_minutes: number | null;
  tax_exempt: number;
  is_available: number;
  image: string | null;
  sort_order: number;
  cost: number | null;
}

export interface TableRow extends Base {
  name: string;
  area: string | null;
  capacity: number;
  sort_order: number;
  is_active: number;
  status: TableStatus;
  current_order_id: string | null;
}

export interface OrderRow extends Base {
  order_no: number;
  order_type: OrderType;
  table_id: string | null;
  status: OrderStatus;
  customer_name: string | null;
  customer_phone: string | null;
  guests: number | null;
  cashier_id: string | null;
  cashier_name: string | null;
  offers: string | null;
  coupon: string | null;
  gross: number;
  discount: number;
  service_charge: number;
  tax: number;
  tax_rate: number;
  total: number;
  paid: number;
  payment_status: string;
  payments: string | null;
  invoice_no: number | null;
  invoiced_at: string | null;
  refund_of: string | null;
  cancel_reason: string | null;
  notes: string | null;
  opened_at: string | null;
  closed_at: string | null;
  pra_status: string;
  pra_invoice_no: string | null;
}

export interface OrderItemRow extends Base {
  order_id: string;
  menu_item_id: string | null;
  deal_id: string | null;
  parent_item_id: string | null;
  code: string | null;
  name: string;
  category_id: string | null;
  variant: string | null;
  modifiers: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
  tax_exempt: number;
  notes: string | null;
  station: string | null;
  kitchen_status: KitchenStatus;
  kot_no: number | null;
  sent_at: string | null;
  cancel_reason: string | null;
  line_discount: number;
  line_tax: number;
  refunded: number;
}

export interface DealRow extends Base {
  code: string;
  name: string;
  description: string | null;
  image: string | null;
  price: number;
  items: string;
  start_date: string | null;
  end_date: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  max_redemptions: number | null;
  redemptions: number;
  is_active: number;
}

export interface OfferRow extends Base {
  code: string;
  name: string;
  type: OfferLike["type"];
  value: number;
  buy_qty: number | null;
  get_qty: number | null;
  applies_to: OfferLike["applies_to"];
  target_ids: string | null;
  min_order: number | null;
  min_qty: number | null;
  max_discount: number | null;
  start_date: string | null;
  end_date: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  usage_limit: number | null;
  used_count: number;
  coupon_code: string | null;
  stackable: number;
  exclude_discounted: number;
  is_active: number;
}

export interface IngredientRow extends Base {
  name: string;
  unit: string;
  purchase_unit: string | null;
  purchase_factor: number;
  stock: number;
  cost: number;
  reorder_level: number;
  is_active: number;
}

export interface KotRow extends Base {
  order_id: string;
  kot_no: number;
  station: string | null;
  item_ids: string;
  printed_count: number;
}

export interface PraSubmissionRow extends Base {
  order_id: string;
  usin: string;
  invoice_type: number;
  ref_usin: string | null;
  status: string;
  attempts: number;
  pra_invoice_no: string | null;
  response_code: string | null;
  response_text: string | null;
  payload: string | null;
  last_error: string | null;
  submitted_at: string | null;
  lock_until: string | null;
}

// ── Settings keys (tenant-prefixed in the settings table) ─────────────

export const REST_SETTINGS = {
  cashRate: "rest_tax_cash_rate",
  cardRate: "rest_tax_card_rate",
  serviceChargePct: "rest_service_charge_pct",
  serviceChargeTaxable: "rest_service_charge_taxable",
  pctCode: "rest_pct_code",
  dailyTarget: "rest_daily_target",
  stations: "rest_stations",
  praEnabled: "pra_enabled",
  praMode: "pra_mode",
  praEnv: "pra_environment",
  praPosId: "pra_pos_id",
} as const;

const json = <T>(v: string | null | undefined, fallback: T): T => {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

const iso = (d: Date) => d.toISOString();

// ── Store ─────────────────────────────────────────────────────────────

export function createRestaurantStore(db: RestDb, context: () => RestContext) {
  /** Tenant of the signed-in restaurant user; refuses anyone else. */
  function tenant(): string {
    const c = context();
    if (!c.tenantId) throw new RestError("UNAUTHENTICATED", "Sign in to a restaurant account first.");
    if (c.businessType !== "restaurant") throw new RestError("FORBIDDEN", "This account is not a restaurant.");
    return c.tenantId;
  }

  function need(action: RestAction) {
    const c = context();
    tenant();
    if (c.role === "super_admin") return;
    if (c.deniedActions.includes(action)) throw new RestError("FORBIDDEN", "You don't have permission for this action.");
  }

  async function insert<T extends Base>(table: string, row: Partial<T>): Promise<T> {
    const ts = iso(db.now());
    const record = { ...row, id: row.id ?? db.newId(), tenant_id: tenant(), created_at: ts, updated_at: ts, deleted_at: null } as unknown as T;
    const keys = Object.keys(record);
    await db.execute(
      `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      keys.map((k) => (record as unknown as Record<string, unknown>)[k] ?? null)
    );
    await db.outbox(table, record.id, "insert", record as unknown as Record<string, unknown>);
    return record;
  }

  /** Tenant-scoped update. `guard` adds extra WHERE conditions (claims). */
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

  async function softDelete(table: string, id: string) {
    await update(table, id, { deleted_at: iso(db.now()) });
  }

  /** Row by id, only if it belongs to this tenant (IDOR protection). */
  async function owned<T>(table: string, id: string | null | undefined, label: string): Promise<T> {
    if (!id) throw new RestError("INVALID", `${label} is required.`);
    const rows = await db.select<T>(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [id, tenant()]);
    if (!rows[0]) throw new RestError("NOT_FOUND", `${label} not found.`);
    return rows[0];
  }

  async function audit(action: string, recordType: string, recordId: string | null, detail?: unknown) {
    const c = context();
    await insert("rest_audit", {
      user_id: c.userId,
      user_name: c.userName,
      action,
      record_type: recordType,
      record_id: recordId,
      detail: detail === undefined ? null : typeof detail === "string" ? detail : JSON.stringify(detail),
    } as never);
  }

  // ── Settings ──
  async function getSetting(key: string): Promise<string | null> {
    const rows = await db.select<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [`${tenant()}::${key}`]);
    return rows[0]?.value ?? null;
  }

  async function setSetting(key: string, value: string) {
    const full = `${tenant()}::${key}`;
    const ts = iso(db.now());
    await db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [full, value, ts]
    );
    await db.outbox("settings", full, "update", { key: full, value, updated_at: ts });
  }

  async function taxSettings(): Promise<TaxSettings & { configured: boolean }> {
    const [cash, card, sc, sct] = await Promise.all([
      getSetting(REST_SETTINGS.cashRate),
      getSetting(REST_SETTINGS.cardRate),
      getSetting(REST_SETTINGS.serviceChargePct),
      getSetting(REST_SETTINGS.serviceChargeTaxable),
    ]);
    return {
      cashRate: Number(cash) || 0,
      cardRate: card != null && card !== "" ? Number(card) || 0 : Number(cash) || 0,
      serviceChargePct: Number(sc) || 0,
      serviceChargeTaxable: sct !== "false",
      // Tax rates must be set explicitly by the restaurant; none is assumed.
      configured: cash != null && cash !== "",
    };
  }

  // ── Menu ──
  const parseItem = (r: MenuItemRow): MenuItemLike & MenuItemRow => ({
    ...r,
    variants: json<PriceOption[]>(r.variants as unknown as string, []),
    modifiers: json<PriceOption[]>(r.modifiers as unknown as string, []),
  }) as unknown as MenuItemLike & MenuItemRow;

  function cleanOptions(list: PriceOption[] | undefined, label: string): PriceOption[] {
    const out: PriceOption[] = [];
    for (const o of list ?? []) {
      const name = String(o.name ?? "").trim();
      const price = Number(o.price);
      if (!name) continue;
      if (!Number.isFinite(price) || price < 0) throw new RestError("INVALID", `${label} "${name}" needs a price of 0 or more.`);
      if (out.some((x) => x.name === name)) throw new RestError("INVALID", `${label} "${name}" is listed twice.`);
      out.push({ name, price });
    }
    return out;
  }

  // ── Order helpers ──
  async function orderItems(orderId: string): Promise<OrderItemRow[]> {
    return db.select<OrderItemRow>(
      `SELECT * FROM rest_order_items WHERE order_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
      [orderId, tenant()]
    );
  }

  /** Billable lines: normal dishes and deal parents (deal components carry no price). */
  const billable = (items: OrderItemRow[]) => items.filter((i) => !i.parent_item_id && i.kitchen_status !== "cancelled");

  const toLine = (i: OrderItemRow): Line => ({
    id: i.id,
    menuItemId: i.menu_item_id,
    categoryId: i.category_id,
    dealId: i.deal_id,
    qty: i.qty,
    unitPaisa: toPaisa(i.unit_price),
  });

  async function nextNumber(column: "order_no" | "invoice_no"): Promise<number> {
    const rows = await db.select<{ n: number | null }>(`SELECT MAX(${column}) AS n FROM rest_orders WHERE tenant_id = ?`, [tenant()]);
    return (Number(rows[0]?.n) || 0) + 1;
  }

  async function nextKot(): Promise<number> {
    const rows = await db.select<{ n: number | null }>(`SELECT MAX(kot_no) AS n FROM rest_kots WHERE tenant_id = ?`, [tenant()]);
    return (Number(rows[0]?.n) || 0) + 1;
  }

  async function loadOffersByCode(codes: string[]): Promise<OfferLike[]> {
    const out: OfferLike[] = [];
    for (const code of codes) {
      const rows = await db.select<OfferRow>(
        `SELECT * FROM rest_offers WHERE tenant_id = ? AND deleted_at IS NULL AND (UPPER(code) = UPPER(?) OR UPPER(COALESCE(coupon_code, '')) = UPPER(?))`,
        [tenant(), code, code]
      );
      if (!rows[0]) throw new RestError("NOT_FOUND", `Offer "${code}" not found.`);
      out.push({ ...rows[0], target_ids: json<string[]>(rows[0].target_ids, []) } as OfferLike);
    }
    return out;
  }

  async function menuMap(): Promise<Map<string, MenuItemLike & MenuItemRow>> {
    const rows = await db.select<MenuItemRow>(`SELECT * FROM rest_menu_items WHERE tenant_id = ? AND deleted_at IS NULL`, [tenant()]);
    return new Map(rows.map((r) => [r.id, parseItem(r)]));
  }

  /** Ingredient deduction for one prepared line. Idempotent per
   * (ingredient, line): the unique index on rest_stock_moves rejects a
   * second deduction, and stock only changes when the move was recorded. */
  async function deductFor(item: OrderItemRow, reason: "sale" | "reversal") {
    if (!item.menu_item_id) return;
    const recipe = await db.select<{ ingredient_id: string; qty: number }>(
      `SELECT ingredient_id, qty FROM rest_recipe_lines WHERE tenant_id = ? AND menu_item_id = ? AND deleted_at IS NULL`,
      [tenant(), item.menu_item_id]
    );
    for (const r of recipe) {
      const qty = r.qty * item.qty * (reason === "sale" ? -1 : 1);
      if (!qty) continue;
      try {
        await insert("rest_stock_moves", { ingredient_id: r.ingredient_id, qty, reason, ref_id: item.id, created_by: context().userName } as never);
      } catch (e) {
        if (/UNIQUE/i.test(String(e))) continue; // already deducted (retry): skip
        throw e;
      }
      await db.execute(`UPDATE rest_ingredients SET stock = stock + ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [qty, iso(db.now()), r.ingredient_id, tenant()]);
      const ing = await db.select(`SELECT * FROM rest_ingredients WHERE id = ? AND tenant_id = ?`, [r.ingredient_id, tenant()]);
      if (ing[0]) await db.outbox("rest_ingredients", r.ingredient_id, "update", ing[0]);
    }
  }

  async function freeTable(order: OrderRow) {
    if (!order.table_id) return;
    await update("rest_tables", order.table_id, { status: "available", current_order_id: null }, { sql: "current_order_id = ?", params: [order.id] });
  }

  // ── Public API ──
  const api = {
    tenant,

    settings: {
      get: getSetting,
      async set(key: string, value: string) {
        need("rest.settings");
        await setSetting(key, value);
        await audit("settings.change", "setting", key, key.startsWith("pra_") ? "(PRA setting changed)" : value);
      },
      tax: taxSettings,
    },

    // Categories
    async listCategories(includeInactive = false): Promise<CategoryRow[]> {
      return db.select<CategoryRow>(
        `SELECT * FROM rest_categories WHERE tenant_id = ? AND deleted_at IS NULL ${includeInactive ? "" : "AND is_active = 1"} ORDER BY sort_order, name`,
        [tenant()]
      );
    },

    async saveCategory(input: Partial<CategoryRow>): Promise<CategoryRow> {
      need("rest.menu");
      const name = String(input.name ?? "").trim();
      if (!name) throw new RestError("INVALID", "Category name is required.");
      const data = {
        name,
        description: input.description ?? null,
        sort_order: Number(input.sort_order) || 0,
        is_active: input.is_active === 0 ? 0 : 1,
        avail_from: input.avail_from || null,
        avail_to: input.avail_to || null,
      };
      if (input.id) {
        await owned<CategoryRow>("rest_categories", input.id, "Category");
        await update("rest_categories", input.id, data);
        await audit("category.update", "category", input.id, data);
        return owned<CategoryRow>("rest_categories", input.id, "Category");
      }
      const row = await insert<CategoryRow>("rest_categories", data as never);
      await audit("category.create", "category", row.id, data);
      return row;
    },

    async reorderCategories(ids: string[]) {
      need("rest.menu");
      for (const [i, id] of ids.entries()) {
        await owned("rest_categories", id, "Category");
        await update("rest_categories", id, { sort_order: i });
      }
    },

    async deleteCategory(id: string) {
      need("rest.menu");
      await owned("rest_categories", id, "Category");
      await softDelete("rest_categories", id);
      await audit("category.delete", "category", id);
    },

    // Menu items
    async listMenuItems(opts: { categoryId?: string | null; search?: string; includeUnavailable?: boolean } = {}) {
      const where: string[] = ["m.tenant_id = ?", "m.deleted_at IS NULL"];
      const params: unknown[] = [tenant()];
      if (!opts.includeUnavailable) where.push("m.is_available = 1", "(c.id IS NULL OR c.is_active = 1)");
      if (opts.categoryId) {
        where.push("m.category_id = ?");
        params.push(opts.categoryId);
      }
      if (opts.search?.trim()) {
        where.push("(UPPER(m.name) LIKE ? OR UPPER(m.code) LIKE ?)");
        const q = `%${opts.search.trim().toUpperCase()}%`;
        params.push(q, q);
      }
      const rows = await db.select<MenuItemRow & { category_name: string | null }>(
        `SELECT m.*, c.name AS category_name FROM rest_menu_items m
         LEFT JOIN rest_categories c ON c.id = m.category_id AND c.tenant_id = m.tenant_id AND c.deleted_at IS NULL
         WHERE ${where.join(" AND ")} ORDER BY m.sort_order, m.name`,
        params
      );
      return rows.map((r) => ({ ...parseItem(r), category_name: r.category_name }));
    },

    async getMenuItem(id: string) {
      return parseItem(await owned<MenuItemRow>("rest_menu_items", id, "Dish"));
    },

    async saveMenuItem(input: Omit<Partial<MenuItemRow>, "variants" | "modifiers"> & { variants?: PriceOption[] | string | null; modifiers?: PriceOption[] | string | null }) {
      need("rest.menu");
      const name = String(input.name ?? "").trim();
      const code = String(input.code ?? "").trim().toUpperCase();
      const price = Number(input.price);
      if (!name) throw new RestError("INVALID", "Dish name is required.");
      if (!code) throw new RestError("INVALID", "Item code is required.");
      if (!Number.isFinite(price) || price < 0) throw new RestError("INVALID", "Price must be 0 or more.");
      if (input.category_id) await owned("rest_categories", input.category_id, "Category");
      const dup = await db.select<{ id: string }>(
        `SELECT id FROM rest_menu_items WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL AND id <> ?`,
        [tenant(), code, input.id ?? ""]
      );
      if (dup.length) throw new RestError("CONFLICT", `Item code ${code} is already used.`);
      const variants = cleanOptions(typeof input.variants === "string" ? json(input.variants, []) : input.variants ?? [], "Size");
      const modifiers = cleanOptions(typeof input.modifiers === "string" ? json(input.modifiers, []) : input.modifiers ?? [], "Add-on");
      const data = {
        category_id: input.category_id || null,
        code,
        name,
        description: input.description ?? null,
        price,
        takeaway_price: input.takeaway_price != null && String(input.takeaway_price) !== "" ? Number(input.takeaway_price) : null,
        variants: JSON.stringify(variants),
        modifiers: JSON.stringify(modifiers),
        station: input.station || null,
        prep_minutes: input.prep_minutes ? Number(input.prep_minutes) : null,
        tax_exempt: input.tax_exempt ? 1 : 0,
        is_available: input.is_available === 0 ? 0 : 1,
        image: input.image ?? null,
        sort_order: Number(input.sort_order) || 0,
        cost: input.cost != null && String(input.cost) !== "" ? Number(input.cost) : null,
      };
      if (input.id) {
        const before = await owned<MenuItemRow>("rest_menu_items", input.id, "Dish");
        await update("rest_menu_items", input.id, data);
        if (before.price !== data.price || before.takeaway_price !== data.takeaway_price) {
          await audit("menu.price_change", "menu_item", input.id, { from: before.price, to: data.price, takeawayFrom: before.takeaway_price, takeawayTo: data.takeaway_price });
        }
        await audit("menu.update", "menu_item", input.id, { name, code });
        return api.getMenuItem(input.id);
      }
      const row = await insert<MenuItemRow>("rest_menu_items", data as never);
      await audit("menu.create", "menu_item", row.id, { name, code, price });
      return parseItem(row);
    },

    async deleteMenuItem(id: string) {
      need("rest.menu");
      await owned("rest_menu_items", id, "Dish");
      await softDelete("rest_menu_items", id);
      await audit("menu.delete", "menu_item", id);
    },

    async getRecipe(menuItemId: string) {
      await owned("rest_menu_items", menuItemId, "Dish");
      return db.select<{ id: string; ingredient_id: string; qty: number; name: string; unit: string; cost: number }>(
        `SELECT r.id, r.ingredient_id, r.qty, i.name, i.unit, i.cost FROM rest_recipe_lines r
         JOIN rest_ingredients i ON i.id = r.ingredient_id AND i.tenant_id = r.tenant_id
         WHERE r.tenant_id = ? AND r.menu_item_id = ? AND r.deleted_at IS NULL`,
        [tenant(), menuItemId]
      );
    },

    async saveRecipe(menuItemId: string, lines: { ingredient_id: string; qty: number }[]) {
      need("rest.menu");
      await owned("rest_menu_items", menuItemId, "Dish");
      for (const l of lines) await owned("rest_ingredients", l.ingredient_id, "Ingredient");
      const old = await db.select<{ id: string }>(`SELECT id FROM rest_recipe_lines WHERE tenant_id = ? AND menu_item_id = ? AND deleted_at IS NULL`, [tenant(), menuItemId]);
      for (const o of old) await softDelete("rest_recipe_lines", o.id);
      for (const l of lines) {
        if (!(Number(l.qty) > 0)) continue;
        await insert("rest_recipe_lines", { menu_item_id: menuItemId, ingredient_id: l.ingredient_id, qty: Number(l.qty) } as never);
      }
      await audit("recipe.update", "menu_item", menuItemId, lines);
    },

    // Tables
    async listTables(includeInactive = false) {
      return db.select<TableRow & { order_total: number | null; opened_at: string | null; order_no: number | null }>(
        `SELECT t.*, o.total AS order_total, o.opened_at, o.order_no FROM rest_tables t
         LEFT JOIN rest_orders o ON o.id = t.current_order_id AND o.tenant_id = t.tenant_id
         WHERE t.tenant_id = ? AND t.deleted_at IS NULL ${includeInactive ? "" : "AND t.is_active = 1"}
         ORDER BY t.area, t.sort_order, t.name`,
        [tenant()]
      );
    },

    async saveTable(input: Partial<TableRow>) {
      need("rest.menu");
      const name = String(input.name ?? "").trim();
      if (!name) throw new RestError("INVALID", "Table name is required.");
      const data = { name, area: input.area || null, capacity: Math.max(1, Number(input.capacity) || 1), sort_order: Number(input.sort_order) || 0, is_active: input.is_active === 0 ? 0 : 1 };
      if (input.id) {
        await owned("rest_tables", input.id, "Table");
        await update("rest_tables", input.id, data);
        return owned<TableRow>("rest_tables", input.id, "Table");
      }
      return insert<TableRow>("rest_tables", { ...data, status: "available" } as never);
    },

    async deleteTable(id: string) {
      need("rest.menu");
      const t = await owned<TableRow>("rest_tables", id, "Table");
      if (t.current_order_id) throw new RestError("CONFLICT", "Close the table's order first.");
      await softDelete("rest_tables", id);
    },

    async setTableReserved(id: string, reserved: boolean) {
      need("rest.order");
      const t = await owned<TableRow>("rest_tables", id, "Table");
      const to: TableStatus = reserved ? "reserved" : "available";
      if (!canTableMove(t.status, to)) throw new RestError("CONFLICT", `Table ${t.name} is ${t.status}.`);
      await update("rest_tables", id, { status: to }, { sql: "status = ?", params: [t.status] });
    },

    // Ingredients
    async listIngredients() {
      return db.select<IngredientRow>(`SELECT * FROM rest_ingredients WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name`, [tenant()]);
    },

    async saveIngredient(input: Partial<IngredientRow>) {
      need("rest.menu");
      const name = String(input.name ?? "").trim();
      const unit = String(input.unit ?? "").trim();
      if (!name || !unit) throw new RestError("INVALID", "Ingredient name and unit are required.");
      const data = {
        name,
        unit,
        purchase_unit: input.purchase_unit || null,
        purchase_factor: Number(input.purchase_factor) > 0 ? Number(input.purchase_factor) : 1,
        cost: Math.max(0, Number(input.cost) || 0),
        reorder_level: Math.max(0, Number(input.reorder_level) || 0),
        is_active: input.is_active === 0 ? 0 : 1,
      };
      if (input.id) {
        await owned("rest_ingredients", input.id, "Ingredient");
        await update("rest_ingredients", input.id, data);
        return owned<IngredientRow>("rest_ingredients", input.id, "Ingredient");
      }
      return insert<IngredientRow>("rest_ingredients", { ...data, stock: 0 } as never);
    },

    /** purchase / wastage / adjustment add or remove `qty` (recipe units);
     * count sets stock to `qty`. */
    async adjustStock(ingredientId: string, kind: "purchase" | "wastage" | "adjustment" | "count", qty: number, note?: string) {
      need("rest.menu");
      const ing = await owned<IngredientRow>("rest_ingredients", ingredientId, "Ingredient");
      if (!Number.isFinite(qty)) throw new RestError("INVALID", "Enter a quantity.");
      const delta = kind === "count" ? qty - ing.stock : kind === "wastage" ? -Math.abs(qty) : kind === "purchase" ? Math.abs(qty) : qty;
      await insert("rest_stock_moves", { ingredient_id: ingredientId, qty: delta, reason: kind, ref_id: null, note: note ?? null, created_by: context().userName } as never);
      await db.execute(`UPDATE rest_ingredients SET stock = stock + ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [delta, iso(db.now()), ingredientId, tenant()]);
      const row = await owned<IngredientRow>("rest_ingredients", ingredientId, "Ingredient");
      await db.outbox("rest_ingredients", ingredientId, "update", row as unknown as Record<string, unknown>);
      await audit(`stock.${kind}`, "ingredient", ingredientId, { delta, note });
      return row;
    },

    // Deals
    async listDeals(includeInactive = true) {
      const rows = await db.select<DealRow>(
        `SELECT * FROM rest_deals WHERE tenant_id = ? AND deleted_at IS NULL ${includeInactive ? "" : "AND is_active = 1"} ORDER BY name`,
        [tenant()]
      );
      return rows.map((r) => ({ ...r, items: json<DealComponent[]>(r.items, []) }));
    },

    async saveDeal(input: Partial<Omit<DealRow, "items">> & { items: DealComponent[] }) {
      need("rest.menu");
      const name = String(input.name ?? "").trim();
      const code = String(input.code ?? "").trim().toUpperCase();
      if (!name || !code) throw new RestError("INVALID", "Deal name and code are required.");
      const price = Number(input.price);
      if (!Number.isFinite(price) || price < 0) throw new RestError("INVALID", "Deal price must be 0 or more.");
      if (!input.items?.length) throw new RestError("INVALID", "Add at least one dish to the deal.");
      const items: DealComponent[] = [];
      for (const c of input.items) {
        const m = parseItem(await owned<MenuItemRow>("rest_menu_items", c.menu_item_id, "Deal dish"));
        if (c.variant && !(m.variants as PriceOption[]).some((v) => v.name === c.variant)) throw new RestError("INVALID", `${m.name} has no size "${c.variant}".`);
        items.push({ menu_item_id: c.menu_item_id, qty: Math.max(1, Math.floor(Number(c.qty) || 1)), variant: c.variant || null });
      }
      const dup = await db.select(`SELECT id FROM rest_deals WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL AND id <> ?`, [tenant(), code, input.id ?? ""]);
      if (dup.length) throw new RestError("CONFLICT", `Deal code ${code} is already used.`);
      const data = {
        code,
        name,
        description: input.description ?? null,
        image: input.image ?? null,
        price,
        items: JSON.stringify(items),
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        days: input.days || null,
        start_time: input.start_time || null,
        end_time: input.end_time || null,
        max_redemptions: input.max_redemptions ? Number(input.max_redemptions) : null,
        is_active: input.is_active === 0 ? 0 : 1,
      };
      if (input.id) {
        await owned("rest_deals", input.id, "Deal");
        await update("rest_deals", input.id, data);
        await audit("deal.update", "deal", input.id, data);
        return input.id;
      }
      const row = await insert<DealRow>("rest_deals", { ...data, redemptions: 0 } as never);
      await audit("deal.create", "deal", row.id, data);
      return row.id;
    },

    async deleteDeal(id: string) {
      need("rest.menu");
      await owned("rest_deals", id, "Deal");
      await softDelete("rest_deals", id);
      await audit("deal.delete", "deal", id);
    },

    // Offers
    async listOffers() {
      const rows = await db.select<OfferRow>(`SELECT * FROM rest_offers WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name`, [tenant()]);
      return rows.map((r) => ({ ...r, target_ids: json<string[]>(r.target_ids, []) }));
    },

    async saveOffer(input: Partial<Omit<OfferRow, "target_ids">> & { target_ids?: string[] }) {
      need("rest.menu");
      const name = String(input.name ?? "").trim();
      const code = String(input.code ?? "").trim().toUpperCase();
      const type = input.type;
      if (!name || !code) throw new RestError("INVALID", "Offer name and code are required.");
      if (!type || !["percent", "fixed", "bogo", "buy_x_get_y"].includes(type)) throw new RestError("INVALID", "Choose an offer type.");
      const value = Number(input.value) || 0;
      if (type === "percent" && (value <= 0 || value > 100)) throw new RestError("INVALID", "Percentage must be between 0 and 100.");
      if (type === "fixed" && value <= 0) throw new RestError("INVALID", "Discount amount must be more than 0.");
      if (type === "buy_x_get_y" && (!(Number(input.buy_qty) >= 1) || !(Number(input.get_qty) >= 1))) throw new RestError("INVALID", "Set both Buy and Get quantities.");
      const appliesTo = input.applies_to ?? "order";
      const targets = input.target_ids ?? [];
      if (appliesTo === "category") for (const id of targets) await owned("rest_categories", id, "Offer category");
      if (appliesTo === "items") for (const id of targets) await owned("rest_menu_items", id, "Offer dish");
      if (appliesTo !== "order" && !targets.length) throw new RestError("INVALID", "Choose the dishes or categories the offer applies to.");
      const dup = await db.select(`SELECT id FROM rest_offers WHERE tenant_id = ? AND code = ? AND deleted_at IS NULL AND id <> ?`, [tenant(), code, input.id ?? ""]);
      if (dup.length) throw new RestError("CONFLICT", `Offer code ${code} is already used.`);
      const num = (v: unknown) => (v != null && String(v) !== "" ? Number(v) : null);
      const data = {
        code,
        name,
        type,
        value,
        buy_qty: num(input.buy_qty),
        get_qty: num(input.get_qty),
        applies_to: appliesTo,
        target_ids: JSON.stringify(appliesTo === "order" ? [] : targets),
        min_order: num(input.min_order),
        min_qty: num(input.min_qty),
        max_discount: num(input.max_discount),
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        days: input.days || null,
        start_time: input.start_time || null,
        end_time: input.end_time || null,
        usage_limit: num(input.usage_limit),
        coupon_code: input.coupon_code ? String(input.coupon_code).trim().toUpperCase() : null,
        stackable: input.stackable ? 1 : 0,
        exclude_discounted: input.exclude_discounted === 0 ? 0 : 1,
        is_active: input.is_active === 0 ? 0 : 1,
      };
      if (input.id) {
        await owned("rest_offers", input.id, "Offer");
        await update("rest_offers", input.id, data);
        await audit("offer.update", "offer", input.id, data);
        return input.id;
      }
      const row = await insert<OfferRow>("rest_offers", { ...data, used_count: 0 } as never);
      await audit("offer.create", "offer", row.id, data);
      return row.id;
    },

    async deleteOffer(id: string) {
      need("rest.menu");
      await owned("rest_offers", id, "Offer");
      await softDelete("rest_offers", id);
      await audit("offer.delete", "offer", id);
    },

    // Orders
    async openOrder(input: { type: OrderType; tableId?: string | null; guests?: number; customerName?: string; customerPhone?: string }) {
      need("rest.order");
      if (!["dine_in", "takeaway", "delivery"].includes(input.type)) throw new RestError("INVALID", "Unknown order type.");
      let table: TableRow | null = null;
      if (input.type === "dine_in") {
        table = await owned<TableRow>("rest_tables", input.tableId, "Table");
        if (!table.is_active) throw new RestError("CONFLICT", `Table ${table.name} is not in use.`);
        if (table.current_order_id) return api.getOrder(table.current_order_id);
      }
      const c = context();
      for (let attempt = 0; attempt < 5; attempt++) {
        const orderNo = await nextNumber("order_no");
        let order: OrderRow;
        try {
          order = await insert<OrderRow>("rest_orders", {
            order_no: orderNo,
            order_type: input.type,
            table_id: table?.id ?? null,
            status: "open",
            guests: input.guests ?? null,
            customer_name: input.customerName?.trim() || null,
            customer_phone: input.customerPhone?.trim() || null,
            cashier_id: c.userId,
            cashier_name: c.userName,
            opened_at: iso(db.now()),
            payment_status: "unpaid",
            pra_status: "not_required",
          } as never);
        } catch (e) {
          if (/UNIQUE/i.test(String(e))) continue; // another counter took this number
          throw e;
        }
        if (table) {
          // Claim the table; if someone else opened it meanwhile, use theirs.
          const claimed = await update("rest_tables", table.id, { status: "occupied", current_order_id: order.id }, { sql: "current_order_id IS NULL", params: [] });
          if (!claimed) {
            await update("rest_orders", order.id, { status: "cancelled", cancel_reason: "Table opened on another counter", closed_at: iso(db.now()) });
            const fresh = await owned<TableRow>("rest_tables", table.id, "Table");
            return api.getOrder(fresh.current_order_id!);
          }
        }
        await audit("order.open", "order", order.id, { type: input.type, table: table?.name });
        return api.getOrder(order.id);
      }
      throw new RestError("CONFLICT", "Could not get an order number, try again.");
    },

    async getOrder(id: string) {
      const order = await owned<OrderRow>("rest_orders", id, "Order");
      const items = await orderItems(id);
      return { order, items };
    },

    async listOpenOrders() {
      return db.select<OrderRow & { table_name: string | null }>(
        `SELECT o.*, t.name AS table_name FROM rest_orders o LEFT JOIN rest_tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id
         WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND o.status IN ('open', 'billed') ORDER BY o.opened_at`,
        [tenant()]
      );
    },

    async listOrders(opts: { from: string; to: string; status?: string }) {
      return db.select<OrderRow & { table_name: string | null }>(
        `SELECT o.*, t.name AS table_name FROM rest_orders o LEFT JOIN rest_tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id
         WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND substr(COALESCE(o.invoiced_at, o.opened_at), 1, 10) BETWEEN ? AND ?
         ${opts.status ? "AND o.status = ?" : ""} ORDER BY COALESCE(o.invoiced_at, o.opened_at) DESC`,
        opts.status ? [tenant(), opts.from, opts.to, opts.status] : [tenant(), opts.from, opts.to]
      );
    },

    /** Orders that can take new items: re-opens a billed order (audited). */
    async editableOrder(orderId: string) {
      const order = await owned<OrderRow>("rest_orders", orderId, "Order");
      if (order.status === "billed") {
        if (order.payment_status === "partial") throw new RestError("CONFLICT", "This bill is partly paid; finish the payment first.");
        await update("rest_orders", order.id, { status: "open" }, { sql: "status = 'billed'", params: [] });
        if (order.table_id) await update("rest_tables", order.table_id, { status: "occupied" }, { sql: "current_order_id = ?", params: [order.id] });
        await audit("order.reopen", "order", order.id);
        return { ...order, status: "open" as OrderStatus };
      }
      if (order.status !== "open") throw new RestError("CONFLICT", `Order #${order.order_no} is ${order.status}.`);
      return order;
    },

    async addItem(orderId: string, input: { menuItemId: string; variant?: string | null; modifiers?: string[]; qty?: number; notes?: string | null }) {
      need("rest.order");
      const order = await api.editableOrder(orderId);
      const m = parseItem(await owned<MenuItemRow>("rest_menu_items", input.menuItemId, "Dish"));
      if (!m.is_available) throw new RestError("CONFLICT", `${m.name} is not available.`);
      if (m.category_id) {
        const cat = await owned<CategoryRow>("rest_categories", m.category_id, "Category");
        if (!cat.is_active) throw new RestError("CONFLICT", `${m.name} is not available (category is off).`);
      }
      const qty = Number(input.qty ?? 1);
      if (!(qty > 0) || qty > 999) throw new RestError("INVALID", "Quantity must be between 1 and 999.");
      const mods = (input.modifiers ?? []).filter(Boolean);
      const unit = unitPricePaisa(m, order.order_type, input.variant ?? null, mods);
      const name = [m.name, input.variant ? `(${input.variant})` : ""].filter(Boolean).join(" ");
      const row = await insert<OrderItemRow>("rest_order_items", {
        order_id: order.id,
        menu_item_id: m.id,
        code: m.code,
        name,
        category_id: m.category_id,
        variant: input.variant ?? null,
        modifiers: JSON.stringify(mods),
        qty,
        unit_price: toRupees(unit),
        line_total: toRupees(Math.round(unit * qty)),
        tax_exempt: m.tax_exempt ? 1 : 0,
        notes: input.notes?.trim() || null,
        station: m.station,
        kitchen_status: "new",
      } as never);
      return row;
    },

    async addDeal(orderId: string, dealId: string, qty = 1) {
      need("rest.order");
      const order = await api.editableOrder(orderId);
      const dealRow = await owned<DealRow>("rest_deals", dealId, "Deal");
      const deal: DealLike = { ...dealRow, items: json<DealComponent[]>(dealRow.items, []) };
      const menu = await menuMap();
      const block = validateDeal(deal, db.now(), menu);
      if (block) throw new RestError("CONFLICT", block);
      const n = Math.max(1, Math.floor(qty));
      const parent = await insert<OrderItemRow>("rest_order_items", {
        order_id: order.id,
        deal_id: deal.id,
        code: dealRow.code,
        name: `Deal: ${deal.name}`,
        qty: n,
        unit_price: deal.price,
        line_total: toRupees(Math.round(toPaisa(deal.price) * n)),
        kitchen_status: "new",
      } as never);
      for (const comp of deal.items) {
        const m = menu.get(comp.menu_item_id)!;
        await insert("rest_order_items", {
          order_id: order.id,
          menu_item_id: m.id,
          deal_id: deal.id,
          parent_item_id: parent.id,
          code: m.code,
          name: [m.name, comp.variant ? `(${comp.variant})` : ""].filter(Boolean).join(" "),
          category_id: m.category_id,
          variant: comp.variant ?? null,
          modifiers: "[]",
          qty: comp.qty * n,
          unit_price: 0,
          line_total: 0,
          station: m.station,
          kitchen_status: "new",
        } as never);
      }
      return parent;
    },

    /** Quantity can change only before the item goes to the kitchen. */
    async setItemQty(itemId: string, qty: number) {
      need("rest.order");
      const item = await owned<OrderItemRow>("rest_order_items", itemId, "Order item");
      await api.editableOrder(item.order_id);
      if (item.kitchen_status !== "new") throw new RestError("CONFLICT", "This dish was already sent to the kitchen; cancel it instead.");
      if (item.parent_item_id) throw new RestError("CONFLICT", "Change the deal quantity, not its dishes.");
      if (!(qty > 0) || qty > 999) throw new RestError("INVALID", "Quantity must be between 1 and 999.");
      await update("rest_order_items", itemId, { qty, line_total: toRupees(Math.round(toPaisa(item.unit_price) * qty)) }, { sql: "kitchen_status = 'new'", params: [] });
      if (item.deal_id && !item.parent_item_id) {
        const comps = await db.select<OrderItemRow>(`SELECT * FROM rest_order_items WHERE tenant_id = ? AND parent_item_id = ? AND deleted_at IS NULL`, [tenant(), itemId]);
        for (const c of comps) await update("rest_order_items", c.id, { qty: (c.qty / item.qty) * qty }, { sql: "kitchen_status = 'new'", params: [] });
      }
    },

    /** Not yet sent: removed (audited). Sent: cancelled with a reason and kept
     * for audit; needs void permission. Stock comes back only if the kitchen
     * had not started preparing it. */
    async cancelItem(itemId: string, reason: string) {
      const item = await owned<OrderItemRow>("rest_order_items", itemId, "Order item");
      await api.editableOrder(item.order_id);
      if (item.parent_item_id) throw new RestError("CONFLICT", "Cancel the whole deal, not one of its dishes.");
      const group = [item, ...(await db.select<OrderItemRow>(`SELECT * FROM rest_order_items WHERE tenant_id = ? AND parent_item_id = ? AND deleted_at IS NULL`, [tenant(), itemId]))];
      const sent = group.some((g) => g.kitchen_status !== "new");
      if (sent) {
        need("rest.void");
        if (!reason?.trim()) throw new RestError("INVALID", "Give a reason for cancelling a dish that was sent to the kitchen.");
      } else need("rest.order");
      for (const g of group) {
        if (g.kitchen_status === "cancelled" || g.kitchen_status === "served") continue;
        const changed = await update(
          "rest_order_items",
          g.id,
          { kitchen_status: "cancelled", cancel_reason: reason?.trim() || "Removed before sending" },
          { sql: "kitchen_status = ?", params: [g.kitchen_status] }
        );
        if (changed && g.kitchen_status === "sent") await deductFor(g, "reversal");
      }
      await audit(sent ? "order.item_void" : "order.item_remove", "order_item", item.id, { name: item.name, qty: item.qty, reason });
    },

    /** Sends only the dishes not yet sent; one ticket per station. Idempotent:
     * a dish is claimed with `kitchen_status = 'new'`, so a retry or a second
     * click can't send it twice or deduct stock twice. */
    async sendToKitchen(orderId: string) {
      need("rest.order");
      const order = await api.editableOrder(orderId);
      const items = await orderItems(order.id);
      const fresh = items.filter((i) => i.kitchen_status === "new" && i.menu_item_id);
      const parents = items.filter((i) => i.kitchen_status === "new" && !i.menu_item_id);
      const byStation = new Map<string, OrderItemRow[]>();
      for (const i of fresh) {
        const key = i.station || "Kitchen";
        byStation.set(key, [...(byStation.get(key) ?? []), i]);
      }
      const tickets: { kot: KotRow; items: OrderItemRow[] }[] = [];
      for (const [station, list] of byStation) {
        const kotNo = await nextKot();
        const claimed: OrderItemRow[] = [];
        for (const i of list) {
          const ok = await update("rest_order_items", i.id, { kitchen_status: "sent", kot_no: kotNo, sent_at: iso(db.now()) }, { sql: "kitchen_status = 'new'", params: [] });
          if (ok) {
            claimed.push(i);
            await deductFor(i, "sale");
          }
        }
        if (!claimed.length) continue;
        const kot = await insert<KotRow>("rest_kots", { order_id: order.id, kot_no: kotNo, station, item_ids: JSON.stringify(claimed.map((i) => i.id)), printed_count: 0 } as never);
        tickets.push({ kot, items: claimed });
      }
      for (const p of parents) await update("rest_order_items", p.id, { kitchen_status: "sent", sent_at: iso(db.now()) }, { sql: "kitchen_status = 'new'", params: [] });
      if (tickets.length) await audit("kitchen.send", "order", order.id, tickets.map((t) => ({ kot: t.kot.kot_no, items: t.items.length })));
      return tickets;
    },

    async markKotPrinted(kotId: string) {
      const kot = await owned<KotRow>("rest_kots", kotId, "Kitchen ticket");
      await update("rest_kots", kotId, { printed_count: kot.printed_count + 1 });
      if (kot.printed_count > 0) await audit("kitchen.reprint", "kot", kotId, { kot: kot.kot_no, copy: kot.printed_count + 1 });
      return { reprint: kot.printed_count > 0, copy: kot.printed_count + 1 };
    },

    async findKot(orderId: string, kotNo: number): Promise<string | null> {
      await owned("rest_orders", orderId, "Order");
      const rows = await db.select<{ id: string }>(`SELECT id FROM rest_kots WHERE tenant_id = ? AND order_id = ? AND kot_no = ?`, [tenant(), orderId, kotNo]);
      return rows[0]?.id ?? null;
    },

    async kotWithItems(kotId: string) {
      const kot = await owned<KotRow>("rest_kots", kotId, "Kitchen ticket");
      const ids = json<string[]>(kot.item_ids, []);
      const items = (await orderItems(kot.order_id)).filter((i) => ids.includes(i.id));
      const { order } = await api.getOrder(kot.order_id);
      const table = order.table_id ? await owned<TableRow>("rest_tables", order.table_id, "Table").catch(() => null) : null;
      return { kot, items, order, tableName: table?.name ?? null };
    },

    async kitchenQueue(station?: string | null) {
      return db.select<OrderItemRow & { order_no: number; order_type: string; table_name: string | null }>(
        `SELECT i.*, o.order_no, o.order_type, t.name AS table_name FROM rest_order_items i
         JOIN rest_orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
         LEFT JOIN rest_tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id
         WHERE i.tenant_id = ? AND i.deleted_at IS NULL AND i.menu_item_id IS NOT NULL
           AND i.kitchen_status IN ('sent', 'preparing', 'ready') ${station ? "AND COALESCE(i.station, 'Kitchen') = ?" : ""}
         ORDER BY i.sent_at, i.kot_no`,
        station ? [tenant(), station] : [tenant()]
      );
    },

    async setKitchenStatus(itemIds: string[], to: KitchenStatus) {
      for (const id of itemIds) {
        const item = await owned<OrderItemRow>("rest_order_items", id, "Order item");
        if (to === "cancelled") throw new RestError("INVALID", "Use cancel to cancel a dish.");
        if (!canKitchenMove(item.kitchen_status, to)) throw new RestError("CONFLICT", `${item.name} is ${item.kitchen_status}; can't mark ${to}.`);
        await update("rest_order_items", id, { kitchen_status: to }, { sql: "kitchen_status = ?", params: [item.kitchen_status] });
      }
    },

    async moveOrder(orderId: string, toTableId: string) {
      need("rest.order");
      const order = await api.editableOrder(orderId);
      const target = await owned<TableRow>("rest_tables", toTableId, "Table");
      if (target.current_order_id) throw new RestError("CONFLICT", `Table ${target.name} is occupied.`);
      const claimed = await update("rest_tables", target.id, { status: "occupied", current_order_id: order.id }, { sql: "current_order_id IS NULL", params: [] });
      if (!claimed) throw new RestError("CONFLICT", `Table ${target.name} was just taken.`);
      await freeTable(order);
      await update("rest_orders", order.id, { table_id: target.id, order_type: "dine_in" });
      await audit("table.transfer", "order", order.id, { from: order.table_id, to: target.id });
    },

    /** Moves every live item of `fromOrderId` into `intoOrderId`; the source
     * order is closed as merged (kept for audit) and its table freed. */
    async mergeOrders(fromOrderId: string, intoOrderId: string) {
      need("rest.order");
      if (fromOrderId === intoOrderId) throw new RestError("INVALID", "Choose two different orders.");
      const from = await api.editableOrder(fromOrderId);
      const into = await api.editableOrder(intoOrderId);
      if (from.payment_status !== "unpaid") throw new RestError("CONFLICT", "A partly paid order can't be merged.");
      const items = await orderItems(from.id);
      for (const i of items) await update("rest_order_items", i.id, { order_id: into.id });
      await update("rest_orders", from.id, { status: "cancelled", cancel_reason: `Merged into order #${into.order_no}`, closed_at: iso(db.now()) }, { sql: "status = 'open'", params: [] });
      await freeTable(from);
      await audit("table.merge", "order", into.id, { from: from.id, fromNo: from.order_no, items: items.length });
    },

    /** Moves the chosen lines (with deal components) to a new order on the
     * same table for separate billing. */
    async splitOrder(orderId: string, itemIds: string[]) {
      need("rest.order");
      const order = await api.editableOrder(orderId);
      const items = await orderItems(order.id);
      const chosen = items.filter((i) => itemIds.includes(i.id) && !i.parent_item_id && i.kitchen_status !== "cancelled");
      if (!chosen.length) throw new RestError("INVALID", "Choose dishes to split.");
      if (chosen.length === billable(items).length) throw new RestError("INVALID", "Leave at least one dish on the original bill.");
      const orderNo = await nextNumber("order_no");
      const c = context();
      const split = await insert<OrderRow>("rest_orders", {
        order_no: orderNo,
        order_type: order.order_type,
        table_id: order.table_id,
        status: "open",
        cashier_id: c.userId,
        cashier_name: c.userName,
        opened_at: iso(db.now()),
        payment_status: "unpaid",
        pra_status: "not_required",
        notes: `Split from order #${order.order_no}`,
      } as never);
      for (const i of chosen) {
        await update("rest_order_items", i.id, { order_id: split.id });
        for (const comp of items.filter((x) => x.parent_item_id === i.id)) await update("rest_order_items", comp.id, { order_id: split.id });
      }
      await audit("order.split", "order", order.id, { into: split.id, items: chosen.length });
      return api.getOrder(split.id);
    },

    /** Server-side bill: prices from stored lines, offers validated here,
     * manual discount needs permission. Nothing is written. */
    async previewBill(orderId: string, opts: { offerCodes?: string[]; coupon?: string | null; manualDiscount?: number; methods?: PayMethod[] } = {}) {
      const { order, items } = await api.getOrder(orderId);
      const lines = billable(items).map(toLine);
      const offers = await loadOffersByCode([...new Set((opts.offerCodes ?? []).map((c) => c.trim()).filter(Boolean))]);
      const promo = applyOffers(offers, lines, db.now(), opts.coupon ?? null);
      const manual = toPaisa(opts.manualDiscount ?? 0);
      if (manual > 0) need("rest.discount");
      if (manual < 0) throw new RestError("INVALID", "Discount can't be negative.");
      const tax = await taxSettings();
      const bill = computeBill(lines, promo.discountPaisa + manual, order.order_type, opts.methods?.length ? opts.methods : ["cash"], tax, billable(items).map((i) => !!i.tax_exempt));
      return { order, items, lines, promo, manualDiscountPaisa: manual, bill, taxConfigured: tax.configured };
    },

    async requestBill(orderId: string) {
      need("rest.order");
      const order = await owned<OrderRow>("rest_orders", orderId, "Order");
      if (!canOrderMove(order.status, "billed")) throw new RestError("CONFLICT", `Order #${order.order_no} is ${order.status}.`);
      await update("rest_orders", order.id, { status: "billed" }, { sql: "status = 'open'", params: [] });
      if (order.table_id) await update("rest_tables", order.table_id, { status: "bill_requested" }, { sql: "current_order_id = ?", params: [order.id] });
      await audit("order.bill_requested", "order", order.id);
    },

    /** Takes a payment. When the bill is fully paid the order is finalised:
     * invoice number assigned, lines frozen with their discount/tax, offer and
     * deal usage counted, table freed, PRA submission queued. Repeating the
     * call on a paid order returns it unchanged (idempotent). */
    async pay(
      orderId: string,
      input: { payments: Payment[]; offerCodes?: string[]; coupon?: string | null; manualDiscount?: number; customerName?: string | null; customerPhone?: string | null }
    ) {
      need("rest.order");
      const current = await owned<OrderRow>("rest_orders", orderId, "Order");
      if (current.status === "paid") return { order: current, change: 0, finalized: true };
      if (current.status !== "open" && current.status !== "billed") throw new RestError("CONFLICT", `Order #${current.order_no} is ${current.status}.`);
      const pays = (input.payments ?? []).filter((p) => toPaisa(p.amount) > 0);
      for (const p of pays) if (!["cash", "card", "bank", "digital"].includes(p.method)) throw new RestError("INVALID", "Unknown payment method.");
      const earlier = json<Payment[]>(current.payments, []);
      const allPays = [...earlier, ...pays];
      if (!allPays.length) throw new RestError("INVALID", "Enter the amount received.");

      // Anything still unsent goes to the kitchen now (counter/takeaway flow).
      const before = await orderItems(current.id);
      if (before.some((i) => i.kitchen_status === "new")) await api.sendToKitchen(current.id);

      const methods = [...new Set(allPays.map((p) => p.method))];
      const preview = await api.previewBill(current.id, { offerCodes: input.offerCodes, coupon: input.coupon, manualDiscount: input.manualDiscount, methods });
      if (!preview.lines.length) throw new RestError("INVALID", "The order has no dishes.");
      if (preview.promo.rejected.length && (input.offerCodes ?? []).length) {
        throw new RestError("CONFLICT", preview.promo.rejected.map((r) => r.reason).join(" "));
      }
      const { bill } = preview;
      const status = paymentStatus(bill.totalPaisa, allPays);
      // Card/bank/digital in this payment may cover at most what is still
      // due; only cash can be over-tendered (change comes from this cash).
      const dueBefore = bill.totalPaisa - earlier.reduce((s, p) => s + toPaisa(p.amount), 0);
      const nonCashNow = pays.filter((p) => p.method !== "cash").reduce((s, p) => s + toPaisa(p.amount), 0);
      if (nonCashNow > dueBefore) throw new RestError("INVALID", "Card/bank/digital payments can't exceed the amount due.");
      let change = 0;
      if (status.balancePaisa < 0) {
        const cashNow = pays.filter((p) => p.method === "cash").reduce((s, p) => s + toPaisa(p.amount), 0);
        if (-status.balancePaisa > cashNow) throw new RestError("INVALID", "Payments exceed the bill.");
        change = -status.balancePaisa;
      }

      if (status.status === "partial") {
        await update(
          "rest_orders",
          current.id,
          { payments: JSON.stringify(allPays), paid: toRupees(status.paidPaisa), payment_status: "partial", status: "billed" },
          { sql: "status IN ('open', 'billed')", params: [] }
        );
        await audit("payment.partial", "order", current.id, { received: pays, balance: toRupees(status.balancePaisa) });
        return { order: await owned<OrderRow>("rest_orders", current.id, "Order"), change: 0, finalized: false };
      }

      // Count offer / deal usage first; a limit hit stops the payment.
      const counted: { table: "rest_offers" | "rest_deals"; id: string; col: "used_count" | "redemptions" }[] = [];
      const undo = async () => {
        for (const u of counted) await db.execute(`UPDATE ${u.table} SET ${u.col} = ${u.col} - 1 WHERE id = ? AND tenant_id = ?`, [u.id, tenant()]);
      };
      for (const o of preview.promo.applied) {
        const { changes } = await db.execute(
          `UPDATE rest_offers SET used_count = used_count + 1, updated_at = ? WHERE id = ? AND tenant_id = ? AND (usage_limit IS NULL OR used_count < usage_limit)`,
          [iso(db.now()), o.offerId, tenant()]
        );
        if (!changes) {
          await undo();
          throw new RestError("CONFLICT", `Offer "${o.name}" was just used up.`);
        }
        counted.push({ table: "rest_offers", id: o.offerId, col: "used_count" });
      }
      for (const dealLine of preview.lines.filter((l) => l.dealId)) {
        const { changes } = await db.execute(
          `UPDATE rest_deals SET redemptions = redemptions + ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND (max_redemptions IS NULL OR redemptions + ? <= max_redemptions)`,
          [dealLine.qty, iso(db.now()), dealLine.dealId, tenant(), dealLine.qty]
        );
        if (!changes) {
          await undo();
          throw new RestError("CONFLICT", "A deal on this order has reached its limit.");
        }
        counted.push({ table: "rest_deals", id: dealLine.dealId!, col: "redemptions" });
      }

      const praOn = (await getSetting(REST_SETTINGS.praEnabled)) === "true";
      for (let attempt = 0; attempt < 5; attempt++) {
        const invoiceNo = await nextNumber("invoice_no");
        let changed = 0;
        try {
          changed = await update(
            "rest_orders",
            current.id,
            {
              status: "paid",
              payment_status: "paid",
              payments: JSON.stringify(allPays),
              paid: toRupees(bill.totalPaisa),
              gross: toRupees(bill.grossPaisa),
              discount: toRupees(bill.discountPaisa),
              service_charge: toRupees(bill.servicePaisa),
              tax: toRupees(bill.taxPaisa),
              tax_rate: bill.taxRate,
              total: toRupees(bill.totalPaisa),
              offers: JSON.stringify({ applied: preview.promo.applied, manualDiscount: toRupees(preview.manualDiscountPaisa) }),
              coupon: input.coupon ?? null,
              customer_name: input.customerName?.trim() || current.customer_name,
              customer_phone: input.customerPhone?.trim() || current.customer_phone,
              invoice_no: invoiceNo,
              invoiced_at: iso(db.now()),
              closed_at: iso(db.now()),
              pra_status: praOn ? "pending" : "not_required",
            },
            { sql: "status IN ('open', 'billed') AND invoice_no IS NULL", params: [] }
          );
        } catch (e) {
          if (/UNIQUE/i.test(String(e))) continue; // invoice number taken: next one
          await undo();
          throw e;
        }
        if (!changed) {
          // Paid concurrently by another counter: keep theirs, give back our counts.
          await undo();
          return { order: await owned<OrderRow>("rest_orders", current.id, "Order"), change: 0, finalized: true };
        }
        // Freeze line amounts (historical snapshot used by refunds and PRA).
        const lineRows = billable(await orderItems(current.id));
        for (const [i, row] of lineRows.entries()) {
          await update("rest_order_items", row.id, { line_discount: toRupees(bill.lineDiscounts[i]), line_tax: toRupees(bill.lineTax[i]), line_total: toRupees(lineGross(preview.lines[i])) });
        }
        await freeTable(current);
        const order = await owned<OrderRow>("rest_orders", current.id, "Order");
        if (praOn) await api.queuePra(order, 1, null);
        await audit("invoice.finalize", "order", order.id, {
          invoice: invoiceNo,
          total: order.total,
          discount: order.discount,
          offers: preview.promo.applied.map((o) => o.code),
          manualDiscount: toRupees(preview.manualDiscountPaisa),
        });
        return { order, change: toRupees(change), finalized: true };
      }
      await undo();
      throw new RestError("CONFLICT", "Could not get an invoice number, try again.");
    },

    /** Cancels an unpaid order (kept for audit), returns unprepared stock. */
    async cancelOrder(orderId: string, reason: string) {
      need("rest.void");
      if (!reason?.trim()) throw new RestError("INVALID", "Give a reason for cancelling.");
      const order = await owned<OrderRow>("rest_orders", orderId, "Order");
      if (!canOrderMove(order.status, "cancelled")) throw new RestError("CONFLICT", `Order #${order.order_no} is ${order.status}.`);
      if (order.payment_status === "partial") throw new RestError("CONFLICT", "Refund the part payment before cancelling.");
      const changed = await update("rest_orders", order.id, { status: "cancelled", cancel_reason: reason.trim(), closed_at: iso(db.now()) }, { sql: "status IN ('open', 'billed')", params: [] });
      if (!changed) throw new RestError("CONFLICT", "The order changed; reload it.");
      for (const i of await orderItems(order.id)) {
        if (i.kitchen_status === "cancelled" || i.kitchen_status === "served") continue;
        const ok = await update("rest_order_items", i.id, { kitchen_status: "cancelled", cancel_reason: reason.trim() }, { sql: "kitchen_status = ?", params: [i.kitchen_status] });
        if (ok && i.kitchen_status === "sent") await deductFor(i, "reversal");
      }
      await freeTable(order);
      await audit("order.cancel", "order", order.id, { reason });
    },

    /** Refund of a paid invoice (whole or chosen lines). Creates a credit
     * document linked to the original; the original stays unchanged except
     * its refunded flags/status. With PRA on, a Credit invoice (type 3) is
     * queued with RefUSIN = the original invoice number. */
    async refund(orderId: string, input: { itemIds?: string[]; reason: string; method: PayMethod }) {
      need("rest.refund");
      if (!input.reason?.trim()) throw new RestError("INVALID", "Give a reason for the refund.");
      const original = await owned<OrderRow>("rest_orders", orderId, "Order");
      if (original.status !== "paid" || original.refund_of) throw new RestError("CONFLICT", "Only a paid sale invoice can be refunded.");
      const items = billable(await orderItems(original.id)).filter((i) => !i.refunded);
      const chosen = input.itemIds?.length ? items.filter((i) => input.itemIds!.includes(i.id)) : items;
      if (!chosen.length) throw new RestError("INVALID", "Nothing left to refund on this invoice.");
      const full = chosen.length === items.length && items.length === billable(await orderItems(original.id)).length;
      // Claim the lines first so a double click can't refund them twice.
      const claimed: OrderItemRow[] = [];
      for (const i of chosen) if (await update("rest_order_items", i.id, { refunded: 1 }, { sql: "refunded = 0", params: [] })) claimed.push(i);
      if (!claimed.length) throw new RestError("CONFLICT", "These lines were already refunded.");
      const sum = (f: (i: OrderItemRow) => number) => claimed.reduce((s, i) => s + toPaisa(f(i)), 0);
      const gross = sum((i) => i.line_total);
      const discount = sum((i) => i.line_discount);
      const lineTax = sum((i) => i.line_tax);
      const service = full ? toPaisa(original.service_charge) : 0;
      const serviceTax = full ? toPaisa(original.tax) - billable(await orderItems(original.id)).reduce((s, i) => s + toPaisa(i.line_tax), 0) : 0;
      const total = gross - discount + lineTax + service + serviceTax;
      for (let attempt = 0; attempt < 5; attempt++) {
        const [orderNo, invoiceNo] = [await nextNumber("order_no"), await nextNumber("invoice_no")];
        try {
          const credit = await insert<OrderRow>("rest_orders", {
            order_no: orderNo,
            order_type: original.order_type,
            table_id: original.table_id,
            status: "paid",
            payment_status: "refunded",
            refund_of: original.id,
            cashier_id: context().userId,
            cashier_name: context().userName,
            gross: toRupees(gross),
            discount: toRupees(discount),
            service_charge: toRupees(service),
            tax: toRupees(lineTax + serviceTax),
            tax_rate: original.tax_rate,
            total: toRupees(total),
            paid: toRupees(total),
            payments: JSON.stringify([{ method: input.method, amount: toRupees(total) }]),
            invoice_no: invoiceNo,
            invoiced_at: iso(db.now()),
            opened_at: iso(db.now()),
            closed_at: iso(db.now()),
            cancel_reason: input.reason.trim(),
            notes: `Refund of invoice #${original.invoice_no}`,
            pra_status: original.pra_status === "not_required" ? "not_required" : "pending",
          } as never);
          for (const i of claimed) {
            await insert("rest_order_items", {
              order_id: credit.id,
              menu_item_id: i.menu_item_id,
              deal_id: i.deal_id,
              code: i.code,
              name: i.name,
              category_id: i.category_id,
              variant: i.variant,
              modifiers: i.modifiers,
              qty: i.qty,
              unit_price: i.unit_price,
              line_total: i.line_total,
              line_discount: i.line_discount,
              line_tax: i.line_tax,
              tax_exempt: i.tax_exempt,
              kitchen_status: "served",
              refunded: 1,
            } as never);
          }
          const remaining = billable(await orderItems(original.id)).filter((i) => !i.refunded).length;
          if (!remaining) await update("rest_orders", original.id, { status: "refunded", payment_status: "refunded" }, { sql: "status = 'paid'", params: [] });
          if (credit.pra_status === "pending") await api.queuePra(credit, 3, String(original.invoice_no));
          await audit("invoice.refund", "order", original.id, { credit: credit.id, creditInvoice: invoiceNo, amount: toRupees(total), reason: input.reason, lines: claimed.length });
          return credit;
        } catch (e) {
          if (/UNIQUE/i.test(String(e))) continue;
          throw e;
        }
      }
      throw new RestError("CONFLICT", "Could not number the refund, try again.");
    },

    // ── PRA queue (the network side lives in praService.ts) ──
    async queuePra(order: OrderRow, invoiceType: 1 | 3, refUsin: string | null) {
      try {
        await insert("rest_pra_submissions", {
          order_id: order.id,
          usin: String(order.invoice_no),
          invoice_type: invoiceType,
          ref_usin: refUsin,
          status: "pending",
          attempts: 0,
        } as never);
      } catch (e) {
        if (!/UNIQUE/i.test(String(e))) throw e; // already queued: keep the existing one
      }
    },

    async praSubmissions(status?: string) {
      return db.select<PraSubmissionRow & { order_no: number; total: number }>(
        `SELECT s.*, o.order_no, o.total FROM rest_pra_submissions s JOIN rest_orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id
         WHERE s.tenant_id = ? AND s.deleted_at IS NULL ${status ? "AND s.status = ?" : ""} ORDER BY s.created_at DESC LIMIT 500`,
        status ? [tenant(), status] : [tenant()]
      );
    },

    /** Claims a submission for sending (one sender at a time). */
    async claimPra(id: string, lockSeconds = 120): Promise<PraSubmissionRow | null> {
      const now = db.now();
      const until = new Date(now.getTime() + lockSeconds * 1000);
      const changed = await db.execute(
        `UPDATE rest_pra_submissions SET status = 'submitting', attempts = attempts + 1, lock_until = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'retry_pending')`,
        [iso(until), iso(now), id, tenant()]
      );
      if (!changed.changes) return null;
      const row = await owned<PraSubmissionRow>("rest_pra_submissions", id, "PRA submission");
      await db.outbox("rest_pra_submissions", id, "update", row as unknown as Record<string, unknown>);
      return row;
    },

    async finishPra(id: string, patch: { status: string; pra_invoice_no?: string | null; response_code?: string | null; response_text?: string | null; payload?: string | null; last_error?: string | null }) {
      const sub = await owned<PraSubmissionRow>("rest_pra_submissions", id, "PRA submission");
      await update("rest_pra_submissions", id, { ...patch, submitted_at: iso(db.now()), lock_until: null });
      const orderStatus = patch.status === "submitting" ? "queued" : patch.status;
      await update("rest_orders", sub.order_id, { pra_status: orderStatus, ...(patch.pra_invoice_no ? { pra_invoice_no: patch.pra_invoice_no } : {}) });
      await audit(`pra.${patch.status}`, "order", sub.order_id, { usin: sub.usin, type: sub.invoice_type, code: patch.response_code, message: patch.response_text ?? patch.last_error });
    },

    /** Stuck 'submitting' rows (app closed mid-request): the request may have
     * reached PRA, so they go to manual review instead of an automatic resend. */
    async recoverStuckPra() {
      const now = iso(db.now());
      const stuck = await db.select<{ id: string }>(
        `SELECT id FROM rest_pra_submissions WHERE tenant_id = ? AND status = 'submitting' AND lock_until < ?`,
        [tenant(), now]
      );
      for (const s of stuck) {
        await api.finishPra(s.id, { status: "manual_review", last_error: "The app stopped while sending. Check the IMS Fiscal Report before retrying." });
      }
      return stuck.length;
    },

    /** After checking PRA's portal: send again, or record the number PRA shows. */
    async resolvePra(id: string, action: "retry" | "accepted", praInvoiceNo?: string) {
      need("rest.settings");
      const sub = await owned<PraSubmissionRow>("rest_pra_submissions", id, "PRA submission");
      if (!["manual_review", "rejected", "retry_pending"].includes(sub.status)) throw new RestError("CONFLICT", `Submission is ${sub.status}.`);
      if (action === "retry") {
        await update("rest_pra_submissions", id, { status: "pending", lock_until: null });
        await update("rest_orders", sub.order_id, { pra_status: "pending" });
        await audit("pra.manual_retry", "order", sub.order_id, { usin: sub.usin });
      } else {
        if (!praInvoiceNo?.trim()) throw new RestError("INVALID", "Enter the PRA invoice number shown on PRA's portal.");
        await api.finishPra(id, { status: "accepted", pra_invoice_no: praInvoiceNo.trim(), response_text: "Recorded manually after portal check" });
      }
    },

    async audits(limit = 300) {
      return db.select<{ id: string; created_at: string; user_name: string | null; action: string; record_type: string | null; record_id: string | null; detail: string | null }>(
        `SELECT * FROM rest_audit WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
        [tenant(), limit]
      );
    },

    // ── Reports / dashboard (finalised documents only; refunds subtract) ──
    async salesSummary(from: string, to: string) {
      const rows = await db.select<{ kind: string; n: number; gross: number; discount: number; tax: number; service: number; total: number }>(
        `SELECT CASE WHEN refund_of IS NULL THEN 'sale' ELSE 'refund' END AS kind, COUNT(*) AS n,
                COALESCE(SUM(gross), 0) AS gross, COALESCE(SUM(discount), 0) AS discount, COALESCE(SUM(tax), 0) AS tax,
                COALESCE(SUM(service_charge), 0) AS service, COALESCE(SUM(total), 0) AS total
         FROM rest_orders WHERE tenant_id = ? AND deleted_at IS NULL AND invoice_no IS NOT NULL
           AND substr(invoiced_at, 1, 10) BETWEEN ? AND ? GROUP BY kind`,
        [tenant(), from, to]
      );
      const sale = rows.find((r) => r.kind === "sale") ?? { n: 0, gross: 0, discount: 0, tax: 0, service: 0, total: 0 };
      const refund = rows.find((r) => r.kind === "refund") ?? { n: 0, gross: 0, discount: 0, tax: 0, service: 0, total: 0 };
      const cancelled = await db.select<{ n: number }>(
        `SELECT COUNT(*) AS n FROM rest_orders WHERE tenant_id = ? AND status = 'cancelled' AND cancel_reason NOT LIKE 'Merged into%' AND substr(COALESCE(closed_at, opened_at), 1, 10) BETWEEN ? AND ?`,
        [tenant(), from, to]
      );
      const net = sale.gross - sale.discount - (refund.gross - refund.discount);
      return {
        orders: sale.n,
        grossSales: sale.gross,
        discounts: sale.discount,
        serviceCharges: sale.service - refund.service,
        taxCollected: sale.tax - refund.tax,
        refunds: refund.total,
        refundCount: refund.n,
        cancelled: cancelled[0]?.n ?? 0,
        /** Food sales after discounts and refunds, before tax and service. */
        netSales: net,
        /** Money taken in, after refunds. */
        collected: sale.total - refund.total,
        averageOrder: sale.n ? sale.total / sale.n : 0,
      };
    },

    async paymentBreakdown(from: string, to: string) {
      const rows = await db.select<{ payments: string | null; total: number; refund_of: string | null }>(
        `SELECT payments, total, refund_of FROM rest_orders WHERE tenant_id = ? AND invoice_no IS NOT NULL AND deleted_at IS NULL AND substr(invoiced_at, 1, 10) BETWEEN ? AND ?`,
        [tenant(), from, to]
      );
      const out: Record<string, number> = { cash: 0, card: 0, bank: 0, digital: 0 };
      for (const r of rows) {
        const pays = json<Payment[]>(r.payments, []);
        const paid = pays.reduce((s, p) => s + toPaisa(p.amount), 0);
        // Cash change is not income: scale payments to the bill total.
        const scale = paid > 0 ? toPaisa(r.total) / paid : 0;
        for (const p of pays) out[p.method] = (out[p.method] ?? 0) + (r.refund_of ? -1 : 1) * toRupees(Math.round(toPaisa(p.amount) * scale));
      }
      return out;
    },

    async salesBy(dim: "category" | "dish" | "table" | "cashier" | "hour" | "day" | "deal" | "offer", from: string, to: string) {
      const base = `FROM rest_orders o WHERE o.tenant_id = ? AND o.invoice_no IS NOT NULL AND o.refund_of IS NULL AND o.deleted_at IS NULL AND substr(o.invoiced_at, 1, 10) BETWEEN ? AND ?`;
      const p = [tenant(), from, to];
      switch (dim) {
        case "category":
          return db.select<{ label: string; qty: number; amount: number }>(
            `SELECT COALESCE(c.name, 'Deals / other') AS label, SUM(i.qty) AS qty, SUM(i.line_total - i.line_discount) AS amount
             FROM rest_order_items i JOIN rest_orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
             LEFT JOIN rest_categories c ON c.id = i.category_id AND c.tenant_id = i.tenant_id
             WHERE i.tenant_id = ? AND i.parent_item_id IS NULL AND i.kitchen_status <> 'cancelled' AND i.deleted_at IS NULL
               AND o.invoice_no IS NOT NULL AND o.refund_of IS NULL AND substr(o.invoiced_at, 1, 10) BETWEEN ? AND ?
             GROUP BY label ORDER BY amount DESC`,
            p
          );
        case "dish":
          return db.select<{ label: string; qty: number; amount: number }>(
            `SELECT i.name AS label, SUM(i.qty) AS qty, SUM(i.line_total - i.line_discount) AS amount
             FROM rest_order_items i JOIN rest_orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
             WHERE i.tenant_id = ? AND i.parent_item_id IS NULL AND i.kitchen_status <> 'cancelled' AND i.deleted_at IS NULL
               AND o.invoice_no IS NOT NULL AND o.refund_of IS NULL AND substr(o.invoiced_at, 1, 10) BETWEEN ? AND ?
             GROUP BY i.name ORDER BY qty DESC`,
            p
          );
        case "deal":
          return db.select<{ label: string; qty: number; amount: number }>(
            `SELECT i.name AS label, SUM(i.qty) AS qty, SUM(i.line_total - i.line_discount) AS amount
             FROM rest_order_items i JOIN rest_orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
             WHERE i.tenant_id = ? AND i.deal_id IS NOT NULL AND i.parent_item_id IS NULL AND i.kitchen_status <> 'cancelled'
               AND o.invoice_no IS NOT NULL AND o.refund_of IS NULL AND substr(o.invoiced_at, 1, 10) BETWEEN ? AND ?
             GROUP BY i.name ORDER BY qty DESC`,
            p
          );
        case "table":
          return db.select<{ label: string; qty: number; amount: number }>(
            `SELECT COALESCE(t.name, CASE o.order_type WHEN 'takeaway' THEN 'Takeaway' ELSE 'Delivery' END) AS label, COUNT(*) AS qty, SUM(o.total) AS amount
             FROM rest_orders o LEFT JOIN rest_tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id
             WHERE o.tenant_id = ? AND o.invoice_no IS NOT NULL AND o.refund_of IS NULL AND substr(o.invoiced_at, 1, 10) BETWEEN ? AND ?
             GROUP BY label ORDER BY amount DESC`,
            p
          );
        case "cashier":
          return db.select<{ label: string; qty: number; amount: number }>(`SELECT COALESCE(o.cashier_name, '-') AS label, COUNT(*) AS qty, SUM(o.total) AS amount ${base} GROUP BY label ORDER BY amount DESC`, p);
        case "hour":
          return db.select<{ label: string; qty: number; amount: number }>(`SELECT substr(o.invoiced_at, 12, 2) AS label, COUNT(*) AS qty, SUM(o.total) AS amount ${base} GROUP BY label ORDER BY label`, p);
        case "day":
          return db.select<{ label: string; qty: number; amount: number }>(`SELECT substr(o.invoiced_at, 1, 10) AS label, COUNT(*) AS qty, SUM(o.total) AS amount ${base} GROUP BY label ORDER BY label`, p);
        case "offer": {
          const rows = await db.select<{ offers: string | null; discount: number }>(`SELECT o.offers, o.discount ${base}`, p);
          const agg = new Map<string, { qty: number; amount: number }>();
          for (const r of rows) {
            const applied = json<{ applied: { code: string; name: string; discountPaisa: number }[]; manualDiscount: number }>(r.offers, { applied: [], manualDiscount: 0 });
            for (const a of applied.applied ?? []) {
              const cur = agg.get(`${a.code} ${a.name}`) ?? { qty: 0, amount: 0 };
              agg.set(`${a.code} ${a.name}`, { qty: cur.qty + 1, amount: cur.amount + toRupees(a.discountPaisa) });
            }
            if (applied.manualDiscount) {
              const cur = agg.get("Manual discount") ?? { qty: 0, amount: 0 };
              agg.set("Manual discount", { qty: cur.qty + 1, amount: cur.amount + applied.manualDiscount });
            }
          }
          return [...agg.entries()].map(([label, v]) => ({ label, ...v }));
        }
      }
    },

    async ingredientUsage(from: string, to: string) {
      return db.select<{ name: string; unit: string; used: number; wasted: number; purchased: number }>(
        `SELECT i.name, i.unit,
                -SUM(CASE WHEN m.reason IN ('sale', 'reversal') THEN m.qty ELSE 0 END) AS used,
                -SUM(CASE WHEN m.reason = 'wastage' THEN m.qty ELSE 0 END) AS wasted,
                SUM(CASE WHEN m.reason = 'purchase' THEN m.qty ELSE 0 END) AS purchased
         FROM rest_stock_moves m JOIN rest_ingredients i ON i.id = m.ingredient_id AND i.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? AND substr(m.created_at, 1, 10) BETWEEN ? AND ? GROUP BY i.id ORDER BY used DESC`,
        [tenant(), from, to]
      );
    },

    async dashboard(day: string) {
      const [summary, pay, tables, open, kitchen, best, low, hourly] = await Promise.all([
        api.salesSummary(day, day),
        api.paymentBreakdown(day, day),
        api.listTables(),
        api.listOpenOrders(),
        api.kitchenQueue(null),
        api.salesBy("dish", day, day),
        db.select<IngredientRow>(`SELECT * FROM rest_ingredients WHERE tenant_id = ? AND deleted_at IS NULL AND is_active = 1 AND stock <= reorder_level AND reorder_level > 0 ORDER BY stock`, [tenant()]),
        api.salesBy("hour", day, day),
      ]);
      const target = Number(await getSetting(REST_SETTINGS.dailyTarget)) || 0;
      return {
        summary,
        payments: pay,
        tables: {
          total: tables.length,
          occupied: tables.filter((t) => t.current_order_id).length,
          available: tables.filter((t) => t.status === "available").length,
          reserved: tables.filter((t) => t.status === "reserved").length,
          billRequested: tables.filter((t) => t.status === "bill_requested").length,
        },
        activeOrders: open.length,
        kitchen: {
          sent: kitchen.filter((k) => k.kitchen_status === "sent").length,
          preparing: kitchen.filter((k) => k.kitchen_status === "preparing").length,
          ready: kitchen.filter((k) => k.kitchen_status === "ready").length,
        },
        bestSellers: best.slice(0, 8),
        lowStock: low,
        hourly,
        target,
      };
    },
  };

  return api;
}

export type RestaurantStore = ReturnType<typeof createRestaurantStore>;

export const today = (d = new Date()) => ymd(d);
