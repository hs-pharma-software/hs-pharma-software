/**
 * PRA (Punjab Revenue Authority) e-IMS invoice model and response mapping.
 *
 * Source: "Technical Specification for Data Sharing through Software Fiscal
 * Device with PRA", Version 1.2, PRAL (issued 08-Nov-2019, with later
 * sections covering IRIS from Sep 2024 and TLS 1.2 guidance), downloaded
 * 2026-10-23 from
 * https://reg.pra.punjab.gov.pk//NewsDirectory/UserGuide/Technical%20Specification%20Software%20Fiscal%20Device%201.2-PRA.pdf
 *
 * Pure functions, relative imports only (runs under `node --test`).
 */

import { toRupees } from "./engine.ts";

/** Section 7: InvoiceType. 1 = New, 2 = Debit, 3 = Credit (return / cancel). */
export type PraInvoiceType = 1 | 2 | 3;

/** Section 7: PaymentMode. */
export const PRA_PAYMENT_MODE = { cash: 1, card: 2, giftVoucher: 3, loyaltyCard: 4, mixed: 5, cheque: 6 } as const;

export interface PraItem {
  ItemCode: string; // varchar(50)
  ItemName: string; // varchar(150)
  PCTCode: string; // varchar(8): classification code from the PST 2nd Schedule
  Quantity: number;
  TaxRate: number;
  SaleValue: number; // value tax is charged on (after discount, before tax)
  Discount: number;
  FurtherTax: number;
  TaxCharged: number;
  TotalAmount: number; // SaleValue + TaxCharged + FurtherTax
  InvoiceType: PraInvoiceType;
  RefUSIN: string | null;
}

export interface PraInvoice {
  InvoiceNumber: string; // blank on request
  POSID: number; // bigint
  USIN: string; // varchar(50), business's own invoice number
  DateTime: string; // "YYYY-MM-DD HH:mm:ss"
  BuyerName?: string;
  BuyerPNTN?: string;
  BuyerCNIC?: string;
  BuyerPhoneNumber?: string;
  TotalBillAmount: number;
  TotalQuantity: number;
  TotalSaleValue: number;
  TotalTaxCharged: number;
  Discount: number;
  FurtherTax: number;
  PaymentMode: number;
  RefUSIN: string | null;
  InvoiceType: PraInvoiceType;
  Items: PraItem[];
}

/** One billed line, already priced by the engine (all amounts in paisa). */
export interface PraSourceLine {
  code: string;
  name: string;
  qty: number;
  grossPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  taxRate: number;
}

export interface PraSource {
  posId: string;
  usin: string;
  refUsin: string | null;
  invoiceType: PraInvoiceType;
  at: Date;
  pctCode: string;
  methods: string[];
  buyerName?: string | null;
  buyerPhone?: string | null;
  lines: PraSourceLine[];
}

const pad = (n: number) => String(n).padStart(2, "0");
export const praDateTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** PaymentMode from the bill's payment methods. Bank transfer and digital
 * wallets have no code of their own in v1.2; they are sent as Card (2).
 * ASSUMPTION to confirm with PRA (eims@pra.punjab.gov.pk). */
export function praPaymentMode(methods: string[]): number {
  const distinct = [...new Set(methods)];
  if (distinct.length > 1) return PRA_PAYMENT_MODE.mixed;
  return distinct[0] === "cash" || !distinct.length ? PRA_PAYMENT_MODE.cash : PRA_PAYMENT_MODE.card;
}

export function buildPraInvoice(src: PraSource): PraInvoice {
  const items: PraItem[] = src.lines.map((l) => {
    const sale = l.grossPaisa - l.discountPaisa;
    return {
      ItemCode: l.code.slice(0, 50),
      ItemName: l.name.slice(0, 150),
      PCTCode: src.pctCode,
      Quantity: l.qty,
      TaxRate: l.taxRate,
      SaleValue: toRupees(sale),
      Discount: toRupees(l.discountPaisa),
      FurtherTax: 0,
      TaxCharged: toRupees(l.taxPaisa),
      TotalAmount: toRupees(sale + l.taxPaisa),
      InvoiceType: src.invoiceType,
      RefUSIN: src.refUsin,
    };
  });
  const sum = (f: (l: PraSourceLine) => number) => src.lines.reduce((s, l) => s + f(l), 0);
  const salePaisa = sum((l) => l.grossPaisa - l.discountPaisa);
  const taxPaisa = sum((l) => l.taxPaisa);
  const inv: PraInvoice = {
    InvoiceNumber: "",
    POSID: Number(src.posId),
    USIN: src.usin,
    DateTime: praDateTime(src.at),
    TotalBillAmount: toRupees(salePaisa + taxPaisa),
    TotalQuantity: src.lines.reduce((s, l) => s + l.qty, 0),
    TotalSaleValue: toRupees(salePaisa),
    TotalTaxCharged: toRupees(taxPaisa),
    Discount: toRupees(sum((l) => l.discountPaisa)),
    FurtherTax: 0,
    PaymentMode: praPaymentMode(src.methods),
    RefUSIN: src.refUsin,
    InvoiceType: src.invoiceType,
    Items: items,
  };
  if (src.buyerName) inv.BuyerName = src.buyerName.slice(0, 150);
  if (src.buyerPhone) inv.BuyerPhoneNumber = src.buyerPhone.replace(/[^\d]/g, "").slice(0, 20);
  return inv;
}

/** Field and arithmetic checks before anything is sent. */
export function validatePraInvoice(inv: PraInvoice): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(inv.POSID) || inv.POSID <= 0) errors.push("POS ID must be the number PRA issued at POS registration.");
  if (!inv.USIN || inv.USIN.length > 50) errors.push("USIN (your invoice number) is required, up to 50 characters.");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(inv.DateTime)) errors.push("DateTime must be YYYY-MM-DD HH:mm:ss.");
  if (inv.InvoiceType !== 1 && !inv.RefUSIN) errors.push("A credit/debit invoice needs RefUSIN (the original invoice number).");
  if (!inv.Items.length) errors.push("The invoice has no items.");
  const finite = (n: number) => Number.isFinite(n) && n >= 0;
  for (const [i, it] of inv.Items.entries()) {
    const at = `Item ${i + 1} (${it.ItemName || "?"})`;
    if (!it.ItemCode) errors.push(`${at}: ItemCode is required.`);
    if (!it.ItemName) errors.push(`${at}: ItemName is required.`);
    if (!/^\d{1,8}$/.test(it.PCTCode)) errors.push(`${at}: PCT code must be up to 8 digits (PST Act 2012, 2nd Schedule).`);
    for (const k of ["Quantity", "TaxRate", "SaleValue", "Discount", "TaxCharged", "TotalAmount"] as const) {
      if (!finite(it[k])) errors.push(`${at}: ${k} must be a number ≥ 0.`);
    }
    if (Math.abs(it.SaleValue + it.TaxCharged + it.FurtherTax - it.TotalAmount) > 0.011) errors.push(`${at}: SaleValue + TaxCharged ≠ TotalAmount.`);
  }
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.011 * Math.max(1, inv.Items.length);
  const sum = (k: "SaleValue" | "TaxCharged" | "TotalAmount" | "Discount") => inv.Items.reduce((s, it) => s + it[k], 0);
  if (!close(sum("SaleValue"), inv.TotalSaleValue)) errors.push("TotalSaleValue ≠ sum of item SaleValue.");
  if (!close(sum("TaxCharged"), inv.TotalTaxCharged)) errors.push("TotalTaxCharged ≠ sum of item TaxCharged.");
  if (!close(sum("TotalAmount"), inv.TotalBillAmount)) errors.push("TotalBillAmount ≠ sum of item TotalAmount.");
  if (!close(sum("Discount"), inv.Discount)) errors.push("Discount ≠ sum of item Discount.");
  return errors;
}

export type PraStatus =
  | "not_required"
  | "pending"
  | "queued"
  | "submitting"
  | "accepted"
  | "rejected"
  | "retry_pending"
  | "manual_review"
  | "credited";

export interface PraOutcome {
  status: PraStatus;
  praInvoiceNo: string | null;
  code: string | null;
  message: string;
}

/** Maps a transport result to a status. An HTTP 200 alone is NOT acceptance:
 * PRA answers failures with 200 too (sandbox, 2026-10-23:
 * {"InvoiceNumber":"Not Available","Code":"104","Response":"You are not authorized to use this service."}).
 * Only Code "100" with a real InvoiceNumber counts as accepted. */
export function mapPraResponse(r: { httpStatus: number | null; body: string | null; networkError?: string | null }): PraOutcome {
  if (r.httpStatus == null) {
    return { status: "retry_pending", praInvoiceNo: null, code: null, message: r.networkError || "No response from PRA (network/timeout)." };
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = r.body ? (JSON.parse(r.body) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  const fault = json?.fault as { code?: number | string; message?: string; description?: string } | undefined;
  if (fault) {
    return { status: "rejected", praInvoiceNo: null, code: String(fault.code ?? r.httpStatus), message: `${fault.message ?? "Gateway error"}: ${fault.description ?? ""}`.trim() };
  }
  if (r.httpStatus >= 500 || r.httpStatus === 429) {
    return { status: "retry_pending", praInvoiceNo: null, code: String(r.httpStatus), message: `PRA server error (HTTP ${r.httpStatus}).` };
  }
  if (!json) {
    return { status: "manual_review", praInvoiceNo: null, code: String(r.httpStatus), message: "PRA response could not be read; check the IMS Fiscal Report before retrying." };
  }
  const code = json.Code != null ? String(json.Code) : null;
  const invNo = json.InvoiceNumber != null ? String(json.InvoiceNumber) : "";
  const message = String(json.Response ?? json.Errors ?? "");
  if (r.httpStatus >= 400) return { status: "rejected", praInvoiceNo: null, code: code ?? String(r.httpStatus), message: message || `HTTP ${r.httpStatus}` };
  if (code === "100" && invNo && invNo !== "Not Available") return { status: "accepted", praInvoiceNo: invNo, code, message: message || "Accepted" };
  if (code == null) return { status: "manual_review", praInvoiceNo: null, code: null, message: "PRA response had no Code; check the IMS Fiscal Report." };
  return { status: "rejected", praInvoiceNo: null, code, message: message || `PRA code ${code}` };
}

/** Section 10, FAQ 4: customer verification link for the receipt QR code. */
export const praVerifyUrl = (praInvoiceNo: string) =>
  `https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=${encodeURIComponent(praInvoiceNo)}`;

/** Endpoints from section 5 (local Software Fiscal Device) and 7.2.2 (cloud). */
export const PRA_ENDPOINTS = {
  localHealth: "http://localhost:8524/api/IMSFiscal/get",
  localPost: "http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel",
  cloudSandbox: "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData",
  cloudProduction: "https://ims.pral.com.pk/ims/production/api/Live/PostData",
} as const;
