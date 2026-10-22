"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAppStore, type PendingAction } from "@/store/appStore";

/** ALT-key shortcuts that just navigate to a screen \u2014 mirrors the "To Open
 * View Forms" half of Utilities -> System Shortcuts. */
const VIEW_ROUTES: Record<string, string> = {
  d: "/dashboard",
  i: "/invoices",
  p: "/products",
  h: "/purchases",
  m: "/invoices/memorized",
  s: "/stock",
  r: "/invoices/returns",
  c: "/cash-register",
  x: "/expenses",
  b: "/settings/backup",
  q: "/suppliers/payable",
  y: "/customers/receivable",
  g: "/utilities/barcode",
  w: "/banks/statement",
};

/** ALT-key shortcuts that navigate AND open that screen's "Add" modal \u2014
 * mirrors the "To Open New Forms" half of the same sheet. Each target page
 * watches `pendingAction` (see appStore.ts) the same way Invoices already
 * did for Ctrl+N. */
const NEW_ROUTES: Record<string, { path: string; action: PendingAction }> = {
  u: { path: "/purchases", action: "new-purchase" },
  o: { path: "/orders", action: "new-order" },
  e: { path: "/expenses", action: "new-expense" },
  n: { path: "/invoices", action: "new-invoice" },
  a: { path: "/utilities/audit", action: "new-audit" },
};

function samePath(pathname: string, target: string): boolean {
  return pathname.replace(/\/$/, "") === target.replace(/\/$/, "");
}

/** App-wide keyboard shortcuts. Ctrl+N and Ctrl+T stay their own cases
 * (no Alt modifier), everything else in Utilities -> System Shortcuts is
 * ALT+<key>, dispatched from the two route tables above. */
export function GlobalShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const setPendingAction = useAppStore((s) => s.setPendingAction);
  const setCalculatorOpen = useAppStore((s) => s.setCalculatorOpen);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();

      if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "n") {
        e.preventDefault();
        setPendingAction("new-invoice");
        if (!samePath(pathname, "/invoices")) router.push("/invoices");
        return;
      }

      if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "t") {
        e.preventDefault();
        setCalculatorOpen(true);
        return;
      }

      if (!e.altKey || e.ctrlKey || e.shiftKey) return;

      const newTarget = NEW_ROUTES[key];
      if (newTarget) {
        e.preventDefault();
        setPendingAction(newTarget.action);
        if (!samePath(pathname, newTarget.path)) router.push(newTarget.path);
        return;
      }

      const viewTarget = VIEW_ROUTES[key];
      if (viewTarget) {
        e.preventDefault();
        if (!samePath(pathname, viewTarget)) router.push(viewTarget);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pathname, router, setPendingAction, setCalculatorOpen]);

  return null;
}
