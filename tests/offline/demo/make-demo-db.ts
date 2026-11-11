/** Creates a DEMO database file (never production): the full schema and a
 * made-up pharmacy with products, batches, prices and customers.
 *   node --import ./tests/register.mjs tests/offline/demo/make-demo-db.ts <file> */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const file = process.argv[2];
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) unlinkSync(f);
const db = new DatabaseSync(file);
const RS = readFileSync(new URL("../../../src-tauri/src/lib.rs", import.meta.url), "utf8");
let v = 1;
for (;; v++) {
  const m = new RegExp(`fn ${v === 1 ? "schema_sql" : `schema_sql_v${v}`}\\(\\)[^{]*\\{\\s*r#"([\\s\\S]*?)"#`).exec(RS);
  if (!m) break;
  db.exec(m[1]);
}
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, description TEXT, applied_at TEXT)`);
for (let i = 1; i < v; i++) db.prepare(`INSERT OR IGNORE INTO schema_migrations (version, description, applied_at) VALUES (?, 'demo', ?)`).run(i, new Date().toISOString());

const T = new Date().toISOString();
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const hash = (pw: string, salt: string) => createHash("sha256").update(`${salt}:${pw}`).digest("hex");
const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
// The schema's built-in unlimited plan, so every screen is open.
run(`INSERT INTO tenants (id, name, phone, address, business_type, denied_actions, subscription_plan_id, subscription_status, subscription_expires_at, created_at, updated_at) VALUES ('demo-t', 'Demo City Pharmacy', '0300-1234567', 'Main Bazaar, Sargodha', 'retail_pharmacy', '["+desktop.offline"]', 'plan-legacy-default', 'active', ?, ?, ?)`, expires, T, T);
run(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, created_at, updated_at) VALUES ('demo-owner', 'demo-t', 'demo', ?, 'demo-salt', 'owner', 'Demo Owner', 1, ?, ?)`, hash("demo-pass", "demo-salt"), T, T);
run(`INSERT INTO uoms (id, name, tenant_id, created_at, updated_at) VALUES ('u-pack', 'Pack', NULL, ?, ?), ('u-tab', 'Tablet', NULL, ?, ?), ('u-btl', 'Bottle', NULL, ?, ?)`, T, T, T, T, T, T);
run(`INSERT INTO categories (id, name, tenant_id, flat_discount_pct, created_at, updated_at) VALUES ('c-med', 'Medicines', 'demo-t', 0, ?, ?)`, T, T);
const products: [string, string, string, number, string | null, number, number, number][] = [
  ["p-panadol", "Panadol 500mg Tablet", "8964000100011", 10, "u-tab", 30, 2.5, 0],
  ["p-brufen", "Brufen 400mg Tablet", "8964000100028", 10, "u-tab", 60, 4, 0],
  ["p-augmentin", "Augmentin 625mg Tablet", "8964000100035", 6, "u-tab", 420, 0, 0],
  ["p-ors", "ORS Sachet Orange", "8964000100042", 1, null, 35, 0, 0],
  ["p-hydryllin", "Hydryllin Syrup 120ml", "8964000100059", 1, null, 145, 0, 0],
  ["p-surbex", "Surbex Z Tablet", "8964000100066", 30, "u-tab", 690, 0, 0],
];
let i = 0;
for (const [id, name, barcode, packing, sec, price, disc] of products) {
  i++;
  run(`INSERT INTO products (id, tenant_id, name, barcode, packing, base_unit_id, secondary_unit_id, category_id, gst_rate_pct, created_at, updated_at) VALUES (?, 'demo-t', ?, ?, ?, 'u-pack', ?, 'c-med', 0, ?, ?)`, id, name, barcode, packing, sec, T, T);
  run(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, wholesale_price, mrp, created_at, updated_at) VALUES (?, ?, 'demo-t', ?, ?, ?, ?, ?)`, `${id}-pr`, id, price, price, price, T, T);
  run(`INSERT INTO product_batches (id, product_id, tenant_id, branch_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES (?, ?, 'demo-t', 'main-demo-t', ?, ?, ?, ?, ?, ?)`, `${id}-b1`, id, `A${i}01`, `2027-0${(i % 9) + 1}-28`, 4 + i, Math.round(price * 0.8), T, T);
  run(`INSERT INTO product_batches (id, product_id, tenant_id, branch_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES (?, ?, 'demo-t', 'main-demo-t', ?, ?, ?, ?, ?, ?)`, `${id}-b2`, id, `B${i}02`, `2028-0${(i % 9) + 1}-28`, 20 + i * 3, Math.round(price * 0.82), T, T);
  void disc;
}
run(`INSERT INTO customers (id, tenant_id, name, phone, opening_balance, balance_type, discount_pct, created_at, updated_at) VALUES ('cu-1', 'demo-t', 'Ali Raza', '0301-1112223', 0, 'receivable', 0, ?, ?)`, T, T);
run(`INSERT INTO salesmen (id, tenant_id, name, created_at, updated_at) VALUES (?, 'demo-t', 'Counter', ?, ?)`, randomUUID(), T, T);
db.close();
console.log(`demo database: ${file} (schema up to v${v - 1}; login demo / demo-pass)`);
