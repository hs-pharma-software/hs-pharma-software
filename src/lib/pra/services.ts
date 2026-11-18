/** Contractors integrated with PRA: what marks a service, a PRA invoice, and
 * how the year's tax divides between FBR (GST) and PRA (PST). Pure functions,
 * no imports: the server, the pages and the tests use the same code.
 *
 * A service is a row of `products` with this classification: invoice lines,
 * reports and returns then work as for any item, but a service holds no stock
 * and stays out of the product, stock and purchase screens. */

export const PRA_SERVICE = "pra_service";
/** invoices.invoice_type of an invoice that goes to PRA (General and Medicine go to FBR). */
export const PRA_INVOICE_TYPE = "pra";

export const isPraService = (p: { product_classification?: string | null } | null | undefined): boolean =>
  p?.product_classification === PRA_SERVICE;

export const isPraInvoice = (invoiceType: string | null | undefined): boolean =>
  String(invoiceType ?? "").toLowerCase() === PRA_INVOICE_TYPE;

/** SQL condition: this products row is not a service (`p` = the table's alias, if any). */
export const notServiceSql = (alias?: string): string =>
  `COALESCE(${alias ? `${alias}.` : ""}product_classification, '') <> '${PRA_SERVICE}'`;

/** "98240000" or "9824.0000" as PRA's schedule writes it: "9824.0000". Null unless it has exactly 8 digits. */
export function formatPctCode(value: string | null | undefined): string | null {
  const d = String(value ?? "").replace(/[\s.]/g, "");
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}.${d.slice(4)}` : null;
}

export interface YearTaxSale { invoice_type: string | null; tax: number | null }
export interface YearTaxReturn { invoice_type: string | null; qty: number | null; orig_tax: number | null; orig_qty: number | null }

/** The year's tax: PRA invoices are PST, every other invoice GST. A return is
 * saved without tax on its lines, so it takes back the original line's tax in
 * proportion to the quantity returned. */
export function splitYearTax(sales: YearTaxSale[], returns: YearTaxReturn[]): { gst: number; pst: number } {
  let gst = 0;
  let pst = 0;
  const add = (type: string | null, amount: number) => {
    if (isPraInvoice(type)) pst += amount;
    else gst += amount;
  };
  for (const s of sales) add(s.invoice_type, Number(s.tax) || 0);
  for (const r of returns) {
    const origQty = Number(r.orig_qty) || 0;
    if (origQty > 0) add(r.invoice_type, -((Number(r.orig_tax) || 0) * (Number(r.qty) || 0)) / origQty);
  }
  const money = (n: number) => Math.round(n * 100) / 100;
  return { gst: money(gst), pst: money(pst) };
}
