import { create } from "zustand";

export type SyncStatus = "idle" | "syncing" | "error";

export type PendingAction =
  | "new-invoice"
  | "new-purchase"
  | "new-order"
  | "new-expense"
  | "new-audit"
  | "new-invoice-from-rx"
  | null;

interface AppState {
  online: boolean;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  pendingCount: number;
  lastError: string | null;
  sidebarCollapsed: boolean;
  /** Slide-in drawer state for mobile screens (< md breakpoint). */
  sidebarMobileOpen: boolean;
  /** Set by global keyboard shortcuts (see GlobalShortcuts.tsx), consumed by
   * the page that can act on it (e.g. Invoices opens Create Invoice when
   * this becomes "new-invoice"), which then clears it back to null. */
  pendingAction: PendingAction;
  /** Prescription ID to pre-populate when pendingAction is "new-invoice-from-rx". */
  pendingRxId: string | null;
  /** CTRL+T (System Calculator) toggles this \u2014 see GlobalShortcuts.tsx and
   * the Calculator component mounted in AppShell. */
  calculatorOpen: boolean;
  setOnline: (online: boolean) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (iso: string) => void;
  setPendingCount: (n: number) => void;
  setLastError: (message: string | null) => void;
  toggleSidebar: () => void;
  setSidebarMobileOpen: (open: boolean) => void;
  setPendingAction: (action: PendingAction, rxId?: string | null) => void;
  setCalculatorOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Deterministic on first render (server and client agree) \u2014 the real
  // navigator.onLine value is applied post-mount in SyncProvider so we don't
  // get a hydration mismatch from reading a browser-only API during SSR.
  online: true,
  syncStatus: "idle",
  lastSyncedAt: null,
  pendingCount: 0,
  lastError: null,
  sidebarCollapsed: false,
  sidebarMobileOpen: false,
  pendingAction: null,
  pendingRxId: null,
  calculatorOpen: false,
  setOnline: (online) => set({ online }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setLastError: (lastError) => set({ lastError }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarMobileOpen: (sidebarMobileOpen) => set({ sidebarMobileOpen }),
  setPendingAction: (pendingAction, rxId = null) => set({ pendingAction, pendingRxId: rxId }),
  setCalculatorOpen: (calculatorOpen) => set({ calculatorOpen }),
}));
