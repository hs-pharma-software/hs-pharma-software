"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Minus, Plus, ShoppingCart, X, Maximize2 } from "lucide-react";
import { InvoiceFormModal } from "@/components/invoices/InvoiceFormModal";
import { InvoiceSavedNotice } from "@/components/invoices/InvoiceShare";
import { PurchaseFormModal } from "@/components/purchases/PurchaseFormModal";
import { InvoiceViewModal } from "@/components/invoices/InvoiceViewModal";
import { desktopBridge, desktopCall } from "@/lib/desktopBridge";
import { invoiceViewRow } from "@/lib/repo/invoices";
import { isPraInvoice } from "@/lib/pra/services";
import { notify } from "@/lib/notify";
import { canOpenKind, tabLabel, useFormTabs } from "@/store/formTabsStore";

/** Keeps every open invoice / purchase form mounted (so typed data survives
 * switching), shows only the active one, and renders the floating tab bar. */
export function FormTabsHost() {
  const router = useRouter();
  const { tabs, activeId, minimized, saving, openNew, activate, close, cycle, setMinimized, markSaved, saveStarted, needsAttention } = useFormTabs();
  // The Windows app: new invoices waiting for the default printer, one at a time.
  const [toPrint, setToPrint] = useState<NonNullable<Awaited<ReturnType<typeof invoiceViewRow>>>[]>([]);
  const printing = toPrint[0] ?? null;
  // The invoice just saved: PDF / WhatsApp offered (when allowed) after its tab closes.
  const [saved, setSaved] = useState<{ id: string; no: number | null; offlineReceipt?: string; offlineRef?: string } | null>(null);
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      // Ctrl+N: new invoice tab, from any screen.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "n") {
        e.preventDefault();
        openNew("invoice");
        return;
      }
      // Ctrl+D with no invoice form in front: open the saved drafts.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "d") {
        e.preventDefault();
        const st = useFormTabs.getState();
        const front = st.tabs.find((t) => t.id === st.activeId);
        if (!front || st.minimized) router.push("/invoices/memorized");
        return; // the form in front saves itself as a draft
      }
      if (tabs.length === 0) return;
      // Next / previous tab. (Alt+Tab is taken by Windows itself.)
      if ((e.ctrlKey && key === "tab") || (e.altKey && (key === "arrowright" || key === "arrowleft"))) {
        e.preventDefault();
        cycle(key === "arrowleft" || (key === "tab" && e.shiftKey) ? -1 : 1);
        return;
      }
      // Alt+1..9: jump to that tab.
      if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
        const t = tabs[Number(e.key) - 1];
        if (t) {
          e.preventDefault();
          activate(t.id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, openNew, cycle, activate, router]);

  // Closing the app while something is still being saved asks first.
  useEffect(() => {
    if (saving.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving.length]);

  /** The Windows app prints a new invoice by itself, on the default printer. */
  function printNew(inv: { id: string; offlineReceipt?: string }) {
    if (!desktopBridge()) return;
    const failed = (e: unknown) => notify(`The receipt did not print: ${e instanceof Error ? e.message : String(e)}`);
    if (inv.offlineReceipt) { void desktopCall((b) => b.printText(inv.offlineReceipt!)).catch(failed); return; }
    void invoiceViewRow(inv.id).then((row) => {
      // A PRA Invoice is printed once PRA has given its number.
      if (row && !isPraInvoice(row.invoice.invoice_type)) setToPrint((q) => [...q, row]);
    }).catch(failed);
  }

  const notice = (
    <>
      {saved && <InvoiceSavedNotice key={saved.id} invoiceId={saved.id} invoiceNo={saved.no} offlineReceipt={saved.offlineReceipt} offlineRef={saved.offlineRef} onClose={() => setSaved(null)} />}
      {printing && <InvoiceViewModal key={printing.invoice.id} row={printing} autoPrint onClose={() => setToPrint((q) => q.slice(1))} />}
    </>
  );
  if (tabs.length === 0) return notice;

  return (
    <>
      {notice}
      {tabs.map((t) => {
        const visible = t.id === activeId && !minimized;
        const done = (inv?: { id: string; no: number | null; offlineReceipt?: string; offlineRef?: string }) => {
          markSaved(t.kind);
          close(t.id);
          if (t.kind === "invoice" && inv) {
            setSaved(inv);
            if (!t.invoice) printNew(inv);
          }
        };
        // The Windows app saves a new invoice or purchase behind the person's back.
        const background = desktopBridge() && !t.invoice && !t.purchase
          ? { onSaving: () => saveStarted(t.id), onAttention: () => needsAttention(t.id) } : {};
        // Only the form in front closes itself (Escape): never one that is hidden or still saving.
        const dismiss = () => { if (visible) close(t.id); };
        return (
          <div key={t.id} className={visible ? "" : "hidden"}>
            {t.kind === "invoice" ? (
              <InvoiceFormModal invoice={t.invoice ?? null} rxId={t.rxId} webOrderId={t.webOrderId} preInvoiceId={t.preInvoiceId} cloneFrom={t.cloneFrom} active={visible} onClose={dismiss} onSaved={done} {...background} />
            ) : (
              <PurchaseFormModal
                purchase={t.purchase ?? null}
                draftId={t.draftId}
                active={visible}
                onClose={dismiss}
                onSaved={() => done()}
                {...background}
              />
            )}
          </div>
        );
      })}

      <div className="fixed left-1/2 top-2 z-[55] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full bg-neutral-900/95 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur print:hidden">
        {tabs.map((t, i) => {
          const isActive = t.id === activeId && !minimized;
          const Icon = t.kind === "invoice" ? FileText : ShoppingCart;
          if (saving.includes(t.id)) {
            return (
              <div key={t.id} role="status" className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs text-amber-300">
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />Saving {tabLabel(t)}…
              </div>
            );
          }
          return (
            <div
              key={t.id}
              className={`flex shrink-0 items-center rounded-full ${isActive ? "bg-white text-neutral-900" : "text-neutral-300 hover:bg-white/10"}`}
            >
              <button
                type="button"
                onClick={() => activate(t.id)}
                title={`${tabLabel(t)} (Alt+${i + 1})`}
                className="flex items-center gap-1.5 py-1 pl-3 pr-1 text-xs font-medium"
              >
                <Icon size={13} />
                {tabLabel(t)}
              </button>
              <button
                type="button"
                title="Close tab"
                onClick={() => {
                  if (window.confirm(`Close ${tabLabel(t)}? Anything not saved in it will be lost.`)) close(t.id);
                }}
                className="mr-1 rounded-full p-1 opacity-60 hover:bg-black/10 hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        <div className="mx-0.5 h-5 w-px bg-white/15" />
        <button
          type="button"
          onClick={() => openNew("invoice")}
          disabled={!canOpenKind("invoice")}
          title="New invoice (Ctrl+N)"
          className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10 disabled:opacity-40"
        >
          <Plus size={13} /> Invoice
        </button>
        <button
          type="button"
          onClick={() => openNew("purchase")}
          disabled={!canOpenKind("purchase")}
          title="New purchase (Alt+U)"
          className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10 disabled:opacity-40"
        >
          <Plus size={13} /> Purchase
        </button>
        <button
          type="button"
          onClick={() => setMinimized(!minimized)}
          title={minimized ? "Show forms" : "Hide forms (tabs stay open)"}
          className="mr-0.5 shrink-0 rounded-full p-1.5 text-neutral-300 hover:bg-white/10"
        >
          {minimized || !activeTab ? <Maximize2 size={13} /> : <Minus size={13} />}
        </button>
      </div>
    </>
  );
}
