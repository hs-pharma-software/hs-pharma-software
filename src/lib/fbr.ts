/**
 * FBR Digital Invoicing API integration.
 * Spec: Technical Documentation for DI API V1.12 (PRAL, 2025)
 *
 * Both sandbox and production share the same base gateway URL.
 * Routing is determined solely by the Bearer token supplied.
 *
 * Sandbox POST:    https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb
 * Production POST: https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata
 */

import { getSetting } from "./repo/settings";

export interface FbrSettings {
  enabled: boolean;
  environment: "sandbox" | "production";
  sandboxToken: string;
  productionToken: string;
  sellerNtn: string;
  sellerName: string;
  sellerProvince: string;
  sellerAddress: string;
}

export async function loadFbrSettings(): Promise<FbrSettings> {
  const [enabled, env, sbToken, prodToken, ntn, name, province, address] =
    await Promise.all([
      getSetting("fbr_enabled"),
      getSetting("fbr_environment"),
      getSetting("fbr_sandbox_token"),
      getSetting("fbr_production_token"),
      getSetting("fbr_seller_ntn"),
      getSetting("fbr_seller_name"),
      getSetting("fbr_seller_province"),
      getSetting("fbr_seller_address"),
    ]);
  return {
    enabled: enabled === "true",
    environment: (env as "sandbox" | "production") ?? "sandbox",
    sandboxToken: sbToken ?? "",
    productionToken: prodToken ?? "",
    sellerNtn: ntn ?? "",
    sellerName: name ?? "",
    sellerProvince: province ?? "Punjab",
    sellerAddress: address ?? "",
  };
}

export interface FbrInvoiceItem {
  hsCode: string;
  productDescription: string;
  rate: string;
  uoM: string;
  quantity: number;
  totalValues: number;
  valueSalesExcludingST: number;
  fixedNotifiedValueOrRetailPrice: number;
  salesTaxApplicable: number;
  salesTaxWithheldAtSource: number;
  extraTax: number;
  furtherTax: number;
  sroScheduleNo: string;
  fedPayable: number;
  discount: number;
  saleType: string;
  sroItemSerialNo: string;
}

export interface FbrInvoicePayload {
  invoiceType: "Sale Invoice" | "Debit Note";
  invoiceDate: string;
  sellerNTNCNIC: string;
  sellerBusinessName: string;
  sellerProvince: string;
  sellerAddress: string;
  buyerNTNCNIC?: string;
  buyerBusinessName: string;
  buyerProvince: string;
  buyerAddress: string;
  buyerRegistrationType: "Registered" | "Unregistered";
  invoiceRefNo?: string;
  scenarioId?: string;
  items: FbrInvoiceItem[];
}

export interface FbrSubmitResult {
  success: boolean;
  fbrInvoiceNo: string | null;
  error: string | null;
  rawResponse: unknown;
}

export async function submitInvoiceToFbr(
  payload: FbrInvoicePayload,
  settings: FbrSettings
): Promise<FbrSubmitResult> {
  const isSandbox = settings.environment === "sandbox";
  const token = isSandbox ? settings.sandboxToken : settings.productionToken;
  const url = isSandbox
    ? "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb"
    : "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata";

  if (!token) {
    return { success: false, fbrInvoiceNo: null, error: "No FBR token configured for this environment.", rawResponse: null };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      return { success: false, fbrInvoiceNo: null, error: "FBR API: Unauthorized \u2014 check your Bearer token.", rawResponse: null };
    }

    const json = await res.json() as {
      invoiceNumber?: string;
      validationResponse?: { statusCode: string; status: string; error?: string };
    };

    const statusCode = json.validationResponse?.statusCode;
    if (statusCode === "00" && json.invoiceNumber) {
      return { success: true, fbrInvoiceNo: json.invoiceNumber, error: null, rawResponse: json };
    }

    const errMsg = json.validationResponse?.error ?? "FBR validation failed";
    return { success: false, fbrInvoiceNo: null, error: errMsg, rawResponse: json };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, fbrInvoiceNo: null, error: `Network error: ${msg}`, rawResponse: null };
  }
}

/** QR code content: the FBR invoice number itself (spec §6).
 *  Scan verifies the invoice at FBR portal. */
export function fbrQrContent(fbrInvoiceNo: string): string {
  return fbrInvoiceNo;
}
