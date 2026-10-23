/** FBR Digital Invoicing for store sales invoices, reusing the app's FBR
 * payload builder and submitter (same rules and settings as pharmacy invoices). */
import { buildFbrPayload, type FbrItemRow } from "@/lib/fbrPayload";
import { activeToken, fetchFbrHsUoms, loadFbrSettings, submitInvoiceToFbr } from "@/lib/fbr";
import { electric } from "./index";

export async function submitSaleToFbr(docId: string): Promise<{ ok: boolean; fbrNo: string | null; error: string | null }> {
  const settings = await loadFbrSettings();
  if (!settings.enabled) return { ok: false, fbrNo: null, error: "FBR Digital Invoicing is not enabled (Settings > FBR)." };
  const { doc, items } = await electric.invoiceForOutput(docId, "view");
  if (doc.doc_type !== "sale") return { ok: false, fbrNo: null, error: "Only sales invoices go to FBR." };
  if (doc.fbr_invoice_no) return { ok: true, fbrNo: doc.fbr_invoice_no, error: null };
  const rows: FbrItemRow[] = [];
  for (const i of items) {
    const p = await electric.getProduct(i.product_id!);
    rows.push({
      qty: i.qty * (i.unit_factor || 1),
      sale_price: i.price / (i.unit_factor || 1),
      tax_pct: i.tax_rate,
      further_tax_pct: 0,
      discount_rs: i.discount,
      product_name: i.name,
      hs_code: p.hs_code,
      fbr_sale_type: p.fbr_sale_type,
      fbr_sale_rate: p.fbr_sale_rate,
      fbr_uom: p.fbr_uom,
      sro_no: p.sro_no,
      sro_item_serial_no: p.sro_item_serial_no,
      fbr_qty_factor: p.fbr_qty_factor,
    });
  }
  const allowed = new Map<string, string[]>();
  const token = activeToken(settings);
  for (const hs of new Set(rows.map((r) => r.hs_code).filter(Boolean) as string[])) {
    try {
      allowed.set(hs, await fetchFbrHsUoms(token, hs));
    } catch {
      // reference API down: validated by FBR itself on submission
    }
  }
  const built = buildFbrPayload(doc.date, { name: doc.party_name, ntnCnic: null, province: null, address: doc.party_address, registered: false }, rows, settings, allowed);
  if ("error" in built) return { ok: false, fbrNo: null, error: built.error };
  const res = await submitInvoiceToFbr(built.payload, settings);
  await electric.setFbrResult(docId, res.success, res.fbrInvoiceNo, res.error);
  return { ok: res.success, fbrNo: res.fbrInvoiceNo, error: res.error };
}
