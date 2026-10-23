/** Every table that participates in local <-> Turso sync, in an order safe
 * for foreign keys on first push (parents before children). Keep this in
 * sync with the schema in `src-tauri/src/lib.rs` and `db/schema.sql`. */
export const SYNCABLE_TABLES = [
  // Catalog: owned by one tenant each since v29 (see CATALOG_TABLES).
  "categories",
  "sub_categories",
  "uoms",
  "products",
  "generic_names",
  // Global/shared \u2014 every tenant (and the Super Admin) sees the same rows.
  "subscription_plans",
  "tenants",
  "users",
  // Tenant-scoped \u2014 see TENANT_SCOPED_TABLES below; the sync engine adds a
  // `tenant_id` filter to these on pull.
  "product_batches",
  "price_list",
  "customers",
  "suppliers",
  "staff",
  "salesmen",
  "banks",
  "bank_ledger_entries",
  "cash_register_entries",
  "invoices",
  "invoice_items",
  "orders",
  "order_items",
  "purchases",
  "purchase_items",
  "expense_categories",
  "expenses",
  "revenue_categories",
  "revenues",
  "salaries",
  "ledger_adjustments",
  "tasks",
  "attendance",
  "audits",
  "audit_items",
  "settings",
  "product_suppliers",
  "financial_closings",
  "purchase_drafts",
  // Restaurant module (all tenant-scoped).
  "rest_categories",
  "rest_menu_items",
  "rest_tables",
  "rest_orders",
  "rest_order_items",
  "rest_kots",
  "rest_deals",
  "rest_offers",
  "rest_ingredients",
  "rest_recipe_lines",
  "rest_stock_moves",
  "rest_pra_submissions",
  "rest_audit",
  // Electric / Electronics / Solar store (all tenant-scoped).
  "es_categories",
  "es_products",
  "es_serials",
  "es_docs",
  "es_doc_items",
  "es_stock_moves",
  "es_payments",
  "es_warranty_claims",
  "es_audit",
] as const;

/** Tables private to one pharmacy tenant \u2014 `pullChanges()` in
 * `src/lib/sync/engine.ts` adds `AND tenant_id = ?` for these, and skips
 * them entirely for the Super Admin (who has no tenant, and no business
 * seeing any tenant's private data). `settings` is deliberately NOT here:
 * it has no `tenant_id` column (scoped instead by prefixing the key \u2014 see
 * `src/lib/repo/settings.ts`), so it stays in the "pull everything" bucket
 * like the global tables \u2014 a tenant's settings rows sync unfiltered, which
 * is an accepted minor gap since settings hold app configuration, not
 * customer/financial data. */
/** The product catalog. Until v29 it was one list shared by every tenant
 * (the cause of restaurants and shops seeing pharmacy medicines); now each
 * row belongs to one tenant. Rows with no tenant are quarantined/templates:
 * only the Super Admin pulls them, to review and hand them over. */
export const CATALOG_TABLES: string[] = ["categories", "sub_categories", "uoms", "products", "generic_names"];

export const TENANT_SCOPED_TABLES: string[] = [
  ...CATALOG_TABLES,
  "product_batches",
  "price_list",
  "customers",
  "suppliers",
  "staff",
  "salesmen",
  "banks",
  "bank_ledger_entries",
  "cash_register_entries",
  "invoices",
  "invoice_items",
  "orders",
  "order_items",
  "purchases",
  "purchase_items",
  "expense_categories",
  "expenses",
  "revenue_categories",
  "revenues",
  "salaries",
  "ledger_adjustments",
  "tasks",
  "attendance",
  "audits",
  "audit_items",
  "product_suppliers",
  "financial_closings",
  "purchase_drafts",
  "rest_categories",
  "rest_menu_items",
  "rest_tables",
  "rest_orders",
  "rest_order_items",
  "rest_kots",
  "rest_deals",
  "rest_offers",
  "rest_ingredients",
  "rest_recipe_lines",
  "rest_stock_moves",
  "rest_pra_submissions",
  "rest_audit",
  "es_categories",
  "es_products",
  "es_serials",
  "es_docs",
  "es_doc_items",
  "es_stock_moves",
  "es_payments",
  "es_warranty_claims",
  "es_audit",
];

// `delete_history` and `backups` are intentionally excluded: they're
// append-only local audit logs with no `updated_at` column (the pull side of
// the sync engine keys off `updated_at`, so including them here breaks the
// whole pass with a SQL error). Neither is written to the outbox today
// either, so they're local-only for now \u2014 worth revisiting if this app ever
// needs a shared audit trail across machines.
