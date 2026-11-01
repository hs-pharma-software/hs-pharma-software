"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useCan } from "@/lib/actionPermissions";

/** Business types whose admin sees the purchase rate while billing. */
const RATE_HINT_TYPES = new Set(["retail_pharmacy", "medical_store", "general_store", "hospital_pharmacy", "distributor"]);

/** Whether the logged-in user sees the purchase rate on the invoice form: the
 * admin (owner) always, staff when allowed (User Permissions > Invoices >
 * See purchase rate while billing), in the business types above. */
export function useShowsPurchaseRate(): boolean {
  const allowed = useCan("invoice.purchase_rate");
  const type = useAuthStore((s) => s.currentTenant?.businessType ?? "");
  return allowed && RATE_HINT_TYPES.has(type);
}

/** A small circle at the top right of the window with a product's purchase
 * rate, shown while the admin is in a line's quantity box. */
export function PurchaseRateBubble({ rate, unit, onClose }: { rate: number; unit?: string | null; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div role="status" aria-label={`Purchase rate Rs ${rate.toFixed(2)}`}
      className="pointer-events-auto fixed right-4 top-4 z-[100] flex h-20 w-20 flex-col items-center justify-center rounded-full bg-amber-50 text-center shadow-lg ring-2 ring-amber-400 print:hidden">
      <button type="button" title="Hide" aria-label="Hide purchase rate"
        // Keep the cursor in the quantity box while closing.
        onMouseDown={(e) => e.preventDefault()} onClick={onClose}
        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-neutral-500 shadow ring-1 ring-neutral-200 hover:text-rose-600">
        <X size={12} />
      </button>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-700">Purchase</span>
      <span className="text-sm font-bold tabular-nums leading-tight text-neutral-900">{rate.toFixed(2)}</span>
      {unit && <span className="max-w-[4.5rem] truncate text-[9px] text-neutral-500">per {unit}</span>}
    </div>,
    document.body
  );
}
