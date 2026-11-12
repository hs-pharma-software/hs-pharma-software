/**
 * FBR Digital Invoicing API integration (DI API v1.12, PRAL 2025).
 * Sandbox and production share gw.fbr.gov.pk; the token decides the routing.
 */

import { getSetting } from "./repo/settings";
import { useAuthStore } from "../store/authStore";
import { normalizeNtn } from "./fbrData";
import { localDate } from "./localDate";
import { SERVER_DB, serverJson } from "./serverMode";
import { interpretFbrSubmit, parseFbrJson, UNCERTAIN_MESSAGE, type FbrOutcome } from "./fbrResponse";
export { interpretFbrSubmit, parseFbrJson, UNCERTAIN_MESSAGE, type FbrOutcome };

const GW = "https://gw.fbr.gov.pk";
const POST_URL = { sandbox: `${GW}/di_data/v1/di/postinvoicedata_sb`, production: `${GW}/di_data/v1/di/postinvoicedata` };
/** Checks an invoice without recording it: used to test a token. */
const VALIDATE_URL = { sandbox: `${GW}/di_data/v1/di/validateinvoicedata_sb`, production: `${GW}/di_data/v1/di/validateinvoicedata` };
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
  /** Server mode: tokens stay on MAVIN's server (the fields above hold SERVER_TOKEN). */
  serverManaged?: boolean;
  /** Server mode: "gateway" (MAVIN's static IP) or "direct" (this browser calls FBR). */
  route?: "gateway" | "direct";
}

/** What MAVIN's server says about this business's FBR set-up (server mode). */
export interface FbrServerConfig {
  route: "gateway" | "direct";
  hasSandbox: boolean;
  hasProduction: boolean;
  sandboxHint: string | null;
  productionHint: string | null;
  canManage: boolean;
  canSubmit: boolean;
  storageReady: boolean;
}
export const fbrServerConfig = () => serverJson<FbrServerConfig>("/api/fbr/", { action: "config" });

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
  // Server mode: the tokens are on MAVIN's server; this page only learns which exist.
  const server = SERVER_DB ? await fbrServerConfig().catch(() => null) : null;
  return {
    ...(SERVER_DB ? { serverManaged: true, route: server?.route ?? "direct" } : {}),
    // The Super Admin can switch FBR off for a pharmacy (tenant detail).
    enabled: enabled === "true" && useAuthStore.getState().currentTenant?.fbrAllowed !== false,
    environment: env === "production" ? "production" : "sandbox",
    sandboxToken: SERVER_DB ? (server?.hasSandbox ? SERVER_TOKEN : "") : (sbToken ?? "").trim(),
    productionToken: SERVER_DB ? (server?.hasProduction ? SERVER_TOKEN : "") : (prodToken ?? "").trim(),
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
  outcome?: FbrOutcome;
  /** The server's record of this attempt (server mode). */
  submissionId?: string;
}

/** The document a submission is for (server mode keeps one live attempt per document). */
export interface FbrDocRef {
  docType: "invoice" | "es_doc";
  docId: string;
}

/** Stands in for a token kept on MAVIN's server: never sent to FBR from the browser. */
export const SERVER_TOKEN = "@server";

async function fbrFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  if (token === SERVER_TOKEN) throw new Error("This FBR token is kept on MAVIN's server.");
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const asResult = (r: ReturnType<typeof interpretFbrSubmit>): FbrSubmitResult =>
  ({ success: r.outcome === "accepted", fbrInvoiceNo: r.fbrInvoiceNo, error: r.error, rawResponse: r.json, outcome: r.outcome });

/** The browser's own call to FBR (desktop, or server mode without the gateway). */
async function postFromBrowser(payload: FbrInvoicePayload, environment: "sandbox" | "production", token: string): Promise<
  { kind: "response"; status: number; text: string } | { kind: "uncertain"; error: string }
> {
  try {
    const res = await fbrFetch(POST_URL[environment], token, { method: "POST", body: JSON.stringify(payload) });
    return { kind: "response", status: res.status, text: await res.text() };
  } catch (e) {
    const err = e as Error;
    // A browser cannot tell "never sent" from "sent, answer lost": both are treated as unclear.
    return { kind: "uncertain", error: err.name === "TimeoutError" ? "FBR did not answer within 45 seconds." : `The connection to FBR failed (${err.message}).` };
  }
}

/** Sandbox scenario testing in direct mode (no gateway yet): this browser
 * validates or posts the test invoice MAVIN's server built, and the server
 * records the answer. Sandbox addresses only. */
export async function sandboxCallFromBrowser(step: "validate" | "post", payload: FbrInvoicePayload, token: string): Promise<
  { kind: "response"; status: number; text: string } | { kind: "uncertain"; error: string }
> {
  if (step === "post") return postFromBrowser(payload, "sandbox", token);
  try {
    const res = await fbrFetch(VALIDATE_URL.sandbox, token, { method: "POST", body: JSON.stringify(payload) });
    return { kind: "response", status: res.status, text: await res.text() };
  } catch (e) {
    const err = e as Error;
    return { kind: "uncertain", error: err.name === "TimeoutError" ? "FBR did not answer within 45 seconds." : `The connection to FBR failed (${err.message}).` };
  }
}

/** Sends an invoice to FBR.
 * Server mode (web / desktop through MAVIN): the server records the attempt
 * first (one live attempt per document), then sends it through MAVIN's FBR
 * gateway, or hands it back for this browser to send ("direct") and records
 * the answer. A previous attempt with an unclear outcome blocks a new one. */
export async function submitInvoiceToFbr(payload: FbrInvoicePayload, settings: FbrSettings, ref?: FbrDocRef): Promise<FbrSubmitResult> {
  const fail = (error: string): FbrSubmitResult => ({ success: false, fbrInvoiceNo: null, error, rawResponse: null });
  if (SERVER_DB) {
    if (!ref) return fail("Internal: the document to submit is missing.");
    try {
      const r = await serverJson<FbrSubmitResult & { direct?: boolean; token?: string; environment?: "sandbox" | "production" }>(
        "/api/fbr/", { action: "submit", ...ref, environment: settings.environment, payload },
      );
      if (!r.direct) return r;
      const sent = await postFromBrowser(payload, r.environment ?? settings.environment, r.token ?? "");
      return await serverJson<FbrSubmitResult>("/api/fbr/", { action: "finish", submissionId: r.submissionId, report: sent });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
  const token = activeToken(settings);
  if (!token) return fail(`No FBR ${settings.environment} token configured in Settings > FBR.`);
  const sent = await postFromBrowser(payload, settings.environment, token);
  if (sent.kind === "uncertain") return { ...fail(`${sent.error} ${UNCERTAIN_MESSAGE}`), outcome: "uncertain" };
  return asResult(interpretFbrSubmit(sent.status, sent.text));
}

/** Tests a token on FBR's validate endpoint of that environment with an
 * empty invoice: nothing is recorded. FBR answers 401 to a token it does not
 * accept there; any other answer (it reports the invoice as invalid) means the
 * token works. */
export async function testFbrToken(token: string, environment: "sandbox" | "production", tenantId?: string): Promise<{ ok: boolean; message: string }> {
  const t = token.trim();
  // Server mode: MAVIN's server tests it (the typed token, or the saved one when none is typed).
  if (SERVER_DB) {
    try {
      const r = await serverJson<{ ok: boolean; message: string; direct?: boolean; token?: string }>("/api/fbr/", { action: "test", environment, token: t || undefined, tenantId });
      if (!r.direct) return r;
      return await testFromBrowser(r.token ?? "", environment);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  return testFromBrowser(t, environment);
}

async function testFromBrowser(t: string, environment: "sandbox" | "production"): Promise<{ ok: boolean; message: string }> {
  if (!t) return { ok: false, message: `Enter the ${environment} token first.` };
  let res: Response;
  try {
    res = await fbrFetch(VALIDATE_URL[environment], t, { method: "POST", body: "{}" });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError") return { ok: false, message: "FBR did not respond within 45 seconds. Check the internet connection." };
    return { ok: false, message: `Could not reach FBR (${err.message}). The browser may block FBR; test from the desktop app.` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, message: `FBR rejected this token for ${environment} (HTTP ${res.status}). Check it is the ${environment} token issued by PRAL.` };
  if (res.status >= 500) return { ok: false, message: `FBR server error (HTTP ${res.status}). Try again later.` };
  return { ok: true, message: `Token accepted by FBR ${environment} (HTTP ${res.status}).` };
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
    // Server mode: MAVIN's server looks it up (through its gateway, or hands back the token for this browser).
    const fetched: Promise<{ status: number; text: string }> = SERVER_DB
      ? serverJson<{ status?: number; body?: string; direct?: boolean; token?: string }>("/api/fbr/", { action: "reference", path }).then(async (r) => {
          if (!r.direct) return { status: r.status ?? 0, text: r.body ?? "" };
          const res = await fbrFetch(`${GW}${path}`, r.token ?? "");
          return { status: res.status, text: await res.text() };
        })
      : fbrFetch(`${GW}${path}`, token).then(async (r) => ({ status: r.status, text: await r.text() }));
    const p = fetched
      .then(({ status, text }) => {
        if (status < 200 || status >= 300) throw new Error(`FBR reference API HTTP ${status}`);
        return parseFbrJson<T>(text);
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
  return localDate(d);
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
