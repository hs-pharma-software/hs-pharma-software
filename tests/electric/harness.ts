/** Electric store test harness: real v28 schema from src-tauri/src/lib.rs. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createElectricStore, type EsContext, type EsDb } from "../../src/lib/electric/store.ts";

function rustSchema(n: number): string {
  const rs = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const m = new RegExp(`fn schema_sql_v${n}\\(\\)[^{]*\\{\\s*r#"([\\s\\S]*?)"#`).exec(rs);
  if (!m) throw new Error(`schema_sql_v${n} not found`);
  return m[1];
}

export function makeDb(clock = { now: new Date("2026-10-23T11:00:00") }) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`);
  // Shared pharmacy catalog and the restaurant menu: must never leak in.
  sql.exec(`CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, barcode TEXT)`);
  sql.exec(rustSchema(26));
  sql.exec(rustSchema(28));
  // Existing tenant-scoped party tables (subset of columns used).
  for (const t of ["customers", "suppliers"]) {
    sql.exec(`CREATE TABLE ${t} (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, phone TEXT, address TEXT, opening_balance REAL DEFAULT 0,
      balance_type TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT)`);
  }
  const db: EsDb = {
    async select(q, params = []) {
      return sql.prepare(q).all(...(params as never[])) as never[];
    },
    async execute(q, params = []) {
      const r = sql.prepare(q).run(...(params as never[]));
      return { changes: Number(r.changes) };
    },
    async outbox() {},
    newId: () => randomUUID(),
    now: () => new Date(clock.now),
  };
  const addParty = (table: "customers" | "suppliers", tenant: string, name: string, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    const row = { id, tenant_id: tenant, name, phone: "03001234567", address: "Lahore", opening_balance: 0, balance_type: table === "customers" ? "receivable" : "payable", ...extra };
    const keys = Object.keys(row);
    sql.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...(Object.values(row) as never[]));
    return id;
  };
  return { sql, db, clock, addParty };
}

export const ctx = (tenantId: string | null, extra: Partial<EsContext> = {}): EsContext => ({
  tenantId,
  businessType: "electronics_solar",
  userId: `${tenantId}-owner`,
  userName: "Owner",
  role: "owner",
  deniedActions: [],
  ...extra,
});

export function makeStore(db: EsDb, initial: EsContext) {
  const session = { current: initial };
  return { store: createElectricStore(db, () => session.current), session };
}

/** A cable sold by the metre, bought by the 100 m roll; an inverter with serials. */
export async function seed(store: ReturnType<typeof createElectricStore>, prefix = "") {
  await store.seedDefaultCategories();
  const cats = await store.listCategories();
  const cableCat = cats.find((c) => c.name === "Electrical Cables & Wires")!;
  const solarCat = cats.find((c) => c.name === "Solar Inverters")!;
  const cable = await store.saveProduct({
    sku: `${prefix}CBL-2.5`,
    barcode: `${prefix}8960001`,
    name: `${prefix}Copper Cable 2.5mm`,
    name_ur: "تانبے کی تار 2.5 ملی میٹر",
    product_type: "cable",
    category_id: cableCat.id,
    unit: "m",
    purchase_unit: "roll",
    purchase_factor: 100,
    cost: 90,
    price: 120,
    min_price: 110,
    tax_rate: 0,
    reorder_level: 50,
    specs: { cores: 1, size_mm2: 2.5, conductor: "Copper", roll_length_m: 100, watt: 999 },
  });
  const inverter = await store.saveProduct({
    sku: `${prefix}INV-5K`,
    name: `${prefix}Solar Inverter 5kW`,
    name_ur: "سولر انورٹر 5kW — Model ABC-5000",
    model: "ABC-5000",
    product_type: "inverter",
    category_id: solarCat.id,
    unit: "pcs",
    cost: 150000,
    price: 185000,
    tax_rate: 18,
    warranty_mfr_months: 24,
    warranty_seller_months: 12,
    specs: { capacity: 5, phase: "Single phase", inverter_type: "Hybrid" },
  });
  return { cable, inverter, cableCat, solarCat };
}
