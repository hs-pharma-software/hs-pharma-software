import type { BaseRow, TenantRow } from "./repo/base";

export interface Salesman extends TenantRow {
  name: string;
  phone: string | null;
}

export interface Bank extends TenantRow {
  name: string;
  account_no: string | null;
  account_title: string | null;
  address: string | null;
  phone: string | null;
  opening_balance: number;
}

export interface BankLedgerEntry extends TenantRow {
  bank_id: string;
  date: string;
  transaction_type: string;
  slip_no: string | null;
  amount: number;
  description: string | null;
}

export interface CashRegisterEntry extends TenantRow {
  date: string;
  transaction_type: string;
  amount: number;
  description: string | null;
}

export interface ExpenseCategory extends TenantRow {
  name: string;
  description: string | null;
}

export interface Expense extends TenantRow {
  date: string;
  category_id: string | null;
  expense_by: string | null;
  amount: number;
  payment_method: string | null;
  description: string | null;
}

export interface RevenueCategory extends TenantRow {
  name: string;
  description: string | null;
}

export interface Revenue extends TenantRow {
  date: string;
  category_id: string | null;
  revenue_by: string | null;
  amount: number;
  payment_method: string | null;
  description: string | null;
}

export interface Salary extends TenantRow {
  date: string;
  salary_month: string | null;
  salary_year: number | null;
  staff_id: string;
  basic_pay: number;
  payment_method: string | null;
  incentive: number;
  deduction: number;
  tax_rs: number;
  payable_salary: number;
  paid_salary: number;
  balance_salary: number;
}

export type PartyType = "customer" | "supplier" | "staff";

export interface LedgerAdjustment extends TenantRow {
  party_type: PartyType;
  party_id: string;
  date: string;
  invoice_no: string | null;
  balance_type: string;
  payment_method: string | null;
  paid_amount: number;
  comment: string | null;
  sms_sent: number;
}

export interface TaskItem extends TenantRow {
  assign_date: string;
  task_name: string;
  assign_by: string | null;
  assign_to: string | null;
  status: string;
  finished_date: string | null;
  description: string | null;
}

export interface Attendance extends TenantRow {
  staff_id: string;
  date: string;
  time_in: string | null;
  time_out: string | null;
  hours: number;
}

export interface OrderRow extends TenantRow {
  order_no: number | null;
  date: string;
  supplier_id: string;
  order_type: string | null;
  estimated_price: number;
  advance_payment: number;
  payment_method: string | null;
  bank_id: string | null;
  description: string | null;
}

export interface OrderItem extends TenantRow {
  order_id: string;
  product_id: string;
  packing: number;
  uom_id: string | null;
  purchase_price: number;
  qty: number;
  avail_qty: number | null;
  max_stock_qty: number | null;
}

export interface Purchase extends TenantRow {
  purchase_no: number | null;
  date: string;
  order_id: string | null;
  supplier_id: string;
  supplier_invoice_no: string | null;
  discount_rs: number;
  discount_pct: number;
  tax: number;
  payable: number;
  paid_amount: number;
  balance: number;
  description: string | null;
  payment_method: string | null;
  bank_id: string | null;
  slip_no: string | null;
  advance_payment: number;
  is_return: number;
  /** For a return purchase (is_return=1): the original purchase it's
   * returning items to the supplier from. Null for ordinary purchases. */
  original_purchase_id: string | null;
}

export interface PurchaseItem extends TenantRow {
  purchase_id: string;
  product_id: string;
  location: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  uom_id: string | null;
  purchase_price: number;
  booked_qty: number;
  received_qty: number;
  avail_qty: number | null;
  amount: number;
  st_pct: number;
  wht_pct: number;
  total: number;
}

export interface Invoice extends TenantRow {
  invoice_no: number | null;
  date: string;
  inv_on: string;
  invoice_type: string;
  description: string | null;
  salesman_id: string | null;
  customer_id: string | null;
  total: number;
  charges: number;
  discount_pct: number;
  discount_rs: number;
  tax_pct: number;
  payable: number;
  paid: number;
  balance: number;
  is_return: number;
  is_memorized: number;
  converted_invoice_id: string | null;
  /** For a return invoice (is_return=1): the original sale it's returning
   * items from. Null for ordinary invoices. */
  original_invoice_id: string | null;
  /** Quotation, not a real sale: excluded from every invoice/sales/profit
   * query and doesn't touch stock until accepted. */
  is_quotation: number;
  quotation_no: number | null;
  fbr_invoice_no: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  buyer_ntn_cnic: string | null;
  buyer_province: string | null;
  buyer_address: string | null;
  buyer_registration_type: string | null;
}

export interface InvoiceItem extends TenantRow {
  invoice_id: string;
  product_id: string;
  batch_no: string | null;
  packing: number;
  uom_id: string | null;
  avail_qty: number | null;
  qty: number;
  bonus_qty: number;
  purchase_price: number;
  sale_price: number;
  tax_pct: number;
  further_tax_pct: number;
  tax_rs: number;
  discount_pct: number;
  discount_rs: number;
  total: number;
}

export interface AuditRow extends TenantRow {
  date: string;
  audit_name: string | null;
  description: string | null;
}

export interface AuditItem extends TenantRow {
  audit_id: string;
  product_id: string;
  counted_qty: number;
}

export interface FinancialClosing extends TenantRow {
  date: string;
  closed_at: string;
  batch_action: string;
  description: string | null;
}

// ===== Multi-tenant: Super Admin, tenants, subscriptions ================
// These three are global/system tables, not owned by any tenant themselves
// (a `tenants` row IS a tenant; `users.tenant_id` is nullable for the Super
// Admin) \u2014 so they extend plain `BaseRow`, not `TenantRow`.

export type SubscriptionStatus = "active" | "suspended" | "expired";
export type UserRole = "super_admin" | "owner" | "staff";

export interface SubscriptionPlan extends BaseRow {
  name: string;
  description: string | null;
  price: number;
  duration_days: number;
  /** JSON-encoded array of nav module keys (see src/config/nav.ts) \u2014 parse
   * with `JSON.parse` before use, see src/lib/repo/subscriptionPlans.ts. */
  allowed_modules: string;
  max_staff_logins: number;
  max_invoices_per_month: number | null;
}

export interface Tenant extends BaseRow {
  name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  subscription_plan_id: string | null;
  subscription_status: SubscriptionStatus;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  is_active: number;
  mrp_discount_pct: number;
  /** Set by the Super Admin (Users > tenant detail). */
  business_type?: string | null;
  /** JSON array of module keys; NULL = the plan's allowed modules. */
  allowed_modules?: string | null;
  /** JSON array of action keys denied to every login of this tenant. */
  denied_actions?: string | null;
  fbr_allowed?: number;
  print_templates_editable?: number;
}

export interface UserAccount extends BaseRow {
  tenant_id: string | null;
  username: string;
  password_hash: string;
  password_salt: string;
  role: UserRole;
  display_name: string | null;
  is_active: number;
  /** JSON array of allowed module keys. NULL = full access (owner default).
   * A non-null array restricts the staff user to only those modules. */
  permissions: string | null;
  /** JSON array of denied action keys (lib/actionPermissions). NULL = none. */
  denied_actions: string | null;
}
