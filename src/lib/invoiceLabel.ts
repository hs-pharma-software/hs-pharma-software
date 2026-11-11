/** How an invoice is named on screen: "#12" once MAVIN.pk has numbered it.
 * A sale made offline on the desktop app has no number until it is sent, so
 * until then it shows its offline reference (e.g. "D5C7F-000001"). */
export function invoiceLabel(r: { invoice_no: number | null; offline_ref?: string | null }): string {
  if (r.invoice_no != null) return `#${r.invoice_no}`;
  return r.offline_ref || "#—";
}
