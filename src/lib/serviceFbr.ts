/** FBR Digital Invoicing for service bills that have no stock products: lab
 * visits and banquet bookings. Their lines are services, so the FBR item
 * details (HS / service code, sale type, rate, UOM) come from the business's
 * settings (General Settings > FBR for service bills) instead of a product.
 * The tokens, seller details and submission are the same as for invoices. */
import { getSetting, setSetting } from "./repo/settings";
import { invoicesRepo } from "./repo/invoices";
import { activeToken, fetchFbrHsUoms, loadFbrSettings, submitInvoiceToFbr, type FbrSubmitResult } from "./fbr";
import { buildFbrPayload, type FbrItemRow } from "./fbrPayload";

export interface ServiceFbrDefaults {
  hsCode: string;
  saleType: string;
  rate: number;
  uom: string;
}

const KEYS = { hsCode: "fbr_service_hs_code", saleType: "fbr_service_sale_type", rate: "fbr_service_rate", uom: "fbr_service_uom" } as const;

export async function loadServiceFbrDefaults(tenantId?: string): Promise<ServiceFbrDefaults> {
  const [hs, st, rate, uom] = await Promise.all([
    getSetting(KEYS.hsCode, tenantId), getSetting(KEYS.saleType, tenantId), getSetting(KEYS.rate, tenantId), getSetting(KEYS.uom, tenantId),
  ]);
  return { hsCode: hs ?? "", saleType: st ?? "", rate: Number(rate ?? 0) || 0, uom: uom ?? "" };
}

export async function saveServiceFbrDefaults(d: ServiceFbrDefaults, tenantId?: string): Promise<void> {
  await Promise.all([
    setSetting(KEYS.hsCode, d.hsCode.trim(), tenantId), setSetting(KEYS.saleType, d.saleType, tenantId),
    setSetting(KEYS.rate, String(Number(d.rate) || 0), tenantId), setSetting(KEYS.uom, d.uom.trim(), tenantId),
  ]);
}

export interface ServiceLine {
  name: string;
  qty: number;
  /** Price of one unit before the bill discount. */
  rate: number;
}

/** Sends a service bill to FBR; the bill discount is spread over its lines. */
export async function submitServiceInvoiceToFbr(invoiceId: string, lines: ServiceLine[]): Promise<FbrSubmitResult> {
  const fail = (error: string): FbrSubmitResult => ({ success: false, fbrInvoiceNo: null, error, rawResponse: null });
  const settings = await loadFbrSettings();
  if (!settings.enabled) return fail("FBR Digital Invoicing is not enabled (General Settings > FBR).");
  const invoice = await invoicesRepo.get(invoiceId);
  if (!invoice) return fail("Bill not found.");
  if (invoice.fbr_invoice_no) return { success: true, fbrInvoiceNo: invoice.fbr_invoice_no, error: null, rawResponse: null };
  const d = await loadServiceFbrDefaults();
  if (!d.hsCode || !d.saleType || !d.uom) return fail("Set the FBR details for service bills first (General Settings > FBR for service bills).");
  if (!lines.length) return fail("The bill has no lines.");

  const gross = lines.reduce((t, l) => t + l.qty * l.rate, 0);
  const billDiscount = Number(invoice.discount_rs) || 0;
  const items: FbrItemRow[] = lines.map((l) => ({
    qty: l.qty,
    sale_price: l.rate,
    tax_pct: d.rate,
    further_tax_pct: 0,
    discount_rs: gross > 0 ? Math.round(((l.qty * l.rate) / gross) * billDiscount * 100) / 100 : 0,
    product_name: l.name,
    hs_code: d.hsCode,
    fbr_sale_type: d.saleType,
    fbr_sale_rate: d.rate,
    fbr_uom: d.uom,
    sro_no: null,
    sro_item_serial_no: null,
    fbr_qty_factor: 1,
  }));
  const allowed = new Map<string, string[]>();
  const token = activeToken(settings);
  if (token) {
    try {
      allowed.set(d.hsCode, await fetchFbrHsUoms(token, d.hsCode));
    } catch {
      // reference API unreachable: FBR checks the UOM itself on submission
    }
  }
  const built = buildFbrPayload(
    invoice.date,
    {
      name: invoice.customer_name, ntnCnic: invoice.buyer_ntn_cnic, province: invoice.buyer_province,
      address: invoice.buyer_address, registered: invoice.buyer_registration_type === "Registered",
    },
    items,
    settings,
    allowed
  );
  if ("error" in built) return fail(built.error.replace(/product FBR data/, "FBR details for service bills"));
  const result = await submitInvoiceToFbr(built.payload, settings);
  if (result.success && result.fbrInvoiceNo) await invoicesRepo.update(invoiceId, { fbr_invoice_no: result.fbrInvoiceNo });
  return result;
}
