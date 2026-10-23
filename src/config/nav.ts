import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FileText,
  FileCheck2,
  ClipboardList,
  ShoppingCart,
  Package,
  Boxes,
  Users,
  Truck,
  UserCog,
  Wallet,
  Landmark,
  Receipt,
  HandCoins,
  ListTodo,
  UserRound,
  BarChart3,
  Wrench,
  Settings,
  Zap,
  ShoppingBag,
  Warehouse,
  ContactRound,
  FileBarChart,
  Cog,
  UtensilsCrossed,
  ChefHat,
  BookOpen,
  Carrot,
  LineChart,
  SlidersHorizontal,
} from "lucide-react";

export interface NavChild {
  label: string;
  href: string;
  /** i18n key (lib/i18n/dict.ts) for translated menus. */
  labelKey?: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Vocabulary used by `subscription_plans.allowed_modules` \u2014 see
   * src/lib/moduleAccess.ts and src/components/layout/Sidebar.tsx. */
  moduleKey: string;
  children?: NavChild[];
  /** Only shown to these business types (config/businessTypes.ts ids). */
  onlyFor?: string[];
  /** i18n key (lib/i18n/dict.ts) for translated menus. */
  labelKey?: string;
}

export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, moduleKey: "dashboard", labelKey: "nav.dashboard" },
  {
    label: "Invoices",
    href: "/invoices",
    icon: FileText,
    moduleKey: "invoices",
    children: [
      { label: "Invoices Details", href: "/invoices" },
      { label: "Invoice Return Details", href: "/invoices/returns" },
      { label: "Sale Item Return", href: "/invoices/item-return" },
      { label: "Memorized Invoice Detail", href: "/invoices/memorized" },
    ],
  },
  { label: "Quotation", href: "/quotations", icon: FileCheck2, moduleKey: "quotation" },
  { label: "Order", href: "/orders", icon: ClipboardList, moduleKey: "order" },
  {
    label: "Purchase",
    href: "/purchases",
    icon: ShoppingCart,
    moduleKey: "purchase",
    children: [
      { label: "Purchase Details", href: "/purchases" },
      { label: "Purchase Return Details", href: "/purchases/returns" },
      { label: "Purchase Item Return", href: "/purchases/item-return" },
    ],
  },
  {
    label: "Products",
    href: "/products",
    icon: Package,
    moduleKey: "products",
    children: [
      { label: "Product Detail", href: "/products" },
      { label: "Price List", href: "/products/price-list" },
      { label: "UOM Details", href: "/products/uom" },
      { label: "Categories Details", href: "/products/categories" },
      { label: "Assign To Supplier", href: "/products/assign-supplier" },
      { label: "DRAP Import", href: "/products/drap-import" },
    ],
  },
  { label: "Stock", href: "/stock", icon: Boxes, moduleKey: "stock" },
  {
    label: "Customers",
    href: "/customers",
    icon: Users,
    moduleKey: "customers",
    children: [
      { label: "Customer Detail", href: "/customers" },
      { label: "Accounts Receivable", href: "/customers/receivable" },
      { label: "Outstanding", href: "/customers/outstanding" },
      { label: "Narcotics", href: "/customers/narcotics" },
    ],
  },
  {
    label: "Suppliers",
    href: "/suppliers",
    icon: Truck,
    moduleKey: "suppliers",
    children: [
      { label: "Supplier Details", href: "/suppliers" },
      { label: "Accounts Payable", href: "/suppliers/payable" },
      { label: "Outstanding", href: "/suppliers/outstanding" },
    ],
  },
  {
    label: "Staff",
    labelKey: "nav.staff",
    href: "/staff",
    icon: UserCog,
    moduleKey: "staff",
    children: [
      { label: "Staff Details", href: "/staff" },
      { label: "Employee Ledger", href: "/staff/ledger" },
      { label: "Attendance Detail", href: "/staff/attendance" },
    ],
  },
  { label: "Cash Register", href: "/cash-register", icon: Wallet, moduleKey: "cash_register", labelKey: "nav.cash" },
  {
    label: "Banks",
    labelKey: "nav.banks",
    href: "/banks",
    icon: Landmark,
    moduleKey: "banks",
    children: [
      { label: "Bank Details", href: "/banks" },
      { label: "Bank Statement", href: "/banks/statement" },
      { label: "Bank Summary", href: "/banks/summary" },
    ],
  },
  {
    label: "Expenses",
    labelKey: "nav.expenses",
    href: "/expenses",
    icon: Receipt,
    moduleKey: "expenses",
    children: [
      { label: "Expenses Details", href: "/expenses" },
      { label: "Expense Category Details", href: "/expenses/categories" },
      { label: "Salary Details", href: "/expenses/salary" },
    ],
  },
  {
    label: "Other Revenue",
    labelKey: "nav.otherRevenue",
    href: "/other-revenue",
    icon: HandCoins,
    moduleKey: "other_revenue",
    children: [
      { label: "Revenue Details", href: "/other-revenue" },
      { label: "Revenue Category Details", href: "/other-revenue/categories" },
    ],
  },
  { label: "Tasks", href: "/tasks", icon: ListTodo, moduleKey: "tasks" },
  { label: "Salesman", href: "/salesman", icon: UserRound, moduleKey: "salesman" },
  {
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    moduleKey: "reports",
    children: [
      { label: "Business Wise Profit/Loss", href: "/reports/business-profit-loss" },
      { label: "Product Wise Profit/Loss", href: "/reports/product-profit-loss" },
      { label: "Company Wise Profit/Loss", href: "/reports/company-profit-loss" },
      { label: "Category Wise Profit/Loss", href: "/reports/category-profit-loss" },
      { label: "Sub Category Wise Profit/Loss", href: "/reports/sub-category-profit-loss" },
      { label: "Customer Wise Profit/Loss", href: "/reports/customer-profit-loss" },
      { label: "Tax Reports", href: "/reports/tax" },
      { label: "Bonus Claim And Discount Report", href: "/reports/bonus-discount" },
      { label: "Product Wise Sales Report", href: "/reports/product-sales" },
      { label: "Category Wise Sales", href: "/reports/category-sales" },
      { label: "Trial Balance Report", href: "/reports/trial-balance" },
      { label: "Balance Sheet", href: "/reports/balance-sheet" },
    ],
  },
  {
    label: "Utilities",
    labelKey: "nav.utilities",
    href: "/utilities",
    icon: Wrench,
    moduleKey: "utilities",
    children: [
      { label: "Delete History", href: "/utilities/delete-history" },
      { label: "System Shortcuts", href: "/utilities/shortcuts" },
      { label: "Generate Barcode", href: "/utilities/barcode" },
      { label: "Financial Closing", href: "/utilities/financial-closing" },
      { label: "View Financial Closing", href: "/utilities/financial-closing/history" },
      { label: "Audit Detail", href: "/utilities/audit" },
    ],
  },
  // ── Electric / Electronics / Solar store (shown only to that type) ──
  {
    label: "Products",
    labelKey: "nav.products",
    href: "/electric/products",
    icon: Zap,
    moduleKey: "es_products",
    onlyFor: ["electronics_solar"],
    children: [
      { label: "Product List", labelKey: "nav.productList", href: "/electric/products" },
      { label: "Product Categories", labelKey: "nav.categories", href: "/electric/categories" },
    ],
  },
  {
    label: "Sales",
    labelKey: "nav.sales",
    href: "/electric/sales",
    icon: ShoppingBag,
    moduleKey: "es_sales",
    onlyFor: ["electronics_solar"],
    children: [
      { label: "New Sales Invoice", labelKey: "nav.newSale", href: "/electric/sales/new" },
      { label: "Sales Invoices", labelKey: "nav.salesList", href: "/electric/sales" },
      { label: "Quotations", labelKey: "nav.quotations", href: "/electric/quotations" },
      { label: "Returns", labelKey: "nav.returns", href: "/electric/returns" },
    ],
  },
  {
    label: "Purchases",
    labelKey: "nav.purchases",
    href: "/electric/purchases",
    icon: ShoppingCart,
    moduleKey: "es_purchases",
    onlyFor: ["electronics_solar"],
    children: [
      { label: "New Purchase", labelKey: "nav.newPurchase", href: "/electric/purchases/new" },
      { label: "Purchase Invoices", labelKey: "nav.purchaseList", href: "/electric/purchases" },
    ],
  },
  {
    label: "Inventory",
    labelKey: "nav.inventory",
    href: "/electric/stock",
    icon: Warehouse,
    moduleKey: "es_inventory",
    onlyFor: ["electronics_solar"],
    children: [
      { label: "Stock & Movements", labelKey: "nav.stock", href: "/electric/stock" },
      { label: "Serial Numbers & Warranty", labelKey: "nav.warranty", href: "/electric/warranty" },
    ],
  },
  { label: "Customers & Suppliers", labelKey: "nav.parties", href: "/electric/parties", icon: ContactRound, moduleKey: "es_parties", onlyFor: ["electronics_solar"] },
  { label: "Reports", labelKey: "nav.reports", href: "/electric/reports", icon: FileBarChart, moduleKey: "es_reports", onlyFor: ["electronics_solar"] },
  { label: "Store Settings", labelKey: "nav.settings", href: "/electric/settings", icon: Cog, moduleKey: "es_settings", onlyFor: ["electronics_solar"] },
  // ── Restaurant (shown only to Restaurant tenants) ──
  {
    label: "Restaurant POS",
    href: "/restaurant",
    icon: UtensilsCrossed,
    moduleKey: "restaurant_pos",
    onlyFor: ["restaurant"],
    children: [
      { label: "Tables & Orders", href: "/restaurant" },
      { label: "Invoices & Refunds", href: "/restaurant/orders" },
      { label: "Table Setup", href: "/restaurant/tables" },
    ],
  },
  { label: "Kitchen", href: "/restaurant/kitchen", icon: ChefHat, moduleKey: "restaurant_kitchen", onlyFor: ["restaurant"] },
  {
    label: "Menu",
    href: "/restaurant/menu",
    icon: BookOpen,
    moduleKey: "restaurant_menu",
    onlyFor: ["restaurant"],
    children: [
      { label: "Categories & Dishes", href: "/restaurant/menu" },
      { label: "Deals & Combos", href: "/restaurant/deals" },
      { label: "Offers & Promotions", href: "/restaurant/offers" },
    ],
  },
  { label: "Ingredients", href: "/restaurant/inventory", icon: Carrot, moduleKey: "restaurant_inventory", onlyFor: ["restaurant"] },
  {
    label: "Restaurant Reports",
    href: "/restaurant/reports",
    icon: LineChart,
    moduleKey: "restaurant_reports",
    onlyFor: ["restaurant"],
    children: [
      { label: "Sales Reports", href: "/restaurant/reports" },
      { label: "Audit Log", href: "/restaurant/audit" },
    ],
  },
  {
    label: "Restaurant Settings",
    href: "/restaurant/settings",
    icon: SlidersHorizontal,
    moduleKey: "restaurant_settings",
    onlyFor: ["restaurant"],
    children: [
      { label: "Billing & Tax", href: "/restaurant/settings" },
      { label: "PRA e-Invoicing", href: "/restaurant/pra" },
    ],
  },
  {
    label: "Settings",
    labelKey: "nav.appSettings",
    href: "/settings",
    icon: Settings,
    moduleKey: "settings",
    children: [
      { label: "General Settings", href: "/settings" },
      { label: "My Online Store", href: "/settings/online-store" },
      { label: "Backup", href: "/settings/backup" },
      { label: "Restore", href: "/settings/restore" },
      { label: "User Logins", href: "/settings/logins" },
    ],
  },
];

export const ALL_MODULE_KEYS = NAV.map((item) => item.moduleKey);
