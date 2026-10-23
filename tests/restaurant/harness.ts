/** Test harness: real restaurant schema (from src-tauri/src/lib.rs) in an
 * in-memory node:sqlite database, plus switchable session contexts. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRestaurantStore, type RestContext, type RestDb } from "../../src/lib/restaurant/store.ts";

function rustSchema(n: number): string {
  const rs = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const m = new RegExp(`fn schema_sql_v${n}\\(\\)[^{]*\\{\\s*r#"([\\s\\S]*?)"#`).exec(rs);
  if (!m) throw new Error(`schema_sql_v${n} not found`);
  return m[1];
}

export function makeDb(clock: { now: Date } = { now: new Date("2026-10-23T13:30:00") }) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`);
  // The shared catalog other business types use (must never leak into restaurants).
  sql.exec(`CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, tenant_id TEXT)`);
  sql.exec(rustSchema(26));
  sql.exec(rustSchema(27));
  const outbox: { table: string; id: string; op: string }[] = [];
  const db: RestDb = {
    async select(q, params = []) {
      return sql.prepare(q).all(...(params as never[])) as never[];
    },
    async execute(q, params = []) {
      const r = sql.prepare(q).run(...(params as never[]));
      return { changes: Number(r.changes) };
    },
    async outbox(table, id, op) {
      outbox.push({ table, id, op });
    },
    newId: () => randomUUID(),
    now: () => new Date(clock.now),
  };
  return { sql, db, outbox, clock };
}

export const ctx = (tenantId: string | null, extra: Partial<RestContext> = {}): RestContext => ({
  tenantId,
  businessType: "restaurant",
  userId: `${tenantId}-owner`,
  userName: "Owner",
  role: "owner",
  deniedActions: [],
  ...extra,
});

/** A store whose session can be switched between tests. */
export function makeStore(db: RestDb, initial: RestContext) {
  const session = { current: initial };
  const store = createRestaurantStore(db, () => session.current);
  return { store, session };
}

/** Seeds a small menu for the current tenant. */
export async function seedMenu(store: ReturnType<typeof createRestaurantStore>, prefix = "") {
  const burgers = await store.saveCategory({ name: `${prefix}Burgers` });
  const drinks = await store.saveCategory({ name: `${prefix}Drinks` });
  const bbq = await store.saveCategory({ name: `${prefix}BBQ` });
  const burger = await store.saveMenuItem({
    code: `${prefix}B1`,
    name: `${prefix}Chicken Burger`,
    category_id: burgers.id,
    price: 500,
    takeaway_price: 480,
    station: "Grill",
    modifiers: [
      { name: "Extra Cheese", price: 80 },
      { name: "Extra Patty", price: 200 },
    ],
    variants: [],
  });
  const fries = await store.saveMenuItem({ code: `${prefix}F1`, name: `${prefix}Fries`, category_id: burgers.id, price: 250, station: "Fryer", variants: [{ name: "Large", price: 350 }] });
  const cola = await store.saveMenuItem({ code: `${prefix}D1`, name: `${prefix}Cola`, category_id: drinks.id, price: 150, station: "Drinks" });
  const tikka = await store.saveMenuItem({ code: `${prefix}T1`, name: `${prefix}Chicken Tikka`, category_id: bbq.id, price: 900, station: "BBQ" });
  return { burgers, drinks, bbq, burger, fries, cola, tikka };
}
