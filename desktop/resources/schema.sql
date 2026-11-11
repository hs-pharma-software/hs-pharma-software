-- schema_sql

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
    
;
-- schema_sql_v2

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
    
;
-- schema_sql_v3

    ALTER TABLE invoices ADD COLUMN original_invoice_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_invoices_original ON invoices (original_invoice_id);
    
;
-- schema_sql_v4

    ALTER TABLE invoices ADD COLUMN is_quotation INTEGER DEFAULT 0;
    ALTER TABLE invoices ADD COLUMN quotation_no INTEGER;
    CREATE INDEX IF NOT EXISTS idx_invoices_quotation ON invoices (is_quotation);
    
;
-- schema_sql_v5

    ALTER TABLE purchases ADD COLUMN original_purchase_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_purchases_original ON purchases (original_purchase_id);
    
;
-- schema_sql_v6

    ALTER TABLE sub_categories ADD COLUMN flat_discount_pct REAL DEFAULT 0;
    
;
-- schema_sql_v7

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
    
;
-- schema_sql_v8

    ALTER TABLE sub_categories ADD COLUMN default_secondary_unit_id TEXT;
    
;
-- schema_sql_v9

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
    
;
-- schema_sql_v10

    ALTER TABLE tenants ADD COLUMN mrp_discount_pct REAL DEFAULT 0;
    
;
-- schema_sql_v11

    ALTER TABLE tenants ADD COLUMN source_tenant_id TEXT;
    
;
-- schema_sql_v12

    ALTER TABLE users ADD COLUMN permissions TEXT;
    
;
-- schema_sql_v13

    ALTER TABLE invoices ADD COLUMN fbr_invoice_no TEXT;
    
;
-- schema_sql_v14

    ALTER TABLE products ADD COLUMN hs_code TEXT;
    ALTER TABLE products ADD COLUMN fbr_sale_type TEXT;
    ALTER TABLE products ADD COLUMN fbr_sale_rate REAL DEFAULT 0;
    ALTER TABLE products ADD COLUMN fbr_uom TEXT;
    
;
-- schema_sql_v15

    ALTER TABLE invoices ADD COLUMN customer_name TEXT;
    ALTER TABLE invoices ADD COLUMN customer_phone TEXT;
    ALTER TABLE invoices ADD COLUMN buyer_ntn_cnic TEXT;
    ALTER TABLE invoices ADD COLUMN buyer_province TEXT;
    ALTER TABLE invoices ADD COLUMN buyer_address TEXT;
    ALTER TABLE invoices ADD COLUMN buyer_registration_type TEXT;
    
;
-- schema_sql_v16

    ALTER TABLE products ADD COLUMN is_narcotic INTEGER DEFAULT 0;
    UPDATE products SET is_narcotic = 1
    WHERE UPPER(name || ' ' || COALESCE(description, '')) LIKE '%ALPRAZOLAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%BROMAZEPAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%DIAZEPAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%LORAZEPAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%CLONAZEPAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%MIDAZOLAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%CHLORDIAZEPOXIDE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%OXAZEPAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%TEMAZEPAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%NITRAZEPAM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%ZOLPIDEM%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%PHENOBARBITAL%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%TRAMADOL%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%TAPENTADOL%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%NALBUPHINE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%PENTAZOCINE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%BUPRENORPHINE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%MORPHINE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%PETHIDINE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%MEPERIDINE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%FENTANYL%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%CODEINE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%METHADONE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%KETAMINE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%OXYCODONE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%HYDROCODONE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%DEXTROPROPOXYPHENE%'
       OR UPPER(name || ' ' || COALESCE(description, '')) LIKE '%EPHEDRINE%';
    
;
-- schema_sql_v17

    UPDATE products SET hs_code = '3004.9099' WHERE hs_code = '3004.9090';
    UPDATE products SET hs_code = '3004.5090' WHERE hs_code = '3004.5000';
    UPDATE products SET hs_code = '9018.3110' WHERE hs_code = '9018.3100';
    UPDATE products SET hs_code = '9018.3990' WHERE hs_code = '9018.3900';
    UPDATE products SET hs_code = '9018.9090' WHERE hs_code = '9018.9000';
    UPDATE products SET fbr_uom = 'Packs' WHERE hs_code LIKE '3004.%' AND COALESCE(fbr_uom, '') NOT IN ('Packs', 'KG');
    UPDATE products SET fbr_uom = 'KG' WHERE hs_code LIKE '3005.%' AND COALESCE(fbr_uom, '') <> 'KG';
    UPDATE products SET fbr_uom = 'Numbers, pieces, units'
      WHERE (hs_code LIKE '9018.%' OR hs_code LIKE '9021.%' OR hs_code LIKE '3822.%') AND fbr_uom IS NULL;
    UPDATE products SET fbr_sale_type = 'Exempt goods' WHERE fbr_sale_type = 'Goods exempt';
    UPDATE products SET fbr_sale_type = 'Goods at Reduced Rate' WHERE fbr_sale_type = 'Goods at reduced rate';
    UPDATE products SET fbr_sale_type = 'Goods at zero-rate' WHERE fbr_sale_type = 'Goods at zero rate';
    UPDATE products SET fbr_sale_rate = 18 WHERE fbr_sale_type = 'Goods at standard rate (default)' AND fbr_sale_rate = 17;
    UPDATE products SET sro_no = '6th Schd Table I'
      WHERE fbr_sale_type = 'Exempt goods' AND sro_no IN ('6th Schedule', 'Sixth Schedule Table I', '6th Schedule Table I');
    UPDATE products SET sro_item_serial_no = '' WHERE fbr_sale_type = 'Exempt goods' AND sro_item_serial_no = '1';
    
;
-- schema_sql_v18

    UPDATE products SET sro_no = 'Eighth Schedule Table 1', sro_item_serial_no = '81'
    WHERE fbr_sale_type = 'Exempt goods' AND COALESCE(sro_item_serial_no, '') = '';
    
;
-- schema_sql_v19

    ALTER TABLE products ADD COLUMN drap_reg_no TEXT;
    ALTER TABLE products ADD COLUMN drap_meta TEXT;
    CREATE INDEX IF NOT EXISTS idx_products_drap_reg_no ON products (drap_reg_no);
    
;
-- schema_sql_v20

    CREATE TABLE IF NOT EXISTS generic_names (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_generic_names_name ON generic_names (UPPER(TRIM(name)));
    INSERT OR IGNORE INTO generic_names (id, name, created_at, updated_at)
    SELECT 'gn-' || lower(hex(UPPER(TRIM(description)))), TRIM(MIN(description)), '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z'
    FROM products
    WHERE deleted_at IS NULL AND TRIM(COALESCE(description, '')) <> ''
    GROUP BY UPPER(TRIM(description));
    
;
-- schema_sql_v21

    INSERT OR IGNORE INTO generic_names (id, name, created_at, updated_at)
    SELECT 'gn-' || lower(hex(UPPER(n))), n, '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z'
    FROM (
        SELECT TRIM(REPLACE(REPLACE(REPLACE(REPLACE(
                 REPLACE(REPLACE(REPLACE(REPLACE(name, char(13), ' '), char(10), ' '), char(9), ' '), char(160), ' '),
                 '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')) AS n
        FROM generic_names WHERE deleted_at IS NULL
    )
    WHERE n <> ''
    GROUP BY UPPER(n);
    DELETE FROM generic_names
    WHERE id <> 'gn-' || lower(hex(UPPER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(
                 REPLACE(REPLACE(REPLACE(REPLACE(name, char(13), ' '), char(10), ' '), char(9), ' '), char(160), ' '),
                 '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')))));
    
;
-- schema_sql_v22

    ALTER TABLE products ADD COLUMN fbr_qty_factor REAL DEFAULT 1;
    UPDATE products SET hs_code = '3822.1900', fbr_sale_type = 'Goods at standard rate (default)', fbr_sale_rate = 18,
        fbr_uom = 'Numbers, pieces, units', sro_no = '', sro_item_serial_no = ''
      WHERE name = 'ACON MALARIA' AND hs_code = '3004.9099';
    UPDATE products SET hs_code = '3822.1900', fbr_sale_type = 'Goods at standard rate (default)', fbr_sale_rate = 18,
        fbr_uom = 'Numbers, pieces, units', sro_no = '', sro_item_serial_no = ''
      WHERE name = 'ONCALL EXTRA SUGAR STRIP' AND hs_code = '3004.9099';
    UPDATE products SET hs_code = '9018.3990', fbr_sale_type = 'Goods at standard rate (default)', fbr_sale_rate = 18,
        fbr_uom = 'Numbers, pieces, units', sro_no = '', sro_item_serial_no = ''
      WHERE name = 'IV CANULA 22G' AND hs_code = '3004.9099';
    UPDATE products SET hs_code = '3924.9000', fbr_sale_type = 'Goods at standard rate (default)', fbr_sale_rate = 18,
        fbr_uom = 'Numbers, pieces, units', sro_no = '', sro_item_serial_no = ''
      WHERE name = 'MECHICO FEEDER' AND hs_code = '3004.9099';
    
;
-- schema_sql_v23

    ALTER TABLE users ADD COLUMN denied_actions TEXT;
    
;
-- schema_sql_v24

    CREATE TABLE IF NOT EXISTS purchase_drafts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        title TEXT,
        payload TEXT NOT NULL,
        is_auto INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_drafts_tenant ON purchase_drafts (tenant_id);
    
;
-- schema_sql_v25

    ALTER TABLE tenants ADD COLUMN business_type TEXT;
    ALTER TABLE tenants ADD COLUMN allowed_modules TEXT;
    ALTER TABLE tenants ADD COLUMN denied_actions TEXT;
    ALTER TABLE tenants ADD COLUMN fbr_allowed INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE tenants ADD COLUMN print_templates_editable INTEGER NOT NULL DEFAULT 1;
    
;
-- schema_sql_v26

    CREATE TABLE IF NOT EXISTS rest_categories (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
        sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, avail_from TEXT, avail_to TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_categories_tenant ON rest_categories (tenant_id);

    CREATE TABLE IF NOT EXISTS rest_menu_items (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, category_id TEXT, code TEXT NOT NULL, name TEXT NOT NULL,
        description TEXT, price REAL NOT NULL DEFAULT 0, takeaway_price REAL, variants TEXT, modifiers TEXT,
        station TEXT, prep_minutes INTEGER, tax_exempt INTEGER DEFAULT 0, is_available INTEGER DEFAULT 1,
        image TEXT, sort_order INTEGER DEFAULT 0, cost REAL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_menu_items_tenant ON rest_menu_items (tenant_id, category_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_menu_items_code ON rest_menu_items (tenant_id, code) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS rest_tables (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, area TEXT, capacity INTEGER DEFAULT 4,
        sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, status TEXT NOT NULL DEFAULT 'available',
        current_order_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_tables_tenant ON rest_tables (tenant_id);

    CREATE TABLE IF NOT EXISTS rest_orders (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_no INTEGER NOT NULL, order_type TEXT NOT NULL,
        table_id TEXT, status TEXT NOT NULL DEFAULT 'open', customer_name TEXT, customer_phone TEXT, guests INTEGER,
        cashier_id TEXT, cashier_name TEXT, offers TEXT, coupon TEXT,
        gross REAL DEFAULT 0, discount REAL DEFAULT 0, service_charge REAL DEFAULT 0, tax REAL DEFAULT 0,
        tax_rate REAL DEFAULT 0, total REAL DEFAULT 0, paid REAL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'unpaid',
        payments TEXT, invoice_no INTEGER, invoiced_at TEXT, refund_of TEXT, cancel_reason TEXT, notes TEXT,
        opened_at TEXT, closed_at TEXT, pra_status TEXT NOT NULL DEFAULT 'not_required', pra_invoice_no TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_orders_tenant ON rest_orders (tenant_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_orders_no ON rest_orders (tenant_id, order_no);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_orders_invoice ON rest_orders (tenant_id, invoice_no) WHERE invoice_no IS NOT NULL;

    CREATE TABLE IF NOT EXISTS rest_order_items (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, menu_item_id TEXT, deal_id TEXT,
        parent_item_id TEXT, code TEXT, name TEXT NOT NULL, category_id TEXT, variant TEXT, modifiers TEXT,
        qty REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0, line_total REAL NOT NULL DEFAULT 0,
        tax_exempt INTEGER DEFAULT 0, notes TEXT, station TEXT, kitchen_status TEXT NOT NULL DEFAULT 'new',
        kot_no INTEGER, sent_at TEXT, cancel_reason TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_order_items_order ON rest_order_items (tenant_id, order_id);
    CREATE INDEX IF NOT EXISTS idx_rest_order_items_kitchen ON rest_order_items (tenant_id, kitchen_status);

    CREATE TABLE IF NOT EXISTS rest_kots (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, kot_no INTEGER NOT NULL, station TEXT,
        item_ids TEXT, printed_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_kots_order ON rest_kots (tenant_id, order_id);

    CREATE TABLE IF NOT EXISTS rest_deals (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
        image TEXT, price REAL NOT NULL DEFAULT 0, items TEXT NOT NULL, start_date TEXT, end_date TEXT, days TEXT,
        start_time TEXT, end_time TEXT, max_redemptions INTEGER, redemptions INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_deals_code ON rest_deals (tenant_id, code) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS rest_offers (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
        value REAL DEFAULT 0, buy_qty INTEGER, get_qty INTEGER, applies_to TEXT NOT NULL DEFAULT 'order', target_ids TEXT,
        min_order REAL, min_qty REAL, max_discount REAL, start_date TEXT, end_date TEXT, days TEXT, start_time TEXT,
        end_time TEXT, usage_limit INTEGER, used_count INTEGER DEFAULT 0, coupon_code TEXT, stackable INTEGER DEFAULT 0,
        exclude_discounted INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_offers_code ON rest_offers (tenant_id, code) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS rest_ingredients (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL, purchase_unit TEXT,
        purchase_factor REAL DEFAULT 1, stock REAL NOT NULL DEFAULT 0, cost REAL DEFAULT 0, reorder_level REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_ingredients_tenant ON rest_ingredients (tenant_id);

    CREATE TABLE IF NOT EXISTS rest_recipe_lines (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, ingredient_id TEXT NOT NULL,
        qty REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_recipe_item ON rest_recipe_lines (tenant_id, menu_item_id);

    CREATE TABLE IF NOT EXISTS rest_stock_moves (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, ingredient_id TEXT NOT NULL, qty REAL NOT NULL, reason TEXT NOT NULL,
        ref_id TEXT, note TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_stock_moves_tenant ON rest_stock_moves (tenant_id, ingredient_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_stock_moves_ref ON rest_stock_moves (tenant_id, ingredient_id, reason, ref_id);

    CREATE TABLE IF NOT EXISTS rest_pra_submissions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, usin TEXT NOT NULL, invoice_type INTEGER NOT NULL,
        ref_usin TEXT, status TEXT NOT NULL, attempts INTEGER DEFAULT 0, pra_invoice_no TEXT, response_code TEXT,
        response_text TEXT, payload TEXT, last_error TEXT, submitted_at TEXT, lock_until TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_pra_usin ON rest_pra_submissions (tenant_id, usin, invoice_type);

    CREATE TABLE IF NOT EXISTS rest_audit (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, user_name TEXT, action TEXT NOT NULL,
        record_type TEXT, record_id TEXT, detail TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rest_audit_tenant ON rest_audit (tenant_id, created_at);

    CREATE TABLE IF NOT EXISTS local_secrets (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    
;
-- schema_sql_v27

    ALTER TABLE rest_order_items ADD COLUMN line_discount REAL DEFAULT 0;
    ALTER TABLE rest_order_items ADD COLUMN line_tax REAL DEFAULT 0;
    ALTER TABLE rest_order_items ADD COLUMN refunded INTEGER DEFAULT 0;
    
;
-- schema_sql_v28

    CREATE TABLE IF NOT EXISTS es_categories (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, name_ur TEXT, grp TEXT,
        sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_es_categories_tenant ON es_categories (tenant_id);

    CREATE TABLE IF NOT EXISTS es_products (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, category_id TEXT, product_type TEXT NOT NULL DEFAULT 'general',
        sku TEXT NOT NULL, barcode TEXT, name TEXT NOT NULL, name_ur TEXT, description TEXT, description_ur TEXT,
        brand TEXT, manufacturer TEXT, model TEXT, unit TEXT NOT NULL DEFAULT 'pcs', purchase_unit TEXT,
        purchase_factor REAL NOT NULL DEFAULT 1, cost REAL DEFAULT 0, avg_cost REAL DEFAULT 0, price REAL DEFAULT 0,
        wholesale_price REAL, min_price REAL, tax_rate REAL DEFAULT 0, supplier_id TEXT, reorder_level REAL DEFAULT 0,
        location TEXT, image TEXT, is_active INTEGER DEFAULT 1, serial_tracked INTEGER DEFAULT 0,
        warranty_mfr_months INTEGER, warranty_seller_months INTEGER, specs TEXT, notes TEXT, stock REAL NOT NULL DEFAULT 0,
        hs_code TEXT, fbr_sale_type TEXT, fbr_sale_rate REAL, fbr_uom TEXT, sro_no TEXT, sro_item_serial_no TEXT,
        fbr_qty_factor REAL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_es_products_tenant ON es_products (tenant_id, category_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_es_products_sku ON es_products (tenant_id, sku) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_es_products_barcode ON es_products (tenant_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS es_serials (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, product_id TEXT NOT NULL, serial TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_stock', purchase_doc_id TEXT, sale_doc_id TEXT, customer_id TEXT, customer_name TEXT,
        warranty_start TEXT, warranty_end TEXT, seller_warranty_end TEXT, supplier_ref TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_es_serials ON es_serials (tenant_id, product_id, serial);
    CREATE INDEX IF NOT EXISTS idx_es_serials_status ON es_serials (tenant_id, status);

    CREATE TABLE IF NOT EXISTS es_docs (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc_type TEXT NOT NULL, doc_no INTEGER NOT NULL, date TEXT NOT NULL,
        party_type TEXT, party_id TEXT, party_name TEXT, party_phone TEXT, party_address TEXT, lang TEXT,
        gross REAL DEFAULT 0, discount REAL DEFAULT 0, tax REAL DEFAULT 0, total REAL DEFAULT 0, paid REAL DEFAULT 0,
        balance REAL DEFAULT 0, cost_total REAL DEFAULT 0, payments TEXT, status TEXT NOT NULL DEFAULT 'final',
        ref_doc_id TEXT, supplier_invoice_no TEXT, notes TEXT, valid_until TEXT, fbr_status TEXT, fbr_invoice_no TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_es_docs_no ON es_docs (tenant_id, doc_type, doc_no);
    CREATE INDEX IF NOT EXISTS idx_es_docs_date ON es_docs (tenant_id, doc_type, date);

    CREATE TABLE IF NOT EXISTS es_doc_items (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc_id TEXT NOT NULL, product_id TEXT, ref_item_id TEXT,
        sku TEXT, name TEXT NOT NULL, name_ur TEXT, model TEXT, unit TEXT, unit_factor REAL NOT NULL DEFAULT 1,
        qty REAL NOT NULL, base_qty REAL NOT NULL, price REAL NOT NULL DEFAULT 0, discount REAL DEFAULT 0,
        tax_rate REAL DEFAULT 0, tax REAL DEFAULT 0, line_total REAL NOT NULL DEFAULT 0, cost REAL DEFAULT 0,
        serials TEXT, warranty_months INTEGER, warranty_end TEXT, returned_qty REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_es_doc_items_doc ON es_doc_items (tenant_id, doc_id);

    CREATE TABLE IF NOT EXISTS es_stock_moves (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, product_id TEXT NOT NULL, qty REAL NOT NULL, reason TEXT NOT NULL,
        doc_id TEXT, doc_item_id TEXT, unit_cost REAL, note TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_es_stock_moves_product ON es_stock_moves (tenant_id, product_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_es_stock_moves_line ON es_stock_moves (tenant_id, doc_item_id, reason) WHERE doc_item_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS es_payments (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, party_type TEXT NOT NULL, party_id TEXT, doc_id TEXT,
        amount REAL NOT NULL, method TEXT NOT NULL, date TEXT NOT NULL, note TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_es_payments_party ON es_payments (tenant_id, party_type, party_id);

    CREATE TABLE IF NOT EXISTS es_warranty_claims (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, serial_id TEXT, product_id TEXT, customer_id TEXT, customer_name TEXT,
        issue TEXT, status TEXT NOT NULL DEFAULT 'open', resolution TEXT, opened_at TEXT, closed_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_es_claims_tenant ON es_warranty_claims (tenant_id, status);

    CREATE TABLE IF NOT EXISTS es_audit (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, user_name TEXT, action TEXT NOT NULL,
        record_type TEXT, record_id TEXT, detail TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_es_audit_tenant ON es_audit (tenant_id, created_at);

    CREATE TABLE IF NOT EXISTS local_assets (
        key TEXT PRIMARY KEY, mime TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    
;
-- schema_sql_v29

    ALTER TABLE products ADD COLUMN tenant_id TEXT;
    ALTER TABLE categories ADD COLUMN tenant_id TEXT;
    ALTER TABLE sub_categories ADD COLUMN tenant_id TEXT;
    ALTER TABLE uoms ADD COLUMN tenant_id TEXT;
    ALTER TABLE generic_names ADD COLUMN tenant_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_products_tenant ON products (tenant_id, name);
    CREATE INDEX IF NOT EXISTS idx_products_tenant_barcode ON products (tenant_id, barcode);
    CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sub_categories_tenant ON sub_categories (tenant_id, category_id);
    CREATE INDEX IF NOT EXISTS idx_uoms_tenant ON uoms (tenant_id);
    DROP INDEX IF EXISTS ux_generic_names_name;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_generic_names_tenant_name ON generic_names (COALESCE(tenant_id, ''), UPPER(TRIM(name)));
    CREATE TABLE IF NOT EXISTS catalog_ownership_log (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, table_name TEXT NOT NULL, row_id TEXT NOT NULL,
        action TEXT NOT NULL, tenant_id TEXT, source_id TEXT, column_name TEXT, old_value TEXT, new_value TEXT,
        reason TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_ownership_log_run ON catalog_ownership_log (run_id);
    
;
-- schema_sql_v30

    CREATE TABLE IF NOT EXISTS dist_config (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('pharma','general')),
        settings TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_config_tenant ON dist_config (tenant_id);

    CREATE TABLE IF NOT EXISTS dist_companies (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, logo TEXT,
        contact_person TEXT, phone TEXT, email TEXT, address TEXT, description TEXT, representative TEXT,
        supplier_id TEXT, is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_companies_code ON dist_companies (tenant_id, code) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS dist_categories (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_categories_tenant ON dist_categories (tenant_id, sort_order);

    CREATE TABLE IF NOT EXISTS dist_products (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, category_id TEXT,
        code TEXT NOT NULL, barcode TEXT, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pcs', pack_size REAL DEFAULT 1,
        generic_name TEXT, strength TEXT, dosage_form TEXT, drap_reg_no TEXT, brand TEXT, size TEXT,
        trade_price REAL NOT NULL DEFAULT 0, retail_price REAL, cost REAL NOT NULL DEFAULT 0, avg_cost REAL NOT NULL DEFAULT 0,
        min_price REAL, sales_tax_rate REAL NOT NULL DEFAULT 0, stock REAL NOT NULL DEFAULT 0, reorder_level REAL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_products_code ON dist_products (tenant_id, code) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_dist_products_company ON dist_products (tenant_id, company_id);
    CREATE INDEX IF NOT EXISTS idx_dist_products_barcode ON dist_products (tenant_id, barcode);

    CREATE TABLE IF NOT EXISTS dist_customers (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, business_name TEXT NOT NULL, owner_name TEXT,
        ntn TEXT, cnic TEXT, mobile TEXT, phone2 TEXT, email TEXT, address TEXT, territory TEXT, salesman_id TEXT,
        tax_class TEXT NOT NULL DEFAULT 'retailer', status TEXT NOT NULL DEFAULT 'active',
        lat REAL, lng REAL, location_accuracy REAL, located_at TEXT, location_source TEXT, located_by TEXT,
        cdsl_no TEXT, cdsl_expiry TEXT, cdsl_status TEXT, cdsl_verified_at TEXT, cdsl_verified_by TEXT,
        atl_status TEXT NOT NULL DEFAULT 'unverified', atl_checked_at TEXT, atl_source TEXT, atl_check_id TEXT,
        credit_limit REAL, opening_balance REAL DEFAULT 0, notes TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_customers_code ON dist_customers (tenant_id, code);
    CREATE INDEX IF NOT EXISTS idx_dist_customers_salesman ON dist_customers (tenant_id, salesman_id);

    CREATE TABLE IF NOT EXISTS dist_tax_checks (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, identifier TEXT NOT NULL,
        result TEXT NOT NULL, source TEXT NOT NULL, reference TEXT, checked_by TEXT, checked_at TEXT NOT NULL, note TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_tax_checks_customer ON dist_tax_checks (tenant_id, customer_id, checked_at);

    CREATE TABLE IF NOT EXISTS dist_salesmen (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, code TEXT NOT NULL, name TEXT NOT NULL, mobile TEXT,
        territory TEXT, company_ids TEXT, monthly_target REAL DEFAULT 0, employment TEXT, is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_salesmen_code ON dist_salesmen (tenant_id, code) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_salesmen_user ON dist_salesmen (tenant_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS dist_targets (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, salesman_id TEXT NOT NULL, month TEXT NOT NULL, amount REAL NOT NULL,
        set_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_targets ON dist_targets (tenant_id, salesman_id, month);

    CREATE TABLE IF NOT EXISTS dist_loc_sessions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, salesman_id TEXT NOT NULL, status TEXT NOT NULL,
        started_at TEXT NOT NULL, stopped_at TEXT, stop_reason TEXT, last_point_at TEXT, user_agent TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_loc_sessions ON dist_loc_sessions (tenant_id, salesman_id, status);

    CREATE TABLE IF NOT EXISTS dist_loc_points (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_id TEXT NOT NULL, salesman_id TEXT NOT NULL,
        lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL, device_at TEXT, recorded_at TEXT NOT NULL, flag TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_loc_points ON dist_loc_points (tenant_id, salesman_id, recorded_at);

    CREATE TABLE IF NOT EXISTS dist_bookings (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, booking_no INTEGER NOT NULL, client_ref TEXT,
        salesman_id TEXT, customer_id TEXT NOT NULL, company_id TEXT, status TEXT NOT NULL, date TEXT NOT NULL,
        gross REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, sales_tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
        notes TEXT, loc_point_id TEXT, loc_lat REAL, loc_lng REAL, loc_accuracy REAL, loc_recorded_at TEXT,
        submitted_at TEXT, decided_by TEXT, decided_at TEXT, decision_note TEXT, invoice_id TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_bookings_no ON dist_bookings (tenant_id, booking_no);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_bookings_ref ON dist_bookings (tenant_id, client_ref) WHERE client_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dist_bookings_salesman ON dist_bookings (tenant_id, salesman_id, date);

    CREATE TABLE IF NOT EXISTS dist_booking_items (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, booking_id TEXT NOT NULL, product_id TEXT NOT NULL,
        code TEXT, name TEXT NOT NULL, unit TEXT, qty REAL NOT NULL, price REAL NOT NULL, discount REAL NOT NULL DEFAULT 0,
        sales_tax_rate REAL NOT NULL DEFAULT 0, sales_tax REAL NOT NULL DEFAULT 0, line_total REAL NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_booking_items ON dist_booking_items (tenant_id, booking_id);

    CREATE TABLE IF NOT EXISTS dist_booking_events (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, booking_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
        user_id TEXT, user_name TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_booking_events ON dist_booking_events (tenant_id, booking_id);

    CREATE TABLE IF NOT EXISTS dist_docs (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc_type TEXT NOT NULL, doc_no INTEGER NOT NULL, date TEXT NOT NULL,
        party_type TEXT NOT NULL, party_id TEXT NOT NULL, party_name TEXT, party_ntn TEXT, party_cnic TEXT, party_address TEXT,
        salesman_id TEXT, booking_id TEXT, ref_doc_id TEXT, supplier_invoice_no TEXT, description TEXT,
        gross REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, sales_tax REAL NOT NULL DEFAULT 0,
        wht_section TEXT, wht_status TEXT, wht_rate REAL NOT NULL DEFAULT 0, wht_base REAL NOT NULL DEFAULT 0, wht_amount REAL NOT NULL DEFAULT 0,
        wht_overridden INTEGER NOT NULL DEFAULT 0, tax_snapshot TEXT,
        total REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 0, cost_total REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'final', created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_docs_no ON dist_docs (tenant_id, doc_type, doc_no);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_docs_booking ON dist_docs (tenant_id, booking_id) WHERE booking_id IS NOT NULL AND doc_type = 'sale';
    CREATE INDEX IF NOT EXISTS idx_dist_docs_party ON dist_docs (tenant_id, party_type, party_id);
    CREATE INDEX IF NOT EXISTS idx_dist_docs_date ON dist_docs (tenant_id, doc_type, date);

    CREATE TABLE IF NOT EXISTS dist_doc_items (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc_id TEXT NOT NULL, product_id TEXT NOT NULL, ref_item_id TEXT,
        code TEXT, name TEXT NOT NULL, unit TEXT, company_id TEXT, category_id TEXT, batch_no TEXT, expiry TEXT,
        qty REAL NOT NULL, price REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, sales_tax_rate REAL NOT NULL DEFAULT 0,
        sales_tax REAL NOT NULL DEFAULT 0, line_total REAL NOT NULL, cost REAL NOT NULL DEFAULT 0, returned_qty REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_doc_items ON dist_doc_items (tenant_id, doc_id);

    CREATE TABLE IF NOT EXISTS dist_payments (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, party_type TEXT NOT NULL, party_id TEXT NOT NULL, doc_id TEXT,
        amount REAL NOT NULL, method TEXT NOT NULL, date TEXT NOT NULL, reference TEXT, note TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_payments_party ON dist_payments (tenant_id, party_type, party_id);

    CREATE TABLE IF NOT EXISTS dist_stock_moves (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, product_id TEXT NOT NULL, qty REAL NOT NULL, reason TEXT NOT NULL,
        doc_id TEXT, doc_item_id TEXT, unit_cost REAL, note TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_stock_moves_line ON dist_stock_moves (tenant_id, doc_item_id, reason) WHERE doc_item_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dist_stock_moves_product ON dist_stock_moves (tenant_id, product_id);

    CREATE TABLE IF NOT EXISTS dist_user_perms (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, perms TEXT NOT NULL, editable_customer_fields TEXT,
        updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_user_perms ON dist_user_perms (tenant_id, user_id);

    CREATE TABLE IF NOT EXISTS dist_audit (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, user_name TEXT, action TEXT NOT NULL,
        record_type TEXT, record_id TEXT, field TEXT, old_value TEXT, new_value TEXT, reason TEXT, detail TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dist_audit ON dist_audit (tenant_id, created_at);
    
;
-- schema_sql_v31

    ALTER TABLE products ADD COLUMN catalog_group TEXT;
    ALTER TABLE products ADD COLUMN product_classification TEXT;
    ALTER TABLE categories ADD COLUMN catalog_group TEXT;
    ALTER TABLE sub_categories ADD COLUMN catalog_group TEXT;
    CREATE INDEX IF NOT EXISTS idx_products_catalog_group ON products (catalog_group) WHERE catalog_group IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_products_classification ON products (product_classification, tenant_id);
    CREATE INDEX IF NOT EXISTS idx_categories_catalog_group ON categories (catalog_group) WHERE catalog_group IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sub_categories_catalog_group ON sub_categories (catalog_group) WHERE catalog_group IS NOT NULL
    
;
-- schema_sql_v32

    UPDATE products
       SET catalog_group = COALESCE(product_classification, 'pharma')
     WHERE tenant_id IS NULL
       AND deleted_at IS NULL
       AND catalog_group IS NULL;

    UPDATE categories
       SET catalog_group = 'pharma'
     WHERE tenant_id IS NULL
       AND deleted_at IS NULL
       AND catalog_group IS NULL;

    UPDATE sub_categories
       SET catalog_group = 'pharma'
     WHERE tenant_id IS NULL
       AND deleted_at IS NULL
       AND catalog_group IS NULL
    
;
-- schema_sql_v33

    ALTER TABLE customers ADD COLUMN ntn TEXT;
    ALTER TABLE customers ADD COLUMN strn TEXT;
    ALTER TABLE customers ADD COLUMN registration_type TEXT;
    ALTER TABLE customers ADD COLUMN business_name TEXT;
    ALTER TABLE customers ADD COLUMN fbr_active_status TEXT
    
;
-- schema_sql_v34

    -- ── Clinic: patients ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS clinic_patients (
        id          TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        mrn         TEXT,
        name        TEXT NOT NULL,
        dob         TEXT,
        gender      TEXT,
        phone       TEXT,
        address     TEXT,
        blood_group TEXT,
        allergies   TEXT,
        emergency_contact TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cp_tenant ON clinic_patients (tenant_id, name);
    CREATE INDEX IF NOT EXISTS idx_cp_mrn   ON clinic_patients (tenant_id, mrn);

    -- ── Clinic: doctors ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS clinic_doctors (
        id                TEXT PRIMARY KEY,
        tenant_id         TEXT NOT NULL,
        name              TEXT NOT NULL,
        specialization    TEXT,
        qualification     TEXT,
        phone             TEXT,
        email             TEXT,
        consultation_fee  REAL DEFAULT 0,
        follow_up_fee     REAL DEFAULT 0,
        follow_up_days    INTEGER DEFAULT 30,
        slot_minutes      INTEGER DEFAULT 15,
        available_days    TEXT,
        notes             TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        deleted_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cd_tenant ON clinic_doctors (tenant_id, name);

    -- ── Clinic: appointments ──────────────────────────────────────────
    -- status: scheduled | confirmed | checked_in | waiting | in_consultation
    --         | completed | cancelled | no_show
    CREATE TABLE IF NOT EXISTS clinic_appointments (
        id          TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        patient_id  TEXT NOT NULL,
        doctor_id   TEXT NOT NULL,
        date        TEXT NOT NULL,
        time        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'scheduled',
        type        TEXT NOT NULL DEFAULT 'routine',
        reason      TEXT,
        notes       TEXT,
        token_no    INTEGER,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ca_tenant_date ON clinic_appointments (tenant_id, date, status);
    CREATE INDEX IF NOT EXISTS idx_ca_doctor_date ON clinic_appointments (doctor_id, date);
    CREATE INDEX IF NOT EXISTS idx_ca_patient     ON clinic_appointments (patient_id);

    -- ── Clinic: consultations ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS clinic_consultations (
        id             TEXT PRIMARY KEY,
        tenant_id      TEXT NOT NULL,
        appointment_id TEXT NOT NULL,
        patient_id     TEXT NOT NULL,
        doctor_id      TEXT NOT NULL,
        date           TEXT NOT NULL,
        complaint      TEXT,
        history        TEXT,
        vitals         TEXT,
        findings       TEXT,
        diagnosis      TEXT,
        advice         TEXT,
        followup_date  TEXT,
        followup_notes TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        deleted_at     TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_cc_appointment ON clinic_consultations (appointment_id);
    CREATE INDEX IF NOT EXISTS idx_cc_patient ON clinic_consultations (patient_id);

    -- ── Clinic: prescriptions ─────────────────────────────────────────
    -- status: draft | finalized | sent | acknowledged | partially_dispensed
    --         | dispensed | cancelled
    CREATE TABLE IF NOT EXISTS clinic_prescriptions (
        id                TEXT PRIMARY KEY,
        tenant_id         TEXT NOT NULL,
        consultation_id   TEXT,
        patient_id        TEXT NOT NULL,
        doctor_id         TEXT NOT NULL,
        date              TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'draft',
        pharmacy_tenant_id TEXT,
        sent_at           TEXT,
        acknowledged_at   TEXT,
        dispensed_at      TEXT,
        notes             TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        deleted_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crx_tenant    ON clinic_prescriptions (tenant_id, date);
    CREATE INDEX IF NOT EXISTS idx_crx_patient   ON clinic_prescriptions (patient_id);
    CREATE INDEX IF NOT EXISTS idx_crx_pharmacy  ON clinic_prescriptions (pharmacy_tenant_id, status);

    -- ── Clinic: prescription items ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS clinic_rx_items (
        id              TEXT PRIMARY KEY,
        prescription_id TEXT NOT NULL,
        product_id      TEXT,
        product_name    TEXT NOT NULL,
        strength        TEXT,
        dosage_form     TEXT,
        dose            TEXT,
        route           TEXT,
        frequency       TEXT,
        duration        TEXT,
        qty             REAL NOT NULL DEFAULT 1,
        instructions    TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        deleted_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crxi_rx ON clinic_rx_items (prescription_id);

    -- ── Pharmacy: rx notifications (owned by pharmacy tenant) ─────────
    -- One row per prescription sent to a pharmacy. Idempotent on prescription_id.
    CREATE TABLE IF NOT EXISTS pharmacy_rx_notifications (
        id                TEXT PRIMARY KEY,
        pharmacy_tenant_id TEXT NOT NULL,
        prescription_id   TEXT NOT NULL,
        clinic_tenant_id  TEXT NOT NULL,
        clinic_name       TEXT NOT NULL,
        patient_name      TEXT NOT NULL,
        patient_id        TEXT NOT NULL,
        doctor_name       TEXT NOT NULL,
        rx_date           TEXT NOT NULL,
        item_count        INTEGER NOT NULL DEFAULT 0,
        status            TEXT NOT NULL DEFAULT 'pending',
        invoice_id        TEXT,
        read_at           TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pharm_rx_notif ON pharmacy_rx_notifications (pharmacy_tenant_id, prescription_id);
    CREATE INDEX IF NOT EXISTS idx_pharm_rx_status ON pharmacy_rx_notifications (pharmacy_tenant_id, status);

    -- ── Clinic ↔ Pharmacy link config ─────────────────────────────────
    CREATE TABLE IF NOT EXISTS clinic_pharmacy_link (
        id                TEXT PRIMARY KEY,
        clinic_tenant_id  TEXT NOT NULL,
        pharmacy_tenant_id TEXT NOT NULL,
        is_active         INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_clinic_pharmacy ON clinic_pharmacy_link (clinic_tenant_id)
    
;
-- schema_sql_v35

    CREATE TABLE IF NOT EXISTS hospital_patients (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        mr_no TEXT NOT NULL,
        name TEXT NOT NULL,
        father_name TEXT,
        dob TEXT,
        age_years INTEGER,
        age_months INTEGER,
        gender TEXT NOT NULL DEFAULT 'Unknown',
        phone TEXT,
        address TEXT,
        city TEXT,
        cnic TEXT,
        blood_group TEXT,
        allergies TEXT,
        chronic_conditions TEXT,
        insurance_company TEXT,
        insurance_no TEXT,
        next_of_kin_name TEXT,
        next_of_kin_phone TEXT,
        next_of_kin_relation TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_patient_mr ON hospital_patients (tenant_id, mr_no);
    CREATE INDEX IF NOT EXISTS idx_hosp_patient_tenant ON hospital_patients (tenant_id, name);

    CREATE TABLE IF NOT EXISTS hospital_services (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT 'General',
        category TEXT NOT NULL DEFAULT 'misc',
        billing_unit TEXT NOT NULL DEFAULT 'visit',
        rate REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_svc_code ON hospital_services (tenant_id, code);
    CREATE INDEX IF NOT EXISTS idx_hosp_svc_dept ON hospital_services (tenant_id, department, category);

    CREATE TABLE IF NOT EXISTS hospital_episodes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        episode_no TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'opd',
        patient_id TEXT NOT NULL,
        doctor_id TEXT,
        department TEXT,
        date TEXT NOT NULL,
        time TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        room_ward TEXT,
        bed_no TEXT,
        admission_date TEXT,
        discharge_date TEXT,
        diagnosis TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_episode_no ON hospital_episodes (tenant_id, episode_no);
    CREATE INDEX IF NOT EXISTS idx_hosp_episode_patient ON hospital_episodes (patient_id, date);
    CREATE INDEX IF NOT EXISTS idx_hosp_episode_status ON hospital_episodes (tenant_id, status, type);

    CREATE TABLE IF NOT EXISTS hospital_charges (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        service_id TEXT,
        description TEXT NOT NULL,
        department TEXT,
        category TEXT,
        qty REAL NOT NULL DEFAULT 1,
        rate REAL NOT NULL DEFAULT 0,
        discount_pct REAL NOT NULL DEFAULT 0,
        amount REAL NOT NULL DEFAULT 0,
        doctor_id TEXT,
        performed_by TEXT,
        charge_date TEXT NOT NULL,
        notes TEXT,
        invoice_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_charge_episode ON hospital_charges (episode_id);
    CREATE INDEX IF NOT EXISTS idx_hosp_charge_tenant ON hospital_charges (tenant_id, charge_date);

    CREATE TABLE IF NOT EXISTS hospital_payments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'payment',
        amount REAL NOT NULL DEFAULT 0,
        method TEXT NOT NULL DEFAULT 'cash',
        reference TEXT,
        notes TEXT,
        received_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_payment_episode ON hospital_payments (episode_id);
    CREATE INDEX IF NOT EXISTS idx_hosp_payment_tenant ON hospital_payments (tenant_id, received_at)
    
;
-- schema_sql_v36

    CREATE TABLE clinic_consultations_new (
        id             TEXT PRIMARY KEY,
        tenant_id      TEXT NOT NULL,
        appointment_id TEXT,
        patient_id     TEXT NOT NULL,
        doctor_id      TEXT,
        date           TEXT NOT NULL,
        complaint      TEXT,
        history        TEXT,
        vitals         TEXT,
        findings       TEXT,
        diagnosis      TEXT,
        advice         TEXT,
        followup_date  TEXT,
        followup_notes TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        deleted_at     TEXT
    );
    INSERT INTO clinic_consultations_new SELECT id, tenant_id, appointment_id, patient_id, doctor_id, date, complaint, history, vitals, findings, diagnosis, advice, followup_date, followup_notes, created_at, updated_at, deleted_at FROM clinic_consultations;
    DROP TABLE clinic_consultations;
    ALTER TABLE clinic_consultations_new RENAME TO clinic_consultations;
    CREATE INDEX IF NOT EXISTS idx_cc_appointment ON clinic_consultations (appointment_id);
    CREATE INDEX IF NOT EXISTS idx_cc_patient ON clinic_consultations (patient_id);

    CREATE TABLE clinic_prescriptions_new (
        id                 TEXT PRIMARY KEY,
        tenant_id          TEXT NOT NULL,
        consultation_id    TEXT,
        patient_id         TEXT NOT NULL,
        doctor_id          TEXT,
        date               TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'draft',
        pharmacy_tenant_id TEXT,
        sent_at            TEXT,
        acknowledged_at    TEXT,
        dispensed_at       TEXT,
        notes              TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        deleted_at         TEXT
    );
    INSERT INTO clinic_prescriptions_new SELECT id, tenant_id, consultation_id, patient_id, doctor_id, date, status, pharmacy_tenant_id, sent_at, acknowledged_at, dispensed_at, notes, created_at, updated_at, deleted_at FROM clinic_prescriptions;
    DROP TABLE clinic_prescriptions;
    ALTER TABLE clinic_prescriptions_new RENAME TO clinic_prescriptions;
    CREATE INDEX IF NOT EXISTS idx_crx_tenant ON clinic_prescriptions (tenant_id, date);
    CREATE INDEX IF NOT EXISTS idx_crx_patient ON clinic_prescriptions (patient_id);
    CREATE INDEX IF NOT EXISTS idx_crx_pharmacy ON clinic_prescriptions (pharmacy_tenant_id, status);

    CREATE TABLE IF NOT EXISTS hospital_departments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'clinical',
        head TEXT,
        phone TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_dept_name ON hospital_departments (tenant_id, name);

    CREATE TABLE IF NOT EXISTS hospital_lab_orders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        order_no TEXT NOT NULL,
        episode_id TEXT,
        patient_id TEXT NOT NULL,
        test_name TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'routine',
        status TEXT NOT NULL DEFAULT 'pending',
        result_value TEXT,
        unit TEXT,
        ref_range TEXT,
        flag TEXT,
        ordered_by TEXT,
        ordered_at TEXT NOT NULL,
        reported_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_lab_tenant ON hospital_lab_orders (tenant_id, status, ordered_at);
    CREATE INDEX IF NOT EXISTS idx_hosp_lab_patient ON hospital_lab_orders (patient_id);

    CREATE TABLE IF NOT EXISTS hospital_imaging_orders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        order_no TEXT NOT NULL,
        episode_id TEXT,
        patient_id TEXT NOT NULL,
        modality TEXT NOT NULL,
        body_part TEXT,
        priority TEXT NOT NULL DEFAULT 'routine',
        status TEXT NOT NULL DEFAULT 'pending',
        findings TEXT,
        impression TEXT,
        radiologist TEXT,
        ordered_by TEXT,
        ordered_at TEXT NOT NULL,
        reported_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_img_tenant ON hospital_imaging_orders (tenant_id, status, ordered_at);
    CREATE INDEX IF NOT EXISTS idx_hosp_img_patient ON hospital_imaging_orders (patient_id)
    
;
-- schema_sql_v37

    CREATE TABLE clinic_appointments_new (
        id          TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        patient_id  TEXT NOT NULL,
        doctor_id   TEXT,
        date        TEXT NOT NULL,
        time        TEXT,
        status      TEXT NOT NULL DEFAULT 'scheduled',
        type        TEXT NOT NULL DEFAULT 'routine',
        reason      TEXT,
        notes       TEXT,
        token_no    INTEGER,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
    );
    INSERT INTO clinic_appointments_new SELECT id, tenant_id, patient_id, doctor_id, date, time, status, type, reason, notes, token_no, created_at, updated_at, deleted_at FROM clinic_appointments;
    DROP TABLE clinic_appointments;
    ALTER TABLE clinic_appointments_new RENAME TO clinic_appointments;
    CREATE INDEX IF NOT EXISTS idx_ca_tenant_date ON clinic_appointments (tenant_id, date, status);
    CREATE INDEX IF NOT EXISTS idx_ca_doctor_date ON clinic_appointments (doctor_id, date);
    CREATE INDEX IF NOT EXISTS idx_ca_patient     ON clinic_appointments (patient_id)
    
;
-- schema_sql_v38

    ALTER TABLE pharmacy_rx_notifications ADD COLUMN rx_notes TEXT;
    CREATE TABLE IF NOT EXISTS pharmacy_rx_items (
        id                 TEXT PRIMARY KEY,
        pharmacy_tenant_id TEXT NOT NULL,
        prescription_id    TEXT NOT NULL,
        product_id         TEXT,
        product_name       TEXT NOT NULL,
        strength           TEXT,
        dosage_form        TEXT,
        dose               TEXT,
        route              TEXT,
        frequency          TEXT,
        duration           TEXT,
        qty                REAL NOT NULL DEFAULT 1,
        instructions       TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pharm_rx_items ON pharmacy_rx_items (pharmacy_tenant_id, prescription_id)
    
;
-- schema_sql_v39

    ALTER TABLE clinic_rx_items ADD COLUMN tenant_id TEXT;
    UPDATE clinic_rx_items SET tenant_id = (SELECT p.tenant_id FROM clinic_prescriptions p WHERE p.id = clinic_rx_items.prescription_id) WHERE tenant_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_crxi_tenant ON clinic_rx_items (tenant_id);
    ALTER TABLE pharmacy_rx_items ADD COLUMN clinic_tenant_id TEXT;
    ALTER TABLE pharmacy_rx_items ADD COLUMN deleted_at TEXT;
    UPDATE pharmacy_rx_items SET clinic_tenant_id = (SELECT n.clinic_tenant_id FROM pharmacy_rx_notifications n WHERE n.prescription_id = pharmacy_rx_items.prescription_id AND n.pharmacy_tenant_id = pharmacy_rx_items.pharmacy_tenant_id) WHERE clinic_tenant_id IS NULL
    
;
-- schema_sql_v40

    ALTER TABLE staff ADD COLUMN employee_id TEXT;
    ALTER TABLE staff ADD COLUMN staff_category TEXT;
    ALTER TABLE staff ADD COLUMN license_type TEXT;
    ALTER TABLE staff ADD COLUMN license_no TEXT;
    ALTER TABLE staff ADD COLUMN department TEXT;
    ALTER TABLE staff ADD COLUMN specialization TEXT;
    ALTER TABLE staff ADD COLUMN consultation_fee REAL DEFAULT 0;
    ALTER TABLE staff ADD COLUMN user_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_employee_id ON staff (tenant_id, employee_id) WHERE employee_id IS NOT NULL;
    ALTER TABLE hospital_episodes ADD COLUMN token_no INTEGER;
    ALTER TABLE hospital_episodes ADD COLUMN consult_status TEXT DEFAULT 'waiting';
    ALTER TABLE hospital_episodes ADD COLUMN complaint TEXT;
    ALTER TABLE hospital_episodes ADD COLUMN vitals TEXT;
    ALTER TABLE hospital_episodes ADD COLUMN findings TEXT;
    ALTER TABLE hospital_episodes ADD COLUMN advice TEXT;
    ALTER TABLE hospital_episodes ADD COLUMN followup_date TEXT;
    CREATE INDEX IF NOT EXISTS idx_hosp_episode_doctor ON hospital_episodes (tenant_id, doctor_id, date);
    ALTER TABLE hospital_lab_orders ADD COLUMN service_id TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN charge_id TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN fee REAL DEFAULT 0;
    ALTER TABLE hospital_lab_orders ADD COLUMN paid INTEGER DEFAULT 0;
    ALTER TABLE hospital_imaging_orders ADD COLUMN service_id TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN charge_id TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN fee REAL DEFAULT 0;
    ALTER TABLE hospital_imaging_orders ADD COLUMN paid INTEGER DEFAULT 0;
    CREATE TABLE IF NOT EXISTS hospital_rx_items (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        product_id TEXT,
        product_name TEXT NOT NULL,
        generic_name TEXT,
        dose TEXT,
        route TEXT,
        frequency TEXT,
        duration TEXT,
        qty REAL NOT NULL DEFAULT 1,
        instructions TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_rx_episode ON hospital_rx_items (tenant_id, episode_id)
    
;
-- schema_sql_v41

    ALTER TABLE hospital_services ADD COLUMN sample_type TEXT;
    ALTER TABLE hospital_services ADD COLUMN unit TEXT;
    ALTER TABLE hospital_services ADD COLUMN ref_range TEXT;
    ALTER TABLE hospital_services ADD COLUMN turnaround_hours REAL
    
;
-- schema_sql_v42

    CREATE TABLE IF NOT EXISTS hospital_collection_centers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_cc_code ON hospital_collection_centers (tenant_id, code);
    CREATE TABLE IF NOT EXISTS hospital_lab_requests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lab_no TEXT NOT NULL,
        invoice_no TEXT NOT NULL,
        episode_id TEXT,
        patient_id TEXT NOT NULL,
        referring_doctor TEXT,
        registration_location TEXT NOT NULL DEFAULT 'hospital_lab',
        collection_center_id TEXT,
        external_ref TEXT,
        registered_by TEXT,
        sample_collected_at TEXT,
        sample_received_at TEXT,
        print_count INTEGER NOT NULL DEFAULT 0,
        last_printed_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_labreq_labno ON hospital_lab_requests (tenant_id, lab_no);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_labreq_invoice ON hospital_lab_requests (tenant_id, invoice_no);
    CREATE INDEX IF NOT EXISTS idx_hosp_labreq_patient ON hospital_lab_requests (tenant_id, patient_id);
    CREATE INDEX IF NOT EXISTS idx_hosp_labreq_extref ON hospital_lab_requests (tenant_id, external_ref);
    ALTER TABLE hospital_lab_orders ADD COLUMN request_id TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN sample_type TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN result_entered_by TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN result_entered_at TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN verified_by TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN verified_by_name TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN verified_by_license TEXT;
    ALTER TABLE hospital_lab_orders ADD COLUMN verified_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_hosp_lab_request ON hospital_lab_orders (request_id);
    CREATE TABLE IF NOT EXISTS hospital_lab_report_log (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT,
        user_name TEXT,
        location_id TEXT,
        details TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_labrep_log ON hospital_lab_report_log (tenant_id, request_id, created_at);
    ALTER TABLE staff ADD COLUMN collection_center_id TEXT;
    INSERT INTO hospital_lab_requests (id, tenant_id, lab_no, invoice_no, episode_id, patient_id, referring_doctor, registration_location, created_at, updated_at)
        SELECT 'lr-' || o.id, o.tenant_id, 'LN-' || o.order_no, 'LI-' || o.order_no, o.episode_id, o.patient_id, o.ordered_by, 'hospital_lab', o.created_at, o.updated_at
        FROM hospital_lab_orders o
        WHERE o.request_id IS NULL AND NOT EXISTS (SELECT 1 FROM hospital_lab_requests r WHERE r.id = 'lr-' || o.id);
    UPDATE hospital_lab_orders SET request_id = 'lr-' || id WHERE request_id IS NULL;
    UPDATE hospital_lab_orders SET verified_at = COALESCE(reported_at, updated_at), verified_by_name = 'Released before verification was required' WHERE status = 'reported' AND verified_at IS NULL
    
;
-- schema_sql_v43

    ALTER TABLE hospital_episodes ADD COLUMN from_episode_id TEXT;
    CREATE TABLE IF NOT EXISTS hospital_surgery_bookings (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        surgery_name TEXT NOT NULL,
        fee REAL NOT NULL DEFAULT 0,
        charge_id TEXT,
        surgeon_id TEXT,
        planned_date TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        notes TEXT,
        performed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_surgery_episode ON hospital_surgery_bookings (tenant_id, episode_id);
    CREATE INDEX IF NOT EXISTS idx_hosp_surgery_date ON hospital_surgery_bookings (tenant_id, status, planned_date)
    
;
-- schema_sql_v44

    ALTER TABLE hospital_lab_orders ADD COLUMN components TEXT;
    ALTER TABLE hospital_lab_requests ADD COLUMN public_token TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hosp_lab_req_public_token ON hospital_lab_requests (public_token) WHERE public_token IS NOT NULL;
    ALTER TABLE hospital_services ADD COLUMN modality TEXT
    
;
-- schema_sql_v45

    ALTER TABLE hospital_services ADD COLUMN fee_breakdown TEXT;
    ALTER TABLE hospital_surgery_bookings ADD COLUMN fee_breakdown TEXT;
    ALTER TABLE hospital_surgery_bookings ADD COLUMN invoice_id TEXT;
    ALTER TABLE invoices ADD COLUMN hospital_episode_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_invoices_hospital_episode ON invoices (tenant_id, hospital_episode_id) WHERE hospital_episode_id IS NOT NULL
    
;
-- schema_sql_v46

    CREATE INDEX IF NOT EXISTS idx_hosp_episodes_from ON hospital_episodes (tenant_id, from_episode_id) WHERE from_episode_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_price_list_product ON price_list (product_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases (supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_adjustments (party_type, party_id)
    
;
-- schema_sql_v47

    ALTER TABLE hospital_episodes ADD COLUMN admission_status TEXT;
    ALTER TABLE hospital_episodes ADD COLUMN admission_confirmed_by TEXT;
    ALTER TABLE hospital_episodes ADD COLUMN admission_confirmed_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_hosp_episodes_admission ON hospital_episodes (tenant_id, admission_status) WHERE admission_status IS NOT NULL
    
;
-- schema_sql_v48

    CREATE TABLE IF NOT EXISTS hospital_form_records (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
        form_key TEXT NOT NULL, form_version INTEGER NOT NULL, scope TEXT NOT NULL,
        patient_id TEXT, episode_id TEXT, department TEXT,
        status TEXT NOT NULL DEFAULT 'draft', data TEXT NOT NULL, summary TEXT,
        unique_key TEXT,
        created_by TEXT, created_by_name TEXT, updated_by TEXT, updated_by_name TEXT,
        finalized_by TEXT, finalized_by_name TEXT, finalized_at TEXT, revision_no INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_forms_patient ON hospital_form_records (tenant_id, patient_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hosp_forms_episode ON hospital_form_records (tenant_id, episode_id, form_key);
    CREATE INDEX IF NOT EXISTS idx_hosp_forms_register ON hospital_form_records (tenant_id, form_key, status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_forms_unique ON hospital_form_records (tenant_id, unique_key) WHERE unique_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS hospital_form_revisions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, record_id TEXT NOT NULL, revision_no INTEGER NOT NULL,
        action TEXT NOT NULL, status_before TEXT, data_before TEXT, reason TEXT,
        user_id TEXT, user_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_form_revision ON hospital_form_revisions (tenant_id, record_id, revision_no);
    CREATE TABLE IF NOT EXISTS hospital_checklist_entries (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_id TEXT NOT NULL, checklist_key TEXT NOT NULL, item_key TEXT NOT NULL,
        kind TEXT NOT NULL, status TEXT NOT NULL, reason TEXT,
        patient_id TEXT, episode_id TEXT, record_id TEXT, department TEXT,
        user_id TEXT, user_name TEXT, user_role TEXT, recorded_at TEXT NOT NULL,
        superseded_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_checklist_episode ON hospital_checklist_entries (tenant_id, episode_id, checklist_key);
    CREATE INDEX IF NOT EXISTS idx_hosp_checklist_kind ON hospital_checklist_entries (tenant_id, kind, item_key, recorded_at);
    CREATE TABLE IF NOT EXISTS hospital_vitals (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL, episode_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL, bp_systolic INTEGER, bp_diastolic INTEGER, pulse INTEGER, resp_rate INTEGER,
        temperature_c REAL, spo2 INTEGER, pain_score INTEGER, consciousness TEXT, blood_sugar REAL, weight_kg REAL, notes TEXT,
        recorded_by TEXT, recorded_by_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_vitals_episode ON hospital_vitals (tenant_id, episode_id, recorded_at)
    
;
-- schema_sql_v49

    ALTER TABLE hospital_rx_items ADD COLUMN order_type TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN ordered_by TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN ordered_by_name TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN ordered_at TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN order_status TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN stopped_at TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN stopped_by_name TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN stop_reason TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN high_risk INTEGER;
    ALTER TABLE hospital_rx_items ADD COLUMN order_source TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN received_by_name TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN countersigned_by_name TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN countersigned_at TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN verified_by_name TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN verified_at TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN own_supply INTEGER;
    CREATE INDEX IF NOT EXISTS idx_hosp_rx_inpatient ON hospital_rx_items (tenant_id, episode_id, order_status) WHERE order_type = 'inpatient';
    CREATE TABLE IF NOT EXISTS hospital_mar_entries (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL, episode_id TEXT NOT NULL, order_id TEXT NOT NULL,
        status TEXT NOT NULL, given_at TEXT NOT NULL, dose_given TEXT, route_given TEXT,
        identifier_1 TEXT, identifier_2 TEXT, checked_medicine INTEGER NOT NULL DEFAULT 0, checked_dose INTEGER NOT NULL DEFAULT 0,
        checked_route INTEGER NOT NULL DEFAULT 0, checked_time INTEGER NOT NULL DEFAULT 0,
        second_checker_id TEXT, second_checker_name TEXT, reason TEXT, notes TEXT,
        given_by TEXT, given_by_name TEXT, voided_at TEXT, voided_by_name TEXT, void_reason TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hosp_mar_episode ON hospital_mar_entries (tenant_id, episode_id, given_at);
    CREATE INDEX IF NOT EXISTS idx_hosp_mar_order ON hospital_mar_entries (tenant_id, order_id, given_at)
    
;
-- schema_sql_v50

    ALTER TABLE hospital_form_records ADD COLUMN subject_id TEXT;
    ALTER TABLE hospital_checklist_entries ADD COLUMN subject_id TEXT;
    ALTER TABLE hospital_vitals ADD COLUMN phase TEXT;
    ALTER TABLE hospital_vitals ADD COLUMN subject_id TEXT;
    ALTER TABLE hospital_vitals ADD COLUMN rhythm TEXT;
    ALTER TABLE hospital_vitals ADD COLUMN airway TEXT;
    CREATE INDEX IF NOT EXISTS idx_hosp_forms_subject ON hospital_form_records (tenant_id, subject_id) WHERE subject_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_hosp_checklist_subject ON hospital_checklist_entries (tenant_id, subject_id) WHERE subject_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_hosp_vitals_subject ON hospital_vitals (tenant_id, subject_id, recorded_at) WHERE subject_id IS NOT NULL
    
;
-- schema_sql_v51

    CREATE TABLE IF NOT EXISTS server_audit_log (
        id TEXT PRIMARY KEY, user_id TEXT, tenant_id TEXT, role TEXT, verb TEXT NOT NULL, tables TEXT,
        statement TEXT, ip TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_server_audit_tenant ON server_audit_log (tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_server_audit_user ON server_audit_log (user_id, created_at)
    
;
-- schema_sql_v52

    CREATE TABLE IF NOT EXISTS hospital_hh_sessions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, department TEXT, area TEXT NOT NULL, session_date TEXT NOT NULL,
        observer_id TEXT, observer_name TEXT, observer_role TEXT, status TEXT NOT NULL DEFAULT 'open', notes TEXT, closed_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hh_sessions ON hospital_hh_sessions (tenant_id, session_date);
    CREATE TABLE IF NOT EXISTS hospital_hh_observations (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_id TEXT NOT NULL, profession TEXT NOT NULL, moment INTEGER NOT NULL,
        action TEXT NOT NULL, gloves_misuse INTEGER NOT NULL DEFAULT 0, observed_at TEXT NOT NULL, recorded_by_name TEXT,
        voided_at TEXT, void_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hh_obs_session ON hospital_hh_observations (tenant_id, session_id);
    CREATE TABLE IF NOT EXISTS hospital_steril_equipment (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, location TEXT,
        is_active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_steril_equipment_code ON hospital_steril_equipment (tenant_id, code);
    CREATE TABLE IF NOT EXISTS hospital_steril_cycles (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, equipment_id TEXT NOT NULL, cycle_no TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
        operator_id TEXT, operator_name TEXT, program TEXT, temperature_c REAL, pressure_kpa REAL, exposure_min REAL,
        load_description TEXT, implant_load INTEGER NOT NULL DEFAULT 0,
        physical_result TEXT, chemical_result TEXT, biological_result TEXT,
        status TEXT NOT NULL DEFAULT 'awaiting_release', sterilized_on TEXT, expires_on TEXT,
        released_by_id TEXT, released_by_name TEXT, released_at TEXT,
        failure_reason TEXT, corrective_action TEXT, failed_by_name TEXT, failed_at TEXT,
        recall_reason TEXT, recalled_by_name TEXT, recalled_at TEXT, reprocessed_in_cycle_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_steril_cycle_no ON hospital_steril_cycles (tenant_id, equipment_id, cycle_no);
    CREATE INDEX IF NOT EXISTS idx_steril_cycles_status ON hospital_steril_cycles (tenant_id, status, started_at);
    CREATE TABLE IF NOT EXISTS hospital_steril_items (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, cycle_id TEXT NOT NULL, set_code TEXT, set_name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_steril_items_cycle ON hospital_steril_items (tenant_id, cycle_id);
    CREATE TABLE IF NOT EXISTS hospital_steril_usage (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, cycle_id TEXT NOT NULL, booking_id TEXT NOT NULL,
        patient_id TEXT NOT NULL, episode_id TEXT NOT NULL, used_at TEXT NOT NULL, recorded_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_steril_usage ON hospital_steril_usage (tenant_id, item_id, booking_id);
    CREATE INDEX IF NOT EXISTS idx_steril_usage_cycle ON hospital_steril_usage (tenant_id, cycle_id)
    
;
-- schema_sql_v53

    CREATE TABLE IF NOT EXISTS hospital_bb_donors (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, donor_no TEXT NOT NULL, name TEXT NOT NULL, cnic TEXT, phone TEXT, gender TEXT,
        dob TEXT, abo TEXT, rh TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_bb_donor_no ON hospital_bb_donors (tenant_id, donor_no);
    CREATE TABLE IF NOT EXISTS hospital_bb_donations (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, donor_id TEXT NOT NULL, donated_at TEXT NOT NULL, donation_type TEXT NOT NULL,
        hb REAL, weight_kg REAL, bp TEXT, pulse INTEGER, temperature_c REAL, questionnaire_ok INTEGER NOT NULL DEFAULT 0,
        eligible INTEGER NOT NULL DEFAULT 0, deferral_reason TEXT, consent_signed INTEGER NOT NULL DEFAULT 0, for_patient_id TEXT,
        screened_by_name TEXT, unit_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bb_donations_donor ON hospital_bb_donations (tenant_id, donor_id);
    CREATE TABLE IF NOT EXISTS hospital_bb_units (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, unit_no TEXT NOT NULL, source TEXT NOT NULL, donation_id TEXT,
        supplier_name TEXT, supplier_unit_no TEXT, supplier_licence TEXT, component TEXT NOT NULL, abo TEXT, rh TEXT, volume_ml INTEGER,
        collected_on TEXT NOT NULL, expires_on TEXT NOT NULL, tti_hbv TEXT, tti_hcv TEXT, tti_hiv TEXT, tti_syphilis TEXT, tti_malaria TEXT,
        screened_by_name TEXT, storage TEXT, status TEXT NOT NULL DEFAULT 'quarantine', released_by_name TEXT, released_at TEXT,
        discard_reason TEXT, discarded_at TEXT, discarded_by_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_bb_unit_no ON hospital_bb_units (tenant_id, unit_no);
    CREATE INDEX IF NOT EXISTS idx_bb_units_status ON hospital_bb_units (tenant_id, status, component, expires_on);
    CREATE TABLE IF NOT EXISTS hospital_bb_requests (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL, episode_id TEXT NOT NULL, component TEXT NOT NULL,
        units_requested INTEGER NOT NULL, urgency TEXT NOT NULL, indication TEXT NOT NULL, patient_abo TEXT, patient_rh TEXT,
        requested_by TEXT, requested_by_name TEXT, requested_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', closed_at TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bb_requests ON hospital_bb_requests (tenant_id, status, requested_at);
    CREATE INDEX IF NOT EXISTS idx_bb_requests_episode ON hospital_bb_requests (tenant_id, episode_id);
    CREATE TABLE IF NOT EXISTS hospital_bb_crossmatches (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, unit_id TEXT NOT NULL, result TEXT NOT NULL, method TEXT,
        tested_by_name TEXT, tested_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bb_xm_request ON hospital_bb_crossmatches (tenant_id, request_id);
    CREATE TABLE IF NOT EXISTS hospital_bb_issues (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, unit_id TEXT NOT NULL, patient_id TEXT NOT NULL, episode_id TEXT NOT NULL,
        emergency_release INTEGER NOT NULL DEFAULT 0, authorized_by TEXT, issued_at TEXT NOT NULL, issued_by_name TEXT, received_by TEXT,
        started_at TEXT, check_by_1 TEXT, check_by_2 TEXT, vitals_pre TEXT, vitals_15min TEXT, vitals_end TEXT, ended_at TEXT,
        volume_ml INTEGER, outcome TEXT, returned_at TEXT, return_reason TEXT, recorded_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_bb_issue_unit ON hospital_bb_issues (tenant_id, unit_id) WHERE returned_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_bb_issues_episode ON hospital_bb_issues (tenant_id, episode_id);
    CREATE TABLE IF NOT EXISTS hospital_bb_reactions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, issue_id TEXT NOT NULL, patient_id TEXT NOT NULL, episode_id TEXT NOT NULL,
        onset_at TEXT NOT NULL, reaction_type TEXT NOT NULL, severity TEXT NOT NULL, symptoms TEXT NOT NULL, actions TEXT NOT NULL,
        investigation TEXT, analysis TEXT, outcome TEXT, reported_to_authority INTEGER NOT NULL DEFAULT 0, authority_reported_at TEXT,
        authority_ref TEXT, recorded_by_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bb_reactions ON hospital_bb_reactions (tenant_id, onset_at)
    
;
-- schema_sql_v54

    CREATE TABLE IF NOT EXISTS hospital_er_triage (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, episode_id TEXT NOT NULL, patient_id TEXT NOT NULL, triaged_at TEXT NOT NULL,
        triaged_by_name TEXT, chief_complaint TEXT NOT NULL, pulse INTEGER, sbp INTEGER, dbp INTEGER, rr INTEGER, spo2 INTEGER,
        temp_c REAL, gcs INTEGER, pain INTEGER, suggested_level INTEGER NOT NULL, level INTEGER NOT NULL, override_reason TEXT,
        seen_at TEXT, seen_by_name TEXT, disposition TEXT, disposition_at TEXT, disposition_by_name TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_er_triage_episode ON hospital_er_triage (tenant_id, episode_id, triaged_at);
    CREATE INDEX IF NOT EXISTS idx_er_triage_at ON hospital_er_triage (tenant_id, triaged_at);
    CREATE TABLE IF NOT EXISTS hospital_mlc_cases (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, mlc_no TEXT NOT NULL, episode_id TEXT NOT NULL, patient_id TEXT NOT NULL,
        arrived_at TEXT NOT NULL, brought_by TEXT, nature TEXT NOT NULL, history TEXT, registered_by_name TEXT,
        police_station TEXT, police_informed_at TEXT, police_informed_by_name TEXT, police_officer TEXT, police_ref TEXT,
        examined_at TEXT, examined_by_name TEXT, injuries TEXT, opinion TEXT, samples TEXT, samples_handed_to TEXT,
        status TEXT NOT NULL DEFAULT 'open', report_issued_at TEXT, report_issued_to TEXT, report_issued_by_name TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_mlc_no ON hospital_mlc_cases (tenant_id, mlc_no);
    CREATE INDEX IF NOT EXISTS idx_mlc_episode ON hospital_mlc_cases (tenant_id, episode_id);
    CREATE TABLE IF NOT EXISTS hospital_critical_alerts (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, source TEXT NOT NULL, order_id TEXT, patient_id TEXT NOT NULL, episode_id TEXT,
        test_name TEXT NOT NULL, value TEXT NOT NULL, detected_at TEXT NOT NULL, detected_by_name TEXT, status TEXT NOT NULL DEFAULT 'pending',
        notified_to TEXT, notified_at TEXT, notified_by_name TEXT, method TEXT, read_back INTEGER NOT NULL DEFAULT 0, action_taken TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_critical_status ON hospital_critical_alerts (tenant_id, status, detected_at);
    CREATE INDEX IF NOT EXISTS idx_critical_order ON hospital_critical_alerts (tenant_id, source, order_id);
    CREATE INDEX IF NOT EXISTS idx_critical_episode ON hospital_critical_alerts (tenant_id, episode_id);
    CREATE TABLE IF NOT EXISTS hospital_complaints (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, complaint_no TEXT NOT NULL, received_at TEXT NOT NULL, channel TEXT NOT NULL,
        complainant_name TEXT NOT NULL, complainant_phone TEXT, relation TEXT, patient_id TEXT, episode_id TEXT, department TEXT,
        category TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL, received_by_name TEXT, assigned_to TEXT,
        acknowledged_at TEXT, acknowledged_by_name TEXT, investigation TEXT, resolution TEXT, resolved_at TEXT, resolved_by_name TEXT,
        complainant_informed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', closed_at TEXT, closed_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_complaint_no ON hospital_complaints (tenant_id, complaint_no);
    CREATE INDEX IF NOT EXISTS idx_complaints_status ON hospital_complaints (tenant_id, status, received_at);
    CREATE TABLE IF NOT EXISTS hospital_incidents (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, incident_no TEXT NOT NULL, occurred_at TEXT NOT NULL, reported_at TEXT NOT NULL,
        reporter_name TEXT, location TEXT NOT NULL, department TEXT, patient_id TEXT, episode_id TEXT, incident_type TEXT NOT NULL,
        outcome_class TEXT NOT NULL, harm TEXT NOT NULL, description TEXT NOT NULL, immediate_action TEXT,
        status TEXT NOT NULL DEFAULT 'reported', reviewed_by_name TEXT, reviewed_at TEXT, review_notes TEXT,
        rca_due_on TEXT, rca_team TEXT, root_causes TEXT, rca_summary TEXT, rca_completed_at TEXT, closed_by_name TEXT, closed_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_incident_no ON hospital_incidents (tenant_id, incident_no);
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON hospital_incidents (tenant_id, status, occurred_at);
    CREATE TABLE IF NOT EXISTS hospital_capa (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, capa_no TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT, problem TEXT NOT NULL,
        action_type TEXT NOT NULL, action TEXT NOT NULL, owner_name TEXT NOT NULL, due_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        raised_by_name TEXT, done_at TEXT, done_by_name TEXT, done_note TEXT, verified_at TEXT, verified_by_name TEXT, effectiveness TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_capa_no ON hospital_capa (tenant_id, capa_no);
    CREATE INDEX IF NOT EXISTS idx_capa_status ON hospital_capa (tenant_id, status, due_on);
    CREATE INDEX IF NOT EXISTS idx_capa_source ON hospital_capa (tenant_id, source, source_id);
    
;
-- schema_sql_v55

    CREATE TABLE IF NOT EXISTS hospital_equipment (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, asset_no TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, make TEXT, model TEXT,
        serial_no TEXT, department TEXT, location TEXT, supplier TEXT, purchased_on TEXT, cost REAL, warranty_until TEXT, amc_vendor TEXT,
        amc_until TEXT, is_critical INTEGER NOT NULL DEFAULT 0, ppm_interval_days INTEGER, calibration_interval_days INTEGER,
        status TEXT NOT NULL DEFAULT 'in_service', condemned_on TEXT, condemned_reason TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_equipment_asset ON hospital_equipment (tenant_id, asset_no);
    CREATE INDEX IF NOT EXISTS idx_equipment_status ON hospital_equipment (tenant_id, status, department);
    CREATE TABLE IF NOT EXISTS hospital_equipment_logs (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, equipment_id TEXT NOT NULL, kind TEXT NOT NULL, performed_on TEXT NOT NULL,
        performed_by TEXT, result TEXT, certificate_ref TEXT, description TEXT, restored_on TEXT, recorded_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_equipment_logs ON hospital_equipment_logs (tenant_id, equipment_id, kind, performed_on);
    CREATE TABLE IF NOT EXISTS hospital_licences (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL, number TEXT, issued_by TEXT, issued_on TEXT, expires_on TEXT,
        responsible TEXT, document_ref TEXT, notes TEXT, superseded_by TEXT, recorded_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_licences ON hospital_licences (tenant_id, kind, expires_on);
    CREATE TABLE IF NOT EXISTS hospital_drills (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL, held_on TEXT NOT NULL, shift TEXT, location TEXT NOT NULL,
        scenario TEXT, participants INTEGER, response_min INTEGER, observations TEXT, gaps TEXT, conducted_by TEXT, recorded_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_drills ON hospital_drills (tenant_id, kind, held_on);
    CREATE TABLE IF NOT EXISTS hospital_staff_training (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT, held_on TEXT NOT NULL,
        valid_until TEXT, hours REAL, provider TEXT, certificate_ref TEXT, recorded_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_staff_training ON hospital_staff_training (tenant_id, staff_id, kind);
    CREATE TABLE IF NOT EXISTS hospital_staff_credentials (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, kind TEXT NOT NULL, number TEXT, issued_by TEXT,
        valid_until TEXT, verified_on TEXT, verified_by_name TEXT, verification_method TEXT, document_ref TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_staff_credentials ON hospital_staff_credentials (tenant_id, staff_id);
    CREATE TABLE IF NOT EXISTS hospital_appraisals (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, period_from TEXT NOT NULL, period_to TEXT NOT NULL,
        appraiser_name TEXT, ratings TEXT, overall REAL, strengths TEXT, improvements TEXT, goals TEXT, status TEXT NOT NULL DEFAULT 'draft',
        finalized_at TEXT, staff_comments TEXT, acknowledged_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_appraisals ON hospital_appraisals (tenant_id, staff_id, period_to);
    CREATE TABLE IF NOT EXISTS hospital_duty_roster (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, duty_date TEXT NOT NULL, shift TEXT NOT NULL, department TEXT,
        notes TEXT, created_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_duty_roster ON hospital_duty_roster (tenant_id, duty_date, department);
    CREATE INDEX IF NOT EXISTS idx_duty_roster_staff ON hospital_duty_roster (tenant_id, staff_id, duty_date);
    CREATE TABLE IF NOT EXISTS hospital_documents (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc_no TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, department TEXT,
        standard_key TEXT, designation_key TEXT, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft', body TEXT, file_ref TEXT,
        change_note TEXT, author_name TEXT, approved_by_name TEXT, approved_at TEXT, effective_on TEXT, review_due_on TEXT, supersedes_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_documents_no ON hospital_documents (tenant_id, doc_no, version);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON hospital_documents (tenant_id, status, review_due_on);
    
;
-- schema_sql_v56

    ALTER TABLE hospital_rx_items ADD COLUMN abx_class TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN abx_indication TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN abx_culture_sent INTEGER;
    ALTER TABLE hospital_rx_items ADD COLUMN abx_approved_by_name TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN abx_approved_at TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN abx_reviewed_by_name TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN abx_reviewed_at TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN abx_review_outcome TEXT;
    ALTER TABLE hospital_rx_items ADD COLUMN non_formulary_reason TEXT;
    CREATE TABLE IF NOT EXISTS hospital_formulary (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, generic_name TEXT NOT NULL, strength_form TEXT, category TEXT, restricted INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active', approval_ref TEXT, notes TEXT, added_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_formulary ON hospital_formulary (tenant_id, status, generic_name);
    CREATE TABLE IF NOT EXISTS hospital_adr_reports (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, report_no TEXT NOT NULL, patient_id TEXT NOT NULL, episode_id TEXT, suspected_drug TEXT NOT NULL,
        other_drugs TEXT, started_on TEXT, onset_at TEXT NOT NULL, reaction TEXT NOT NULL, serious INTEGER NOT NULL DEFAULT 0, seriousness TEXT,
        action_taken TEXT, outcome TEXT, dechallenge TEXT, rechallenge TEXT, reporter_name TEXT, causality TEXT, assessment TEXT,
        assessed_by_name TEXT, assessed_at TEXT, drap_reported_on TEXT, drap_ref TEXT, status TEXT NOT NULL DEFAULT 'reported',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_adr_no ON hospital_adr_reports (tenant_id, report_no);
    CREATE INDEX IF NOT EXISTS idx_adr_status ON hospital_adr_reports (tenant_id, status, onset_at);
    CREATE TABLE IF NOT EXISTS hospital_cd_register (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, location TEXT NOT NULL, drug TEXT NOT NULL, entry_type TEXT NOT NULL, qty REAL NOT NULL,
        balance_after REAL NOT NULL, counted_qty REAL, patient_id TEXT, episode_id TEXT, order_id TEXT, entry_at TEXT NOT NULL, by_name TEXT,
        witness_staff_id TEXT, witness_name TEXT, reference TEXT, note TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cd_register ON hospital_cd_register (tenant_id, location, drug, entry_at);
    CREATE TABLE IF NOT EXISTS hospital_fridge_logs (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, fridge TEXT NOT NULL, reading_at TEXT NOT NULL, temp_c REAL NOT NULL, min_c REAL, max_c REAL,
        in_range INTEGER NOT NULL, action_taken TEXT, by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fridge_logs ON hospital_fridge_logs (tenant_id, fridge, reading_at);
    
;
-- schema_sql_v57

    CREATE TABLE IF NOT EXISTS hospital_record_releases (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, release_no TEXT NOT NULL, patient_id TEXT NOT NULL, episode_id TEXT,
        requested_at TEXT NOT NULL, requester_name TEXT NOT NULL, requester_type TEXT NOT NULL, relation TEXT, requester_id_no TEXT,
        purpose TEXT NOT NULL, records_requested TEXT NOT NULL, authority TEXT NOT NULL, authority_ref TEXT, received_by_name TEXT,
        status TEXT NOT NULL DEFAULT 'requested', decided_by_name TEXT, decided_at TEXT, decision_note TEXT,
        released_at TEXT, released_by_name TEXT, records_released TEXT, copies INTEGER, id_checked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_release_no ON hospital_record_releases (tenant_id, release_no);
    CREATE INDEX IF NOT EXISTS idx_releases ON hospital_record_releases (tenant_id, status, requested_at);
    CREATE INDEX IF NOT EXISTS idx_releases_patient ON hospital_record_releases (tenant_id, patient_id);
    
;
-- schema_sql_v58

    ALTER TABLE hospital_payments ADD COLUMN received_by TEXT;
    ALTER TABLE hospital_payments ADD COLUMN received_by_name TEXT;
    ALTER TABLE hospital_payments ADD COLUMN closing_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hosp_payment_receiver ON hospital_payments (tenant_id, received_by, closing_id);
    CREATE TABLE IF NOT EXISTS hospital_cash_closings (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, closing_no TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
        desk TEXT, from_at TEXT, to_at TEXT NOT NULL, payments_count INTEGER NOT NULL DEFAULT 0,
        cash REAL NOT NULL DEFAULT 0, card REAL NOT NULL DEFAULT 0, online REAL NOT NULL DEFAULT 0, bank REAL NOT NULL DEFAULT 0,
        refunds REAL NOT NULL DEFAULT 0, net_total REAL NOT NULL DEFAULT 0, counted_cash REAL NOT NULL DEFAULT 0, difference REAL NOT NULL DEFAULT 0,
        handed_to TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'submitted', verified_by_name TEXT, verified_at TEXT, verify_note TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_closing_no ON hospital_cash_closings (tenant_id, closing_no);
    CREATE INDEX IF NOT EXISTS idx_cash_closings ON hospital_cash_closings (tenant_id, user_id, to_at);
    CREATE INDEX IF NOT EXISTS idx_cash_closings_status ON hospital_cash_closings (tenant_id, status, to_at);
    
;
-- schema_sql_v59

    ALTER TABLE hospital_imaging_orders ADD COLUMN modality_code TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN clinical_history TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN machine_id TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN exam_started_at TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN exam_started_by_name TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN performed_at TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN performed_by_name TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN exam_data TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN acquisition_status TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN study_uid TEXT;
    ALTER TABLE hospital_imaging_orders ADD COLUMN series_count INTEGER;
    ALTER TABLE hospital_imaging_orders ADD COLUMN images_count INTEGER;
    ALTER TABLE hospital_imaging_orders ADD COLUMN images_received_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_hosp_img_machine ON hospital_imaging_orders (tenant_id, machine_id, status);
    CREATE INDEX IF NOT EXISTS idx_hosp_img_order_no ON hospital_imaging_orders (tenant_id, order_no);
    CREATE TABLE IF NOT EXISTS radiology_modalities (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, dicom_code TEXT, universal_name TEXT,
        outsourced INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_radiology_modalities ON radiology_modalities (tenant_id, code);
    CREATE TABLE IF NOT EXISTS radiology_machines (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, machine_code TEXT NOT NULL, name TEXT NOT NULL, modality_code TEXT NOT NULL,
        manufacturer TEXT, model TEXT, serial_no TEXT, location TEXT, status TEXT NOT NULL DEFAULT 'active', ae_title TEXT,
        assigned_user_id TEXT, assigned_user_name TEXT, api_key_hash TEXT, api_key_hint TEXT, last_seen_at TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_radiology_machines ON radiology_machines (tenant_id, modality_code);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_radiology_machine_key ON radiology_machines (api_key_hash);
    CREATE TABLE IF NOT EXISTS radiology_templates (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, modality_code TEXT, service_id TEXT,
        findings TEXT, impression TEXT, is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_radiology_templates ON radiology_templates (tenant_id, modality_code);
    CREATE TABLE IF NOT EXISTS radiology_pacs (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, orthanc_url TEXT, viewer_url TEXT, ae_title TEXT,
        dicom_host TEXT, dicom_port INTEGER, is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_radiology_pacs ON radiology_pacs (tenant_id);
    CREATE TABLE IF NOT EXISTS radiology_dicom_events (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, machine_id TEXT, order_id TEXT, kind TEXT NOT NULL, detail TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_radiology_dicom_events ON radiology_dicom_events (tenant_id, machine_id, created_at);
    
;
-- schema_sql_v60

    CREATE TABLE IF NOT EXISTS product_batch_expiry_changes (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, batch_id TEXT NOT NULL, product_id TEXT,
        old_expiry TEXT, new_expiry TEXT NOT NULL, reason TEXT NOT NULL, changed_by TEXT, changed_by_name TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_batch_expiry_changes ON product_batch_expiry_changes (tenant_id, batch_id);
    
;
-- schema_sql_v61

    ALTER TABLE purchase_items ADD COLUMN bonus_qty REAL DEFAULT 0;
    
;
-- schema_sql_v62

    ALTER TABLE salesmen ADD COLUMN user_id TEXT;
    ALTER TABLE salesmen ADD COLUMN monthly_target REAL DEFAULT 0;
    
;
-- schema_sql_v63

    CREATE TABLE IF NOT EXISTS clinic_services (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT, name TEXT NOT NULL, category TEXT NOT NULL,
        rate REAL NOT NULL DEFAULT 0, billing_unit TEXT, sample_type TEXT, unit TEXT, ref_range TEXT, section TEXT, modality TEXT,
        is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clinic_services ON clinic_services (tenant_id, category, name);
    CREATE TABLE IF NOT EXISTS clinic_orders (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_no TEXT NOT NULL, patient_id TEXT NOT NULL, consultation_id TEXT,
        doctor_id TEXT, service_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, qty REAL NOT NULL DEFAULT 1, rate REAL NOT NULL DEFAULT 0,
        amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ordered', priority TEXT NOT NULL DEFAULT 'routine',
        result_value TEXT, unit TEXT, ref_range TEXT, flag TEXT, findings TEXT, impression TEXT,
        reported_by TEXT, reported_at TEXT, ordered_by TEXT, ordered_at TEXT NOT NULL, notes TEXT, invoice_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clinic_orders_consult ON clinic_orders (tenant_id, consultation_id);
    CREATE INDEX IF NOT EXISTS idx_clinic_orders_work ON clinic_orders (tenant_id, kind, status, ordered_at);
    CREATE INDEX IF NOT EXISTS idx_clinic_orders_invoice ON clinic_orders (tenant_id, invoice_id);
    
;
-- schema_sql_v64

    ALTER TABLE clinic_orders ADD COLUMN components TEXT;
    
;
-- schema_sql_v65

    ALTER TABLE clinic_consultations ADD COLUMN admit_advised INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clinic_consultations ADD COLUMN admit_reason TEXT;
    ALTER TABLE clinic_consultations ADD COLUMN admit_ward TEXT;
    ALTER TABLE clinic_consultations ADD COLUMN admit_days INTEGER;
    ALTER TABLE clinic_consultations ADD COLUMN admit_urgency TEXT;
    ALTER TABLE clinic_consultations ADD COLUMN admit_advised_at TEXT;
    
;
-- schema_sql_v66

    CREATE TABLE IF NOT EXISTS business_link_tokens (
        id                 TEXT PRIMARY KEY,
        tenant_id          TEXT NOT NULL,
        token_hash         TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'pending',
        expires_at         TEXT NOT NULL,
        pharmacy_tenant_id TEXT,
        verified_at        TEXT,
        created_by         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        deleted_at         TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_business_link_token ON business_link_tokens (token_hash);
    CREATE INDEX IF NOT EXISTS ix_business_link_tokens_tenant ON business_link_tokens (tenant_id, status);
    ALTER TABLE clinic_pharmacy_link ADD COLUMN verified_at TEXT;
    ALTER TABLE clinic_pharmacy_link ADD COLUMN verified_by TEXT;
    ALTER TABLE clinic_pharmacy_link ADD COLUMN clinic_name TEXT;
    
;
-- schema_sql_v67

    ALTER TABLE products ADD COLUMN track_imei INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN attr_type TEXT;
    ALTER TABLE products ADD COLUMN attr_color TEXT;
    ALTER TABLE products ADD COLUMN attr_size TEXT;
    CREATE TABLE IF NOT EXISTS mobile_imei_units (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, product_id TEXT NOT NULL, imei TEXT NOT NULL, imei2 TEXT,
        status TEXT NOT NULL DEFAULT 'in_stock', purchase_id TEXT, purchase_price REAL NOT NULL DEFAULT 0,
        invoice_id TEXT, sold_at TEXT, customer_name TEXT, customer_mobile TEXT, customer_cnic TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_mobile_imei ON mobile_imei_units (tenant_id, imei);
    CREATE INDEX IF NOT EXISTS ix_mobile_imei_product ON mobile_imei_units (tenant_id, product_id, status);
    CREATE INDEX IF NOT EXISTS ix_mobile_imei_invoice ON mobile_imei_units (tenant_id, invoice_id);
    CREATE TABLE IF NOT EXISTS cloth_measurements (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_name TEXT NOT NULL, mobile TEXT, garment TEXT NOT NULL,
        measurements TEXT NOT NULL DEFAULT '{}', notes TEXT, last_used_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_cloth_measurements_mobile ON cloth_measurements (tenant_id, mobile);
    CREATE INDEX IF NOT EXISTS ix_cloth_measurements_name ON cloth_measurements (tenant_id, customer_name);
    ALTER TABLE invoices ADD COLUMN measurement_id TEXT;
    CREATE TABLE IF NOT EXISTS lab_visits (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, visit_no TEXT NOT NULL, patient_id TEXT NOT NULL, referred_by TEXT,
        priority TEXT NOT NULL DEFAULT 'routine', status TEXT NOT NULL DEFAULT 'registered', notes TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_lab_visits ON lab_visits (tenant_id, created_at);
    ALTER TABLE clinic_orders ADD COLUMN lab_visit_id TEXT;
    ALTER TABLE clinic_orders ADD COLUMN collected_by TEXT;
    ALTER TABLE clinic_orders ADD COLUMN collected_at TEXT;
    ALTER TABLE clinic_orders ADD COLUMN verified_by TEXT;
    ALTER TABLE clinic_orders ADD COLUMN verified_at TEXT;
    ALTER TABLE clinic_orders ADD COLUMN pathologist_note TEXT;
    CREATE INDEX IF NOT EXISTS ix_clinic_orders_lab_visit ON clinic_orders (tenant_id, lab_visit_id);
    CREATE TABLE IF NOT EXISTS banquet_halls (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER, rent REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS banquet_dishes (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, price_per_head REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS banquet_packages (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, price_per_head REAL NOT NULL DEFAULT 0,
        dish_ids TEXT NOT NULL DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 1, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS banquet_bookings (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, booking_no TEXT NOT NULL, customer_name TEXT NOT NULL, mobile TEXT NOT NULL,
        cnic TEXT, address TEXT, event_type TEXT NOT NULL, event_date TEXT NOT NULL, slot TEXT NOT NULL, start_time TEXT, end_time TEXT,
        hall_id TEXT, guests INTEGER NOT NULL DEFAULT 0, package_id TEXT, per_head_rate REAL NOT NULL DEFAULT 0,
        hall_rent REAL NOT NULL DEFAULT 0, extras_amount REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT,
        invoice_id TEXT, created_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_banquet_bookings_date ON banquet_bookings (tenant_id, event_date, slot);
    CREATE TABLE IF NOT EXISTS banquet_booking_items (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, booking_id TEXT NOT NULL, kind TEXT NOT NULL, dish_id TEXT, name TEXT NOT NULL,
        qty REAL NOT NULL DEFAULT 1, rate REAL NOT NULL DEFAULT 0, amount REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_banquet_booking_items ON banquet_booking_items (tenant_id, booking_id);
    CREATE TABLE IF NOT EXISTS banquet_payments (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, booking_id TEXT NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL,
        method TEXT NOT NULL DEFAULT 'cash', note TEXT, received_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_banquet_payments ON banquet_payments (tenant_id, booking_id)
    
;
-- schema_sql_v68

    ALTER TABLE products ADD COLUMN fbr_article_name TEXT;
    
;
-- schema_sql_v69

    ALTER TABLE tenants ADD COLUMN medicine_invoice_allowed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE invoice_items ADD COLUMN line_batch TEXT;
    
;
-- schema_sql_v70

    ALTER TABLE users ADD COLUMN platform_role TEXT;
    CREATE TABLE IF NOT EXISTS sub_supers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
        name TEXT NOT NULL,
        business_name TEXT,
        phone TEXT,
        email TEXT,
        city TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
        status_reason TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sub_super_apps (
        id TEXT PRIMARY KEY,
        sub_super_id TEXT NOT NULL REFERENCES sub_supers(id),
        app_id TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL,
        revoked_by TEXT,
        revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sub_super_apps_super ON sub_super_apps(sub_super_id, app_id);
    CREATE TABLE IF NOT EXISTS onboarding_requests (
        id TEXT PRIMARY KEY,
        sub_super_id TEXT NOT NULL REFERENCES sub_supers(id),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','returned','rejected','activated')),
        app_id TEXT,
        plan_id TEXT,
        business_name TEXT,
        owner_name TEXT,
        phone TEXT,
        email TEXT,
        city TEXT,
        address TEXT,
        ntn TEXT,
        proposed_username TEXT,
        notes TEXT,
        expected_amount REAL,
        claimed_amount REAL,
        payment_reference TEXT,
        payment_date TEXT,
        payment_status TEXT NOT NULL DEFAULT 'unverified' CHECK (payment_status IN ('unverified','verified')),
        verified_amount REAL,
        payment_verified_by TEXT,
        payment_verified_at TEXT,
        needs_owner_review INTEGER NOT NULL DEFAULT 0,
        owner_review_reason TEXT,
        return_reason TEXT,
        reject_reason TEXT,
        submitted_at TEXT,
        review_started_by TEXT,
        review_started_at TEXT,
        returned_by TEXT,
        returned_at TEXT,
        rejected_by TEXT,
        rejected_at TEXT,
        activation_key TEXT,
        activated_by TEXT,
        activated_at TEXT,
        tenant_id TEXT,
        owner_user_id TEXT,
        sale_amount REAL,
        invite_status TEXT,
        invite_issued_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_super ON onboarding_requests(sub_super_id, status);
    CREATE INDEX IF NOT EXISTS idx_onboarding_activated ON onboarding_requests(activated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_tenant ON onboarding_requests(tenant_id) WHERE tenant_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS onboarding_events (
        id TEXT PRIMARY KEY,
        request_id TEXT,
        sub_super_id TEXT,
        actor_user_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_events_request ON onboarding_events(request_id, created_at);
    CREATE TABLE IF NOT EXISTS password_setup_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
    );
    
;
-- schema_sql_v71

    CREATE TABLE IF NOT EXISTS site_queries (
        id TEXT PRIMARY KEY,
        submission_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('contact','demo')),
        name TEXT NOT NULL,
        business_name TEXT,
        business_type TEXT,
        branches TEXT,
        phone TEXT,
        email TEXT,
        message TEXT,
        topic TEXT,
        status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read')),
        read_at TEXT,
        read_by TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_site_queries_status ON site_queries(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_site_queries_created ON site_queries(created_at);
    
;
-- schema_sql_v72

    ALTER TABLE lab_visits ADD COLUMN public_token TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_visits_public_token ON lab_visits(public_token) WHERE public_token IS NOT NULL;
    
;
-- schema_sql_v73

    CREATE TABLE IF NOT EXISTS seo_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_by TEXT,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_jobs (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        cadence TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
        lock_until TEXT,
        last_run_at TEXT,
        last_success_at TEXT,
        last_status TEXT,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_job_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('schedule','manual')),
        triggered_by TEXT,
        status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','blocked','skipped')),
        attempts INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        summary TEXT,
        error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_seo_job_runs_job ON seo_job_runs(job_id, started_at);
    CREATE TABLE IF NOT EXISTS seo_activity_log (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        actor TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seo_activity_created ON seo_activity_log(created_at);
    CREATE TABLE IF NOT EXISTS seo_metrics_daily (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        page TEXT,
        query TEXT,
        clicks INTEGER NOT NULL DEFAULT 0,
        impressions INTEGER NOT NULL DEFAULT 0,
        ctr REAL,
        position REAL,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_metrics ON seo_metrics_daily(day, source, COALESCE(page,''), COALESCE(query,''));
    CREATE TABLE IF NOT EXISTS seo_audit_findings (
        id TEXT PRIMARY KEY,
        check_id TEXT NOT NULL,
        url TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
        message TEXT NOT NULL,
        evidence TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_finding ON seo_audit_findings(check_id, url);
    CREATE TABLE IF NOT EXISTS seo_keywords (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL UNIQUE,
        product TEXT,
        intent TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        search_volume INTEGER,
        volume_source TEXT,
        competition TEXT,
        competition_source TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_recommendations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        evidence TEXT,
        url TEXT,
        impact TEXT,
        status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','done')),
        decided_by TEXT,
        decided_at TEXT,
        decision_note TEXT,
        pr_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_content_drafts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('landing','article','meta')),
        title TEXT NOT NULL,
        target_keyword TEXT,
        target_path TEXT,
        body TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','rejected','published')),
        checks TEXT,
        created_by TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        pr_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_reports (
        id TEXT PRIMARY KEY,
        period TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    
;
-- schema_sql_v74

    CREATE TABLE IF NOT EXISTS seo_analytics_daily (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        channel TEXT NOT NULL,
        sessions INTEGER NOT NULL DEFAULT 0,
        engaged_sessions INTEGER NOT NULL DEFAULT 0,
        key_events REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_analytics ON seo_analytics_daily(day, source, channel);
    CREATE INDEX IF NOT EXISTS idx_seo_metrics_source_day ON seo_metrics_daily(source, day);
    
;
-- schema_sql_v75

    ALTER TABLE users ADD COLUMN email TEXT;
    ALTER TABLE users ADD COLUMN mobile TEXT;
    ALTER TABLE users ADD COLUMN password_changed_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
    CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        ip TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_password_resets_ip ON password_resets(ip, created_at);
    
;
-- schema_sql_v76

    CREATE TABLE IF NOT EXISTS web_sites (
        tenant_id TEXT PRIMARY KEY,
        website_enabled INTEGER NOT NULL DEFAULT 0,
        store_enabled INTEGER NOT NULL DEFAULT 0,
        public_suspended INTEGER NOT NULL DEFAULT 0,
        builder_allowed INTEGER NOT NULL DEFAULT 1,
        custom_domain_allowed INTEGER NOT NULL DEFAULT 0,
        template TEXT,
        subdomain TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        published_at TEXT,
        settings TEXT,
        draft_settings TEXT,
        store_settings TEXT,
        max_pages INTEGER,
        max_storage_mb INTEGER,
        max_custom_domains INTEGER,
        storage_bytes INTEGER NOT NULL DEFAULT 0,
        provisioned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_web_sites_subdomain ON web_sites(subdomain) WHERE subdomain IS NOT NULL;
    CREATE TABLE IF NOT EXISTS web_pages (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'page',
        draft TEXT NOT NULL,
        published TEXT,
        seo_title TEXT,
        seo_description TEXT,
        in_nav INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        draft_updated_at TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_web_pages_slug ON web_pages(tenant_id, slug) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS web_revisions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        note TEXT,
        published_by TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_revisions_tenant ON web_revisions(tenant_id, created_at);
    CREATE TABLE IF NOT EXISTS web_products (
        tenant_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        show_online INTEGER NOT NULL DEFAULT 0,
        allow_order INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        description TEXT,
        images TEXT,
        online_price REAL,
        featured INTEGER NOT NULL DEFAULT 0,
        online_category TEXT,
        rx_required INTEGER NOT NULL DEFAULT 0,
        stock_visibility TEXT NOT NULL DEFAULT 'status',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, product_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_web_products_slug ON web_products(tenant_id, slug);
    CREATE TABLE IF NOT EXISTS web_domains (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        host TEXT NOT NULL,
        target TEXT NOT NULL CHECK (target IN ('website','store','portal')),
        is_primary INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending_verification',
        verification TEXT,
        error TEXT,
        last_checked_at TEXT,
        activated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_web_domains_host ON web_domains(host);
    CREATE TABLE IF NOT EXISTS web_orders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        order_no INTEGER NOT NULL,
        public_token TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_method TEXT NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        fulfillment TEXT NOT NULL,
        zone TEXT,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        address TEXT,
        notes TEXT,
        subtotal REAL NOT NULL,
        delivery_charge REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        rx_required INTEGER NOT NULL DEFAULT 0,
        rx_status TEXT,
        reserved_until TEXT,
        invoice_id TEXT,
        ip TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_web_orders_token ON web_orders(public_token);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_web_orders_idem ON web_orders(tenant_id, idempotency_key);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_web_orders_no ON web_orders(tenant_id, order_no);
    CREATE INDEX IF NOT EXISTS idx_web_orders_status ON web_orders(tenant_id, status, created_at);
    CREATE TABLE IF NOT EXISTS web_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        name TEXT NOT NULL,
        qty REAL NOT NULL,
        unit_price REAL NOT NULL,
        line_total REAL NOT NULL,
        rx_required INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_web_order_items_order ON web_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_web_order_items_product ON web_order_items(tenant_id, product_id);
    CREATE TABLE IF NOT EXISTS web_order_events (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_order_events_order ON web_order_events(order_id, created_at);
    CREATE TABLE IF NOT EXISTS web_files (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        order_id TEXT,
        kind TEXT NOT NULL,
        name TEXT,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_files_order ON web_files(order_id);
    CREATE TABLE IF NOT EXISTS web_media (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        url TEXT NOT NULL,
        alt TEXT,
        bytes INTEGER NOT NULL DEFAULT 0,
        width INTEGER,
        height INTEGER,
        created_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_web_media_tenant ON web_media(tenant_id, created_at);
    CREATE TABLE IF NOT EXISTS web_requests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        message TEXT,
        data TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        ip TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_requests_tenant ON web_requests(tenant_id, created_at);
    CREATE TABLE IF NOT EXISTS web_audit (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_audit_tenant ON web_audit(tenant_id, created_at);
    CREATE TABLE IF NOT EXISTS web_guard (x INTEGER CHECK (x = 0));
    ALTER TABLE subscription_plans ADD COLUMN web_max_pages INTEGER;
    ALTER TABLE subscription_plans ADD COLUMN web_max_storage_mb INTEGER;
    ALTER TABLE subscription_plans ADD COLUMN web_max_custom_domains INTEGER;
    
;
-- schema_sql_v77

    ALTER TABLE subscription_plans ADD COLUMN business_types TEXT;
    ALTER TABLE subscription_plans ADD COLUMN grace_days INTEGER NOT NULL DEFAULT 7;
    ALTER TABLE subscription_plans ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE subscription_plans ADD COLUMN tagline TEXT;
    ALTER TABLE subscription_plans ADD COLUMN features TEXT;
    ALTER TABLE subscription_plans ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS plan_addons (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        feature TEXT NOT NULL DEFAULT 'other',
        price REAL NOT NULL DEFAULT 0,
        billing TEXT NOT NULL DEFAULT 'monthly' CHECK (billing IN ('one_time','monthly','yearly','per_term')),
        business_types TEXT,
        is_public INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mail_mailboxes (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at TEXT NOT NULL,
        deleted_at TEXT
    );
    INSERT OR IGNORE INTO mail_mailboxes (id, address, display_name, created_at) VALUES ('mailbox-info', 'info@mavin.pk', 'MAVIN.pk', '2026-11-07T00:00:00.000Z');
    INSERT OR IGNORE INTO mail_mailboxes (id, address, display_name, created_at) VALUES ('mailbox-security', 'security@mavin.pk', 'MAVIN.pk Security', '2026-11-07T00:00:00.000Z');
    CREATE TABLE IF NOT EXISTS mail_messages (
        id TEXT PRIMARY KEY,
        mailbox_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in','out')),
        provider_id TEXT,
        message_id TEXT,
        in_reply_to TEXT,
        from_addr TEXT NOT NULL,
        to_addrs TEXT,
        cc_addrs TEXT,
        subject TEXT,
        text_body TEXT,
        html_body TEXT,
        attachments TEXT,
        read_at TEXT,
        archived_at TEXT,
        sent_by TEXT,
        created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_messages_provider ON mail_messages(mailbox_id, provider_id) WHERE provider_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_mail_messages_box ON mail_messages(mailbox_id, created_at);
    
;
-- schema_sql_v78

    ALTER TABLE subscription_plans ADD COLUMN annual_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE subscription_plans ADD COLUMN annual_discount_pct REAL NOT NULL DEFAULT 20;
    ALTER TABLE subscription_plans ADD COLUMN description_style TEXT;
    INSERT OR IGNORE INTO plan_addons (id, name, description, feature, price, billing, business_types, is_public, sort_order, created_at, updated_at) VALUES ('addon-fbr-integration', 'FBR Digital Invoicing integration', 'Send your sale invoices to FBR Digital Invoicing from the POS: registration check, sandbox testing and go-live.', 'fbr_setup', 0, 'one_time', NULL, 1, 10, '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
    
;
-- schema_sql_v79

    -- Multi-branch (Enterprise). One business = one tenant; its branches are rows here.
    -- The main branch of every business has the id 'main-' || tenant id, so existing
    -- records are assigned to it below and new businesses get it on first use.
    CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        is_main INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        address TEXT,
        phone TEXT,
        email TEXT,
        manager_user_id TEXT,
        hours TEXT,
        settings TEXT,
        online_fulfillment INTEGER NOT NULL DEFAULT 0,
        capacity_released INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_branches_code ON branches (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_branches_main ON branches (tenant_id) WHERE is_main = 1;
    CREATE TABLE IF NOT EXISTS branch_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        branch_id TEXT NOT NULL REFERENCES branches(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        is_manager INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_branch_users ON branch_users (branch_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_branch_users_user ON branch_users (user_id);
    CREATE TABLE IF NOT EXISTS branch_capacity_requests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        requested_by TEXT,
        extra INTEGER NOT NULL,
        current_limit INTEGER,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_limit INTEGER,
        decided_by TEXT,
        decided_at TEXT,
        decision_note TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_branch_capreq_tenant ON branch_capacity_requests (tenant_id, status);
    CREATE TABLE IF NOT EXISTS branch_audit (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        branch_id TEXT,
        actor_user_id TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_branch_audit_tenant ON branch_audit (tenant_id, created_at);
    CREATE TABLE IF NOT EXISTS branch_transfers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        transfer_no INTEGER NOT NULL,
        from_branch_id TEXT NOT NULL REFERENCES branches(id),
        to_branch_id TEXT NOT NULL REFERENCES branches(id),
        status TEXT NOT NULL DEFAULT 'in_transit',
        note TEXT,
        idempotency_key TEXT,
        created_by TEXT,
        dispatched_at TEXT NOT NULL,
        received_by TEXT,
        received_at TEXT,
        receipt_note TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_branch_transfers_no ON branch_transfers (tenant_id, transfer_no);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_branch_transfers_idem ON branch_transfers (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS branch_transfer_items (
        id TEXT PRIMARY KEY,
        transfer_id TEXT NOT NULL REFERENCES branch_transfers(id),
        tenant_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        source_batch_id TEXT NOT NULL,
        batch_no TEXT,
        expiry_date TEXT,
        purchase_price REAL,
        qty REAL NOT NULL,
        received_qty REAL,
        dest_batch_id TEXT,
        note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_branch_transfer_items ON branch_transfer_items (transfer_id);
    -- Branch allowance: plan default (Enterprise 5, others 1), Super Admin override or unlimited.
    ALTER TABLE subscription_plans ADD COLUMN branch_limit INTEGER;
    ALTER TABLE tenants ADD COLUMN branch_limit INTEGER;
    ALTER TABLE tenants ADD COLUMN branch_unlimited INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tenants ADD COLUMN multi_branch_disabled INTEGER NOT NULL DEFAULT 0;
    UPDATE subscription_plans SET branch_limit = 5 WHERE branch_limit IS NULL AND UPPER(name) LIKE '%ENTERPRISE%';
    INSERT OR IGNORE INTO branches (id, tenant_id, code, name, is_main, status, address, phone, email, online_fulfillment, created_at, updated_at)
        SELECT 'main-' || id, id, 'MAIN', 'Main Branch', 1, 'active', address, phone, email, 1, '2026-11-07T12:00:00.000Z', '2026-11-07T12:00:00.000Z' FROM tenants;
    -- Branch-owned records: every existing row goes to its business's main branch.
    ALTER TABLE product_batches ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_product_batches_branch ON product_batches (tenant_id, branch_id);
    UPDATE product_batches SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE product_batch_expiry_changes ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_product_batch_expiry_changes_branch ON product_batch_expiry_changes (tenant_id, branch_id);
    UPDATE product_batch_expiry_changes SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE invoices ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_invoices_branch ON invoices (tenant_id, branch_id);
    UPDATE invoices SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE invoice_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_invoice_items_branch ON invoice_items (tenant_id, branch_id);
    UPDATE invoice_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE orders ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders (tenant_id, branch_id);
    UPDATE orders SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE order_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_order_items_branch ON order_items (tenant_id, branch_id);
    UPDATE order_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE purchases ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_purchases_branch ON purchases (tenant_id, branch_id);
    UPDATE purchases SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE purchase_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_purchase_items_branch ON purchase_items (tenant_id, branch_id);
    UPDATE purchase_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE purchase_drafts ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_purchase_drafts_branch ON purchase_drafts (tenant_id, branch_id);
    UPDATE purchase_drafts SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE expenses ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_expenses_branch ON expenses (tenant_id, branch_id);
    UPDATE expenses SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE revenues ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_revenues_branch ON revenues (tenant_id, branch_id);
    UPDATE revenues SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE cash_register_entries ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_cash_register_entries_branch ON cash_register_entries (tenant_id, branch_id);
    UPDATE cash_register_entries SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE bank_ledger_entries ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_bank_ledger_entries_branch ON bank_ledger_entries (tenant_id, branch_id);
    UPDATE bank_ledger_entries SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE ledger_adjustments ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_ledger_adjustments_branch ON ledger_adjustments (tenant_id, branch_id);
    UPDATE ledger_adjustments SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE audits ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_audits_branch ON audits (tenant_id, branch_id);
    UPDATE audits SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE audit_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_audit_items_branch ON audit_items (tenant_id, branch_id);
    UPDATE audit_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE financial_closings ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_financial_closings_branch ON financial_closings (tenant_id, branch_id);
    UPDATE financial_closings SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE mobile_imei_units ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_mobile_imei_units_branch ON mobile_imei_units (tenant_id, branch_id);
    UPDATE mobile_imei_units SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE rest_tables ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_rest_tables_branch ON rest_tables (tenant_id, branch_id);
    UPDATE rest_tables SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE rest_orders ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_rest_orders_branch ON rest_orders (tenant_id, branch_id);
    UPDATE rest_orders SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE rest_order_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_rest_order_items_branch ON rest_order_items (tenant_id, branch_id);
    UPDATE rest_order_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE rest_kots ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_rest_kots_branch ON rest_kots (tenant_id, branch_id);
    UPDATE rest_kots SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE rest_pra_submissions ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_rest_pra_submissions_branch ON rest_pra_submissions (tenant_id, branch_id);
    UPDATE rest_pra_submissions SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE es_docs ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_es_docs_branch ON es_docs (tenant_id, branch_id);
    UPDATE es_docs SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE es_doc_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_es_doc_items_branch ON es_doc_items (tenant_id, branch_id);
    UPDATE es_doc_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE es_payments ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_es_payments_branch ON es_payments (tenant_id, branch_id);
    UPDATE es_payments SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE es_warranty_claims ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_es_warranty_claims_branch ON es_warranty_claims (tenant_id, branch_id);
    UPDATE es_warranty_claims SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE clinic_appointments ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_clinic_appointments_branch ON clinic_appointments (tenant_id, branch_id);
    UPDATE clinic_appointments SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE clinic_consultations ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_clinic_consultations_branch ON clinic_consultations (tenant_id, branch_id);
    UPDATE clinic_consultations SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE clinic_prescriptions ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_clinic_prescriptions_branch ON clinic_prescriptions (tenant_id, branch_id);
    UPDATE clinic_prescriptions SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE clinic_orders ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_clinic_orders_branch ON clinic_orders (tenant_id, branch_id);
    UPDATE clinic_orders SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE lab_visits ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_lab_visits_branch ON lab_visits (tenant_id, branch_id);
    UPDATE lab_visits SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_lab_requests ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_lab_requests_branch ON hospital_lab_requests (tenant_id, branch_id);
    UPDATE hospital_lab_requests SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE banquet_halls ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_banquet_halls_branch ON banquet_halls (tenant_id, branch_id);
    UPDATE banquet_halls SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE banquet_bookings ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_banquet_bookings_branch ON banquet_bookings (tenant_id, branch_id);
    UPDATE banquet_bookings SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE banquet_booking_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_banquet_booking_items_branch ON banquet_booking_items (tenant_id, branch_id);
    UPDATE banquet_booking_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE banquet_payments ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_banquet_payments_branch ON banquet_payments (tenant_id, branch_id);
    UPDATE banquet_payments SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_episodes ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_episodes_branch ON hospital_episodes (tenant_id, branch_id);
    UPDATE hospital_episodes SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_charges ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_charges_branch ON hospital_charges (tenant_id, branch_id);
    UPDATE hospital_charges SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_payments ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_payments_branch ON hospital_payments (tenant_id, branch_id);
    UPDATE hospital_payments SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_lab_orders ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_lab_orders_branch ON hospital_lab_orders (tenant_id, branch_id);
    UPDATE hospital_lab_orders SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_imaging_orders ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_imaging_orders_branch ON hospital_imaging_orders (tenant_id, branch_id);
    UPDATE hospital_imaging_orders SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_cash_closings ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_cash_closings_branch ON hospital_cash_closings (tenant_id, branch_id);
    UPDATE hospital_cash_closings SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_vitals ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_vitals_branch ON hospital_vitals (tenant_id, branch_id);
    UPDATE hospital_vitals SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_mar_entries ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_mar_entries_branch ON hospital_mar_entries (tenant_id, branch_id);
    UPDATE hospital_mar_entries SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_surgery_bookings ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_surgery_bookings_branch ON hospital_surgery_bookings (tenant_id, branch_id);
    UPDATE hospital_surgery_bookings SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE hospital_er_triage ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_hospital_er_triage_branch ON hospital_er_triage (tenant_id, branch_id);
    UPDATE hospital_er_triage SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE dist_docs ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_dist_docs_branch ON dist_docs (tenant_id, branch_id);
    UPDATE dist_docs SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE dist_doc_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_dist_doc_items_branch ON dist_doc_items (tenant_id, branch_id);
    UPDATE dist_doc_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE dist_payments ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_dist_payments_branch ON dist_payments (tenant_id, branch_id);
    UPDATE dist_payments SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE dist_bookings ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_dist_bookings_branch ON dist_bookings (tenant_id, branch_id);
    UPDATE dist_bookings SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE dist_booking_items ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_dist_booking_items_branch ON dist_booking_items (tenant_id, branch_id);
    UPDATE dist_booking_items SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    ALTER TABLE web_orders ADD COLUMN branch_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_web_orders_branch ON web_orders (tenant_id, branch_id);
    UPDATE web_orders SET branch_id = 'main-' || tenant_id WHERE branch_id IS NULL AND tenant_id IS NOT NULL;
    -- Document numbers run per branch.
    DROP INDEX IF EXISTS ux_rest_orders_no;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_orders_branch_no ON rest_orders (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), order_no);
    DROP INDEX IF EXISTS ux_rest_orders_invoice;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_orders_branch_invoice ON rest_orders (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), invoice_no) WHERE invoice_no IS NOT NULL;
    DROP INDEX IF EXISTS ux_rest_pra_usin;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rest_pra_branch_usin ON rest_pra_submissions (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), usin, invoice_type);
    DROP INDEX IF EXISTS ux_es_docs_no;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_es_docs_branch_no ON es_docs (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), doc_type, doc_no);
    DROP INDEX IF EXISTS ux_dist_bookings_no;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_bookings_branch_no ON dist_bookings (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), booking_no);
    DROP INDEX IF EXISTS ux_dist_docs_no;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_dist_docs_branch_no ON dist_docs (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), doc_type, doc_no);
    DROP INDEX IF EXISTS ux_hosp_episode_no;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_episode_branch_no ON hospital_episodes (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), episode_no);
    DROP INDEX IF EXISTS ux_hosp_labreq_labno;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_labreq_branch_labno ON hospital_lab_requests (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), lab_no);
    DROP INDEX IF EXISTS ux_hosp_labreq_invoice;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hosp_labreq_branch_invoice ON hospital_lab_requests (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), invoice_no);
    DROP INDEX IF EXISTS ux_cash_closing_no;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_closing_branch_no ON hospital_cash_closings (tenant_id, COALESCE(branch_id, 'main-' || tenant_id), closing_no);
    
;
-- schema_sql_v80

    -- Online payments (JazzCash, Easypaisa, cards through their hosted pages).
    -- Merchant connections: the platform's own (tenant_id NULL) and each business's.
    -- Secrets are stored encrypted (credentials_enc); masked hints only for display.
    CREATE TABLE IF NOT EXISTS payment_merchants (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        provider TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'sandbox',
        status TEXT NOT NULL DEFAULT 'setup',
        enabled INTEGER NOT NULL DEFAULT 0,
        methods TEXT,
        approved_domains TEXT,
        credentials_enc TEXT,
        credential_hints TEXT,
        last_test_at TEXT,
        last_test_ok INTEGER,
        last_test_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_merchants ON payment_merchants (COALESCE(tenant_id, '~platform'), provider, environment);
    -- One row per attempt to pay; an order may have several, only one can be paid.
    CREATE TABLE IF NOT EXISTS payment_attempts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        branch_id TEXT,
        purpose TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        method TEXT NOT NULL,
        environment TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'PKR',
        reference TEXT NOT NULL,
        idempotency_key TEXT,
        status TEXT NOT NULL DEFAULT 'created',
        provider_txn_ref TEXT,
        provider_status TEXT,
        settlement_status TEXT NOT NULL DEFAULT 'unsettled',
        return_url TEXT,
        paid_at TEXT,
        applied_at TEXT,
        review_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_attempts_ref ON payment_attempts (reference);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_attempts_idem ON payment_attempts (purpose, ref_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_ref ON payment_attempts (purpose, ref_id);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_tenant ON payment_attempts (tenant_id, created_at);
    -- What the provider said (redacted), each time.
    CREATE TABLE IF NOT EXISTS payment_events (
        id TEXT PRIMARY KEY,
        attempt_id TEXT,
        tenant_id TEXT,
        kind TEXT NOT NULL,
        provider_status TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payment_events_attempt ON payment_events (attempt_id, created_at);
    CREATE TABLE IF NOT EXISTS payment_refunds (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        tenant_id TEXT,
        amount_minor INTEGER NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        provider_ref TEXT,
        idempotency_key TEXT,
        requested_by TEXT,
        completed_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_refunds_idem ON payment_refunds (attempt_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS payment_access_requests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        methods TEXT NOT NULL,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by TEXT,
        decided_by TEXT,
        decision_note TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payment_requests_tenant ON payment_access_requests (tenant_id, status);
    CREATE TABLE IF NOT EXISTS payment_audit (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        actor_user_id TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payment_audit_tenant ON payment_audit (tenant_id, created_at);
    
;
-- schema_sql_v81

    -- Offline desktop (pilot): approved checkout devices, the operations they
    -- send (exactly once by op_id), stock exceptions to reconcile, and a
    -- server-side change sequence the devices pull from (no device clocks).
    CREATE TABLE IF NOT EXISTS offline_devices (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        name TEXT NOT NULL,
        device_code TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        allowed_users TEXT NOT NULL DEFAULT '[]',
        modules TEXT NOT NULL DEFAULT '["sale.cash"]',
        max_offline_hours INTEGER NOT NULL DEFAULT 72,
        registered_by TEXT,
        registered_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT,
        revoke_reason TEXT,
        last_seen_at TEXT,
        last_sync_at TEXT,
        last_pending INTEGER,
        last_failed INTEGER,
        app_version TEXT,
        protocol INTEGER,
        next_receipt_no INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_offline_devices_code ON offline_devices (tenant_id, device_code);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_offline_devices_branch_active ON offline_devices (tenant_id, branch_id) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS offline_ops (
        op_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        user_id TEXT,
        kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        depends_on TEXT,
        payload TEXT NOT NULL,
        occurred_at TEXT,
        received_at TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        applied_seq INTEGER,
        decided_by TEXT,
        decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_offline_ops_device ON offline_ops (tenant_id, device_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_offline_ops_status ON offline_ops (tenant_id, status);
    CREATE TABLE IF NOT EXISTS offline_exceptions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        op_id TEXT NOT NULL,
        invoice_id TEXT,
        product_id TEXT,
        batch_id TEXT,
        kind TEXT NOT NULL,
        qty REAL,
        detail TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        resolution TEXT,
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offline_exceptions_tenant ON offline_exceptions (tenant_id, status);
    CREATE TABLE IF NOT EXISTS offline_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        tbl TEXT NOT NULL,
        row_id TEXT NOT NULL,
        tenant_id TEXT,
        branch_id TEXT,
        changed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offline_changes_tenant ON offline_changes (tenant_id, seq);
    ALTER TABLE invoices ADD COLUMN offline_ref TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_offline_ref ON invoices (tenant_id, offline_ref) WHERE offline_ref IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS trg_offline_chg_batches_ins AFTER INSERT ON product_batches BEGIN
        INSERT INTO offline_changes (tbl, row_id, tenant_id, branch_id, changed_at) VALUES ('product_batches', NEW.id, NEW.tenant_id, NEW.branch_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_offline_chg_batches_upd AFTER UPDATE ON product_batches BEGIN
        INSERT INTO offline_changes (tbl, row_id, tenant_id, branch_id, changed_at) VALUES ('product_batches', NEW.id, NEW.tenant_id, NEW.branch_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_offline_chg_products_ins AFTER INSERT ON products BEGIN
        INSERT INTO offline_changes (tbl, row_id, tenant_id, branch_id, changed_at) VALUES ('products', NEW.id, NEW.tenant_id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_offline_chg_products_upd AFTER UPDATE ON products BEGIN
        INSERT INTO offline_changes (tbl, row_id, tenant_id, branch_id, changed_at) VALUES ('products', NEW.id, NEW.tenant_id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_offline_chg_prices_ins AFTER INSERT ON price_list BEGIN
        INSERT INTO offline_changes (tbl, row_id, tenant_id, branch_id, changed_at) VALUES ('price_list', NEW.id, NEW.tenant_id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_offline_chg_prices_upd AFTER UPDATE ON price_list BEGIN
        INSERT INTO offline_changes (tbl, row_id, tenant_id, branch_id, changed_at) VALUES ('price_list', NEW.id, NEW.tenant_id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    END;
    
;
-- schema_sql_v82

    -- Purchases: extra discount % per product line (on the supplier's rate,
    -- before sales tax and withholding tax). Existing lines: 0.
    ALTER TABLE purchase_items ADD COLUMN disc_pct REAL NOT NULL DEFAULT 0;
    
;
-- schema_sql_v83

    -- Extra discount: switched on per customer by the owner (or staff allowed
    -- to); on the customer's invoice and quotation lines it comes off the
    -- already discounted price. Existing rows: off / 0.
    ALTER TABLE customers ADD COLUMN extra_discount INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE invoice_items ADD COLUMN extra_disc_pct REAL NOT NULL DEFAULT 0;
    
;