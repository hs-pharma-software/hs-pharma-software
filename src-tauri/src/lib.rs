use tauri_plugin_sql::{Migration, MigrationKind};

mod print;

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

/// Tenants can now carry an MRP discount percentage so that a "dealer portal"
/// login shows all stock prices as MRP * (1 - discount / 100) — used e.g.
/// for "Hadayat Ullah & Sons Pharmacy" at 14.5 %.
fn schema_sql_v10() -> &'static str {
    r#"
    ALTER TABLE tenants ADD COLUMN mrp_discount_pct REAL DEFAULT 0;
    "#
}

/// Dealer portal: a tenant can be a read-only view of another tenant's stock.
/// When source_tenant_id is set the stock page queries that tenant's data
/// instead of the dealer's own (which would be empty).
fn schema_sql_v11() -> &'static str {
    r#"
    ALTER TABLE tenants ADD COLUMN source_tenant_id TEXT;
    "#
}

/// Per-user module permissions for staff accounts. NULL means full access
/// (backward-compatible default). A JSON array of module keys restricts the
/// user to only those modules in the sidebar and settings.
fn schema_sql_v12() -> &'static str {
    r#"
    ALTER TABLE users ADD COLUMN permissions TEXT;
    "#
}

fn schema_sql_v13() -> &'static str {
    r#"
    ALTER TABLE invoices ADD COLUMN fbr_invoice_no TEXT;
    "#
}

fn schema_sql_v14() -> &'static str {
    r#"
    ALTER TABLE products ADD COLUMN hs_code TEXT;
    ALTER TABLE products ADD COLUMN fbr_sale_type TEXT;
    ALTER TABLE products ADD COLUMN fbr_sale_rate REAL DEFAULT 0;
    ALTER TABLE products ADD COLUMN fbr_uom TEXT;
    "#
}

/// Per-invoice buyer snapshot: walk-in customers have no customers row, and
/// FBR needs the buyer details exactly as they were at sale time.
fn schema_sql_v15() -> &'static str {
    r#"
    ALTER TABLE invoices ADD COLUMN customer_name TEXT;
    ALTER TABLE invoices ADD COLUMN customer_phone TEXT;
    ALTER TABLE invoices ADD COLUMN buyer_ntn_cnic TEXT;
    ALTER TABLE invoices ADD COLUMN buyer_province TEXT;
    ALTER TABLE invoices ADD COLUMN buyer_address TEXT;
    ALTER TABLE invoices ADD COLUMN buyer_registration_type TEXT;
    "#
}

/// Narcotic / controlled-drug flag. Backfilled from name + description using
/// the same keywords as src/lib/narcotics.ts.
fn schema_sql_v16() -> &'static str {
    r#"
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
    "#
}

/// Correct product FBR data to values FBR's reference APIs accept: valid HS
/// codes, UOM allowed per HS code, FBR sale-type names, 18% standard rate and
/// FBR's SRO schedule name for exempt goods.
fn schema_sql_v17() -> &'static str {
    r#"
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
    "#
}

/// Exempt products get SRO "Eighth Schedule Table 1" item 81, the only SRO
/// item FBR's reference APIs (SroSchedule/SROItem) offer for drugs at the
/// Exempt rate. Products already given a serial are left alone.
fn schema_sql_v18() -> &'static str {
    r#"
    UPDATE products SET sro_no = 'Eighth Schedule Table 1', sro_item_serial_no = '81'
    WHERE fbr_sale_type = 'Exempt goods' AND COALESCE(sro_item_serial_no, '') = '';
    "#
}

/// DRAP regulatory data for imported products. Name/description/company stay
/// in their existing columns; only the registration number (used to match on
/// re-import) and the remaining regulatory details (JSON) are new.
fn schema_sql_v19() -> &'static str {
    r#"
    ALTER TABLE products ADD COLUMN drap_reg_no TEXT;
    ALTER TABLE products ADD COLUMN drap_meta TEXT;
    CREATE INDEX IF NOT EXISTS idx_products_drap_reg_no ON products (drap_reg_no);
    "#
}

/// Shared list of product descriptions (generic names) for the Description
/// suggestion menu, seeded once from existing products. The id is derived
/// from the uppercased name so every device and Turso produce the same id
/// for the same name, and the unique index blocks case-only duplicates.
fn schema_sql_v20() -> &'static str {
    r#"
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
    "#
}

/// FBR fixes the unit per HS code (KG for rubber teats, disinfectants, soap,
/// diapers...), so the quantity sent must be in that unit: fbr_qty_factor is
/// how much of the FBR unit one base unit is (a 500 g pack in KG = 0.5).
/// Also corrects four non-medicines that were classed as exempt medicines;
/// each update only applies while the product still has the old value.
fn schema_sql_v22() -> &'static str {
    r#"
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
    "#
}

/// Action permissions for staff logins (edit/delete invoice or purchase,
/// submit to FBR), stored as a JSON array of DENIED action keys so every
/// existing staff login keeps full access until the owner restricts it.
fn schema_sql_v23() -> &'static str {
    r#"
    ALTER TABLE users ADD COLUMN denied_actions TEXT;
    "#
}

/// Purchase drafts: the Add Purchase form's state as JSON. Saved explicitly
/// (Draft button) or automatically while typing, so work survives the app
/// closing or crashing; removed when the purchase is saved.
fn schema_sql_v24() -> &'static str {
    r#"
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
    "#
}

/// Per-tenant controls set by the Super Admin: business type, accessible
/// sections (NULL = the plan's modules), actions denied to every login of the
/// tenant, whether FBR Digital Invoicing is allowed, and whether the tenant
/// may edit its print templates.
fn schema_sql_v25() -> &'static str {
    r#"
    ALTER TABLE tenants ADD COLUMN business_type TEXT;
    ALTER TABLE tenants ADD COLUMN allowed_modules TEXT;
    ALTER TABLE tenants ADD COLUMN denied_actions TEXT;
    ALTER TABLE tenants ADD COLUMN fbr_allowed INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE tenants ADD COLUMN print_templates_editable INTEGER NOT NULL DEFAULT 1;
    "#
}

/// Restaurant module. Every table is private to one tenant (tenant_id on
/// every row, every query filters by it). Menu items live here, NOT in the
/// shared `products` catalog, so a restaurant never sees another business's
/// products. `local_secrets` is device-only (never synced): PRA tokens.
fn schema_sql_v26() -> &'static str {
    r#"
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
    "#
}

/// Electric / Electronics / Solar store module. Tenant-owned catalog (not the
/// shared pharmacy `products` table), serial-numbered units, documents
/// (sales, purchases, quotations, returns) with frozen line snapshots,
/// signed stock movements in base units, party payments, warranty claims.
/// `local_assets` is device-only (never synced): the uploaded Urdu font.
fn schema_sql_v28() -> &'static str {
    r#"
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
    "#
}

/// Shared pharmacy / general-store product catalog (v31).
/// Adds catalog_group and product_classification columns so products can be
/// shared across pharmacy-family tenants (retail_pharmacy, medical_store,
/// hospital_pharmacy) while each tenant still maintains its own stock,
/// batches, pricing and transactions.
///
/// catalog_group values:
///   'pharma'        — shared pharma master; visible to retail_pharmacy,
///                     medical_store, hospital_pharmacy
///   'general_store' — shared general-store master; visible to the above
///                     plus general_store tenants
///   NULL            — tenant-private (electric, solar, restaurant, etc.)
///                     or quarantined (tenant_id also NULL)
///
/// product_classification mirrors catalog_group for products that a
/// pharmacy tenant explicitly tagged as Pharma or General Store.
fn schema_sql_v31() -> &'static str {
    r#"
    ALTER TABLE products ADD COLUMN catalog_group TEXT;
    ALTER TABLE products ADD COLUMN product_classification TEXT;
    ALTER TABLE categories ADD COLUMN catalog_group TEXT;
    ALTER TABLE sub_categories ADD COLUMN catalog_group TEXT;
    CREATE INDEX IF NOT EXISTS idx_products_catalog_group ON products (catalog_group) WHERE catalog_group IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_products_classification ON products (product_classification, tenant_id);
    CREATE INDEX IF NOT EXISTS idx_categories_catalog_group ON categories (catalog_group) WHERE catalog_group IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sub_categories_catalog_group ON sub_categories (catalog_group) WHERE catalog_group IS NOT NULL
    "#
}

/// Backfill catalog_group for unowned products (v32).
/// v31 added the catalog_group column but did not populate it — that was done
/// via a separate Turso migration script that never ran on local SQLite.
/// All pre-existing unowned products (tenant_id IS NULL) are pharma products
/// quarantined by v29; they default to 'pharma' unless product_classification
/// says otherwise.  Unowned categories and sub_categories share the same rule.
fn schema_sql_v32() -> &'static str {
    r#"
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
    "#
}

/// Clinic Management module (v34): patients, doctors, appointments,
/// consultations, prescriptions, pharmacy notifications and link config.
/// All clinic tables are tenant-scoped; pharmacy notifications are owned
/// by the pharmacy tenant so pharmacy staff can query their own inbox.
fn schema_sql_v34() -> &'static str {
    r#"
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
    "#
}

/// Admission from the doctor's desk and planned surgeries (additive):
/// - hospital_episodes.from_episode_id: the OPD visit an admission came from.
/// - hospital_surgery_bookings: a surgery planned for an admission, with its type
///   (an "ot" service of the Surgery tab), fee, surgeon, planned date and status.
/// v44: lab results with several parameters (CBC panel) as JSON, a random
/// token per lab request for the online report behind the QR code, and the
/// modality of a radiology study in Performing Images.
fn schema_sql_v44() -> &'static str {
    r#"
    ALTER TABLE hospital_lab_orders ADD COLUMN components TEXT;
    ALTER TABLE hospital_lab_requests ADD COLUMN public_token TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hosp_lab_req_public_token ON hospital_lab_requests (public_token) WHERE public_token IS NOT NULL;
    ALTER TABLE hospital_services ADD COLUMN modality TEXT
    "#
}

/// Surgery invoices: the charge breakdown of a surgery type and of a booked
/// surgery (operation fee, OT, paramedics, anaesthesia, OT medicine, room,
/// indoor medicine), the booking's invoice, and the admission an invoice bills.
/// The admission made from a visit (hospital_episodes.from_episode_id, v43) is
/// looked up by that visit. Also the v1 indexes the shared Turso database never
/// received (its first schema was created by migrate-turso.cjs, not v1); on a
/// desktop database they already exist and these are no-ops.
/// Admission confirmation: an admission made from a visit (consultant, or a
/// referral from Emergency) waits for the Head Nurse of its department (or the
/// Nursing Superintendent). Empty on older and direct admissions.
/// PHC MSDS medical record foundation. Forms (consents, care plans, notes,
/// discharge, transfer ...) are versioned definitions in src/config/forms; a
/// record holds one filled form for a patient (and visit / admission) or a
/// department register entry. Finalized records change only through
/// revisions (append-only, with reason). Checklist entries record a person
/// affirming (self_confirmation) or observing (observation) a safety step;
/// nothing is ever recorded as done without someone choosing it.
/// Inpatient medication orders and the medication administration record
/// (MSDS MOM-1, MOM-3). Orders reuse hospital_rx_items (order_type =
/// 'inpatient'), are never replaced, and carry who ordered them and when,
/// stop details, high-risk verification and verbal-order countersignature.
/// Each administration is one append-only row with its identity and
/// medicine / dose / route / time checks; errors are voided with a reason.
/// Theatre and anaesthesia records (MSDS COP-4, COP-5): forms and checklist
/// answers can belong to one surgery of an admission (subject_id = the
/// surgery booking), and vital signs carry the phase (ward, during
/// anaesthesia, recovery) with heart rhythm and airway for anaesthesia
/// monitoring. All columns are nullable; existing rows are ward readings.
/// Server audit log: every write the web version sends through the server
/// (/api/db), with who sent it and the statement (never the values, which can
/// hold patient data). Written by the server only; unused on the desktop.
/// Infection prevention and control (MSDS IPC-1, IPC-2). Hand-hygiene
/// observation audits by an IPC auditor (sessions of observed opportunities),
/// kept apart from clinicians' own confirmations. Sterilization: autoclaves,
/// cycles with physical / chemical / biological results, release by a
/// verifier other than the operator, recall; the instrument sets of a load and
/// the surgeries they were actually used in.
/// Hospital blood bank (MSDS COP-2, CQI-2 Ind. 104; Punjab Blood Transfusion
/// Safety Act 2016): donors and donations, blood units with screening and
/// status through the chain (quarantine, available, reserved, issued,
/// transfused, returned, discarded), requests, compatibility tests, issues
/// and the bedside transfusion, and transfusion reactions with the report to
/// the Authority.
fn schema_sql_v54() -> &'static str {
    r#"
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
    "#
}

fn schema_sql_v53() -> &'static str {
    r#"
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
    "#
}

fn schema_sql_v52() -> &'static str {
    r#"
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
    "#
}

fn schema_sql_v51() -> &'static str {
    r#"
    CREATE TABLE IF NOT EXISTS server_audit_log (
        id TEXT PRIMARY KEY, user_id TEXT, tenant_id TEXT, role TEXT, verb TEXT NOT NULL, tables TEXT,
        statement TEXT, ip TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_server_audit_tenant ON server_audit_log (tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_server_audit_user ON server_audit_log (user_id, created_at)
    "#
}

fn schema_sql_v50() -> &'static str {
    r#"
    ALTER TABLE hospital_form_records ADD COLUMN subject_id TEXT;
    ALTER TABLE hospital_checklist_entries ADD COLUMN subject_id TEXT;
    ALTER TABLE hospital_vitals ADD COLUMN phase TEXT;
    ALTER TABLE hospital_vitals ADD COLUMN subject_id TEXT;
    ALTER TABLE hospital_vitals ADD COLUMN rhythm TEXT;
    ALTER TABLE hospital_vitals ADD COLUMN airway TEXT;
    CREATE INDEX IF NOT EXISTS idx_hosp_forms_subject ON hospital_form_records (tenant_id, subject_id) WHERE subject_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_hosp_checklist_subject ON hospital_checklist_entries (tenant_id, subject_id) WHERE subject_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_hosp_vitals_subject ON hospital_vitals (tenant_id, subject_id, recorded_at) WHERE subject_id IS NOT NULL
    "#
}

fn schema_sql_v49() -> &'static str {
    r#"
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
    "#
}

fn schema_sql_v48() -> &'static str {
    r#"
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
    "#
}

fn schema_sql_v47() -> &'static str {
    r#"
    ALTER TABLE hospital_episodes ADD COLUMN admission_status TEXT;
    ALTER TABLE hospital_episodes ADD COLUMN admission_confirmed_by TEXT;
    ALTER TABLE hospital_episodes ADD COLUMN admission_confirmed_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_hosp_episodes_admission ON hospital_episodes (tenant_id, admission_status) WHERE admission_status IS NOT NULL
    "#
}

fn schema_sql_v46() -> &'static str {
    r#"
    CREATE INDEX IF NOT EXISTS idx_hosp_episodes_from ON hospital_episodes (tenant_id, from_episode_id) WHERE from_episode_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_price_list_product ON price_list (product_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases (supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_adjustments (party_type, party_id)
    "#
}

fn schema_sql_v45() -> &'static str {
    r#"
    ALTER TABLE hospital_services ADD COLUMN fee_breakdown TEXT;
    ALTER TABLE hospital_surgery_bookings ADD COLUMN fee_breakdown TEXT;
    ALTER TABLE hospital_surgery_bookings ADD COLUMN invoice_id TEXT;
    ALTER TABLE invoices ADD COLUMN hospital_episode_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_invoices_hospital_episode ON invoices (tenant_id, hospital_episode_id) WHERE hospital_episode_id IS NOT NULL
    "#
}

fn schema_sql_v43() -> &'static str {
    r#"
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
    "#
}

/// Central lab reports (additive, existing rows kept):
/// - hospital_collection_centers: locations of the same hospital that register tests.
/// - hospital_lab_requests: one patient order of one or more tests, with a Unique
///   Lab Number and a Lab Invoice Number (both unique per hospital), where it was
///   registered, and the sample dates. Every existing lab order gets its own request.
/// - hospital_lab_orders: link to the request, result entry and verification
///   (who released the result, with credentials). Results released before this
///   version are marked as released before verification was required.
/// - hospital_lab_report_log: who viewed / printed / reprinted which report.
/// - staff.collection_center_id: where a staff member works.
fn schema_sql_v42() -> &'static str {
    r#"
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
    "#
}

/// The lab's "Performing Tests": a lab service also records its sample type,
/// result unit, normal range and turnaround time (additive).
fn schema_sql_v41() -> &'static str {
    r#"
    ALTER TABLE hospital_services ADD COLUMN sample_type TEXT;
    ALTER TABLE hospital_services ADD COLUMN unit TEXT;
    ALTER TABLE hospital_services ADD COLUMN ref_range TEXT;
    ALTER TABLE hospital_services ADD COLUMN turnaround_hours REAL
    "#
}

/// Hospital HR, OPD reception and the doctor's desk (all additive):
/// - staff: designation category, automatic employee id (MO-01...), PMDC / PNC /
///   licence number, department, specialization, consultation fee, linked login.
/// - hospital_episodes: OPD token and the consultation notes.
/// - lab / radiology orders: the fee and whether it is paid (unpaid orders with a
///   fee cannot be processed).
/// - hospital_rx_items: medicines a hospital doctor prescribes in an episode.
fn schema_sql_v40() -> &'static str {
    r#"
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
    "#
}

/// Owner columns so prescription lines can sync like every other tenant row:
/// clinic_rx_items gets tenant_id (filled from its prescription), and the
/// pharmacy's copy gets the sending clinic and a soft-delete column.
fn schema_sql_v39() -> &'static str {
    r#"
    ALTER TABLE clinic_rx_items ADD COLUMN tenant_id TEXT;
    UPDATE clinic_rx_items SET tenant_id = (SELECT p.tenant_id FROM clinic_prescriptions p WHERE p.id = clinic_rx_items.prescription_id) WHERE tenant_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_crxi_tenant ON clinic_rx_items (tenant_id);
    ALTER TABLE pharmacy_rx_items ADD COLUMN clinic_tenant_id TEXT;
    ALTER TABLE pharmacy_rx_items ADD COLUMN deleted_at TEXT;
    UPDATE pharmacy_rx_items SET clinic_tenant_id = (SELECT n.clinic_tenant_id FROM pharmacy_rx_notifications n WHERE n.prescription_id = pharmacy_rx_items.prescription_id AND n.pharmacy_tenant_id = pharmacy_rx_items.pharmacy_tenant_id) WHERE clinic_tenant_id IS NULL
    "#
}

/// The prescription mailbox between a clinic and a pharmacy. A clinic and a
/// pharmacy live in different databases, so the pharmacy gets its own copy of
/// the prescription lines when one is sent (it can no longer read the clinic's).
fn schema_sql_v38() -> &'static str {
    r#"
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
    "#
}

/// Walk-in appointments have no doctor yet: doctor_id must be nullable.
fn schema_sql_v37() -> &'static str {
    r#"
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
    "#
}

fn schema_sql_v36() -> &'static str {
    r#"
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
    "#
}

fn schema_sql_v35() -> &'static str {
    r#"
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
    "#
}

/// Extended customer / client fields for contractor and FBR compliance (v33).
/// Splits the combined cnic_ntn field into separate cnic_ntn (CNIC) and ntn
/// fields, adds strn, registration_type, business_name and fbr_active_status
/// so contractor tenants can store structured client identity and FBR data.
fn schema_sql_v33() -> &'static str {
    r#"
    ALTER TABLE customers ADD COLUMN ntn TEXT;
    ALTER TABLE customers ADD COLUMN strn TEXT;
    ALTER TABLE customers ADD COLUMN registration_type TEXT;
    ALTER TABLE customers ADD COLUMN business_name TEXT;
    ALTER TABLE customers ADD COLUMN fbr_active_status TEXT
    "#
}

/// Tenant ownership for the catalog that used to be shared by every tenant
/// (products, categories, sub categories, units, generic names). Additive
/// only: existing rows keep tenant_id NULL here, which no tenant query
/// returns (quarantine). Ownership of existing rows is assigned by the audited
/// catalog-ownership migration against Turso and arrives through sync.
/// Generic names become unique per tenant instead of globally.
fn schema_sql_v29() -> &'static str {
    r#"
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
    "#
}

/// Wholesaler / Distributor module (Pharma or General mode per tenant):
/// own companies, categories, catalog and customers (with geotag, NTN/ATL and
/// CDSL fields), salesmen with targets and location sharing, bookings,
/// invoices / purchases / returns with withholding-tax snapshots, payments,
/// stock, per-user permissions and an audit log. Every row is tenant-owned;
/// codes and numbers are unique per tenant.
fn schema_sql_v30() -> &'static str {
    r#"
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
    "#
}

/// Per-line billed discount and tax (fixed at payment, used for refunds and
/// PRA line values) and the refunded flag.
fn schema_sql_v27() -> &'static str {
    r#"
    ALTER TABLE rest_order_items ADD COLUMN line_discount REAL DEFAULT 0;
    ALTER TABLE rest_order_items ADD COLUMN line_tax REAL DEFAULT 0;
    ALTER TABLE rest_order_items ADD COLUMN refunded INTEGER DEFAULT 0;
    "#
}

/// v20 only trimmed spaces, so names with line breaks or repeated spaces were
/// kept as separate entries. Re-key every name on its whitespace-normalized
/// form (same rule as normalizeGenericName in the app: any run of
/// whitespace -> one space) and drop the unnormalized copies. Idempotent.
fn schema_sql_v21() -> &'static str {
    r#"
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

/// The full schema of the single database shared by Pharmacy POS, Hospital and
/// Clinic. scripts/migrate-turso.cjs applies the same versions to Turso.
fn all_migrations() -> Vec<Migration> {
    vec![
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
        Migration {
            version: 10,
            description: "tenant_mrp_discount_pct",
            sql: schema_sql_v10(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "tenant_source_tenant_id",
            sql: schema_sql_v11(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "user_permissions",
            sql: schema_sql_v12(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "invoice_fbr_invoice_no",
            sql: schema_sql_v13(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "product_fbr_fields",
            sql: schema_sql_v14(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "invoice_buyer_fields",
            sql: schema_sql_v15(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "product_is_narcotic",
            sql: schema_sql_v16(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "product_fbr_data_corrections",
            sql: schema_sql_v17(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "product_exempt_sro_serial_81",
            sql: schema_sql_v18(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "product_drap_fields",
            sql: schema_sql_v19(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "generic_names",
            sql: schema_sql_v20(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "generic_names_whitespace_normalize",
            sql: schema_sql_v21(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "product_fbr_qty_factor_and_non_medicine_fixes",
            sql: schema_sql_v22(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "user_denied_actions",
            sql: schema_sql_v23(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "purchase_drafts",
            sql: schema_sql_v24(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "tenant_controls",
            sql: schema_sql_v25(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "restaurant_module",
            sql: schema_sql_v26(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "restaurant_line_amounts",
            sql: schema_sql_v27(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "electric_store_module",
            sql: schema_sql_v28(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "catalog_tenant_ownership",
            sql: schema_sql_v29(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "distributor_module",
            sql: schema_sql_v30(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "shared_catalog_groups",
            sql: schema_sql_v31(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "backfill_catalog_group",
            sql: schema_sql_v32(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "customer_contractor_fields",
            sql: schema_sql_v33(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 34,
            description: "clinic_module",
            sql: schema_sql_v34(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 35,
            description: "hospital_module",
            sql: schema_sql_v35(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 36,
            description: "hospital_departments_lab_radiology_and_nullable_clinic_fks",
            sql: schema_sql_v36(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 37,
            description: "clinic_appointments_nullable_doctor",
            sql: schema_sql_v37(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 38,
            description: "pharmacy_rx_items_mailbox",
            sql: schema_sql_v38(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 39,
            description: "rx_items_owner_columns_for_sync",
            sql: schema_sql_v39(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 40,
            description: "hospital_hr_opd_doctor_desk",
            sql: schema_sql_v40(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 41,
            description: "lab_performing_tests",
            sql: schema_sql_v41(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 42,
            description: "lab_requests_reports_collection_centers",
            sql: schema_sql_v42(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 43,
            description: "admissions_and_surgery_bookings",
            sql: schema_sql_v43(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 44,
            description: "cbc_panel_report_qr_radiology_studies",
            sql: schema_sql_v44(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 45,
            description: "surgery_invoices",
            sql: schema_sql_v45(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 46,
            description: "admission_source_index_and_shared_db_indexes",
            sql: schema_sql_v46(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 47,
            description: "admission_confirmation_by_head_nurse",
            sql: schema_sql_v47(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 48,
            description: "msds_forms_checklists_vitals",
            sql: schema_sql_v48(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 49,
            description: "inpatient_medication_orders_and_mar",
            sql: schema_sql_v49(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 50,
            description: "theatre_anaesthesia_records",
            sql: schema_sql_v50(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 51,
            description: "server_audit_log",
            sql: schema_sql_v51(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 52,
            description: "ipc_hand_hygiene_and_sterilization",
            sql: schema_sql_v52(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 53,
            description: "hospital_blood_bank",
            sql: schema_sql_v53(),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 54,
            description: "hospital_emergency_quality",
            sql: schema_sql_v54(),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pharmacy.db", all_migrations())
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![print::print_silent, print::print_to_pdf])
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
