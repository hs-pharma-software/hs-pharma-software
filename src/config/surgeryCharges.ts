/** The charges a surgery is billed with. Each one becomes its own line on the
 * admission bill and on the surgery invoice. */

export type SurgeryChargeKey =
  | "operation_fee"
  | "ot_charges"
  | "paramedic_charges"
  | "anesthesia_charges"
  | "ot_medicine"
  | "room_charges"
  | "indoor_medicine";

export type SurgeryFeeBreakdown = Record<SurgeryChargeKey, number> & { room_type: string | null };

/** In bill order. `category` is the hospital charge category of the line. */
export const SURGERY_CHARGES: { key: SurgeryChargeKey; label: string; category: string }[] = [
  { key: "operation_fee", label: "Operation Fee", category: "ot" },
  { key: "ot_charges", label: "OT Charges", category: "ot" },
  { key: "paramedic_charges", label: "Paramedics Charges", category: "nursing" },
  { key: "anesthesia_charges", label: "Anesthesia Charges", category: "ot" },
  { key: "ot_medicine", label: "OT Medicine", category: "pharmacy" },
  { key: "room_charges", label: "Room Charges", category: "bed" },
  { key: "indoor_medicine", label: "Indoor Medicine Charges", category: "pharmacy" },
];

export const ROOM_TYPES = ["Normal Room", "VIP Room", "VVIP Room"];

export const EMPTY_BREAKDOWN: SurgeryFeeBreakdown = {
  operation_fee: 0, ot_charges: 0, paramedic_charges: 0, anesthesia_charges: 0, ot_medicine: 0, room_charges: 0, indoor_medicine: 0, room_type: null,
};

const round = (n: number) => Math.round(n * 100) / 100;

export function breakdownTotal(b: SurgeryFeeBreakdown): number {
  return round(SURGERY_CHARGES.reduce((sum, c) => sum + (Number(b[c.key]) || 0), 0));
}

/** Validated copy: amounts are numbers, never negative; a blank room type is null. */
export function cleanBreakdown(input: Partial<SurgeryFeeBreakdown> | null | undefined): SurgeryFeeBreakdown {
  const out: SurgeryFeeBreakdown = { ...EMPTY_BREAKDOWN };
  for (const c of SURGERY_CHARGES) {
    const v = Number(input?.[c.key] ?? 0);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${c.label} cannot be negative.`);
    out[c.key] = round(v);
  }
  out.room_type = input?.room_type?.trim() || null;
  return out;
}

/** The stored breakdown of a surgery type or booking. A surgery saved before
 * the breakdown existed has only its fee, which is the operation fee. */
export function parseBreakdown(json: string | null | undefined, fee: number): SurgeryFeeBreakdown {
  if (json) {
    try {
      return cleanBreakdown(JSON.parse(json));
    } catch {
      // Fall through to the fee alone.
    }
  }
  return { ...EMPTY_BREAKDOWN, operation_fee: round(Math.max(0, Number(fee) || 0)) };
}

/** The bill line of one charge: "Room Charges (VIP Room)". */
export function chargeLabel(key: SurgeryChargeKey, b: SurgeryFeeBreakdown): string {
  const label = SURGERY_CHARGES.find((c) => c.key === key)!.label;
  return key === "room_charges" && b.room_type ? `${label} (${b.room_type})` : label;
}
