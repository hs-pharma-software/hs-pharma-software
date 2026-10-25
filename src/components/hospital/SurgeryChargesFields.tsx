"use client";

import { Field, Input } from "@/components/ui/Field";
import { ROOM_TYPES, SURGERY_CHARGES, type SurgeryChargeKey } from "@/config/surgeryCharges";

/** Amounts as typed (strings, so a field can be blank while editing). */
export type ChargeDraft = Record<SurgeryChargeKey, string> & { room_type: string };

export function draftFrom(b: Record<SurgeryChargeKey, number> & { room_type: string | null }): ChargeDraft {
  const d = { room_type: b.room_type ?? "" } as ChargeDraft;
  for (const c of SURGERY_CHARGES) d[c.key] = b[c.key] ? String(b[c.key]) : "";
  return d;
}

export function draftToBreakdown(d: ChargeDraft) {
  const out = { room_type: d.room_type.trim() || null } as Record<SurgeryChargeKey, number> & { room_type: string | null };
  for (const c of SURGERY_CHARGES) out[c.key] = Number(d[c.key]) || 0;
  return out;
}

export function draftTotal(d: ChargeDraft): number {
  return SURGERY_CHARGES.reduce((sum, c) => sum + (Number(d[c.key]) || 0), 0);
}

/** The surgery's charges, each its own line on the invoice. Room type is a
 * list to pick from or type into; its charges are entered separately. */
export function SurgeryChargesFields({ value, onChange, idPrefix }: { value: ChargeDraft; onChange: (d: ChargeDraft) => void; idPrefix: string }) {
  const set = (patch: Partial<ChargeDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {SURGERY_CHARGES.map((c) => c.key === "room_charges" ? (
        <div key={c.key} className="grid grid-cols-2 gap-2 md:col-span-2">
          <Field label="Room type">
            <Input id={`${idPrefix}-room-type`} list={`${idPrefix}-room-types`} value={value.room_type} onChange={(e) => set({ room_type: e.target.value })} placeholder="Search or type" />
            <datalist id={`${idPrefix}-room-types`}>
              {ROOM_TYPES.map((r) => <option key={r} value={r} />)}
            </datalist>
          </Field>
          <Field label="Room Charges (Rs)">
            <Input id={`${idPrefix}-${c.key}`} type="number" min="0" value={value[c.key]} onChange={(e) => set({ [c.key]: e.target.value })} placeholder="0" />
          </Field>
        </div>
      ) : (
        <Field key={c.key} label={`${c.label} (Rs)`}>
          <Input id={`${idPrefix}-${c.key}`} type="number" min="0" value={value[c.key]} onChange={(e) => set({ [c.key]: e.target.value })} placeholder="0" />
        </Field>
      ))}
      <div className="flex items-baseline justify-between rounded-lg bg-neutral-50 px-3 py-2 md:col-span-2">
        <span className="text-xs font-medium text-neutral-600">Total surgery fee</span>
        <span className="text-base font-semibold tabular-nums">Rs {draftTotal(value).toLocaleString()}</span>
      </div>
    </div>
  );
}
