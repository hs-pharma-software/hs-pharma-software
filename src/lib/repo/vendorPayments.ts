/** Hospital Finance > Vendor Payments: purchases and service bills the
 * Purchase Cell forwarded, paid in part or in full by bank transfer, cash or
 * cheque (with the transaction id / cheque number and date). A payment raises
 * the purchase's / bill's paid amount, so the supplier's balance follows. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { currentActor, roleAllowed } from "./medicalRecord";
import { serviceBillsRepo } from "./vendors";
import { purchasesRepo } from "./purchases";
import { storePurchasesRepo } from "./hospitalStores";
import { localDate } from "../localDate";
import { FINANCE_ROLES } from "../../config/hospitalStaff";

export type VendorDocType = "purchase" | "service_bill" | "store_purchase";
export type VendorPayMethod = "bank" | "cash" | "cheque";
export const VENDOR_PAY_METHODS: Record<VendorPayMethod, string> = { bank: "Bank transfer", cash: "Cash", cheque: "Cheque" };

export interface VendorPayment extends TenantRow {
  doc_type: VendorDocType; doc_id: string; vendor_id: string | null; amount: number; method: VendorPayMethod;
  reference: string | null; dated: string; notes: string | null; paid_by_name: string | null;
}
export const vendorPaymentsRepo = createTenantRepo<VendorPayment>("hospital_vendor_payments");

const round = (n: number) => Math.round(n * 100) / 100;

export interface PayableDoc {
  docType: VendorDocType; docId: string; no: string; date: string; vendorId: string | null; vendorName: string; vendorNo: string | null;
  bankTitle: string | null; bankName: string | null; iban: string | null; detail: string | null; total: number; paid: number; balance: number;
}

/** Purchases and service bills with something left to pay, oldest first. */
export async function pendingVendorBills(search = ""): Promise<PayableDoc[]> {
  const T = requireCurrentTenantId();
  const [purchases, bills, stores] = await Promise.all([
    dbSelect<Record<string, unknown>>(
      `SELECT pu.id, pu.purchase_no, pu.date, pu.supplier_id, pu.supplier_invoice_no, pu.payable, pu.paid_amount, pu.balance,
              s.name AS vendor_name, s.vendor_no, s.bank_title, s.bank_name, s.iban
       FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id
       WHERE pu.tenant_id = ? AND pu.deleted_at IS NULL AND COALESCE(pu.is_return, 0) = 0 AND COALESCE(pu.balance, 0) > 0.004`, [T]),
    dbSelect<Record<string, unknown>>(
      `SELECT b.id, b.bill_no, b.date, b.vendor_id, b.vendor_invoice_no, b.service_type, b.total, b.paid, b.balance,
              s.name AS vendor_name, s.vendor_no, s.bank_title, s.bank_name, s.iban
       FROM hospital_service_bills b LEFT JOIN suppliers s ON s.id = b.vendor_id
       WHERE b.tenant_id = ? AND b.deleted_at IS NULL AND b.balance > 0.004`, [T]).catch(() => []),
    // Store purchases come to Finance once the store keepers verified every item.
    dbSelect<Record<string, unknown>>(
      `SELECT p.id, p.purchase_no, p.date, p.vendor_id, p.vendor_invoice_no, p.total, p.paid, p.balance,
              s.name AS vendor_name, s.vendor_no, s.bank_title, s.bank_name, s.iban,
              (SELECT GROUP_CONCAT(i.entry_no, ', ') FROM hospital_store_purchase_items i WHERE i.purchase_id = p.id AND i.tenant_id = p.tenant_id AND i.deleted_at IS NULL AND i.entry_no IS NOT NULL) AS entries
       FROM hospital_store_purchases p LEFT JOIN suppliers s ON s.id = p.vendor_id
       WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.status = 'verified' AND p.balance > 0.004`, [T]).catch(() => []),
  ]);
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  const rows: PayableDoc[] = [
    ...purchases.map((p) => ({
      docType: "purchase" as const, docId: String(p.id), no: `Purchase #${p.purchase_no ?? ""}`, date: String(p.date).slice(0, 10), vendorId: str(p.supplier_id),
      vendorName: str(p.vendor_name) ?? "No supplier", vendorNo: str(p.vendor_no), bankTitle: str(p.bank_title), bankName: str(p.bank_name), iban: str(p.iban),
      detail: p.supplier_invoice_no ? `Supplier invoice ${p.supplier_invoice_no}` : null,
      total: Number(p.payable) || 0, paid: Number(p.paid_amount) || 0, balance: Number(p.balance) || 0,
    })),
    ...bills.map((b) => ({
      docType: "service_bill" as const, docId: String(b.id), no: String(b.bill_no), date: String(b.date).slice(0, 10), vendorId: str(b.vendor_id),
      vendorName: str(b.vendor_name) ?? "Vendor", vendorNo: str(b.vendor_no), bankTitle: str(b.bank_title), bankName: str(b.bank_name), iban: str(b.iban),
      detail: [b.service_type, b.vendor_invoice_no && `Invoice ${b.vendor_invoice_no}`].filter(Boolean).join(" · ") || null,
      total: Number(b.total) || 0, paid: Number(b.paid) || 0, balance: Number(b.balance) || 0,
    })),
  ];
  for (const b of stores) {
    rows.push({
      docType: "store_purchase", docId: String(b.id), no: `Store purchase ${b.purchase_no}`, date: String(b.date).slice(0, 10), vendorId: str(b.vendor_id),
      vendorName: str(b.vendor_name) ?? "Vendor", vendorNo: str(b.vendor_no), bankTitle: str(b.bank_title), bankName: str(b.bank_name), iban: str(b.iban),
      detail: [b.vendor_invoice_no && `Invoice ${b.vendor_invoice_no}`, b.entries && `Stock entries ${b.entries}`].filter(Boolean).join(" · ") || null,
      total: Number(b.total) || 0, paid: Number(b.paid) || 0, balance: Number(b.balance) || 0,
    });
  }
  const q = search.trim().toLowerCase();
  return rows.filter((r) => !q || `${r.no} ${r.vendorName} ${r.vendorNo ?? ""} ${r.detail ?? ""}`.toLowerCase().includes(q)).sort((a, b) => a.date.localeCompare(b.date));
}

/** Pays a purchase or service bill, in part or in full. */
export async function payVendorBill(x: { docType: VendorDocType; docId: string; amount?: number | null; full?: boolean; method: VendorPayMethod; reference?: string | null; dated?: string | null; notes?: string | null }): Promise<VendorPayment> {
  const a = await currentActor();
  if (!roleAllowed(FINANCE_ROLES, a)) throw new Error("Vendor payments are made by Finance (the accountant or an administrator).");
  if (!VENDOR_PAY_METHODS[x.method]) throw new Error("Choose bank transfer, cash or cheque.");
  const reference = x.reference?.trim() || null;
  if (x.method !== "cash" && !reference) throw new Error(x.method === "cheque" ? "Enter the cheque number." : "Enter the transaction ID.");
  const dated = x.dated || localDate();
  let balance: number, vendorId: string | null;
  if (x.docType === "purchase") {
    const p = await purchasesRepo.get(x.docId);
    if (!p || p.is_return) throw new Error("Purchase not found.");
    balance = Number(p.balance) || 0; vendorId = p.supplier_id ?? null;
  } else if (x.docType === "store_purchase") {
    const b = await storePurchasesRepo.get(x.docId);
    if (!b || b.status !== "verified") throw new Error("This store purchase is not verified by the store yet.");
    balance = Number(b.balance) || 0; vendorId = b.vendor_id;
  } else {
    const b = await serviceBillsRepo.get(x.docId);
    if (!b) throw new Error("Service bill not found.");
    balance = Number(b.balance) || 0; vendorId = b.vendor_id;
  }
  if (!(balance > 0)) throw new Error("This bill is already paid.");
  const amount = round(x.full ? balance : Number(x.amount));
  if (!(amount > 0)) throw new Error("Enter the amount paid.");
  if (amount > balance + 0.004) throw new Error(`Only Rs ${balance.toLocaleString("en-PK")} is left to pay on this bill.`);
  const left = round(balance - amount);
  if (x.docType === "purchase") {
    const p = (await purchasesRepo.get(x.docId))!;
    await purchasesRepo.update(x.docId, { paid_amount: round((Number(p.paid_amount) || 0) + amount), balance: left });
  } else if (x.docType === "store_purchase") {
    const b = (await storePurchasesRepo.get(x.docId))!;
    await storePurchasesRepo.update(x.docId, { paid: round((Number(b.paid) || 0) + amount), balance: left });
  } else {
    const b = (await serviceBillsRepo.get(x.docId))!;
    await serviceBillsRepo.update(x.docId, { paid: round((Number(b.paid) || 0) + amount), balance: left });
  }
  return vendorPaymentsRepo.create({
    doc_type: x.docType, doc_id: x.docId, vendor_id: vendorId, amount, method: x.method, reference, dated, notes: x.notes?.trim() || null,
    paid_by_name: a.designation ? `${a.name}, ${a.designation}` : a.name,
  });
}

export interface VendorPaymentRow extends VendorPayment { vendor_name: string | null; vendor_no: string | null }

/** The latest vendor payments. */
export async function recentVendorPayments(limit = 20): Promise<VendorPaymentRow[]> {
  return dbSelect<VendorPaymentRow>(
    `SELECT v.*, s.name AS vendor_name, s.vendor_no FROM hospital_vendor_payments v LEFT JOIN suppliers s ON s.id = v.vendor_id
     WHERE v.tenant_id = ? AND v.deleted_at IS NULL ORDER BY v.created_at DESC LIMIT ?`, [requireCurrentTenantId(), limit]
  ).catch(() => []);
}

/** Finance dashboard: bills waiting, what is owed, and what was paid in the period. */
export async function vendorPaymentSummary(range: { from: string; to: string }): Promise<{ pending: number; pendingTotal: number; paidTotal: number; paidCount: number }> {
  const [pending, paid] = await Promise.all([
    pendingVendorBills().catch(() => []),
    dbSelect<{ n: number; total: number | null }>(
      `SELECT COUNT(*) AS n, SUM(amount) AS total FROM hospital_vendor_payments WHERE tenant_id = ? AND deleted_at IS NULL AND dated BETWEEN ? AND ?`,
      [requireCurrentTenantId(), range.from, range.to]
    ).catch(() => [] as { n: number; total: number | null }[]),
  ]);
  return {
    pending: pending.length, pendingTotal: round(pending.reduce((x, p) => x + p.balance, 0)),
    paidTotal: round(Number(paid[0]?.total) || 0), paidCount: Number(paid[0]?.n) || 0,
  };
}
