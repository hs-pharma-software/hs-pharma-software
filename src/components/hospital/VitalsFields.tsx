"use client";

import { VITAL_NORMS, vitalFlag, type VitalValues } from "@/config/vitalNorms";

/** Separate vital-sign fields, each with its unit and normal range; a value
 * outside the range is shown in red with "High" / "Low". */
export function VitalsFields({ value, onChange, disabled }: { value: VitalValues; onChange: (v: VitalValues) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {VITAL_NORMS.map((n) => {
        const flag = vitalFlag(n.key, value[n.key]);
        return (
          <label key={n.key} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-neutral-600">{n.label} <span className="font-normal text-neutral-400">({n.unit})</span></span>
            <input type="number" inputMode="decimal" step="any" disabled={disabled} value={value[n.key] ?? ""} aria-label={`${n.label} (${n.unit})`}
              onChange={(e) => onChange({ ...value, [n.key]: e.target.value })}
              className={`w-full rounded-lg border px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-black/[0.06] ${flag ? "border-rose-400 bg-rose-50 text-rose-800" : "border-neutral-200"}`} />
            <span className={`text-[10px] ${flag ? "font-semibold text-rose-700" : "text-neutral-400"}`}>
              {flag ? `${flag === "high" ? "High" : "Low"} · ` : ""}Normal {n.normalText}
            </span>
          </label>
        );
      })}
    </div>
  );
}
