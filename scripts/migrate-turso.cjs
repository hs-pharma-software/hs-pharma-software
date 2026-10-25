/**
 * migrate-turso.cjs
 *
 * Applies the schema migrations (src-tauri/src/lib.rs) to the shared Turso
 * database in .env.local. Run it, after a backup, EVERY TIME a migration is
 * added and BEFORE pushing code that needs it (Vercel deploys on push).
 *
 *   node scripts/backup-turso-snapshot.cjs     first: a verified backup
 *   node scripts/migrate-turso.cjs --check     read-only: target host + what is missing
 *   node scripts/migrate-turso.cjs --from=43   apply version 43 and later
 *   node scripts/migrate-turso.cjs             every version (idempotent)
 *   node scripts/migrate-turso.cjs --target-file=copy.db   rehearse on a SQLite
 *        copy (e.g. a backup's database.db) instead of Turso
 *
 * Each version is checked first: a column / table / index that already exists
 * is skipped, and the rest of the version runs as ONE atomic batch (all or
 * nothing). Versions that rebuild a table (stopOnError) or have conditional
 * steps run statement by statement as before. After each version the database
 * is compared with the schema the code expects; only a version that verifies
 * is recorded in schema_migrations. Exit code 1 if anything failed or is still
 * missing. Credentials are never printed; only the host is.
 */

// Reads credentials from .env.local (never commit tokens to git)
const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(fs.readFileSync(envPath,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
  : {};

// The one Turso database shared by Pharmacy POS, Hospital and Clinic.
//   node scripts/migrate-turso.cjs            every version (idempotent)
//   node scripts/migrate-turso.cjs --from=34  only version 34 and later
const FROM = Number((process.argv.find((a) => a.startsWith('--from=')) ?? '--from=0').split('=')[1]) || 0;
const TURSO_URL   = ((env.TURSO_DATABASE_URL || env.NEXT_PUBLIC_TURSO_DATABASE_URL) ?? '').replace('libsql://', 'https://');
const TURSO_TOKEN = (env.TURSO_AUTH_TOKEN || env.NEXT_PUBLIC_TURSO_AUTH_TOKEN) ?? '';
if (!TURSO_URL || !TURSO_TOKEN) { console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (or the NEXT_PUBLIC_TURSO_* pair) in .env.local'); process.exit(1); }

async function exec(sql) {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args: [] } }, { type: 'close' }] }),
  });
  const data = await res.json();
  const result = data.results?.[0];
  if (result?.type === 'error') {
    const msg = result.error?.message ?? '';
    // "duplicate column" and "already exists" are expected for idempotent re-runs
    if (msg.includes('duplicate column') || msg.includes('already exists')) return 'skipped';
    throw new Error(`SQL error: ${msg}\nSQL: ${sql.trim().slice(0, 120)}`);
  }
  return 'ok';
}

// Each entry mirrors one schema_sql_v* function in src-tauri/src/lib.rs.
// ADD A NEW ENTRY HERE whenever you add a new migration there.
// SQL for normalizeGenericName(): line breaks/tabs/nbsp -> space, runs of
// spaces -> one, trimmed.
const normWs = (col) =>
  `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, char(13), ' '), char(10), ' '), char(9), ' '), char(160), ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '))`;

/** SQL statements of schema_sql_v<N>() in src-tauri/src/lib.rs. */
function rustSchemaStatements(n) {
  const rs = fs.readFileSync(require('path').join(__dirname, '..', 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const m = new RegExp(`fn schema_sql_v${n}\\(\\)[^{]*\\{\\s*r#"([\\s\\S]*?)"#`).exec(rs);
  if (!m) throw new Error(`schema_sql_v${n} not found in lib.rs`);
  // Strip -- line comments BEFORE collapsing whitespace. Without this, collapsing
  // \n into a space turns "-- comment\nCREATE TABLE ..." into "-- comment CREATE TABLE ..."
  // where the -- eats the entire rest of the collapsed "line" as a comment.
  const stripped = m[1].replace(/--[^\n]*/g, '');
  return stripped.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const MIGRATIONS = [
  // v1 — base schema (all CREATE TABLE IF NOT EXISTS, safe to re-run)
  { version: 1, label: 'Base schema', statements: [
    `CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, table_name TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL CHECK (op IN ('insert','update','delete')), payload TEXT, created_at TEXT NOT NULL, synced_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox (synced_at)`,
    `CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, flat_discount_pct REAL DEFAULT 0, description TEXT, image_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS sub_categories (id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id), name TEXT NOT NULL, description TEXT, image_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS uoms (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, barcode TEXT, name TEXT NOT NULL, company_name TEXT, description TEXT, category_id TEXT REFERENCES categories(id), sub_category_id TEXT REFERENCES sub_categories(id), base_unit_id TEXT REFERENCES uoms(id), secondary_unit_id TEXT REFERENCES uoms(id), packing REAL DEFAULT 1, tax_rate_pct REAL DEFAULT 0, gst_rate_pct REAL DEFAULT 0, apply_further_tax INTEGER DEFAULT 0, max_stock_qty REAL, stock_expiry_limit_days INTEGER, location TEXT, sale_type TEXT, sro_no TEXT, sro_item_serial_no TEXT, pct_code TEXT, online_store_status TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode)`,
    `CREATE INDEX IF NOT EXISTS idx_products_name ON products (name)`,
    `CREATE TABLE IF NOT EXISTS product_batches (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), batch_no TEXT, expiry_date TEXT, qty REAL NOT NULL DEFAULT 0, location TEXT, purchase_price REAL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_product_batches_product ON product_batches (product_id)`,
    `CREATE TABLE IF NOT EXISTS price_list (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), batch_no TEXT, sale_price REAL DEFAULT 0, wholesale_price REAL DEFAULT 0, mrp REAL DEFAULT 0, comment TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, cnic_ntn TEXT, address TEXT, area TEXT, province TEXT, license_no TEXT, license_expiry TEXT, discount_pct REAL DEFAULT 0, opening_balance REAL DEFAULT 0, criteria TEXT DEFAULT 'receivable', credit_limit REAL, income_tax_status TEXT, sales_tax_status TEXT, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers (tenant_id)`,
    `CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, company_name TEXT, email TEXT, phone TEXT, cnic TEXT, address TEXT, discount_pct REAL DEFAULT 0, opening_balance REAL DEFAULT 0, criteria TEXT DEFAULT 'payable', description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers (tenant_id)`,
    `CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, designation TEXT, address TEXT, phone TEXT, cnic TEXT, basic_pay REAL DEFAULT 0, opening_balance REAL DEFAULT 0, criteria TEXT DEFAULT 'payable', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_staff_tenant ON staff (tenant_id)`,
    `CREATE TABLE IF NOT EXISTS salesmen (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, invoice_no INTEGER, date TEXT NOT NULL, inv_on TEXT NOT NULL DEFAULT 'cash', invoice_type TEXT NOT NULL DEFAULT 'retail', salesman_id TEXT REFERENCES salesmen(id), customer_id TEXT REFERENCES customers(id), description TEXT, total REAL NOT NULL DEFAULT 0, charges REAL DEFAULT 0, discount_pct REAL DEFAULT 0, discount_rs REAL DEFAULT 0, tax_pct REAL DEFAULT 0, payable REAL NOT NULL DEFAULT 0, paid REAL DEFAULT 0, balance REAL DEFAULT 0, is_return INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices (tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices (date)`,
    `CREATE TABLE IF NOT EXISTS invoice_items (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), product_id TEXT REFERENCES products(id), batch_no TEXT, product_name TEXT NOT NULL, packing TEXT, uom TEXT, qty REAL NOT NULL DEFAULT 0, bonus_qty REAL DEFAULT 0, purchase_price REAL DEFAULT 0, sale_price REAL NOT NULL DEFAULT 0, tax_pct REAL DEFAULT 0, further_tax_pct REAL DEFAULT 0, tax_rs REAL DEFAULT 0, discount_pct REAL DEFAULT 0, discount_rs REAL DEFAULT 0, total REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id)`,
    `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_no INTEGER, date TEXT NOT NULL, supplier_id TEXT REFERENCES suppliers(id), order_type TEXT, estimated_price REAL DEFAULT 0, advance_payment REAL DEFAULT 0, payment_method TEXT DEFAULT 'cash', bank_id TEXT, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders (tenant_id)`,
    `CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT REFERENCES products(id), barcode TEXT, product_name TEXT NOT NULL, packing TEXT, uom TEXT, purchase_price REAL DEFAULT 0, qty REAL DEFAULT 0, avail_qty REAL DEFAULT 0, max_stock REAL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, purchase_no INTEGER, date TEXT NOT NULL, supplier_id TEXT REFERENCES suppliers(id), order_id TEXT REFERENCES orders(id), invoice_no TEXT, advance_payment REAL DEFAULT 0, discount_rs REAL DEFAULT 0, discount_pct REAL DEFAULT 0, tax REAL DEFAULT 0, payable REAL DEFAULT 0, paid REAL DEFAULT 0, balance REAL DEFAULT 0, payment_method TEXT DEFAULT 'cash', bank_id TEXT, slip_no TEXT, description TEXT, is_return INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchases (tenant_id)`,
    `CREATE TABLE IF NOT EXISTS purchase_items (id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id), product_id TEXT REFERENCES products(id), location TEXT, barcode TEXT, product_name TEXT NOT NULL, packing TEXT, batch_no TEXT, uom TEXT, expiry_date TEXT, purchase_price REAL DEFAULT 0, booked_qty REAL DEFAULT 0, received_qty REAL DEFAULT 0, amount REAL DEFAULT 0, sales_tax_pct REAL DEFAULT 0, wht_pct REAL DEFAULT 0, total REAL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS ledger_adjustments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier','staff')), party_id TEXT NOT NULL, date TEXT NOT NULL, balance_type TEXT, payment_method TEXT DEFAULT 'cash', bank_id TEXT, paid_amount REAL DEFAULT 0, comment TEXT, invoice_no TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_tenant ON ledger_adjustments (tenant_id)`,
    `CREATE TABLE IF NOT EXISTS cash_register_entries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, date TEXT NOT NULL, transaction_type TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_cash_register_tenant ON cash_register_entries (tenant_id)`,
    `CREATE TABLE IF NOT EXISTS banks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, bank_name TEXT NOT NULL, account_no TEXT, account_title TEXT, address TEXT, phone TEXT, opening_balance REAL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS bank_ledger_entries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, bank_id TEXT NOT NULL REFERENCES banks(id), date TEXT NOT NULL, transaction_type TEXT NOT NULL, slip_no TEXT, amount REAL NOT NULL DEFAULT 0, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS expense_categories (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, date TEXT NOT NULL, category_id TEXT REFERENCES expense_categories(id), expense_by TEXT, amount REAL NOT NULL DEFAULT 0, payment_method TEXT DEFAULT 'cash', bank_id TEXT, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS salaries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, date TEXT NOT NULL, salary_month TEXT NOT NULL, salary_year TEXT NOT NULL, staff_id TEXT REFERENCES staff(id), basic_pay REAL DEFAULT 0, incentive REAL DEFAULT 0, deduction REAL DEFAULT 0, tax_rs REAL DEFAULT 0, payable_salary REAL DEFAULT 0, paid_salary REAL DEFAULT 0, balance_salary REAL DEFAULT 0, payment_method TEXT DEFAULT 'cash', bank_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS revenue_categories (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS revenues (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, date TEXT NOT NULL, category_id TEXT REFERENCES revenue_categories(id), revenue_by TEXT, amount REAL NOT NULL DEFAULT 0, payment_method TEXT DEFAULT 'cash', bank_id TEXT, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, assign_date TEXT NOT NULL, task_name TEXT NOT NULL, assign_by TEXT, assign_to TEXT, status TEXT, finished_date TEXT, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS attendance (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT REFERENCES staff(id), date TEXT NOT NULL, time_in TEXT, time_out TEXT, hours REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS audits (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, date TEXT NOT NULL, audit_name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS audit_items (id TEXT PRIMARY KEY, audit_id TEXT NOT NULL REFERENCES audits(id), product_id TEXT REFERENCES products(id), batch_no TEXT, counted_qty REAL DEFAULT 0, system_qty REAL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS delete_history (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT NOT NULL, row_id TEXT NOT NULL, deleted_by TEXT, reason TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS backup_records (id TEXT PRIMARY KEY, tenant_id TEXT, date TEXT NOT NULL, status TEXT NOT NULL, file_name TEXT, created_at TEXT NOT NULL)`,
  ]},

  // v2
  { version: 2, label: 'product_suppliers', statements: [
    `CREATE TABLE IF NOT EXISTS product_suppliers (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON product_suppliers (supplier_id)`,
    `CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers (product_id)`,
  ]},

  // v3
  { version: 3, label: 'invoices.original_invoice_id', statements: [
    `ALTER TABLE invoices ADD COLUMN original_invoice_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_original ON invoices (original_invoice_id)`,
  ]},

  // v4
  { version: 4, label: 'invoices quotation columns', statements: [
    `ALTER TABLE invoices ADD COLUMN is_quotation INTEGER DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN quotation_no INTEGER`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_quotation ON invoices (is_quotation)`,
  ]},

  // v5
  { version: 5, label: 'purchases.original_purchase_id', statements: [
    `ALTER TABLE purchases ADD COLUMN original_purchase_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_purchases_original ON purchases (original_purchase_id)`,
  ]},

  // v6
  { version: 6, label: 'sub_categories.flat_discount_pct', statements: [
    `ALTER TABLE sub_categories ADD COLUMN flat_discount_pct REAL DEFAULT 0`,
  ]},

  // v7
  { version: 7, label: 'financial_closings table', statements: [
    `CREATE TABLE IF NOT EXISTS financial_closings (id TEXT PRIMARY KEY, date TEXT NOT NULL, closed_at TEXT NOT NULL, batch_action TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
  ]},

  // v8
  { version: 8, label: 'sub_categories.default_secondary_unit_id', statements: [
    `ALTER TABLE sub_categories ADD COLUMN default_secondary_unit_id TEXT`,
  ]},

  // v9 — multi-tenant (large, all IF NOT EXISTS)
  { version: 9, label: 'Multi-tenant support', statements: [
    `CREATE TABLE IF NOT EXISTS subscription_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, allowed_modules TEXT, max_staff_logins INTEGER DEFAULT 5, max_invoices_per_month INTEGER, duration_days INTEGER DEFAULT 30, price REAL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_name TEXT, phone TEXT, email TEXT, address TEXT, subscription_plan_id TEXT REFERENCES subscription_plans(id), subscription_status TEXT NOT NULL DEFAULT 'active', subscription_started_at TEXT, subscription_expires_at TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', display_name TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `ALTER TABLE product_batches ADD COLUMN tenant_id TEXT`,
    `ALTER TABLE price_list      ADD COLUMN tenant_id TEXT`,
    `ALTER TABLE invoices        ADD COLUMN converted_invoice_id TEXT`,
    `ALTER TABLE invoices        ADD COLUMN converted_quotation_id TEXT`,
  ]},

  // v10
  { version: 10, label: 'tenants.mrp_discount_pct (dealer portal)', statements: [
    `ALTER TABLE tenants ADD COLUMN mrp_discount_pct REAL DEFAULT 0`,
  ]},

  // v11
  { version: 11, label: 'tenants.source_tenant_id (dealer portal)', statements: [
    `ALTER TABLE tenants ADD COLUMN source_tenant_id TEXT`,
  ]},

  // v12
  { version: 12, label: 'users.permissions (per-user module access)', statements: [
    `ALTER TABLE users ADD COLUMN permissions TEXT`,
  ]},
  { version: 13, label: 'invoices.fbr_invoice_no (FBR Digital Invoicing)', statements: [
    `ALTER TABLE invoices ADD COLUMN fbr_invoice_no TEXT`,
  ]},
  { version: 14, label: 'products.fbr_fields (HS Code, FBR Sale Type/Rate/UOM)', statements: [
    `ALTER TABLE products ADD COLUMN hs_code TEXT`,
    `ALTER TABLE products ADD COLUMN fbr_sale_type TEXT`,
    `ALTER TABLE products ADD COLUMN fbr_sale_rate REAL DEFAULT 0`,
    `ALTER TABLE products ADD COLUMN fbr_uom TEXT`,
  ]},
  { version: 15, label: 'invoices buyer fields (customer name/phone, FBR buyer NTN/province/address/type)', statements: [
    `ALTER TABLE invoices ADD COLUMN customer_name TEXT`,
    `ALTER TABLE invoices ADD COLUMN customer_phone TEXT`,
    `ALTER TABLE invoices ADD COLUMN buyer_ntn_cnic TEXT`,
    `ALTER TABLE invoices ADD COLUMN buyer_province TEXT`,
    `ALTER TABLE invoices ADD COLUMN buyer_address TEXT`,
    `ALTER TABLE invoices ADD COLUMN buyer_registration_type TEXT`,
  ]},
  // The backfill UPDATE is `once`: it only runs when the ALTER before it was
  // actually applied, so re-running this script never re-flags products a
  // user has manually unflagged.
  { version: 16, label: 'products.is_narcotic + backfill from name/description', statements: [
    `ALTER TABLE products ADD COLUMN is_narcotic INTEGER DEFAULT 0`,
    { once: true, sql: `UPDATE products SET is_narcotic = 1 WHERE ` + [
      'ALPRAZOLAM','BROMAZEPAM','DIAZEPAM','LORAZEPAM','CLONAZEPAM','MIDAZOLAM','CHLORDIAZEPOXIDE',
      'OXAZEPAM','TEMAZEPAM','NITRAZEPAM','ZOLPIDEM','PHENOBARBITAL','TRAMADOL','TAPENTADOL',
      'NALBUPHINE','PENTAZOCINE','BUPRENORPHINE','MORPHINE','PETHIDINE','MEPERIDINE','FENTANYL',
      'CODEINE','METHADONE','KETAMINE','OXYCODONE','HYDROCODONE','DEXTROPROPOXYPHENE','EPHEDRINE',
    ].map((k) => `UPPER(name || ' ' || COALESCE(description, '')) LIKE '%${k}%'`).join(' OR ') },
  ]},
  // Idempotent corrections to values FBR's reference APIs accept.
  { version: 17, label: 'product FBR data corrections (HS, UOM, sale type, 18%, SRO name)', statements: [
    `UPDATE products SET hs_code = '3004.9099' WHERE hs_code = '3004.9090'`,
    `UPDATE products SET hs_code = '3004.5090' WHERE hs_code = '3004.5000'`,
    `UPDATE products SET hs_code = '9018.3110' WHERE hs_code = '9018.3100'`,
    `UPDATE products SET hs_code = '9018.3990' WHERE hs_code = '9018.3900'`,
    `UPDATE products SET hs_code = '9018.9090' WHERE hs_code = '9018.9000'`,
    `UPDATE products SET fbr_uom = 'Packs' WHERE hs_code LIKE '3004.%' AND COALESCE(fbr_uom, '') NOT IN ('Packs', 'KG')`,
    `UPDATE products SET fbr_uom = 'KG' WHERE hs_code LIKE '3005.%' AND COALESCE(fbr_uom, '') <> 'KG'`,
    `UPDATE products SET fbr_uom = 'Numbers, pieces, units' WHERE (hs_code LIKE '9018.%' OR hs_code LIKE '9021.%' OR hs_code LIKE '3822.%') AND fbr_uom IS NULL`,
    `UPDATE products SET fbr_sale_type = 'Exempt goods' WHERE fbr_sale_type = 'Goods exempt'`,
    `UPDATE products SET fbr_sale_type = 'Goods at Reduced Rate' WHERE fbr_sale_type = 'Goods at reduced rate'`,
    `UPDATE products SET fbr_sale_type = 'Goods at zero-rate' WHERE fbr_sale_type = 'Goods at zero rate'`,
    `UPDATE products SET fbr_sale_rate = 18 WHERE fbr_sale_type = 'Goods at standard rate (default)' AND fbr_sale_rate = 17`,
    `UPDATE products SET sro_no = '6th Schd Table I' WHERE fbr_sale_type = 'Exempt goods' AND sro_no IN ('6th Schedule', 'Sixth Schedule Table I', '6th Schedule Table I')`,
    `UPDATE products SET sro_item_serial_no = '' WHERE fbr_sale_type = 'Exempt goods' AND sro_item_serial_no = '1'`,
  ]},
  { version: 18, label: 'exempt products: SRO Eighth Schedule Table 1, item 81', statements: [
    `UPDATE products SET sro_no = 'Eighth Schedule Table 1', sro_item_serial_no = '81' WHERE fbr_sale_type = 'Exempt goods' AND COALESCE(sro_item_serial_no, '') = ''`,
  ]},
  { version: 19, label: 'products.drap_reg_no + drap_meta (DRAP import)', statements: [
    `ALTER TABLE products ADD COLUMN drap_reg_no TEXT`,
    `ALTER TABLE products ADD COLUMN drap_meta TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_products_drap_reg_no ON products (drap_reg_no)`,
  ]},
  // This script re-runs every statement, so the seed uses the same
  // whitespace normalization as v21 / normalizeGenericName() and stays a no-op
  // for names already present.
  // v20/v21 seeded one GLOBAL generic-name list and deleted rows not keyed
  // by the global id. Since v29 generic names belong to tenants (per-tenant
  // ids), so replaying those would re-create global rows and delete tenant
  // copies. They were applied long ago; only the table creation is kept.
  { version: 20, label: 'generic_names table', statements: [
    `CREATE TABLE IF NOT EXISTS generic_names (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
  ]},
  { version: 29, label: 'catalog tenant ownership (columns, indexes, ownership log)', statements: rustSchemaStatements(29) },
  { version: 30, label: 'wholesaler / distributor module tables', statements: rustSchemaStatements(30) },
  { version: 28, label: 'electric store module tables', statements: rustSchemaStatements(28).filter((s) => !/local_assets/.test(s)) },
  { version: 27, label: 'restaurant order line discount/tax/refunded', statements: rustSchemaStatements(27) },
  // Same SQL as schema_sql_v26() in src-tauri/src/lib.rs (read from there, so
  // the two can't drift). local_secrets is device-only and never goes to Turso.
  { version: 26, label: 'restaurant module tables', statements: rustSchemaStatements(26).filter((s) => !/local_secrets/.test(s)) },
  { version: 25, label: 'tenant controls (type, sections, actions, FBR, print templates)', statements: [
    `ALTER TABLE tenants ADD COLUMN business_type TEXT`,
    `ALTER TABLE tenants ADD COLUMN allowed_modules TEXT`,
    `ALTER TABLE tenants ADD COLUMN denied_actions TEXT`,
    `ALTER TABLE tenants ADD COLUMN fbr_allowed INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE tenants ADD COLUMN print_templates_editable INTEGER NOT NULL DEFAULT 1`,
  ]},
  { version: 24, label: 'purchase_drafts', statements: [
    `CREATE TABLE IF NOT EXISTS purchase_drafts (id TEXT PRIMARY KEY, tenant_id TEXT, title TEXT, payload TEXT NOT NULL, is_auto INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_purchase_drafts_tenant ON purchase_drafts (tenant_id)`,
  ]},
  { version: 23, label: 'users.denied_actions (staff action permissions)', statements: [
    `ALTER TABLE users ADD COLUMN denied_actions TEXT`,
  ]},
  // v31 — shared pharma / general-store catalog
  { version: 33, label: 'customer contractor fields (ntn, strn, registration_type, business_name, fbr_active_status)', statements: [
    `ALTER TABLE customers ADD COLUMN ntn TEXT`,
    `ALTER TABLE customers ADD COLUMN strn TEXT`,
    `ALTER TABLE customers ADD COLUMN registration_type TEXT`,
    `ALTER TABLE customers ADD COLUMN business_name TEXT`,
    `ALTER TABLE customers ADD COLUMN fbr_active_status TEXT`,
  ] },

  { version: 32, label: 'backfill catalog_group for unowned shared catalog products/categories', statements: [
    `UPDATE products SET catalog_group = COALESCE(product_classification, 'pharma') WHERE tenant_id IS NULL AND deleted_at IS NULL AND catalog_group IS NULL`,
    `UPDATE categories SET catalog_group = 'pharma' WHERE tenant_id IS NULL AND deleted_at IS NULL AND catalog_group IS NULL`,
    `UPDATE sub_categories SET catalog_group = 'pharma' WHERE tenant_id IS NULL AND deleted_at IS NULL AND catalog_group IS NULL`,
  ] },

  { version: 31, label: 'shared catalog: catalog_group + product_classification columns', statements: [
    `ALTER TABLE products ADD COLUMN catalog_group TEXT`,
    `ALTER TABLE products ADD COLUMN product_classification TEXT`,
    `ALTER TABLE categories ADD COLUMN catalog_group TEXT`,
    `ALTER TABLE sub_categories ADD COLUMN catalog_group TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_products_catalog_group ON products (catalog_group) WHERE catalog_group IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_products_classification ON products (product_classification, tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_catalog_group ON categories (catalog_group) WHERE catalog_group IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_sub_categories_catalog_group ON sub_categories (catalog_group) WHERE catalog_group IS NOT NULL`,
  ] },

  { version: 34, label: 'clinic module (patients, doctors, appointments, consultations, prescriptions, pharmacy notifications)', statements: rustSchemaStatements(34) },

  { version: 35, label: 'hospital module (patients, services, episodes, charges, payments)', statements: rustSchemaStatements(35) },

  // stopOnError: these rebuild a table (copy, DROP, rename). If the copy fails the
  // DROP must never run, so the first failed statement ends the migration.
  { version: 36, label: 'hospital departments, lab, radiology + nullable clinic FKs', stopOnError: true, statements: rustSchemaStatements(36) },

  { version: 37, label: 'clinic_appointments nullable doctor_id', stopOnError: true, statements: rustSchemaStatements(37) },

  { version: 38, label: 'pharmacy_rx_items mailbox + rx_notes', statements: rustSchemaStatements(38) },

  { version: 39, label: 'rx items owner columns for sync', statements: rustSchemaStatements(39) },

  { version: 40, label: 'hospital HR, OPD reception, doctor desk, paid lab/radiology orders', statements: rustSchemaStatements(40) },

  { version: 41, label: 'lab performing tests (sample, unit, normal range, turnaround)', statements: rustSchemaStatements(41) },

  { version: 42, label: 'central lab reports: requests, lab / invoice numbers, verification, collection centers, print log', statements: rustSchemaStatements(42) },

  { version: 43, label: 'admission from the doctor desk, planned surgeries', statements: rustSchemaStatements(43) },
  { version: 44, label: 'CBC panel results, lab report QR token, radiology study modality', statements: rustSchemaStatements(44) },
  { version: 45, label: 'surgery invoices: charge breakdown, invoice of a booked surgery', statements: rustSchemaStatements(45) },
  { version: 46, label: 'index of the visit an admission came from; v1 indexes the shared database lacked', statements: rustSchemaStatements(46) },
  { version: 47, label: 'admission confirmation by the department Head Nurse', statements: rustSchemaStatements(47) },
  { version: 48, label: 'MSDS medical record: forms, revisions, checklists, vital signs', statements: rustSchemaStatements(48) },
  { version: 49, label: 'inpatient medication orders and the medication administration record', statements: rustSchemaStatements(49) },
  { version: 50, label: 'theatre and anaesthesia: records per surgery, anaesthesia / recovery monitoring', statements: rustSchemaStatements(50) },
  { version: 51, label: 'server audit log of writes from the web version', statements: rustSchemaStatements(51) },
  { version: 52, label: 'infection control: hand-hygiene audits, sterilization cycles and traceability', statements: rustSchemaStatements(52) },
  { version: 53, label: 'hospital blood bank: donors, units, requests, compatibility, issue, transfusion, reactions', statements: rustSchemaStatements(53) },
  { version: 54, label: 'emergency triage, MLC register, critical results, complaints, incidents, CAPA', statements: rustSchemaStatements(54) },
  { version: 55, label: 'equipment and maintenance, licences, drills, staff training / credentials / appraisals, duty roster, controlled documents', statements: rustSchemaStatements(55) },
  { version: 56, label: 'medication management: formulary, antibiotic stewardship, adverse drug reactions, controlled drugs, medicine fridges', statements: rustSchemaStatements(56) },
  { version: 57, label: 'medical records: release of information register', statements: rustSchemaStatements(57) },

  { version: 22, label: 'products.fbr_qty_factor + reclassify 4 non-medicines', statements: [
    `ALTER TABLE products ADD COLUMN fbr_qty_factor REAL DEFAULT 1`,
    ...[["ACON MALARIA", "3822.1900"], ["ONCALL EXTRA SUGAR STRIP", "3822.1900"], ["IV CANULA 22G", "9018.3990"], ["MECHICO FEEDER", "3924.9000"]].map(
      ([name, hs]) => `UPDATE products SET hs_code = '${hs}', fbr_sale_type = 'Goods at standard rate (default)', fbr_sale_rate = 18, fbr_uom = 'Numbers, pieces, units', sro_no = '', sro_item_serial_no = '', updated_at = '2026-10-23T12:00:00.000Z' WHERE name = '${name}' AND hs_code = '3004.9099'`
    ),
  ]},
];

const { createClient } = require('@libsql/client/web');
const { expectedByVersion, liveSnapshot, compare, missingFor } = require('./lib/turso-schema.cjs');
const { tursoQuery } = require('./lib/turso-http.cjs');

/** The statements of a version that still have something to do on this schema. */
function pending(statements, live) {
  return statements.filter((sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    let m = /^ALTER TABLE "?(\w+)"? ADD COLUMN "?(\w+)"?/i.exec(s);
    if (m) return !(live.tables[m[1]] && m[2] in live.tables[m[1]]);
    m = /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"?(\w+)"?/i.exec(s);
    if (m) return !live.indexes.has(m[1]);
    m = /^CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?/i.exec(s);
    if (m) return !live.tables[m[1]];
    return true; // data changes and anything else run (they are written to be repeatable)
  });
}

async function recordVersion(query, version, label, source) {
  await query(
    `INSERT INTO schema_migrations (version, label, source, applied_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(version) DO UPDATE SET label = excluded.label, verified_at = excluded.applied_at`,
    [version, label, source, new Date().toISOString()]
  );
}

/** Where the statements go: Turso, or a SQLite file for a rehearsal. */
function target() {
  const fileArg = process.argv.find((a) => a.startsWith('--target-file='));
  if (!fileArg) {
      const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
      return { name: `Turso ${new URL(TURSO_URL).host}`, query: tursoQuery, runOne: exec, batch: (stmts) => client.batch(stmts, 'write'), close: () => client.close() };
  }
  const { DatabaseSync } = require('node:sqlite');
  const file = require('path').resolve(fileArg.slice('--target-file='.length));
  const db = new DatabaseSync(file);
  return {
    name: `file ${file}`,
    query: async (sql, args = []) => {
      const st = db.prepare(sql);
      if (st.columns().length) return st.all(...args);
      st.run(...args);
      return [];
    },
    runOne: async (sql) => {
      try {
        db.exec(sql);
        return 'ok';
      } catch (e) {
        if (e.message.includes('duplicate column') || e.message.includes('already exists')) return 'skipped';
        throw new Error(`SQL error: ${e.message}\nSQL: ${sql.trim().slice(0, 120)}`);
      }
    },
    batch: async (stmts) => {
      db.exec('BEGIN');
      try {
        for (const x of stmts) db.exec(x);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  };
}

async function main() {
  const check = process.argv.includes('--check') || process.argv.includes('--dry-run');
  const db = target();
  console.log(`Target: ${db.name}`);
  const expected = expectedByVersion();
  const latest = expected.versions.at(-1).version;
  const byVersion = new Map(expected.versions.map((v) => [v.version, v]));
  let live = await liveSnapshot(db.query);
  const before = compare(expected, live);
  console.log(`Schema present up to v${before.presentUpTo}; the code needs v${latest}.`);
  for (const v of before.incomplete) console.log(`  v${v.version} missing: ${v.missing.join(', ')}`);
  if (check) {
    console.log(before.incomplete.length
      ? `\nRead-only check: nothing changed. To apply: node scripts/migrate-turso.cjs --from=${before.incomplete[0].version}`
      : '\nUp to date. Nothing to do.');
    process.exit(before.incomplete.length ? 3 : 0);
  }

  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, label TEXT, source TEXT NOT NULL, applied_at TEXT NOT NULL, verified_at TEXT)`);
  let applied = 0, skipped = 0, failed = 0;
  const unverified = [];
  let after;
  try {
    for (const m of MIGRATIONS) {
      if (m.version < FROM) continue;
      process.stdout.write(`v${m.version} ${m.label} ... `);
      let vFailed = 0, vApplied = 0;
      const legacy = m.stopOnError || m.statements.some((x) => typeof x !== 'string');
      if (legacy) {
        let prevApplied = false;
        for (const stmt of m.statements) {
          const sql = typeof stmt === 'string' ? stmt : stmt.sql;
          if (typeof stmt === 'object' && stmt.once && !prevApplied) { skipped++; continue; }
          try {
            const r = await db.runOne(sql);
            prevApplied = r !== 'skipped';
            if (r === 'skipped') skipped++; else { applied++; vApplied++; }
          } catch (err) {
            console.error(`\n  ✗ FAILED: ${err.message}`);
            vFailed++;
            if (m.stopOnError) { console.error(`  stopped v${m.version} here so no data is dropped; fix the error and run again`); break; }
          }
        }
      } else {
        const todo = pending(m.statements, live);
        skipped += m.statements.length - todo.length;
        if (todo.length) {
          try {
            await db.batch(todo); // one transaction: all statements or none
            applied += todo.length;
            vApplied = todo.length;
          } catch (err) {
            vFailed = todo.length;
            console.error(`\n  ✗ FAILED, nothing of v${m.version} was applied (rolled back): ${err.message}`);
          }
        }
      }
      failed += vFailed;
      live = await liveSnapshot(db.query);
      const adds = byVersion.get(m.version);
      const stillMissing = adds ? missingFor(adds, live, expected.final) : [];
      if (vFailed || stillMissing.length) {
        unverified.push(m.version);
        console.log(`NOT complete${stillMissing.length ? ` (missing: ${stillMissing.join(', ')})` : ''}; not recorded`);
      } else {
        await recordVersion(db.query, m.version, m.label, vApplied ? 'applied' : 'verified-present');
        console.log(vApplied ? `✓ applied ${vApplied}, verified` : 'already up to date, verified');
      }
    }
  } finally {
    after = compare(expected, live);
    // Earlier versions are recorded too once their schema verifies, marked
    // "schema-verified" (not "applied": this run did not apply them).
    const recorded = new Set((await db.query(`SELECT version FROM schema_migrations`)).map((r) => Number(r.version)));
    for (const v of after.perVersion) {
      if (v.missing.length || recorded.has(v.version)) continue;
      const entry = MIGRATIONS.find((m) => m.version === v.version);
      await recordVersion(db.query, v.version, entry?.label ?? 'schema verified', 'schema-verified');
    }
    db.close();
  }
  console.log(`\nDone. ${applied} statements applied, ${skipped} skipped, ${failed} failed.`);
  console.log(`Schema present up to v${after.presentUpTo} of v${latest}.`);
  for (const v of after.incomplete) console.log(`  still missing in v${v.version}: ${v.missing.join(', ')}`);
  if (failed || unverified.length || after.incomplete.length) process.exit(1);
}

main().catch((e) => { console.error(`Migration stopped: ${e.message}`); process.exit(1); });
