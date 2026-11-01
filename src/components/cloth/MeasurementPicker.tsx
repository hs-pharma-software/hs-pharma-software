"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { MeasurementForm } from "./MeasurementForm";
import { measurementSummary, searchMeasurements, type ClothMeasurement } from "@/lib/cloth";

/** Custom size on a bill: find the customer's saved measurements by name or
 * mobile, or save new ones. */
export function MeasurementPicker({ defaults, onPick, onClose }: {
  defaults: { customer_name: string; mobile: string };
  onPick: (m: ClothMeasurement) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState(defaults.mobile || defaults.customer_name);
  const [rows, setRows] = useState<ClothMeasurement[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void searchMeasurements(term).then((r) => { setRows(r); setError(null); }).catch((e) => { setRows([]); setError(e instanceof Error ? e.message : String(e)); });
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  if (typeof document === "undefined") return null;
  // A portal: the invoice form is itself a form, and this must not submit it.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4" onKeyDown={(e) => e.stopPropagation()}>
      <div role="dialog" aria-label="Custom size" className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">{creating ? "New measurements" : "Custom size"}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100"><X size={16} /></button>
        </div>
        {creating ? (
          <MeasurementForm initial={null} defaults={defaults} onCancel={() => setCreating(false)} onSaved={onPick} />
        ) : (
          <>
            <div className="flex gap-2">
              <Input id="mp-search" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Customer name or mobile…" />
              <Button type="button" variant="primary" onClick={() => setCreating(true)}><Plus size={14} />New</Button>
            </div>
            {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
            <div className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {rows === null ? <p className="p-3 text-sm text-neutral-400">Loading…</p>
                : rows.length === 0 ? <p className="p-3 text-sm text-neutral-500">No saved measurements found. Click New to save this customer&apos;s size.</p>
                : rows.map((m) => (
                  <button key={m.id} type="button" onClick={() => onPick(m)} className="block w-full px-3 py-2 text-left hover:bg-neutral-50">
                    <span className="text-sm font-medium text-neutral-900">{m.customer_name}</span>
                    <span className="text-xs text-neutral-500">{m.mobile ? ` · ${m.mobile}` : ""} · {m.garment}</span>
                    <span className="block truncate text-xs text-neutral-600">{measurementSummary(m)}</span>
                  </button>
                ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
