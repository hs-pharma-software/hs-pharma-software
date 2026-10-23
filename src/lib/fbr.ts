/**
 * FBR Digital Invoicing API integration (DI API v1.12, PRAL 2025).
 * Sandbox and production share gw.fbr.gov.pk; the token decides the routing.
 */

import { getSetting } from "./repo/settings";
import { useAuthStore } from "../store/authStore";
import { normalizeNtn } from "./fbrData";

const GW = "https://gw.fbr.gov.pk";
const POST_URL = { sandbox: `${GW}/di_data/v1/di/postinvoicedata_sb`, production: `${GW}/di_data/v1/di/postinvoicedata` };
const TIMEOUT_MS = 45_000;

export interface FbrSettings {
  enabled: boolean;
  environment: "sandbox" | "production";
  sandboxToken: string;
  productionToken: string;
  sellerNtn: string;
  sellerName: string;
  sellerProvince: string;
  sellerAddress: string;
  /** Sales-tax profile is "retailer": sandbox uses SN026-SN028 for end consumers. */
  retailer: boolean;
}

export async function loadFbrSettings(): Promise<FbrSettings> {
  const [enabled, env, sbToken, prodToken, ntn, name, province, address, retailer] = await Promise.all([
    getSetting("fbr_enabled"),
    getSetting("fbr_environment"),
    getSetting("fbr_sandbox_token"),
    getSetting("fbr_production_token"),
    getSetting("fbr_seller_ntn"),
    getSetting("fbr_seller_name"),
    getSetting("fbr_seller_province"),
    getSetting("fbr_seller_address"),
    getSetting("fbr_retailer"),
  ]);
  return {
    // The Super Admin can switch FBR off for a pharmacy (tenant detail).
    enabled: enabled === "true" && useAuthStore.getState().currentTenant?.fbrAllowed !== false,
    environment: env === "production" ? "production" : "sandbox",
    sandboxToken: (sbToken ?? "").trim(),
    productionToken: (prodToken ?? "").trim(),
    sellerNtn: normalizeNtn(ntn),
    sellerName: name ?? "",
    sellerProvince: province || "Punjab",
    sellerAddress: address ?? "",
    retailer: retailer === "true",
  };
}

export function activeToken(settings: FbrSettings): string {
  return settings.environment === "sandbox" ? settings.sandboxToken : settings.productionToken;
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
  /** "" for reduced-rate goods: FBR rejects 0 there with error 0091. */
  extraTax: number | "";
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
  /** Always sent; "" for unregistered buyers without an NTN/CNIC. */
  buyerNTNCNIC: string;
  buyerBusinessName: string;
  buyerProvince: string;
  buyerAddress: string;
  buyerRegistrationType: "Registered" | "Unregistered";
  invoiceRefNo: string;
  /** Required in sandbox only. */
  scenarioId?: string;
  items: FbrInvoiceItem[];
}

export interface FbrSubmitResult {
  success: boolean;
  fbrInvoiceNo: string | null;
  error: string | null;
  rawResponse: unknown;
}

interface FbrResponse {
  invoiceNumber?: string;
  validationResponse?: {
    statusCode?: string;
    errorCode?: string | null;
    error?: string;
    invoiceStatuses?: { itemSNo?: string; statusCode?: string; errorCode?: string | null; error?: string }[] | null;
  };
}

/** FBR sometimes returns JSON with trailing commas (`"x":"",\n}`). */
export function parseFbrJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return JSON.parse(text.replace(/,\s*([}\]])/g, "$1")) as T;
  }
}

async function fbrFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function submitInvoiceToFbr(payload: FbrInvoicePayload, settings: FbrSettings): Promise<FbrSubmitResult> {
  const token = activeToken(settings);
  const fail = (error: string, rawResponse: unknown = null): FbrSubmitResult => ({
    success: false,
    fbrInvoiceNo: null,
    error,
    rawResponse,
  });
  if (!token) return fail(`No FBR ${settings.environment} token configured in Settings > FBR.`);

  let text: string;
  let status: number;
  try {
    const res = await fbrFetch(POST_URL[settings.environment], token, { method: "POST", body: JSON.stringify(payload) });
    status = res.status;
    text = await res.text();
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError") return fail("FBR did not respond within 45 seconds. Check the internet connection and try again.");
    return fail(`Could not reach FBR: ${err.message}`);
  }

  if (status === 401) return fail("FBR rejected the token (401 Unauthorized). Check the token in Settings > FBR.");
  if (status >= 500) return fail(`FBR server error (HTTP ${status}). Try again later.`);

  let json: FbrResponse;
  try {
    json = parseFbrJson<FbrResponse>(text);
  } catch {
    return fail(`Unexpected response from FBR (HTTP ${status}): ${text.slice(0, 200)}`, text);
  }

  const vr = json.validationResponse;
  const itemErrors = (vr?.invoiceStatuses ?? [])
    .filter((s) => s.statusCode && s.statusCode !== "00")
    .map((s) => `Item ${s.itemSNo}: ${s.error || "invalid"}${s.errorCode ? ` [${s.errorCode}]` : ""}`);

  if (vr?.statusCode === "00" && json.invoiceNumber && itemErrors.length === 0) {
    return { success: true, fbrInvoiceNo: json.invoiceNumber, error: null, rawResponse: json };
  }
  if (itemErrors.length > 0) return fail(itemErrors.join("\n"), json);
  if (vr?.errorCode === "500") {
    // FBR returns this generic "expected time" text for server-side crashes,
    // not real timeouts, so retrying the same data never helps.
    return fail(
      "FBR could not process this invoice (FBR error 500). This is usually caused by invalid data such as special characters in a product name.",
      json
    );
  }
  return fail(`${vr?.error || "FBR validation failed"}${vr?.errorCode ? ` [${vr.errorCode}]` : ""}`, json);
}

/** QR code content: the FBR invoice number itself (spec section 6). */
export function fbrQrContent(fbrInvoiceNo: string): string {
  return fbrInvoiceNo;
}

// ── Reference APIs (cached per session) ─────────────────────────────────────

const cache = new Map<string, Promise<unknown>>();

function fbrGet<T>(path: string, token: string): Promise<T> {
  const key = path;
  if (!cache.has(key)) {
    const p = fbrFetch(`${GW}${path}`, token)
      .then(async (r) => {
        if (!r.ok) throw new Error(`FBR reference API HTTP ${r.status}`);
        return parseFbrJson<T>(await r.text());
      })
      .catch((e) => {
        cache.delete(key);
        throw e;
      });
    cache.set(key, p);
  }
  return cache.get(key) as Promise<T>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function ddMonYyyy(d = new Date()) {
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export interface FbrRate {
  rateId: number;
  label: string;
  value: number;
}
export async function fetchFbrRates(token: string, transTypeId: number, provinceCode: number): Promise<FbrRate[]> {
  const rows = await fbrGet<{ ratE_ID: number; ratE_DESC: string; ratE_VALUE: number }[]>(
    `/pdi/v2/SaleTypeToRate?date=${ddMonYyyy()}&transTypeId=${transTypeId}&originationSupplier=${provinceCode}`,
    token
  );
  return rows.map((r) => ({ rateId: r.ratE_ID, label: r.ratE_DESC.trim(), value: r.ratE_VALUE }));
}

export async function fetchFbrHsUoms(token: string, hsCode: string): Promise<string[]> {
  const rows = await fbrGet<{ uoM_ID: number; description: string }[]>(
    `/pdi/v2/HS_UOM?hs_code=${encodeURIComponent(hsCode)}&annexure_id=3`,
    token
  );
  return rows.map((r) => r.description.trim());
}

export interface FbrSroSchedule {
  sroId: number;
  label: string;
}
export async function fetchFbrSroSchedules(token: string, rateId: number, provinceCode: number): Promise<FbrSroSchedule[]> {
  const rows = await fbrGet<{ srO_ID: number; srO_DESC: string }[]>(
    `/pdi/v1/SroSchedule?rate_id=${rateId}&date=${ddMonYyyy()}&origination_supplier_csv=${provinceCode}`,
    token
  );
  return rows.map((r) => ({ sroId: r.srO_ID, label: r.srO_DESC.trim() }));
}

export async function fetchFbrSroItems(token: string, sroId: number): Promise<string[]> {
  const rows = await fbrGet<{ srO_ITEM_ID: number; srO_ITEM_DESC: string }[]>(
    `/pdi/v2/SROItem?date=${isoDate()}&sro_id=${sroId}`,
    token
  );
  return Array.from(new Set(rows.map((r) => r.srO_ITEM_DESC.trim())));
}
