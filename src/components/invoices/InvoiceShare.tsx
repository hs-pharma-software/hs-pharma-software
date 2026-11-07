"use client";

import { useEffect, useState } from "react";
import { Download, MessageCircle, Share2, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useCan } from "@/lib/actionPermissions";
import { SERVER_DB } from "@/lib/serverMode";
import { canShareFiles, fetchInvoicePdf, normalizePhone, saveBlob, whatsappInfo, type WhatsAppInfo } from "@/lib/invoiceShare";

/** Which sharing actions this login has (Super Admin switch + owner's staff setting). */
export function useInvoiceShare() {
  const pdf = useCan("invoice.pdf");
  const whatsapp = useCan("invoice.whatsapp");
  return { pdf: SERVER_DB && pdf, whatsapp: SERVER_DB && whatsapp };
}

/** "Download PDF" and "Send on WhatsApp", only when allowed. */
export function InvoiceShareButtons({ invoiceId, size = "md" }: { invoiceId: string; size?: "sm" | "md" }) {
  const { pdf, whatsapp } = useInvoiceShare();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waOpen, setWaOpen] = useState(false);
  if (!pdf && !whatsapp) return null;
  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, fileName } = await fetchInvoicePdf(invoiceId, "download");
      saveBlob(blob, fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const cls = size === "sm" ? "!px-3 text-xs" : "";
  return (
    <>
      {pdf && (
        <Button type="button" className={cls} disabled={busy} onClick={() => void download()} title="Download PDF">
          <Download size={15} /> {busy ? "Preparing…" : "PDF"}
        </Button>
      )}
      {whatsapp && (
        <Button type="button" className={`${cls} !text-[#128c4a]`} onClick={() => setWaOpen(true)} title="Send on WhatsApp">
          <MessageCircle size={15} /> WhatsApp
        </Button>
      )}
      {error && <span role="alert" className="text-xs text-rose-600">{error}</span>}
      {waOpen && <WhatsAppShareDialog invoiceId={invoiceId} onClose={() => setWaOpen(false)} />}
    </>
  );
}

/** Send on WhatsApp: the person checks the number and message, then shares the
 * PDF through the phone's share sheet (where supported) or opens WhatsApp with
 * the message (WhatsApp links cannot carry a file). Nothing is sent by the app. */
export function WhatsAppShareDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { pdf } = useInvoiceShare();
  const [info, setInfo] = useState<WhatsAppInfo | null>(null);
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "share" | "open" | "save">(null);
  const [fileShare, setFileShare] = useState(false);
  // The PDF is made when the dialog opens: the phone opens its share sheet only
  // straight from a tap, so nothing may be downloaded between the tap and the share.
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    const files = canShareFiles();
    setFileShare(files);
    whatsappInfo(invoiceId)
      .then((i) => { setInfo(i); setPhone(i.phone ?? ""); setMessage(i.message); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (files) {
      fetchInvoicePdf(invoiceId, "share")
        .then(({ blob, fileName }) => setFile(new File([blob], fileName, { type: "application/pdf" })))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }, [invoiceId]);

  async function sharePdf() {
    if (busy || !file) return;
    setError(null);
    setStatus(null);
    try {
      if (!navigator.canShare?.({ files: [file] })) throw new Error("This browser cannot share files. Use Save PDF and Open WhatsApp instead.");
      // Share first (still inside the tap), then log; nothing is awaited before it.
      const sharing = navigator.share({ files: [file], text: message });
      setBusy("share");
      void whatsappInfo(invoiceId, { channel: "share-sheet" }).catch(() => undefined);
      await sharing;
      setStatus("The share sheet closed. If you picked WhatsApp, check there that the message went to the right person.");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setStatus("Sharing cancelled. Nothing was sent.");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function openWhatsApp() {
    if (busy) return;
    const p = normalizePhone(phone);
    if (!p.ok) return setError(p.error);
    setBusy("open");
    setError(null);
    try {
      await whatsappInfo(invoiceId, { channel: "link" });
      window.open(`https://wa.me/${p.intl}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
      setStatus(`WhatsApp opened for ${p.display} with the message. Press send there yourself${pdf || fileShare ? "; to include the invoice, attach the saved PDF" : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function savePdf() {
    if (busy) return;
    setBusy("save");
    setError(null);
    try {
      const { blob, fileName } = await fetchInvoicePdf(invoiceId, "share");
      saveBlob(blob, fileName);
      setStatus(`${fileName} saved to your downloads. Open WhatsApp, then attach it in the chat (📎 › Document).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const check = phone ? normalizePhone(phone) : null;
  return (
    <Modal title={`Send invoice ${info?.invoiceNo != null ? `#${info.invoiceNo} ` : ""}on WhatsApp`} onClose={onClose} width="max-w-md">
      {!info && !error ? <p className="py-6 text-center text-sm text-neutral-500">Loading…</p> : (
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Customer&apos;s WhatsApp number</span>
            <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx xxxxxxx"
              className="rounded-lg border border-neutral-300 px-3 py-2" aria-describedby="wa-phone-help" />
            <span id="wa-phone-help" className={`text-xs ${check && !check.ok ? "text-rose-600" : "text-neutral-500"}`}>
              {check ? (check.ok ? `Will open ${check.display}` : check.error) : "Only for this message; the customer's saved number is not changed."}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Message</span>
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} className="rounded-lg border border-neutral-300 px-3 py-2" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}
          {status && <p role="status" className="flex gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sky-900"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{status}</p>}
          <div className="flex flex-col gap-2">
            {fileShare && (
              <Button type="button" variant="primary" disabled={!!busy || !info || !file} onClick={() => void sharePdf()}>
                <Share2 size={15} /> {!file ? "Preparing PDF…" : busy === "share" ? "Sharing…" : "Share invoice PDF…"}
              </Button>
            )}
            <Button type="button" variant={fileShare ? "secondary" : "primary"} disabled={!!busy || !info} onClick={() => void openWhatsApp()}>
              <MessageCircle size={15} /> {busy === "open" ? "Opening…" : "Open WhatsApp message"}
            </Button>
            {!fileShare && (
              <Button type="button" disabled={!!busy || !info} onClick={() => void savePdf()}>
                <Download size={15} /> {busy === "save" ? "Preparing PDF…" : "Save PDF to attach"}
              </Button>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            {fileShare
              ? "Share invoice PDF opens your phone's share sheet: pick WhatsApp and the chat. Open WhatsApp message sends text only (WhatsApp links cannot carry a file)."
              : "WhatsApp links carry text only. Save the PDF first, then attach it in the WhatsApp chat."}
          </p>
        </div>
      )}
    </Modal>
  );
}

/** After saving an invoice: a small notice with PDF / WhatsApp (only when allowed). */
export function InvoiceSavedNotice({ invoiceId, invoiceNo, onClose }: { invoiceId: string; invoiceNo: number | null; onClose: () => void }) {
  const { pdf, whatsapp } = useInvoiceShare();
  if (!pdf && !whatsapp) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-black/10 md:bottom-6 print:hidden">
      <CheckCircle2 size={18} className="text-emerald-600" />
      <span className="mr-auto text-sm font-medium text-neutral-900">Invoice {invoiceNo != null ? `#${invoiceNo} ` : ""}saved</span>
      <InvoiceShareButtons invoiceId={invoiceId} size="sm" />
      <button type="button" aria-label="Close" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"><X size={16} /></button>
    </div>
  );
}
