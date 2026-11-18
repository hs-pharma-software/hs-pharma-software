/** PRA eIMS from the business's own screens (MAVIN's server does the sending):
 * is the business fiscalised by MAVIN.pk, a bill's PRA record, and handing a
 * saved invoice to PRA. Every call fails quietly: billing never waits on PRA. */
import { useEffect, useState } from "react";
import { getSetting } from "@/lib/repo/settings";
import { serverJson } from "@/lib/serverMode";
import { praVerifyUrl } from "@/lib/restaurant/praModel";
import { useAuthStore } from "@/store/authStore";

export interface PraRecord {
  id: string; status: string; fiscalInvoiceNo: string | null; usin: string; environment: string; invoiceType: number;
  blockedReason: string | null; responseText: string | null; refFiscalInvoiceNo: string | null;
}

/** Set by MAVIN's server when the Super Admin enables PRA for the business. */
export async function praManaged(): Promise<boolean> {
  return (await getSetting("pra_server_managed").catch(() => null)) === "true";
}

const PRA_CHANGED = "mavin:pra-settings-changed";

/** A contractor integrated with PRA: `integrated` shows the PRA section and
 * Services; `sending` (the owner's switch) offers the PRA Invoice type. */
export function usePraContractor(): { loaded: boolean; integrated: boolean; sending: boolean } {
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const contractor = useAuthStore((s) => s.currentTenant?.businessType === "contractor");
  const [state, setState] = useState({ loaded: false, integrated: false, sending: false });
  useEffect(() => {
    if (!tenantId || !contractor) {
      setState({ loaded: Boolean(tenantId), integrated: false, sending: false });
      return;
    }
    let live = true;
    const read = async () => {
      const [managed, sending] = await Promise.all([praManaged(), getSetting("pra_sending").catch(() => null)]);
      if (live) setState({ loaded: true, integrated: managed, sending: managed && sending !== "off" });
    };
    void read();
    window.addEventListener(PRA_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(PRA_CHANGED, read);
    };
  }, [tenantId, contractor]);
  return state;
}

/** The owner's switch: PRA invoices are sent, or held until it is on again. */
export async function setPraSending(enabled: boolean): Promise<void> {
  await serverJson("/api/pra/", { action: "set_sending", enabled });
  window.dispatchEvent(new Event(PRA_CHANGED));
}

/** The PRA record of a bill (an invoice or a restaurant order), or null. */
export async function praRecord(sourceType: "invoice" | "rest_order", sourceId: string): Promise<PraRecord | null> {
  return serverJson<{ result: PraRecord | null }>("/api/pra/", { action: "for_source", sourceType, sourceId }).then((r) => r.result).catch(() => null);
}

/** After an invoice is saved: hand it to PRA (MAVIN's server records it before sending; repeat calls send nothing twice). */
export async function fiscalizeInvoice(invoiceId: string): Promise<PraRecord | null> {
  if (!(await praManaged())) return null;
  return serverJson<{ result: PraRecord }>("/api/pra/", { action: "submit", invoiceId }).then((r) => r.result).catch(() => null);
}

/** Editing an invoice PRA already has (or may have) would make the books differ from PRA's: a return / credit note is needed instead. */
export async function praEditBlock(invoiceId: string): Promise<string | null> {
  if (!(await praManaged())) return null;
  const r = await praRecord("invoice", invoiceId);
  if (!r || r.status === "blocked") return null;
  return r.status === "accepted"
    ? `This invoice was fiscalised with PRA (${r.fiscalInvoiceNo}). It can't be edited: make a return (credit note) and a new invoice instead.`
    : `This invoice has been sent to PRA (${r.status.replace("_", " ")}). Edit it only after it is resolved under PRA; otherwise make a return and a new invoice.`;
}

/** What the invoice print shows: only an accepted fiscal number, with PRA's verification QR. */
export function praPrint(r: PraRecord | null, pntn?: string | null): { fiscalNo: string; qrUrl: string; pntn?: string | null } | null {
  return r?.status === "accepted" && r.fiscalInvoiceNo ? { fiscalNo: r.fiscalInvoiceNo, qrUrl: praVerifyUrl(r.fiscalInvoiceNo), pntn } : null;
}

/** The band at the top of a contractor's invoice: which tax authority it is for, and how far it has got. */
export interface InvoiceAuthority {
  kind: "fbr" | "pra";
  title: string;
  tax: string;
  status: string;
  confirmed: boolean;
}

export function invoiceAuthority(o: { isPra: boolean; fbrInvoiceNo: string | null; fbrEnabled: boolean; pra: PraRecord | null }): InvoiceAuthority | null {
  if (o.isPra) {
    const accepted = o.pra?.status === "accepted" && Boolean(o.pra.fiscalInvoiceNo);
    const sandbox = o.pra?.environment === "sandbox";
    return {
      kind: "pra", title: "PRA e-Invoice", tax: "Punjab Sales Tax on Services (PST)", confirmed: accepted,
      status: accepted ? (sandbox ? "Sandbox test, not a live invoice" : "Accepted by PRA") : "Awaiting PRA confirmation",
    };
  }
  if (o.fbrInvoiceNo) return { kind: "fbr", title: "FBR Digital Invoice", tax: "Federal Sales Tax (GST)", status: "Reported to FBR", confirmed: true };
  return o.fbrEnabled ? { kind: "fbr", title: "FBR Digital Invoice", tax: "Federal Sales Tax (GST)", status: "Not reported to FBR yet", confirmed: false } : null;
}
