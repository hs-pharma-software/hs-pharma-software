"use client";

/** Browser side of invoice PDF and WhatsApp sharing (server: src/server/invoicePdf.ts). */
import { BRANCH_TAB_KEY } from "@/config/branchTables";
import { serverJson } from "./serverMode";

function tabBranch(): string | null {
  try { return sessionStorage.getItem(BRANCH_TAB_KEY); } catch { return null; }
}

/** The invoice PDF from the server (checks permission, business and branch there). */
export async function fetchInvoicePdf(invoiceId: string, purpose: "download" | "share"): Promise<{ blob: Blob; fileName: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const b = tabBranch();
  if (b) headers["X-Branch"] = b;
  let res: Response;
  try {
    res = await fetch("/api/invoices/share/", { method: "POST", credentials: "same-origin", headers, body: JSON.stringify({ action: "pdf", invoiceId, purpose }) });
  } catch {
    throw new Error("No connection. Check the internet and try again.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `The PDF could not be made (error ${res.status}).`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "Invoice.pdf";
  return { blob: await res.blob(), fileName: name };
}

/** Saves a file through the browser's download. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface WhatsAppInfo { message: string; phone: string | null; invoiceNo: number | null; fileName: string }

/** The short message and saved phone (checks the WhatsApp permission). `log` records that WhatsApp was opened. */
export function whatsappInfo(invoiceId: string, log?: { channel: "link" | "share-sheet" }) {
  return serverJson<{ result: WhatsAppInfo }>("/api/invoices/share/", { action: "whatsapp", invoiceId, ...(log ? { log: "open", channel: log.channel } : {}) }).then((r) => r.result);
}

/** Pakistan-first phone check: 03xx-xxxxxxx, +92 3xx..., 92 3xx... or another country's +number. */
export function normalizePhone(input: string): { ok: true; intl: string; display: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter the customer's WhatsApp number." };
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = `92${d.slice(1)}`;
  else if (/^3\d{9}$/.test(d)) d = `92${d}`;
  if (!/^\d{8,15}$/.test(d)) return { ok: false, error: "This does not look like a phone number. Use 03xx-xxxxxxx or +92 3xx xxxxxxx." };
  if (d.startsWith("92") && !/^923\d{9}$/.test(d)) return { ok: false, error: "A Pakistani WhatsApp number is 03xx followed by 7 digits." };
  return { ok: true, intl: d, display: `+${d}` };
}

/** Whether this browser can hand a PDF file to the share sheet (Android Chrome, Safari, ...). */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator === "undefined" || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File([new Uint8Array([37])], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}
