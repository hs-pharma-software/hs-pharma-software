import { create } from "zustand";
import type { Invoice, Purchase } from "../lib/types2";
import { hasModuleAccess } from "../lib/moduleAccess";
import { useAuthStore } from "./authStore";

export type TabKind = "invoice" | "purchase";

export interface FormTab {
  id: string;
  kind: TabKind;
  /** 1, 2, 3... per kind, for "Invoice 2" style labels. */
  seq: number;
  /** Set when the tab edits an existing record. */
  invoice?: Invoice;
  purchase?: Purchase;
  /** Purchase draft being resumed. */
  draftId?: string;
  /** Prescription ID: pre-populate the invoice from this rx when opening new. */
  rxId?: string;
}

const MODULE: Record<TabKind, string> = { invoice: "invoices", purchase: "purchase" };

/** Whether the logged-in user may open this kind of form at all (plan and
 * per-user module permissions). */
export function canOpenKind(kind: TabKind): boolean {
  const key = MODULE[kind];
  const perms = useAuthStore.getState().currentUser?.permissions ?? null;
  return hasModuleAccess(key) && (perms === null || perms.includes(key));
}

export function tabLabel(t: FormTab): string {
  if (t.invoice) return `Edit Inv #${t.invoice.invoice_no ?? ""}`;
  if (t.purchase) return `Edit Pur #${t.purchase.purchase_no ?? ""}`;
  if (t.draftId) return "Purchase draft";
  return `${t.kind === "invoice" ? "Invoice" : "Purchase"} ${t.seq}`;
}

interface FormTabsState {
  tabs: FormTab[];
  activeId: string | null;
  /** All forms hidden (tabs stay open in the floating bar). */
  minimized: boolean;
  /** Bumped when a form saves, so list screens know to reload. */
  savedTick: Record<TabKind, number>;
  openNew: (kind: TabKind) => void;
  openNewFromRx: (rxId: string) => void;
  openEditInvoice: (invoice: Invoice) => void;
  openEditPurchase: (purchase: Purchase) => void;
  openPurchaseDraft: (draftId: string) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  cycle: (dir: 1 | -1) => void;
  setMinimized: (v: boolean) => void;
  markSaved: (kind: TabKind) => void;
}

let counter = 0;
const newId = () => `tab-${Date.now().toString(36)}-${++counter}`;

export const useFormTabs = create<FormTabsState>()((set, get) => ({
  tabs: [],
  activeId: null,
  minimized: false,
  savedTick: { invoice: 0, purchase: 0 },

  openNew: (kind) => {
    if (!canOpenKind(kind)) return;
    const used = new Set(get().tabs.filter((t) => t.kind === kind && !t.invoice && !t.purchase && !t.draftId).map((t) => t.seq));
    let seq = 1;
    while (used.has(seq)) seq++;
    const tab: FormTab = { id: newId(), kind, seq };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id, minimized: false }));
  },

  openNewFromRx: (rxId) => {
    if (!canOpenKind("invoice")) return;
    // Reuse an existing rx tab if already open for this prescription.
    const existing = get().tabs.find((t) => t.rxId === rxId);
    if (existing) return set({ activeId: existing.id, minimized: false });
    const used = new Set(get().tabs.filter((t) => t.kind === "invoice" && !t.invoice).map((t) => t.seq));
    let seq = 1;
    while (used.has(seq)) seq++;
    const tab: FormTab = { id: newId(), kind: "invoice", seq, rxId };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id, minimized: false }));
  },

  openEditInvoice: (invoice) => {
    const existing = get().tabs.find((t) => t.invoice?.id === invoice.id);
    if (existing) return set({ activeId: existing.id, minimized: false });
    const tab: FormTab = { id: newId(), kind: "invoice", seq: 0, invoice };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id, minimized: false }));
  },

  openEditPurchase: (purchase) => {
    const existing = get().tabs.find((t) => t.purchase?.id === purchase.id);
    if (existing) return set({ activeId: existing.id, minimized: false });
    const tab: FormTab = { id: newId(), kind: "purchase", seq: 0, purchase };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id, minimized: false }));
  },

  openPurchaseDraft: (draftId) => {
    if (!canOpenKind("purchase")) return;
    const existing = get().tabs.find((t) => t.draftId === draftId);
    if (existing) return set({ activeId: existing.id, minimized: false });
    const tab: FormTab = { id: newId(), kind: "purchase", seq: 0, draftId };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id, minimized: false }));
  },

  activate: (id) => set({ activeId: id, minimized: false }),

  close: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeId = s.activeId;
      if (s.activeId === id) activeId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
      return { tabs, activeId };
    }),

  cycle: (dir) =>
    set((s) => {
      if (s.tabs.length === 0) return {};
      const idx = Math.max(0, s.tabs.findIndex((t) => t.id === s.activeId));
      const next = s.tabs[(idx + dir + s.tabs.length) % s.tabs.length];
      return { activeId: next.id, minimized: false };
    }),

  setMinimized: (minimized) => set({ minimized }),

  markSaved: (kind) => set((s) => ({ savedTick: { ...s.savedTick, [kind]: s.savedTick[kind] + 1 } })),
}));

// Open invoice / purchase forms hold the previous tenant's products and
// parties: close them all whenever the signed-in tenant changes (switch,
// logout), so nothing from one business is shown or saved under another.
useAuthStore.subscribe((s, prev) => {
  if (s.currentTenant?.id !== prev.currentTenant?.id) useFormTabs.setState({ tabs: [], activeId: null, minimized: false });
});
