/**
 * Pakistan FBR Digital Invoicing reference data (DI API v1.12).
 * Values here must match FBR's reference APIs exactly; anything else is
 * rejected. Rates, allowed UOMs and SRO lists are fetched live (lib/fbr.ts).
 */

export { FBR_HS_CODES } from "./fbrHsCodes";

// ── Provinces ───────────────────────────────────────────────────────────────
// Labels are what the app stores; `fbr` is the pdi/v1/provinces description,
// `code` its stateProvinceCode (used as originationSupplier in rate lookups).
export const FBR_PROVINCES: { label: string; fbr: string; code: number }[] = [
  { label: "Punjab", fbr: "PUNJAB", code: 7 },
  { label: "Sindh", fbr: "SINDH", code: 8 },
  { label: "KPK", fbr: "KHYBER PAKHTUNKHWA", code: 6 },
  { label: "Balochistan", fbr: "BALOCHISTAN", code: 2 },
  { label: "Federal", fbr: "CAPITAL TERRITORY", code: 5 },
  { label: "AJK", fbr: "AZAD JAMMU AND KASHMIR", code: 4 },
  { label: "Gilgit Baltistan", fbr: "GILGIT BALTISTAN", code: 9 },
];

function findProvince(label: string | null | undefined) {
  if (!label) return undefined;
  const l = label.toLowerCase();
  return FBR_PROVINCES.find((p) => p.label.toLowerCase() === l || p.fbr.toLowerCase() === l);
}

export function toFbrProvince(label: string | null | undefined): string {
  if (!label) return "";
  return findProvince(label)?.fbr ?? label.toUpperCase();
}

export function fbrProvinceCode(label: string | null | undefined): number {
  return findProvince(label)?.code ?? 7;
}

export function isValidNtnOrCnic(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{7}$/.test(digits) || /^\d{9}$/.test(digits) || /^\d{13}$/.test(digits);
}

export function isValidPkMobile(value: string): boolean {
  return /^(\+92|0092|0)3\d{9}$/.test(value.replace(/[\s-]/g, ""));
}

// ── Sale types (pdi/v1/transtypecode) ────────────────────────────────────────
export interface SaleTypeEntry {
  value: string;
  transTypeId: number;
  /** Rate used when the live rate list can't be loaded. */
  defaultRate: number;
  /** Rate string FBR expects in the invoice ("18%", "Exempt", ...). */
  rateLabel: (rate: number) => string;
  /** Sandbox scenario for this sale type. Retailers selling to end consumers
   * (unregistered buyers) use SN026-SN028 when their sales-tax profile is
   * "retailer". */
  scenario: (buyerRegistered: boolean, retailer: boolean) => string;
  description: string;
}

const pct = (r: number) => `${r}%`;

export const FBR_SALE_TYPES: SaleTypeEntry[] = [
  {
    value: "Goods at standard rate (default)",
    transTypeId: 75,
    defaultRate: 18,
    rateLabel: pct,
    scenario: (reg, retailer) => (reg ? "SN001" : retailer ? "SN026" : "SN002"),
    description: "Standard sales tax (18%)",
  },
  {
    value: "Goods at Reduced Rate",
    transTypeId: 24,
    defaultRate: 1,
    rateLabel: pct,
    scenario: (reg, retailer) => (retailer && !reg ? "SN028" : "SN005"),
    description: "Reduced rate under a schedule/SRO (needs SRO and item serial)",
  },
  {
    value: "Exempt goods",
    transTypeId: 81,
    defaultRate: 0,
    rateLabel: () => "Exempt",
    scenario: () => "SN006",
    description: "Exempt (registered drugs: SRO Eighth Schedule Table 1, item 81)",
  },
  {
    value: "Goods at zero-rate",
    transTypeId: 80,
    defaultRate: 0,
    rateLabel: () => "0%",
    scenario: () => "SN007",
    description: "Zero-rated (needs SRO and item serial, e.g. FIFTH SCHEDULE)",
  },
  {
    value: "3rd Schedule Goods",
    transTypeId: 23,
    defaultRate: 18,
    rateLabel: pct,
    scenario: (reg, retailer) => (retailer && !reg ? "SN027" : "SN008"),
    description: "Tax charged on printed retail price (MRP)",
  },
];

export function findSaleType(value: string | null | undefined): SaleTypeEntry | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return FBR_SALE_TYPES.find((t) => t.value.toLowerCase() === v);
}

// ── UOM (pdi/v1/uom) ─────────────────────────────────────────────────────────
// Which of these is allowed depends on the HS code (pdi/v2/HS_UOM): medicines
// (3004.x) take "Packs" or "KG", instruments (9018.x) "Numbers, pieces, units".
export const FBR_UOM_LIST: string[] = [
  "Packs",
  "Numbers, pieces, units",
  "KG",
  "Kilogram",
  "Gram",
  "Liter",
  "Pcs",
  "Dozen",
  "Pair",
  "SET",
  "Bag",
  "Meter",
  "Foot",
  "Square Metre",
  "Square Foot",
  "Cubic Metre",
  "Gallon",
  "Pound",
  "Carat",
  "Thousand Unit",
  "NO",
  "MT",
  "Others",
];
