import type { FbrInvoiceItem, FbrInvoicePayload, FbrSettings } from "./fbr";
import { FBR_HS_CODES, findSaleType, isValidNtnOrCnic, isValidSellerNtn, normalizeNtn, toFbrProvince } from "./fbrData";

export interface FbrItemRow {
  qty: number;
  sale_price: number;
  tax_pct: number;
  further_tax_pct: number;
  discount_rs: number;
  product_name: string | null;
  hs_code: string | null;
  fbr_sale_type: string | null;
  fbr_sale_rate: number | null;
  fbr_uom: string | null;
  sro_no: string | null;
  sro_item_serial_no: string | null;
  /** FBR units per base unit (KG per pack etc.); null/0 means 1. */
  fbr_qty_factor?: number | null;
}

/** FBR UOMs that count items; anything else (KG, Liter, Gram...) needs the
 * product's fbr_qty_factor to convert the quantity sold. */
export const COUNT_UOMS = new Set(["Packs", "Numbers, pieces, units", "Pcs", "NO", "Dozen", "Pair", "SET", "Bag"]);

export interface FbrBuyer {
  name: string | null;
  ntnCnic: string | null;
  province: string | null;
  address: string | null;
  registered: boolean;
}

const VALID_HS = new Set(FBR_HS_CODES.map((h) => h.code));
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** FBR's server crashes (error 500, reported as a "timeout") on backslashes. */
export function fbrText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/\\/g, "/")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure: builds the DI API payload or lists every data problem found.
 * `allowedUoms` maps HS code -> UOMs from FBR's HS_UOM API (when available). */
export function buildFbrPayload(
  invoiceDate: string,
  buyer: FbrBuyer,
  items: FbrItemRow[],
  settings: FbrSettings,
  allowedUoms: Map<string, string[]> = new Map()
): { payload: FbrInvoicePayload } | { error: string } {
  const buyerNtn = normalizeNtn(buyer.ntnCnic);
  const buyerProvince = toFbrProvince(buyer.province || settings.sellerProvince);

  if (!isValidSellerNtn(settings.sellerNtn)) {
    return { error: "Seller NTN in Settings > FBR must be a 7-character NTN (e.g. 1234567 or A123456) or a 13-digit CNIC." };
  }
  if (!settings.sellerAddress.trim()) return { error: "Seller address is missing in Settings > FBR." };
  if (buyer.registered && !buyerNtn) return { error: "A registered buyer needs an NTN/CNIC on the invoice." };
  if (buyerNtn && !isValidNtnOrCnic(buyerNtn)) return { error: "Buyer NTN must be 7 characters (e.g. 1234567 or A123456) or 9 digits, or CNIC 13 digits." };
  if (items.length === 0) return { error: "Invoice has no line items." };

  const problems: string[] = [];
  for (const i of items) {
    const name = i.product_name ?? "Unknown product";
    const saleType = findSaleType(i.fbr_sale_type);
    if (!i.hs_code || !VALID_HS.has(i.hs_code)) problems.push(`${name}: HS code "${i.hs_code ?? ""}" is not a valid FBR code`);
    if (!saleType) problems.push(`${name}: sale type "${i.fbr_sale_type ?? ""}" is not an FBR sale type`);
    if (!i.fbr_uom) problems.push(`${name}: FBR UOM missing`);
    const rate = i.fbr_sale_rate ?? 0;
    const standard18 = saleType?.value.startsWith("Goods at standard") && rate === 18;
    if (saleType && !standard18 && saleType.value !== "3rd Schedule Goods" && (!i.sro_no || !i.sro_item_serial_no)) {
      problems.push(`${name}: SRO schedule and item serial are required for "${saleType.value}"`);
    }
    const allowed = i.hs_code ? allowedUoms.get(i.hs_code) : undefined;
    if (allowed && allowed.length > 0 && i.fbr_uom && !allowed.includes(i.fbr_uom)) {
      problems.push(`${name}: UOM "${i.fbr_uom}" not allowed for HS ${i.hs_code} (use ${allowed.join(" or ")})`);
    }
  }
  if (problems.length > 0) return { error: `Fix the product FBR data first:\n${problems.join("\n")}` };

  const saleTypes = Array.from(new Set(items.map((i) => findSaleType(i.fbr_sale_type)!.value)));
  let scenarioId: string | undefined;
  if (settings.environment === "sandbox") {
    if (saleTypes.length > 1) {
      return { error: `In sandbox each invoice may contain only one sale type; this one mixes: ${saleTypes.join(", ")}.` };
    }
    scenarioId = findSaleType(saleTypes[0])!.scenario(buyer.registered, settings.retailer);
  }

  const fbrItems: FbrInvoiceItem[] = items.map((i) => {
    const saleType = findSaleType(i.fbr_sale_type)!;
    const rate = i.fbr_sale_rate ?? saleType.defaultRate;
    const gross = round(i.sale_price * i.qty, 2);
    const discount = round(i.discount_rs ?? 0, 2);
    const valueExclST = round(gross - discount, 2);
    const thirdSchedule = saleType.value === "3rd Schedule Goods";
    const salesTax = round(((thirdSchedule ? gross : valueExclST) * rate) / 100, 2);
    const furtherTax = buyer.registered ? 0 : round((valueExclST * (i.further_tax_pct ?? 0)) / 100, 2);
    return {
      hsCode: i.hs_code!,
      productDescription: fbrText(i.product_name),
      rate: saleType.rateLabel(rate),
      uoM: i.fbr_uom!,
      quantity: round(i.qty * (i.fbr_qty_factor || 1), 4),
      totalValues: round(valueExclST + salesTax + furtherTax, 2),
      valueSalesExcludingST: valueExclST,
      fixedNotifiedValueOrRetailPrice: thirdSchedule ? gross : 0,
      salesTaxApplicable: salesTax,
      salesTaxWithheldAtSource: 0,
      extraTax: saleType.value === "Goods at Reduced Rate" ? "" : 0,
      furtherTax,
      sroScheduleNo: fbrText(i.sro_no),
      fedPayable: 0,
      discount,
      saleType: saleType.value,
      sroItemSerialNo: fbrText(i.sro_item_serial_no),
    };
  });

  return {
    payload: {
      invoiceType: "Sale Invoice",
      invoiceDate,
      sellerNTNCNIC: normalizeNtn(settings.sellerNtn),
      sellerBusinessName: fbrText(settings.sellerName),
      sellerProvince: toFbrProvince(settings.sellerProvince),
      sellerAddress: fbrText(settings.sellerAddress),
      buyerNTNCNIC: buyerNtn,
      buyerBusinessName: fbrText(buyer.name) || "Walk-in Customer",
      buyerProvince,
      buyerAddress: fbrText(buyer.address) || buyerProvince,
      buyerRegistrationType: buyer.registered ? "Registered" : "Unregistered",
      invoiceRefNo: "",
      ...(scenarioId ? { scenarioId } : {}),
      items: fbrItems,
    },
  };
}
