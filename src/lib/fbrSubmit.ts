import { dbSelect } from "./db";
import { useAuthStore } from "../store/authStore";
import { invoicesRepo } from "./repo/invoices";
import { customersRepo } from "./repo/customers";
import { submitInvoiceToFbr, type FbrSettings, type FbrSubmitResult, type FbrInvoiceItem } from "./fbr";
import { toFbrProvince, isValidNtnOrCnic } from "./fbrData";

interface FbrItemRow {
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
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Loads the invoice, its buyer snapshot and per-product FBR data, submits it,
 * and stores the returned FBR invoice number on success. */
export async function submitInvoiceToFbrById(invoiceId: string, settings: FbrSettings): Promise<FbrSubmitResult> {
  const fail = (error: string): FbrSubmitResult => ({ success: false, fbrInvoiceNo: null, error, rawResponse: null });

  const invoice = await invoicesRepo.get(invoiceId);
  if (!invoice) return fail("Invoice not found.");
  if (invoice.fbr_invoice_no) {
    return { success: true, fbrInvoiceNo: invoice.fbr_invoice_no, error: null, rawResponse: null };
  }

  const customer = invoice.customer_id ? await customersRepo.get(invoice.customer_id) : null;
  const buyerName = invoice.customer_name || customer?.name || "Walk-in Customer";
  const buyerNtn = (invoice.buyer_ntn_cnic || customer?.cnic_ntn || "").replace(/[\s-]/g, "");
  const buyerProvince = toFbrProvince(invoice.buyer_province || customer?.province || settings.sellerProvince);
  const buyerAddress = invoice.buyer_address || customer?.address || "";
  const registration = invoice.buyer_registration_type === "Registered" ? "Registered" : "Unregistered";

  if (!settings.sellerNtn) return fail("Seller NTN/CNIC is missing in Settings > FBR.");
  if (registration === "Registered" && !buyerNtn) return fail("Registered buyer requires an NTN/CNIC.");
  if (buyerNtn && !isValidNtnOrCnic(buyerNtn)) return fail("Buyer NTN must be 7-9 digits or CNIC 13 digits.");

  const items = await dbSelect<FbrItemRow>(
    `
    SELECT ii.qty, ii.sale_price, ii.tax_pct, ii.further_tax_pct, ii.discount_rs,
           p.name AS product_name, p.hs_code, p.fbr_sale_type, p.fbr_sale_rate, p.fbr_uom,
           p.sro_no, p.sro_item_serial_no
    FROM invoice_items ii
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = ? AND ii.tenant_id = ? AND ii.deleted_at IS NULL
  `,
    [invoiceId, useAuthStore.getState().currentTenant?.id ?? null]
  );
  if (items.length === 0) return fail("Invoice has no line items.");

  const missing = items.filter((i) => !i.hs_code || !i.fbr_sale_type || !i.fbr_uom).map((i) => i.product_name);
  if (missing.length > 0) return fail(`FBR data missing on product(s): ${missing.join(", ")}`);

  const fbrItems: FbrInvoiceItem[] = items.map((i) => {
    const rate = i.fbr_sale_rate ?? i.tax_pct ?? 0;
    const valueExclST = round2(i.sale_price * i.qty - (i.discount_rs ?? 0));
    const salesTax = round2((valueExclST * rate) / 100);
    const furtherTax = registration === "Unregistered" ? round2((valueExclST * (i.further_tax_pct ?? 0)) / 100) : 0;
    return {
      hsCode: i.hs_code!,
      productDescription: i.product_name ?? "",
      rate: `${rate}%`,
      uoM: i.fbr_uom!,
      quantity: i.qty,
      totalValues: round2(valueExclST + salesTax + furtherTax),
      valueSalesExcludingST: valueExclST,
      fixedNotifiedValueOrRetailPrice: 0,
      salesTaxApplicable: salesTax,
      salesTaxWithheldAtSource: 0,
      extraTax: 0,
      furtherTax,
      sroScheduleNo: i.sro_no ?? "",
      fedPayable: 0,
      discount: round2(i.discount_rs ?? 0),
      saleType: i.fbr_sale_type!,
      sroItemSerialNo: i.sro_item_serial_no ?? "",
    };
  });

  const result = await submitInvoiceToFbr(
    {
      invoiceType: "Sale Invoice",
      invoiceDate: invoice.date,
      sellerNTNCNIC: settings.sellerNtn,
      sellerBusinessName: settings.sellerName,
      sellerProvince: toFbrProvince(settings.sellerProvince),
      sellerAddress: settings.sellerAddress,
      ...(buyerNtn ? { buyerNTNCNIC: buyerNtn } : {}),
      buyerBusinessName: buyerName,
      buyerProvince,
      buyerAddress,
      buyerRegistrationType: registration,
      items: fbrItems,
    },
    settings
  );

  if (result.success && result.fbrInvoiceNo) {
    await invoicesRepo.update(invoiceId, { fbr_invoice_no: result.fbrInvoiceNo });
  }
  return result;
}
