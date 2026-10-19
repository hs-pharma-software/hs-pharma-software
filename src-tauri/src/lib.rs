use tauri_plugin_sql::{Migration, MigrationKind};

// Full local schema for the offline-first pharmacy app.
//
// Design notes:
// - Every business table uses a client-generated TEXT `id` (UUID) instead of an
//   autoincrement integer, so rows created offline never collide with rows
//   created elsewhere before they've synced.
// - `created_at` / `updated_at` are ISO-8601 strings (UTC). `updated_at` is the
//   field the sync engine uses for last-write-wins conflict resolution.
// - `deleted_at` is a soft-delete marker (nullable) so deletes can be
//   propagated by the sync engine instead of losing the row's sync history.
// - `sync_outbox` records every local write (insert/update/delete) so the sync
//   engine can replay them to Turso once the app is back online.
// - `sync_meta` is a small key/value table used to remember per-table sync
//   cursors (last pulled `updated_at`) between runs.
fn schema_sql() -> &'static str {
    r#"
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
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox (synced_at);

    CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    -- ===== Settings ==================================================
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
    );

    -- ===== Products / catalog =======================================
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
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);

    CREATE TABLE IF NOT EXISTS product_batches (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        batch_no TEXT,
        expiry_date TEXT,
        qty REAL NOT NULL DEFAULT 0,
        location TEXT,
        purchase_price REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_product_batches_product ON product_batches (product_id);

    CREATE TABLE IF NOT EXISTS price_list (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        batch_no TEXT,
        sale_price REAL DEFAULT 0,
        wholesale_price REAL DEFAULT 0,
        mrp REAL DEFAULT 0,
        comment TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_price_list_product ON price_list (product_id);

    -- ===== Parties: customers / suppliers / staff / salesmen =======
    CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
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
        name TEXT NOT NULL,
        phone TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );

    -- ===== Banks / cash =============================================
    CREATE TABLE IF NOT EXISTS banks (
        id TEXT PRIMARY KEY,
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
        date TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );

    -- ===== Sales: invoices ===========================================
    CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices (date);

    CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY,
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
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id);

    -- ===== Purchasing: orders / purchases ============================
    CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases (supplier_id);

    CREATE TABLE IF NOT EXISTS purchase_items (
        id TEXT PRIMARY KEY,
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
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);

    -- ===== Expenses / Revenue / Salary ===============================
    CREATE TABLE IF NOT EXISTS expense_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
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
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS revenues (
        id TEXT PRIMARY KEY,
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

    -- ===== Ledger adjustments (shared by customers/suppliers/staff) ==
    CREATE TABLE IF NOT EXISTS ledger_adjustments (
        id TEXT PRIMARY KEY,
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
    CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_adjustments (party_type, party_id);

    -- ===== Tasks / Attendance / Audit ================================
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
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
        date TEXT NOT NULL,
        audit_name TEXT,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_items (
        id TEXT PRIMARY KEY,
        audit_id TEXT NOT NULL REFERENCES audits(id),
        product_id TEXT NOT NULL REFERENCES products(id),
        counted_qty REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );

    -- ===== Utilities ==================================================
    CREATE TABLE IF NOT EXISTS delete_history (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        delete_from TEXT NOT NULL,
        delete_by TEXT,
        reason TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        status TEXT,
        file_name TEXT,
        created_at TEXT NOT NULL
    );
    "#
}

/// Products <-> Suppliers many-to-many link (Products -> Assign To Supplier).
fn schema_sql_v2() -> &'static str {
    r#"
    CREATE TABLE IF NOT EXISTS product_suppliers (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        supplier_id TEXT NOT NULL REFERENCES suppliers(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON product_suppliers (supplier_id);
    CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers (product_id);
    "#
}

/// Links a return invoice back to the original bill it's returning items
/// from (Sale Item Return now picks the original invoice first, then items
/// off it, instead of a free-form product search).
fn schema_sql_v3() -> &'static str {
    r#"
    ALTER TABLE invoices ADD COLUMN original_invoice_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_invoices_original ON invoices (original_invoice_id);
    "#
}

/// Quotations: reuses the invoices table (is_quotation=1) so line items,
/// customer/salesman fields etc. are shared, but with their own numbering
/// sequence and kept out of every real invoice/sales query. Accepting a
/// quotation creates a brand-new invoice row and stamps converted_invoice_id
/// back onto the quotation, rather than mutating it in place.
fn schema_sql_v4() -> &'static str {
    r#"
    ALTER TABLE invoices ADD COLUMN is_quotation INTEGER DEFAULT 0;
    ALTER TABLE invoices ADD COLUMN quotation_no INTEGER;
    CREATE INDEX IF NOT EXISTS idx_invoices_quotation ON invoices (is_quotation);
    "#
}

/// Mirrors v3's invoice linking, but for purchases: lets Purchase Item
/// Return (and the new whole-invoice Purchase Return) pick the original
/// purchase first, then compute what's still returnable per line.
fn schema_sql_v5() -> &'static str {
    r#"
    ALTER TABLE purchases ADD COLUMN original_purchase_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_purchases_original ON purchases (original_purchase_id);
    "#
}

/// Sub Categories get the same flat_discount_pct Categories already had —
/// previously only Categories carried a discount column, and neither one
/// was actually settable from any form (Add/Edit always wrote 0), so the
/// field existed but could never do anything.
fn schema_sql_v6() -> &'static str {
    r#"
    ALTER TABLE sub_categories ADD COLUMN flat_discount_pct REAL DEFAULT 0;
    "#
}

/// View Financial Closing was reading a single settings key (only ever the
/// *last* closing, no history, no way to view/print/delete a past one) —
/// this gives each closing its own row like every other record in the app.
fn schema_sql_v7() -> &'static str {
    r#"
    CREATE TABLE IF NOT EXISTS financial_closings (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        closed_at TEXT NOT NULL,
        batch_action TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    "#
}

/// Sub Category can now carry a default Secondary Unit (e.g. every product
/// in "Tablets" defaults to Tab, "Injections" to Inj) so Product Detail can
/// auto-fill it instead of picking every time — supports the Pack/sub-unit
/// price-and-qty conversion feature across Products, Purchase, Order,
/// Quotation and Invoice.
fn schema_sql_v8() -> &'static str {
    r#"
    ALTER TABLE sub_categories ADD COLUMN default_secondary_unit_id TEXT;
    "#
}

/// Multi-tenant support: a Super Admin creates pharmacy accounts ("tenants"),
/// each with a login and a subscription plan (which modules they can use, how
/// many staff logins, an expiry, a monthly invoice cap). `categories` /
/// `sub_categories` / `uoms` / `products` stay global/shared on purpose — the
/// medicine catalog is meant to be visible to every tenant. Every other
/// business table gets a `tenant_id` column so stock, pricing, and sales stay
/// private per tenant. Pre-existing data (from before this migration) is
/// backfilled onto a single "Legacy" tenant/plan so nothing is lost — the
/// app's first-run Setup screen then creates real login credentials for it.
fn schema_sql_v9() -> &'static str {
    r#"
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
    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);

    ALTER TABLE product_batches ADD COLUMN tenant_id TEXT;
    ALTER TABLE price_list ADD COLUMN tenant_id TEXT;
    ALTER TABLE customers ADD COLUMN tenant_id TEXT;
    ALTER TABLE suppliers ADD COLUMN tenant_id TEXT;
    ALTER TABLE staff ADD COLUMN tenant_id TEXT;
    ALTER TABLE salesmen ADD COLUMN tenant_id TEXT;
    ALTER TABLE banks ADD COLUMN tenant_id TEXT;
    ALTER TABLE bank_ledger_entries ADD COLUMN tenant_id TEXT;
    ALTER TABLE cash_register_entries ADD COLUMN tenant_id TEXT;
    ALTER TABLE invoices ADD COLUMN tenant_id TEXT;
    ALTER TABLE invoice_items ADD COLUMN tenant_id TEXT;
    ALTER TABLE orders ADD COLUMN tenant_id TEXT;
    ALTER TABLE order_items ADD COLUMN tenant_id TEXT;
    ALTER TABLE purchases ADD COLUMN tenant_id TEXT;
    ALTER TABLE purchase_items ADD COLUMN tenant_id TEXT;
    ALTER TABLE expense_categories ADD COLUMN tenant_id TEXT;
    ALTER TABLE expenses ADD COLUMN tenant_id TEXT;
    ALTER TABLE revenue_categories ADD COLUMN tenant_id TEXT;
    ALTER TABLE revenues ADD COLUMN tenant_id TEXT;
    ALTER TABLE salaries ADD COLUMN tenant_id TEXT;
    ALTER TABLE ledger_adjustments ADD COLUMN tenant_id TEXT;
    ALTER TABLE tasks ADD COLUMN tenant_id TEXT;
    ALTER TABLE attendance ADD COLUMN tenant_id TEXT;
    ALTER TABLE audits ADD COLUMN tenant_id TEXT;
    ALTER TABLE audit_items ADD COLUMN tenant_id TEXT;
    ALTER TABLE product_suppliers ADD COLUMN tenant_id TEXT;
    ALTER TABLE financial_closings ADD COLUMN tenant_id TEXT;
    ALTER TABLE delete_history ADD COLUMN tenant_id TEXT;
    ALTER TABLE backups ADD COLUMN tenant_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchases (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_product_batches_tenant ON product_batches (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_price_list_tenant ON price_list (tenant_id);

    INSERT OR IGNORE INTO subscription_plans
        (id, name, description, price, duration_days, allowed_modules, max_staff_logins, max_invoices_per_month, created_at, updated_at)
    VALUES
        ('plan-legacy-default', 'Legacy (Unlimited)', 'Auto-created for data that existed before multi-tenant support was added.', 0, 36500,
         '["dashboard","invoices","quotation","order","purchase","products","stock","customers","suppliers","staff","cash_register","banks","expenses","other_revenue","tasks","salesman","reports","utilities","settings"]',
         50, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    INSERT OR IGNORE INTO tenants
        (id, name, owner_name, subscription_plan_id, subscription_status, subscription_started_at, subscription_expires_at, is_active, created_at, updated_at)
    VALUES
        ('tenant-default', 'My Pharmacy', NULL, 'plan-legacy-default', 'active', '2026-01-01T00:00:00.000Z', '2126-01-01T00:00:00.000Z', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    UPDATE product_batches SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE price_list SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE customers SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE suppliers SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE staff SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE salesmen SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE banks SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE bank_ledger_entries SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE cash_register_entries SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE invoices SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE invoice_items SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE orders SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE order_items SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE purchases SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE purchase_items SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE expense_categories SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE expenses SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE revenue_categories SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE revenues SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE salaries SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE ledger_adjustments SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE tasks SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE attendance SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE audits SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE audit_items SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE product_suppliers SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE financial_closings SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE delete_history SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    UPDATE backups SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
    "#
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: schema_sql(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "product_suppliers",
            sql: schema_sql_v2(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "invoice_original_invoice_id",
            sql: schema_sql_v3(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "invoice_quotation_fields",
            sql: schema_sql_v4(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "purchase_original_purchase_id",
            sql: schema_sql_v5(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "sub_category_flat_discount_pct",
            sql: schema_sql_v6(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "financial_closings",
            sql: schema_sql_v7(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "sub_category_default_secondary_unit",
            sql: schema_sql_v8(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "multi_tenant_auth_and_subscriptions",
            sql: schema_sql_v9(),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pharmacy.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
