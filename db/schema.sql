-- Turso (remote) schema — must stay in sync with the local schema embedded
-- in src-tauri/src/lib.rs. Apply once when you create the Turso database:
--
--   turso db shell <your-db-name> < db/schema.sql
--
-- The sync engine (src/lib/sync/engine.ts) assumes every table below exists
-- remotely with the exact same columns as the local SQLite copy.
--
-- Multi-tenant note (migration v9 locally): `categories` / `sub_categories` /
-- `uoms` / `products` are the shared medicine catalog and intentionally have
-- NO `tenant_id` — every tenant and the Super Admin see the same rows. Every
-- other business table below has a `tenant_id` column so stock, pricing and
-- sales stay private per pharmacy tenant.

-- ===== Sync infrastructure =====================================
CREATE TABLE IF NOT EXISTS sync_outbox (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
    payload TEXT,
    created_at TEXT NOT NULL,
    synced_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- ===== Settings ==================================================
-- `key` is prefixed with `<tenant_id>::` in application code to scope it per
-- tenant — no schema change needed for that.
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL
);

-- ===== Products / catalog (shared across every tenant) ==========
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    flat_discount_pct REAL DEFAULT 0,
    description TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sub_categories (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    flat_discount_pct REAL DEFAULT 0,
    default_secondary_unit_id TEXT,
    description TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS uoms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    barcode TEXT,
    name TEXT NOT NULL,
    company_name TEXT,
    description TEXT,
    category_id TEXT REFERENCES categories(id),
    sub_category_id TEXT REFERENCES sub_categories(id),
    base_unit_id TEXT REFERENCES uoms(id),
    secondary_unit_id TEXT REFERENCES uoms(id),
    packing REAL DEFAULT 1,
    tax_rate_pct REAL DEFAULT 0,
    gst_rate_pct REAL DEFAULT 0,
    apply_further_tax INTEGER DEFAULT 0,
    max_stock_qty REAL,
    stock_expiry_limit_days INTEGER,
    location TEXT,
    sale_type TEXT,
    sro_no TEXT,
    sro_item_serial_no TEXT,
    pct_code TEXT,
    online_store_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Stock & pricing (private per tenant) ======================
CREATE TABLE IF NOT EXISTS product_batches (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    batch_no TEXT,
    expiry_date TEXT,
    qty REAL NOT NULL DEFAULT 0,
    location TEXT,
    purchase_price REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS price_list (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    batch_no TEXT,
    sale_price REAL DEFAULT 0,
    wholesale_price REAL DEFAULT 0,
    mrp REAL DEFAULT 0,
    comment TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Parties: customers / suppliers / staff / salesmen (private) ===
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    cnic_ntn TEXT,
    address TEXT,
    area TEXT,
    province TEXT,
    license_no TEXT,
    license_expiry TEXT,
    discount_pct REAL DEFAULT 0,
    opening_balance REAL DEFAULT 0,
    balance_type TEXT DEFAULT 'receivable',
    credit_limit REAL,
    income_tax_status TEXT,
    sales_tax_status TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    company_name TEXT,
    email TEXT,
    cnic TEXT,
    phone TEXT,
    address TEXT,
    discount_pct REAL DEFAULT 0,
    opening_balance REAL DEFAULT 0,
    balance_type TEXT DEFAULT 'payable',
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    designation TEXT,
    phone TEXT,
    cnic TEXT,
    address TEXT,
    opening_balance REAL DEFAULT 0,
    balance_type TEXT DEFAULT 'payable',
    basic_pay REAL DEFAULT 0,
    date_of_joining TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS salesmen (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    phone TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Banks / cash (private per tenant) =========================
CREATE TABLE IF NOT EXISTS banks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    account_no TEXT,
    account_title TEXT,
    address TEXT,
    phone TEXT,
    opening_balance REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS bank_ledger_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    bank_id TEXT NOT NULL REFERENCES banks(id),
    date TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    slip_no TEXT,
    amount REAL NOT NULL DEFAULT 0,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS cash_register_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    date TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Sales: invoices (private per tenant) ======================
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    invoice_no INTEGER,
    date TEXT NOT NULL,
    inv_on TEXT DEFAULT 'cash',
    invoice_type TEXT DEFAULT 'retail',
    description TEXT,
    salesman_id TEXT REFERENCES salesmen(id),
    customer_id TEXT REFERENCES customers(id),
    total REAL DEFAULT 0,
    charges REAL DEFAULT 0,
    discount_pct REAL DEFAULT 0,
    discount_rs REAL DEFAULT 0,
    tax_pct REAL DEFAULT 0,
    payable REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    is_return INTEGER DEFAULT 0,
    is_memorized INTEGER DEFAULT 0,
    converted_invoice_id TEXT,
    original_invoice_id TEXT REFERENCES invoices(id),
    is_quotation INTEGER DEFAULT 0,
    quotation_no INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    batch_no TEXT,
    packing REAL DEFAULT 1,
    uom_id TEXT REFERENCES uoms(id),
    avail_qty REAL,
    qty REAL NOT NULL DEFAULT 0,
    bonus_qty REAL DEFAULT 0,
    purchase_price REAL DEFAULT 0,
    sale_price REAL DEFAULT 0,
    tax_pct REAL DEFAULT 0,
    further_tax_pct REAL DEFAULT 0,
    tax_rs REAL DEFAULT 0,
    discount_pct REAL DEFAULT 0,
    discount_rs REAL DEFAULT 0,
    total REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Purchasing: orders / purchases (private per tenant) =======
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    order_no INTEGER,
    date TEXT NOT NULL,
    supplier_id TEXT REFERENCES suppliers(id),
    order_type TEXT,
    estimated_price REAL DEFAULT 0,
    advance_payment REAL DEFAULT 0,
    payment_method TEXT,
    bank_id TEXT REFERENCES banks(id),
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    packing REAL DEFAULT 1,
    uom_id TEXT REFERENCES uoms(id),
    purchase_price REAL DEFAULT 0,
    qty REAL NOT NULL DEFAULT 0,
    avail_qty REAL,
    max_stock_qty REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    purchase_no INTEGER,
    date TEXT NOT NULL,
    order_id TEXT REFERENCES orders(id),
    supplier_id TEXT REFERENCES suppliers(id),
    supplier_invoice_no TEXT,
    discount_rs REAL DEFAULT 0,
    discount_pct REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    payable REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    description TEXT,
    payment_method TEXT,
    bank_id TEXT REFERENCES banks(id),
    slip_no TEXT,
    advance_payment REAL DEFAULT 0,
    is_return INTEGER DEFAULT 0,
    original_purchase_id TEXT REFERENCES purchases(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    purchase_id TEXT NOT NULL REFERENCES purchases(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    location TEXT,
    batch_no TEXT,
    expiry_date TEXT,
    uom_id TEXT REFERENCES uoms(id),
    purchase_price REAL DEFAULT 0,
    booked_qty REAL DEFAULT 0,
    received_qty REAL DEFAULT 0,
    avail_qty REAL,
    amount REAL DEFAULT 0,
    st_pct REAL DEFAULT 0,
    wht_pct REAL DEFAULT 0,
    total REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Expenses / Revenue / Salary (private per tenant) ==========
CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    date TEXT NOT NULL,
    category_id TEXT REFERENCES expense_categories(id),
    expense_by TEXT,
    amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS revenue_categories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS revenues (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    date TEXT NOT NULL,
    category_id TEXT REFERENCES revenue_categories(id),
    revenue_by TEXT,
    amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS salaries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    date TEXT NOT NULL,
    salary_month TEXT,
    salary_year INTEGER,
    staff_id TEXT REFERENCES staff(id),
    basic_pay REAL DEFAULT 0,
    payment_method TEXT,
    incentive REAL DEFAULT 0,
    deduction REAL DEFAULT 0,
    tax_rs REAL DEFAULT 0,
    payable_salary REAL DEFAULT 0,
    paid_salary REAL DEFAULT 0,
    balance_salary REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Ledger adjustments (private per tenant) ===================
CREATE TABLE IF NOT EXISTS ledger_adjustments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier','staff')),
    party_id TEXT NOT NULL,
    date TEXT NOT NULL,
    invoice_no TEXT,
    balance_type TEXT DEFAULT 'adjustment',
    payment_method TEXT,
    paid_amount REAL DEFAULT 0,
    comment TEXT,
    sms_sent INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Tasks / Attendance / Audit (private per tenant) ===========
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    assign_date TEXT NOT NULL,
    task_name TEXT NOT NULL,
    assign_by TEXT,
    assign_to TEXT,
    status TEXT DEFAULT 'pending',
    finished_date TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    staff_id TEXT NOT NULL REFERENCES staff(id),
    date TEXT NOT NULL,
    time_in TEXT,
    time_out TEXT,
    hours REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    date TEXT NOT NULL,
    audit_name TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    audit_id TEXT NOT NULL REFERENCES audits(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    counted_qty REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Utilities (private per tenant; local-only, not synced) ====
CREATE TABLE IF NOT EXISTS delete_history (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    date TEXT NOT NULL,
    delete_from TEXT NOT NULL,
    delete_by TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    date TEXT NOT NULL,
    status TEXT,
    file_name TEXT,
    created_at TEXT NOT NULL
);

-- ===== Financial closing history (migration v7 locally; private) ==
CREATE TABLE IF NOT EXISTS financial_closings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    date TEXT NOT NULL,
    closed_at TEXT NOT NULL,
    batch_action TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Products <-> Suppliers link (migration v2 locally; private) ==
CREATE TABLE IF NOT EXISTS product_suppliers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- ===== Multi-tenant: Super Admin, tenants, subscriptions (migration v9) ==
-- `subscription_plans` and `tenants` are global/system tables (not owned by
-- any tenant themselves). `users` holds login credentials; `tenant_id` is
-- NULL for the Super Admin account.
CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL DEFAULT 30,
    allowed_modules TEXT NOT NULL DEFAULT '[]',
    max_staff_logins INTEGER NOT NULL DEFAULT 1,
    max_invoices_per_month INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    subscription_plan_id TEXT REFERENCES subscription_plans(id),
    subscription_status TEXT NOT NULL DEFAULT 'active',
    subscription_started_at TEXT,
    subscription_expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT REFERENCES tenants(id),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin','owner','staff')),
    display_name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
