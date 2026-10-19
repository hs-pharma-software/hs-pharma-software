/** Every table that participates in local <-> Turso sync, in an order safe
 * for foreign keys on first push (parents before children). Keep this in
 * sync with the schema in `src-tauri/src/lib.rs` and `db/schema.sql`. */
export const SYNCABLE_TABLES = [
  // Global/shared — every tenant (and the Super Admin) sees the same rows,
  // so these always sync fully, unfiltered by tenant.
  "categories",
  "sub_categories",
  "uoms",
  "products",
  "subscription_plans",
  "tenants",
  "users",
  // Tenant-scoped — see TENANT_SCOPED_TABLES below; the sync engine adds a
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
] as const;

/** Tables private to one pharmacy tenant — `pullChanges()` in
 * `src/lib/sync/engine.ts` adds `AND tenant_id = ?` for these, and skips
 * them entirely for the Super Admin (who has no tenant, and no business
 * seeing any tenant's private data). `settings` is deliberately NOT here:
 * it has no `tenant_id` column (scoped instead by prefixing the key — see
 * `src/lib/repo/settings.ts`), so it stays in the "pull everything" bucket
 * like the global tables — a tenant's settings rows sync unfiltered, which
 * is an accepted minor gap since settings hold app configuration, not
 * customer/financial data. */
export const TENANT_SCOPED_TABLES: string[] = [
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
];

// `delete_history` and `backups` are intentionally excluded: they're
// append-only local audit logs with no `updated_at` column (the pull side of
// the sync engine keys off `updated_at`, so including them here breaks the
// whole pass with a SQL error). Neither is written to the outbox today
// either, so they're local-only for now — worth revisiting if this app ever
// needs a shared audit trail across machines.
