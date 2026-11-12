/**
 * FBR Digital Invoicing sandbox scenarios (pure: used by the server and the
 * Super Admin wizard).
 *
 * Business Nature and Sector: the options of the FBR portal's sandbox screen,
 * exactly as shown there. They are recorded with a testing session; the FBR
 * portal decides which scenarios a taxpayer must pass. FBR offers no API that
 * returns those, so the Super Admin ticks the scenarios the portal shows.
 *
 * Scenarios: only those MAVIN's own invoice builder (src/lib/fbrPayload.ts,
 * FBR_SALE_TYPES) produces are "verified": their test invoice is the one MAVIN
 * would send for a real one-unit sale of a product of the business. Every
 * other code can be listed and tracked, but is never submitted automatically.
 */
import type { FbrInvoicePayload } from "./fbr";
import { isValidNtnOrCnic, isValidSellerNtn } from "./fbrData";
import { parseFbrJson, type FbrResponse } from "./fbrResponse";

/** Bump when the mapping below changes; stored with each session. */
export const SCENARIO_CATALOG_VERSION = "2026-11-di-v1.12";

export const FBR_BUSINESS_NATURES = [
  "Manufacturer",
  "Importer",
  "Exporter",
  "Distributor",
  "Wholesaler",
  "Retailer",
  "Service Provider",
  "Other",
] as const;

export const FBR_SECTORS = [
  "Potassium Chlorate",
  "Mobile",
  "Pharmaceuticals",
  "Automobile",
  "Gas Distribution",
  "Petroleum",
  "Textile",
  "Steel",
  "Cement or Concrete Blocks",
  "Wholesale / Retails",
  "CNG Stations",
  "Services",
  "Electricity Distribution",
  "Telecom",
  "FMCG",
  "All Other Sectors",
] as const;

export type BuyerKind = "registered" | "unregistered" | "either";

export interface FbrScenario {
  code: string;
  title: string;
  /** Verified: MAVIN builds this scenario's invoice (sale type + buyer + retailer profile). */
  verified: boolean;
  /** FBR sale type of the item (FBR_SALE_TYPES value). */
  saleType?: string;
  buyer?: BuyerKind;
  /** The business's sales-tax profile this scenario needs ("retailer" selling to end consumers). */
  retailer?: boolean;
}

const v = (code: string, title: string, saleType: string, buyer: BuyerKind, retailer: boolean): FbrScenario => ({ code, title, verified: true, saleType, buyer, retailer });
const u = (code: string, title: string): FbrScenario => ({ code, title, verified: false });

/** Titles of the codes MAVIN does not build are from FBR's DI technical
 * specification; check them against the portal before relying on them. */
export const FBR_SCENARIOS: FbrScenario[] = [
  v("SN001", "Goods at standard rate to registered buyers", "Goods at standard rate (default)", "registered", false),
  v("SN002", "Goods at standard rate to unregistered buyers", "Goods at standard rate (default)", "unregistered", false),
  u("SN003", "Sale of steel (melted and re-rolled)"),
  u("SN004", "Sale by ship breakers"),
  v("SN005", "Goods at reduced rate", "Goods at Reduced Rate", "either", false),
  v("SN006", "Exempt goods", "Exempt goods", "either", false),
  v("SN007", "Goods at zero rate", "Goods at zero-rate", "either", false),
  v("SN008", "Sale of 3rd Schedule goods", "3rd Schedule Goods", "either", false),
  u("SN009", "Purchase from registered cotton ginners"),
  u("SN010", "Telecom services"),
  u("SN011", "Toll manufacturing (steel sector)"),
  u("SN012", "Sale of petroleum products"),
  u("SN013", "Electricity supply to retailers"),
  u("SN014", "Sale of gas to CNG stations"),
  u("SN015", "Sale of mobile phones"),
  u("SN016", "Processing / conversion of goods"),
  u("SN017", "Goods where FED is charged in sales-tax mode"),
  u("SN018", "Services where FED is charged in sales-tax mode"),
  u("SN019", "Services rendered or provided"),
  u("SN020", "Sale of electric vehicles"),
  u("SN021", "Sale of cement / concrete blocks"),
  u("SN022", "Sale of potassium chlorate"),
  u("SN023", "Sale of CNG"),
  u("SN024", "Goods listed in SRO 297(I)/2023"),
  u("SN025", "Drugs at fixed sales-tax rate (Eighth Schedule)"),
  v("SN026", "Sale to end consumer by retailers (standard rate)", "Goods at standard rate (default)", "unregistered", true),
  v("SN027", "Sale to end consumer by retailers (3rd Schedule goods)", "3rd Schedule Goods", "unregistered", true),
  v("SN028", "Sale to end consumer by retailers (reduced rate)", "Goods at Reduced Rate", "unregistered", true),
];

export const SCENARIO_CODE_RE = /^SN\d{3}$/;
export const findScenario = (code: string) => FBR_SCENARIOS.find((s) => s.code === code);

// ── Statuses ─────────────────────────────────────────────────────────────

export type ScenarioStatus =
  | "not_started" | "needs_input" | "local_failed" | "fbr_invalid" | "error"
  | "submitted" | "rejected" | "uncertain" | "portal_confirmed" | "skipped";

export const SCENARIO_STATUS_LABEL: Record<ScenarioStatus, string> = {
  not_started: "Not started",
  needs_input: "Needs information",
  local_failed: "Local validation failed",
  fbr_invalid: "FBR validation failed",
  error: "FBR did not answer (nothing posted)",
  submitted: "Sandbox submission passed",
  rejected: "Sandbox submission rejected",
  uncertain: "Unclear: check the FBR portal",
  portal_confirmed: "FBR portal completion confirmed",
  skipped: "Skipped",
};

export type ScenarioGroup = "passed" | "failed" | "pending" | "skipped";
export function scenarioGroup(s: string): ScenarioGroup {
  if (s === "submitted" || s === "portal_confirmed") return "passed";
  if (s === "skipped") return "skipped";
  if (s === "not_started") return "pending";
  return "failed";
}
/** Not passed and not skipped: offered for retry. */
export const isIncomplete = (s: string) => scenarioGroup(s) === "failed" || scenarioGroup(s) === "pending";

// ── Local validation of a generated invoice ─────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /^(\d+(\.\d+)?%|Exempt)$/;
const near = (a: number, b: number) => Math.abs(a - b) <= 0.011;
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);

/** Checks a generated invoice against FBR's field list and MAVIN's tax
 * arithmetic before anything is sent. Returns the problems (empty: passed). */
export function checkScenarioPayload(p: FbrInvoicePayload, s: FbrScenario, buyerRegistered: boolean): string[] {
  const out: string[] = [];
  const str = (k: keyof FbrInvoicePayload, required = true) => {
    const x = p[k];
    if (typeof x !== "string") out.push(`${k} must be text`);
    else if (required && !x.trim()) out.push(`${k} is empty`);
  };
  if (p.invoiceType !== "Sale Invoice") out.push(`invoiceType must be "Sale Invoice"`);
  if (typeof p.invoiceDate !== "string" || !DATE_RE.test(p.invoiceDate)) out.push("invoiceDate must be yyyy-MM-dd");
  if (!isValidSellerNtn(p.sellerNTNCNIC)) out.push("sellerNTNCNIC must be a 7-character NTN or 13-digit CNIC");
  str("sellerBusinessName"); str("sellerProvince"); str("sellerAddress");
  str("buyerBusinessName"); str("buyerProvince"); str("buyerAddress");
  str("buyerNTNCNIC", false); str("invoiceRefNo", false);
  const wantType = buyerRegistered ? "Registered" : "Unregistered";
  if (p.buyerRegistrationType !== wantType) out.push(`buyerRegistrationType must be "${wantType}" for ${s.code}`);
  if (buyerRegistered && !isValidNtnOrCnic(p.buyerNTNCNIC)) out.push("a registered buyer needs a valid NTN/CNIC");
  if (p.scenarioId !== s.code) out.push(`scenarioId is "${p.scenarioId ?? ""}", expected ${s.code}`);
  if (!Array.isArray(p.items) || p.items.length !== 1) out.push("a scenario test invoice has exactly one item");
  for (const [n, it] of (p.items ?? []).entries()) {
    const at = `item ${n + 1}`;
    if (!/^\d{4}\.\d{4}$/.test(it.hsCode)) out.push(`${at}: hsCode must look like 0000.0000`);
    if (!it.productDescription?.trim()) out.push(`${at}: productDescription is empty`);
    if (!RATE_RE.test(it.rate)) out.push(`${at}: rate "${it.rate}" must be like "18%" or "Exempt"`);
    if (!it.uoM?.trim()) out.push(`${at}: uoM is empty`);
    if (s.saleType && it.saleType !== s.saleType) out.push(`${at}: saleType must be "${s.saleType}" for ${s.code}`);
    for (const k of ["quantity", "totalValues", "valueSalesExcludingST", "fixedNotifiedValueOrRetailPrice", "salesTaxApplicable", "salesTaxWithheldAtSource", "furtherTax", "fedPayable", "discount"] as const) {
      if (!num(it[k]) || (it[k] as number) < 0) out.push(`${at}: ${k} must be a number of 0 or more`);
    }
    if (!(it.quantity > 0)) out.push(`${at}: quantity must be more than 0`);
    if (!(it.valueSalesExcludingST > 0)) out.push(`${at}: valueSalesExcludingST must be more than 0 (the product needs a sale price)`);
    if (it.extraTax !== "" && !num(it.extraTax)) out.push(`${at}: extraTax must be a number or ""`);
    const extra = typeof it.extraTax === "number" ? it.extraTax : 0;
    if (num(it.totalValues) && !near(it.totalValues, it.valueSalesExcludingST + it.salesTaxApplicable + it.furtherTax + it.fedPayable + extra)) {
      out.push(`${at}: totalValues ${it.totalValues} is not value + sales tax + further tax + FED + extra tax`);
    }
    const rate = it.rate === "Exempt" ? 0 : parseFloat(it.rate);
    const base = it.saleType === "3rd Schedule Goods" ? it.fixedNotifiedValueOrRetailPrice : it.valueSalesExcludingST;
    if (it.saleType === "3rd Schedule Goods" && !(it.fixedNotifiedValueOrRetailPrice > 0)) out.push(`${at}: 3rd Schedule goods need the retail price (fixedNotifiedValueOrRetailPrice)`);
    if (num(it.salesTaxApplicable) && !near(it.salesTaxApplicable, Math.round(base * rate) / 100)) {
      out.push(`${at}: salesTaxApplicable ${it.salesTaxApplicable} is not ${rate}% of ${base}`);
    }
    const needsSro = it.saleType === "Goods at Reduced Rate" || it.saleType === "Exempt goods" || it.saleType === "Goods at zero-rate";
    if (needsSro && (!it.sroScheduleNo?.trim() || !it.sroItemSerialNo?.trim())) out.push(`${at}: "${it.saleType}" needs the SRO schedule and item serial`);
  }
  return out;
}

// ── FBR's answer to the validate call ───────────────────────────────────

/** What FBR's validate endpoint said. Validating records nothing at FBR,
 * so an unreadable answer is simply "unclear": it can be asked again. */
export function interpretFbrValidate(status: number, text: string): { outcome: "valid" | "invalid" | "unclear"; error: string | null } {
  if (status === 401 || status === 403) return { outcome: "invalid", error: `FBR rejected the sandbox token (HTTP ${status}). Check the token and the IP whitelisting.` };
  if (status === 429) return { outcome: "unclear", error: "FBR is limiting requests (HTTP 429). Wait a minute, then retry." };
  let json: FbrResponse;
  try { json = parseFbrJson<FbrResponse>(text); } catch {
    return { outcome: "unclear", error: `FBR answered HTTP ${status} without a readable result.` };
  }
  const vr = json?.validationResponse;
  if (!vr) return { outcome: status >= 500 ? "unclear" : "invalid", error: `FBR answered HTTP ${status} without a validation result.` };
  const items = (vr.invoiceStatuses ?? [])
    .filter((s) => s.statusCode && s.statusCode !== "00")
    .map((s) => `Item ${s.itemSNo}: ${s.error || "invalid"}${s.errorCode ? ` [${s.errorCode}]` : ""}`);
  if (vr.statusCode === "00" && items.length === 0) return { outcome: "valid", error: null };
  const head = vr.error ? `${vr.error}${vr.errorCode ? ` [${vr.errorCode}]` : ""}` : null;
  return { outcome: "invalid", error: [head, ...items].filter(Boolean).join("\n") || `FBR reported the invoice as invalid (status ${vr.statusCode ?? "?"}).` };
}

/** For display: a buyer's NTN/CNIC shows only its last 3 characters. */
export function maskId(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  return t.length <= 3 ? t : `${"•".repeat(t.length - 3)}${t.slice(-3)}`;
}
