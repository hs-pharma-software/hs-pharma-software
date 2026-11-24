/** Hospital Purchase Cell: Supplier & Vendors (each with its own vendor
 * number and bank details), bills for services bought from vendors (tenting,
 * catering, welding, repairs, buildings...) and their types, and the Purchase
 * Cell dashboard's alerts. Purchases and service bills go to Finance for
 * payment (repo/vendorPayments.ts). */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { suppliersRepo } from "./suppliers";
import { localDate } from "../localDate";
import { useAuthStore } from "../../store/authStore";
import type { Supplier } from "../types";

const round = (n: number) => Math.round(n * 100) / 100;

// ── Supplier & Vendors ────────────────────────────────────────────────────

/** The next vendor number: V-0001, V-0002 ... (never reused). */
export async function nextVendorNo(): Promise<string> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(CAST(substr(vendor_no, 3) AS INTEGER)) AS n FROM suppliers WHERE tenant_id = ? AND vendor_no GLOB 'V-[0-9]*'`, [requireCurrentTenantId()]
  );
  return `V-${String((Number(rows[0]?.n) || 0) + 1).padStart(4, "0")}`;
}

/** A Pakistani IBAN: PK, 2 check digits, 4-letter bank code, 16 digits (24 characters). */
export function validIban(iban: string): boolean {
  return /^PK\d{2}[A-Z]{4}\d{16}$/.test(iban.replace(/\s+/g, "").toUpperCase());
}

export type VendorInput = Partial<Pick<Supplier, "name" | "company_name" | "email" | "cnic" | "phone" | "address" | "discount_pct" | "opening_balance" | "description" | "party_kind" | "proprietor" | "bank_name" | "bank_title" | "iban">>;

/** Adds or edits a supplier / vendor; a new one gets the next vendor number. */
export async function saveVendor(id: string | null, x: VendorInput): Promise<Supplier> {
  const name = x.name?.trim();
  if (!name) throw new Error("Enter the supplier's or vendor's name.");
  const iban = x.iban?.replace(/\s+/g, "").toUpperCase() || null;
  if (iban && !validIban(iban)) throw new Error("The IBAN is 24 characters: PK, 2 digits, the bank's 4 letters and 16 digits (e.g. PK36SCBL0000001123456702).");
  const cnic = x.cnic?.trim() || null;
  if (cnic && !/^\d{5}-?\d{7}-?\d$/.test(cnic)) throw new Error("Enter the CNIC as 13 digits (e.g. 35202-1234567-1).");
  const data: Partial<Supplier> = {
    name, company_name: x.company_name?.trim() || null, email: x.email?.trim() || null, cnic, phone: x.phone?.trim() || null,
    address: x.address?.trim() || null, discount_pct: Number(x.discount_pct) || 0, opening_balance: Number(x.opening_balance) || 0,
    balance_type: "payable", description: x.description?.trim() || null, party_kind: x.party_kind ?? "supplier",
    proprietor: x.proprietor?.trim() || null, bank_name: x.bank_name?.trim() || null, bank_title: x.bank_title?.trim() || null, iban,
  };
  if (id) {
    const old = await suppliersRepo.get(id);
    if (!old) throw new Error("Supplier not found.");
    return (await suppliersRepo.update(id, { ...data, ...(old.vendor_no ? {} : { vendor_no: await nextVendorNo() }) }))!;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await suppliersRepo.create({ ...data, vendor_no: await nextVendorNo() });
    } catch (e) {
      if (attempt >= 3 || !/vendor no|vendor_no/i.test(String(e instanceof Error ? e.message : e))) throw e;
    }
  }
}

export interface VendorRow extends Supplier {
  purchase_balance: number;
  service_balance: number;
  paid_on_account: number;
  balance: number;
}

/** Suppliers and vendors with what is owed to each: opening balance, unpaid purchases (less returns) and service bills, less payments on account. */
export async function listVendors(search = "", kind: "" | "supplier" | "vendor" = ""): Promise<VendorRow[]> {
  const T = requireCurrentTenantId();
  const q = search.trim();
  const rows = await dbSelect<VendorRow>(
    `SELECT s.*,
       COALESCE((SELECT SUM(CASE WHEN is_return = 0 THEN balance ELSE -balance END) FROM purchases WHERE supplier_id = s.id AND tenant_id = ? AND deleted_at IS NULL), 0) AS purchase_balance,
       COALESCE((SELECT SUM(balance) FROM hospital_service_bills WHERE vendor_id = s.id AND tenant_id = ? AND deleted_at IS NULL), 0)
         + COALESCE((SELECT SUM(balance) FROM hospital_store_purchases WHERE vendor_id = s.id AND tenant_id = ? AND deleted_at IS NULL AND status = 'verified'), 0) AS service_balance,
       COALESCE((SELECT SUM(paid_amount) FROM ledger_adjustments WHERE tenant_id = ? AND party_type = 'supplier' AND party_id = s.id AND deleted_at IS NULL), 0) AS paid_on_account
     FROM suppliers s
     WHERE s.tenant_id = ? AND s.deleted_at IS NULL
       ${q ? "AND (s.name LIKE ? OR s.company_name LIKE ? OR s.vendor_no LIKE ? OR s.phone LIKE ?)" : ""}
       ${kind === "vendor" ? "AND COALESCE(s.party_kind, 'supplier') IN ('vendor', 'both')" : kind === "supplier" ? "AND COALESCE(s.party_kind, 'supplier') IN ('supplier', 'both')" : ""}
     ORDER BY s.name COLLATE NOCASE`,
    [T, T, T, T, T, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [])]
  );
  return rows.map((r) => ({ ...r, balance: round(Number(r.opening_balance) + Number(r.purchase_balance) + Number(r.service_balance) - Number(r.paid_on_account)) }));
}

/** A supplier's bank details as one line, for a purchase or a payment. */
export function bankLine(s: Pick<Supplier, "bank_name" | "bank_title" | "iban"> | null | undefined): string | null {
  if (!s || (!s.iban && !s.bank_title && !s.bank_name)) return null;
  return [s.bank_title && `Title: ${s.bank_title}`, s.bank_name, s.iban && `IBAN ${s.iban}`].filter(Boolean).join(" · ");
}

// ── Service types and bills ───────────────────────────────────────────────

export interface ServiceType extends TenantRow { name: string }
export const serviceTypesRepo = createTenantRepo<ServiceType>("hospital_service_types");

export const DEFAULT_SERVICE_TYPES = ["Tenting", "Catering", "Welding", "Repairing", "Building / civil work", "Electrical", "Plumbing", "Cleaning", "Security", "Transport"];

export async function listServiceTypes(): Promise<ServiceType[]> {
  return serviceTypesRepo.list({ orderBy: "name COLLATE NOCASE ASC" });
}

export async function addServiceType(name: string): Promise<ServiceType> {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new Error("Enter the service type.");
  const same = (await serviceTypesRepo.list({ where: "LOWER(name) = LOWER(?)", params: [n] }))[0];
  return same ?? serviceTypesRepo.create({ name: n });
}

export async function removeServiceType(id: string): Promise<void> {
  await serviceTypesRepo.remove(id);
}

export interface ServiceBill extends TenantRow {
  bill_no: string;
  vendor_id: string;
  vendor_invoice_no: string | null;
  service_type: string | null;
  description: string | null;
  date: string;
  amount: number;
  tax: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  created_by_name: string | null;
}
export const serviceBillsRepo = createTenantRepo<ServiceBill>("hospital_service_bills", { refs: [["vendor_id", "suppliers", "Vendor"]] });

async function nextBillNo(): Promise<string> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(CAST(substr(bill_no, 4) AS INTEGER)) AS n FROM hospital_service_bills WHERE tenant_id = ? AND bill_no GLOB 'SB-[0-9]*'`, [requireCurrentTenantId()]
  );
  return `SB-${String((Number(rows[0]?.n) || 0) + 1).padStart(4, "0")}`;
}

/** Records a vendor's bill for a service: total = amount + tax - discount; it waits in Finance for payment. */
export async function createServiceBill(x: { vendorId: string; vendorInvoiceNo?: string | null; serviceType?: string | null; description?: string | null; date?: string; amount: number; tax?: number; discount?: number }): Promise<ServiceBill> {
  if (!x.vendorId) throw new Error("Choose the vendor.");
  const vendor = await suppliersRepo.get(x.vendorId);
  if (!vendor) throw new Error("Vendor not found.");
  const amount = round(Number(x.amount));
  const tax = round(Number(x.tax ?? 0));
  const discount = round(Number(x.discount ?? 0));
  if (!(amount > 0)) throw new Error("Enter the bill amount.");
  if (tax < 0 || discount < 0) throw new Error("Tax and discount cannot be negative.");
  const total = round(amount + tax - discount);
  if (total < 0) throw new Error("The discount is more than the bill.");
  const who = useAuthStore.getState().currentUser;
  return serviceBillsRepo.create({
    bill_no: await nextBillNo(), vendor_id: x.vendorId, vendor_invoice_no: x.vendorInvoiceNo?.trim() || null, service_type: x.serviceType?.trim() || null,
    description: x.description?.trim() || null, date: x.date || localDate(), amount, tax, discount, total, paid: 0, balance: total,
    created_by_name: who?.displayName || who?.username || null,
  });
}

/** A service bill nothing has been paid on can be deleted. */
export async function deleteServiceBill(id: string): Promise<void> {
  const b = await serviceBillsRepo.get(id);
  if (!b) throw new Error("Bill not found.");
  if (Number(b.paid) > 0) throw new Error("Payments were made on this bill; it can't be deleted.");
  await serviceBillsRepo.remove(id);
}

export interface ServiceBillRow extends ServiceBill { vendor_name: string; vendor_no: string | null }

export async function listServiceBills(f: { from?: string; to?: string; vendorId?: string; status?: "" | "unpaid" | "paid" } = {}): Promise<ServiceBillRow[]> {
  const T = requireCurrentTenantId();
  const where = ["b.tenant_id = ?", "b.deleted_at IS NULL"];
  const params: unknown[] = [T];
  if (f.from) { where.push("b.date >= ?"); params.push(f.from); }
  if (f.to) { where.push("b.date <= ?"); params.push(f.to); }
  if (f.vendorId) { where.push("b.vendor_id = ?"); params.push(f.vendorId); }
  if (f.status === "unpaid") where.push("b.balance > 0");
  if (f.status === "paid") where.push("b.balance <= 0");
  return dbSelect<ServiceBillRow>(
    `SELECT b.*, s.name AS vendor_name, s.vendor_no FROM hospital_service_bills b LEFT JOIN suppliers s ON s.id = b.vendor_id
     WHERE ${where.join(" AND ")} ORDER BY b.date DESC, b.bill_no DESC LIMIT 500`,
    params
  );
}

// ── Purchase Cell dashboard ───────────────────────────────────────────────

export interface PendingSupply { supplier_id: string | null; supplier_name: string; orders: number; estimated: number; oldest: string }

/** Purchase orders the supplier has not delivered yet (no purchase made from them), by supplier. */
export async function pendingSupply(): Promise<PendingSupply[]> {
  const T = requireCurrentTenantId();
  return dbSelect<PendingSupply>(
    `SELECT o.supplier_id, COALESCE(s.name, 'No supplier') AS supplier_name, COUNT(*) AS orders, COALESCE(SUM(o.estimated_price), 0) AS estimated, MIN(o.date) AS oldest
     FROM orders o LEFT JOIN suppliers s ON s.id = o.supplier_id
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM purchases pu WHERE pu.order_id = o.id AND pu.tenant_id = ? AND pu.deleted_at IS NULL)
     GROUP BY o.supplier_id ORDER BY oldest ASC`,
    [T, T]
  ).catch(() => []);
}
