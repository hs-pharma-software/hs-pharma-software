import { dbSelect } from "./db";
import { useAuthStore } from "../store/authStore";
import { invoicesRepo } from "./repo/invoices";
import { customersRepo } from "./repo/customers";
import { activeToken, fetchFbrHsUoms, submitInvoiceToFbr, type FbrSettings, type FbrSubmitResult } from "./fbr";
import { buildFbrPayload, type FbrItemRow } from "./fbrPayload";

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

  const token = activeToken(settings);
  const allowedUoms = new Map<string, string[]>();
  for (const hs of new Set(items.map((i) => i.hs_code).filter((h): h is string => !!h))) {
    const list = token ? await fetchFbrHsUoms(token, hs).catch(() => null) : null;
    if (list) allowedUoms.set(hs, list);
  }

  const built = buildFbrPayload(
    invoice.date,
    {
      name: invoice.customer_name || customer?.name || null,
      ntnCnic: invoice.buyer_ntn_cnic || customer?.cnic_ntn || null,
      province: invoice.buyer_province || customer?.province || null,
      address: invoice.buyer_address || customer?.address || null,
      registered: invoice.buyer_registration_type === "Registered",
    },
    items,
    settings,
    allowedUoms
  );
  if ("error" in built) return fail(built.error);

  const result = await submitInvoiceToFbr(built.payload, settings);
  if (result.success && result.fbrInvoiceNo) {
    await invoicesRepo.update(invoiceId, { fbr_invoice_no: result.fbrInvoiceNo });
  }
  return result;
}
