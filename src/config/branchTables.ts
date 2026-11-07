/** Records that belong to one branch (schema v79 adds branch_id to each).
 * The SQL scope (server/tenantScope.ts) keeps reads and writes of these tables
 * inside the caller's active branch; everything else is shared by the whole
 * business (products, customers, suppliers, staff, patients, settings ...).
 * Stock kept as one number on a product (electronics, distribution, restaurant
 * ingredients) stays business-wide; batch stock (product_batches) is per branch. */
export const BRANCH_TABLES: ReadonlySet<string> = new Set([
  "product_batches",
  "product_batch_expiry_changes",
  "invoices",
  "invoice_items",
  "orders",
  "order_items",
  "purchases",
  "purchase_items",
  "purchase_drafts",
  "expenses",
  "revenues",
  "cash_register_entries",
  "bank_ledger_entries",
  "ledger_adjustments",
  "audits",
  "audit_items",
  "financial_closings",
  "mobile_imei_units",
  "rest_tables",
  "rest_orders",
  "rest_order_items",
  "rest_kots",
  "rest_pra_submissions",
  "es_docs",
  "es_doc_items",
  "es_payments",
  "es_warranty_claims",
  "clinic_appointments",
  "clinic_consultations",
  "clinic_prescriptions",
  "clinic_orders",
  "lab_visits",
  "hospital_lab_requests",
  "banquet_halls",
  "banquet_bookings",
  "banquet_booking_items",
  "banquet_payments",
  "hospital_episodes",
  "hospital_charges",
  "hospital_payments",
  "hospital_lab_orders",
  "hospital_imaging_orders",
  "hospital_cash_closings",
  "hospital_vitals",
  "hospital_mar_entries",
  "hospital_surgery_bookings",
  "hospital_er_triage",
  "dist_docs",
  "dist_doc_items",
  "dist_payments",
  "dist_bookings",
  "dist_booking_items",
  "web_orders",
]);

/** Said by the server when a tab's branch is no longer open to the login (the tab then resets). */
export const BRANCH_UNAVAILABLE = "The branch selected in this tab is not available to your login. Choose a branch again.";
/** Where a tab keeps its branch (sessionStorage: per tab, gone when the tab closes). */
export const BRANCH_TAB_KEY = "mavin.branch";

/** The main branch's id: every business has one, made by migration v79 or on first use. */
export const mainBranchId = (tenantId: string) => `main-${tenantId}`;
