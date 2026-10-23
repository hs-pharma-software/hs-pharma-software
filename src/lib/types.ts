import type { BaseRow, TenantRow } from "./repo/base";

export interface Category extends TenantRow {
  name: string;
  flat_discount_pct: number;
  description: string | null;
  image_url: string | null;
  /** 'pharma' | 'general_store' \u2014 row is part of the shared catalog visible
   * to multiple tenants; NULL = tenant-private or quarantined. */
  catalog_group: string | null;
}

export interface SubCategory extends TenantRow {
  category_id: string;
  name: string;
  flat_discount_pct: number;
  /** New products in this sub category auto-fill their Secondary Unit from
   * here (e.g. "Tablets" sub category -> Tab) \u2014 see lib/uom.ts. */
  default_secondary_unit_id: string | null;
  description: string | null;
  image_url: string | null;
  /** 'pharma' | 'general_store' \u2014 shared catalog; NULL = tenant-private. */
  catalog_group: string | null;
}

export interface Uom extends TenantRow {
  name: string;
  description: string | null;
}

export interface Product extends TenantRow {
  barcode: string | null;
  name: string;
  company_name: string | null;
  description: string | null;
  category_id: string | null;
  sub_category_id: string | null;
  base_unit_id: string | null;
  secondary_unit_id: string | null;
  packing: number;
  tax_rate_pct: number;
  gst_rate_pct: number;
  apply_further_tax: number;
  max_stock_qty: number | null;
  stock_expiry_limit_days: number | null;
  location: string | null;
  sale_type: string | null;
  sro_no: string | null;
  sro_item_serial_no: string | null;
  pct_code: string | null;
  online_store_status: string | null;
  hs_code: string | null;
  fbr_sale_type: string | null;
  fbr_sale_rate: number;
  fbr_uom: string | null;
  is_narcotic: number;
  /** FBR quantity per base unit when FBR's UOM for the HS code is a weight or
   * volume (KG, Liter...): a 500 g pack in KG = 0.5. 1 for Packs / pieces. */
  fbr_qty_factor: number | null;
  drap_reg_no: string | null;
  /** JSON of DrapMeta (see lib/drap.ts). */
  drap_meta: string | null;
  /** 'pharma' | 'general_store' — product is part of the shared master
   * catalog (tenant_id = NULL); NULL = tenant-private product. */
  catalog_group: string | null;
  /** 'pharma' | 'general_store' — top-level product classification used by
   * pharmacy-type tenants to separate pharmaceutical items from general store
   * goods. NULL for non-pharmacy tenants' products. */
  product_classification: string | null;
}

export interface ProductBatch extends TenantRow {
  product_id: string;
  batch_no: string | null;
  expiry_date: string | null;
  qty: number;
  location: string | null;
  purchase_price: number;
}

export interface PriceListEntry extends TenantRow {
  product_id: string;
  batch_no: string | null;
  sale_price: number;
  wholesale_price: number;
  mrp: number;
  comment: string | null;
}

export type BalanceType = "receivable" | "payable";

export interface Customer extends TenantRow {
  name: string;
  email: string | null;
  phone: string | null;
  cnic_ntn: string | null;
  ntn: string | null;
  strn: string | null;
  registration_type: string | null;
  business_name: string | null;
  address: string | null;
  area: string | null;
  province: string | null;
  license_no: string | null;
  license_expiry: string | null;
  discount_pct: number;
  opening_balance: number;
  balance_type: BalanceType;
  credit_limit: number | null;
  income_tax_status: string | null;
  sales_tax_status: string | null;
  fbr_active_status: string | null;
  description: string | null;
}

export interface Supplier extends TenantRow {
  name: string;
  company_name: string | null;
  email: string | null;
  cnic: string | null;
  phone: string | null;
  address: string | null;
  discount_pct: number;
  opening_balance: number;
  balance_type: BalanceType;
  description: string | null;
}

export interface Staff extends TenantRow {
  name: string;
  designation: string | null;
  phone: string | null;
  cnic: string | null;
  address: string | null;
  opening_balance: number;
  balance_type: BalanceType;
  basic_pay: number;
  date_of_joining: string | null;
}
