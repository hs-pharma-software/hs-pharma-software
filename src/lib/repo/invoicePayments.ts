/** Marking a sales invoice as paid in full from the invoice list.
 *
 * An ordinary invoice records the balance as paid (the customer's
 * receivable drops with it). A hospital surgery invoice takes its paid
 * amount from the admission's payments, so the balance is recorded as a
 * payment on the admission and the invoice follows from that. */
import { invoicesRepo } from "./invoices";
import { addPayment } from "./hospital";
import { localDateTime } from "../localDate";
import type { Invoice } from "../types2";
import type { PaymentMethod } from "../types-hospital";

const round = (n: number) => Math.round(n * 100) / 100;

export async function markInvoicePaid(invoiceId: string, method: PaymentMethod = "cash"): Promise<Invoice> {
  const inv = await invoicesRepo.get(invoiceId);
  if (!inv) throw new Error("Invoice not found.");
  if (inv.is_quotation) throw new Error("A quotation is not an invoice; convert it first.");
  if (inv.is_return) throw new Error("A return invoice is not paid by the customer.");
  const balance = round(Number(inv.balance));
  if (!(balance > 0)) throw new Error("This invoice is already paid.");

  if (inv.invoice_type === "hospital_surgery" && inv.hospital_episode_id) {
    await addPayment({
      tenant_id: "", episode_id: inv.hospital_episode_id, type: "payment", amount: balance, method,
      reference: inv.invoice_no ? `Invoice ${inv.invoice_no}` : null, notes: "Surgery invoice marked paid", received_at: localDateTime(),
    });
    return (await invoicesRepo.get(invoiceId))!;
  }
  return (await invoicesRepo.update(invoiceId, { paid: round(Number(inv.paid) + balance), balance: 0 }))!;
}
