"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileText, Minus, Plus, ShoppingCart, X, Maximize2 } from "lucide-react";
import { InvoiceFormModal } from "@/components/invoices/InvoiceFormModal";
import { PurchaseFormModal } from "@/components/purchases/PurchaseFormModal";
import { canOpenKind, tabLabel, useFormTabs } from "@/store/formTabsStore";

/** Keeps every open invoice / purchase form mounted (so typed data survives
 * switching), shows only the active one, and renders the floating tab bar. */
export function FormTabsHost() {
  const router = useRouter();
  const { tabs, activeId, minimized, openNew, activate, close, cycle, setMinimized, markSaved } = useFormTabs();
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

  if (tabs.length === 0) return null;

  return (
    <>
      {tabs.map((t) => {
        const visible = t.id === activeId && !minimized;
        const done = () => {
          markSaved(t.kind);
          close(t.id);
        };
        return (
          <div key={t.id} className={visible ? "" : "hidden"}>
            {t.kind === "invoice" ? (
              <InvoiceFormModal invoice={t.invoice ?? null} rxId={t.rxId} active={visible} onClose={() => close(t.id)} onSaved={done} />
            ) : (
              <PurchaseFormModal
                purchase={t.purchase ?? null}
                draftId={t.draftId}
                active={visible}
                onClose={() => close(t.id)}
                onSaved={done}
              />
            )}
          </div>
        );
      })}

      <div className="fixed left-1/2 top-2 z-[55] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full bg-neutral-900/95 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur print:hidden">
        {tabs.map((t, i) => {
          const isActive = t.id === activeId && !minimized;
          const Icon = t.kind === "invoice" ? FileText : ShoppingCart;
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
