"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { availableImeis, type ImeiUnit } from "@/lib/repo/imei";

/** Picks the handsets sold on an invoice line: scan an IMEI (it is ticked when
 * found in stock) or tick them in the list. `current` are this line's IMEIs;
 * `elsewhere` are IMEIs already on other lines of the same bill. */
export function ImeiPicker({ productId, productName, count, current, elsewhere, onDone, onClose }: {
  productId: string;
  productName: string;
  count: number;
  current: string[];
  elsewhere: string[];
  onDone: (imeis: string[]) => void;
  onClose: () => void;
}) {
  const [units, setUnits] = useState<ImeiUnit[] | null>(null);
  const [picked, setPicked] = useState<string[]>(current);
  const [term, setTerm] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void availableImeis(productId).then(setUnits).catch((e) => { setUnits([]); setMessage(e instanceof Error ? e.message : String(e)); });
  }, [productId]);

  // Handsets in stock plus the ones this line already holds (an edited bill).
  const all = [...(units ?? []).map((u) => u.imei), ...current.filter((i) => !(units ?? []).some((u) => u.imei === i))].filter((i) => !elsewhere.includes(i));
  const shown = all.filter((i) => !term.trim() || i.includes(term.trim()));
  const toggle = (imei: string) => setPicked((p) => (p.includes(imei) ? p.filter((x) => x !== imei) : [...p, imei]));

  function scan() {
    const t = term.trim();
    if (!t) return;
    if (all.includes(t)) {
      if (!picked.includes(t)) setPicked((p) => [...p, t]);
      setMessage(null);
      setTerm("");
    } else {
      setMessage(`IMEI ${t} is not a ${productName} in stock.`);
    }
  }

  if (typeof document === "undefined") return null;
  // A portal: the invoice form is itself a form, and this must not submit it.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4" onKeyDown={(e) => e.stopPropagation()}>
      <div role="dialog" aria-label={`IMEIs of ${productName}`} className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">{productName}</h2>
            <p className={`text-xs ${picked.length === count ? "text-emerald-700" : "text-neutral-500"}`}>{picked.length} of {count} handset{count === 1 ? "" : "s"} picked</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100"><X size={16} /></button>
        </div>
        <Input id="imei-scan" autoFocus value={term} onChange={(e) => setTerm(e.target.value.replace(/\D/g, ""))} inputMode="numeric"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scan(); } }} placeholder="Scan or type the IMEI, then Enter" className="font-mono" />
        {message && <p className="mt-1 text-xs text-rose-600">{message}</p>}
        <div className="mt-2 min-h-24 flex-1 overflow-y-auto rounded-lg border border-neutral-200">
          {units === null ? <p className="p-3 text-sm text-neutral-400">Loading…</p>
            : shown.length === 0 ? <p className="p-3 text-sm text-neutral-500">No {productName} IMEI in stock{term ? " matching that" : ""}. Add IMEIs on a purchase or in IMEI Register.</p>
            : shown.map((imei) => (
              <label key={imei} className="flex cursor-pointer items-center gap-2 border-b border-neutral-100 px-3 py-1.5 font-mono text-sm last:border-0 hover:bg-neutral-50">
                <input type="checkbox" checked={picked.includes(imei)} onChange={() => toggle(imei)} />
                {imei}
                {picked.includes(imei) && <Check size={13} className="ml-auto text-emerald-600" />}
              </label>
            ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => onDone(picked)}>Done</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
