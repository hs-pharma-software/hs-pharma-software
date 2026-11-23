"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/Field";
import { pharmacyPreInvoices, type PharmacyPreInvoice } from "@/lib/repo/brandSelections";
import { SHARE_FIELDS, sharesTotal, surgeryProfit, type SurgeryShares } from "@/config/surgeryShares";

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;

/** A surgery's shares and expenses, the OT / IPD medicine from the linked
 * pharmacy's Pre Invoices, and the profit left from its charges. */
export function SurgerySharesFields({ value, onChange, chargesTotal }: { value: SurgeryShares; onChange: (s: SurgeryShares) => void; chargesTotal: number }) {
  const [pre, setPre] = useState<PharmacyPreInvoice[] | null>(null);
  const [preError, setPreError] = useState<string | null>(null);
  useEffect(() => { void pharmacyPreInvoices().then(setPre).catch((e) => { setPre([]); setPreError(e instanceof Error ? e.message : String(e)); }); }, []);
  const set = (p: Partial<SurgeryShares>) => onChange({ ...value, ...p });
  const pick = (key: "ot_medicine" | "ipd_medicine", id: string) => {
    const p = pre?.find((x) => x.id === id);
    set({ [key]: p ? { id: p.id, name: p.name, total: p.total } : null } as Partial<SurgeryShares>);
  };
  const preOptions = (cur: SurgeryShares["ot_medicine"]) => [
    ...(cur && !pre?.some((p) => p.id === cur.id) ? [{ id: cur.id, name: cur.name, total: cur.total }] : []),
    ...(pre ?? []),
  ];
  const paid = sharesTotal(value);
  const profit = surgeryProfit(chargesTotal, value);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {SHARE_FIELDS.map((f) => (
          <Field key={f.key} label={`${f.label} (Rs)`}>
            <Input type="number" min="0" step="any" value={value[f.key] || ""} placeholder="0" onChange={(e) => set({ [f.key]: Number(e.target.value) || 0 } as Partial<SurgeryShares>)} />
          </Field>
        ))}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-neutral-600">Other expenses</p>
        {value.other.map((o, i) => (
          <div key={i} className="mb-1.5 flex gap-2">
            <Input value={o.label} placeholder="e.g. Sutures, OT linen" aria-label="Expense" onChange={(e) => set({ other: value.other.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <Input type="number" min="0" step="any" value={o.amount || ""} placeholder="Rs" aria-label="Amount" className="w-32"
              onChange={(e) => set({ other: value.other.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)) })} />
            <button type="button" title="Remove" onClick={() => set({ other: value.other.filter((_, j) => j !== i) })} className="text-neutral-400 hover:text-rose-600"><X size={15} /></button>
          </div>
        ))}
        <button type="button" onClick={() => set({ other: [...value.other, { label: "", amount: 0 }] })} className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"><Plus size={12} />Add expense</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {(["ot_medicine", "ipd_medicine"] as const).map((k) => (
          <Field key={k} label={k === "ot_medicine" ? "OT medicine (pharmacy Pre Invoice)" : "IPD medicine by the consultant (pharmacy Pre Invoice)"}>
            <Select value={value[k]?.id ?? ""} onChange={(e) => pick(k, e.target.value)} disabled={pre === null}>
              <option value="">{pre === null ? "Loading…" : "— None —"}</option>
              {preOptions(value[k]).map((p) => <option key={p.id} value={p.id}>{p.name} · {rs(p.total)}</option>)}
            </Select>
          </Field>
        ))}
      </div>
      {preError && <p className="text-[11px] text-amber-700">Pharmacy Pre Invoices: {preError}</p>}
      <div className="flex flex-wrap justify-end gap-x-6 border-t border-neutral-200 pt-2 text-sm">
        <span>Charges <b>{rs(chargesTotal)}</b></span>
        <span>Shares &amp; expenses <b className="text-rose-700">{rs(paid)}</b></span>
        <span>Profit <b className={profit < 0 ? "text-rose-700" : "text-emerald-700"}>{rs(profit)}</b></span>
      </div>
    </div>
  );
}
