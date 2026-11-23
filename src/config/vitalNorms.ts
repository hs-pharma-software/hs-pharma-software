/** Vital signs on the Doctor Desk, each with its normal range (adults).
 * Temperature is entered in °F (as Pakistani clinics write it) and stored in °C. */

export type VitalKey = "bp_systolic" | "bp_diastolic" | "pulse" | "temperature_f" | "spo2" | "resp_rate" | "weight_kg" | "blood_sugar";

export interface VitalNorm {
  key: VitalKey;
  label: string;
  unit: string;
  /** Normal range; null when there is none (weight). */
  low: number | null;
  high: number | null;
  normalText: string;
}

export const VITAL_NORMS: VitalNorm[] = [
  { key: "bp_systolic", label: "BP systolic", unit: "mmHg", low: 90, high: 120, normalText: "90–120" },
  { key: "bp_diastolic", label: "BP diastolic", unit: "mmHg", low: 60, high: 80, normalText: "60–80" },
  { key: "pulse", label: "Pulse", unit: "/min", low: 60, high: 100, normalText: "60–100" },
  { key: "temperature_f", label: "Temperature", unit: "°F", low: 97, high: 99, normalText: "97–99 °F" },
  { key: "spo2", label: "SpO2", unit: "%", low: 95, high: 100, normalText: "95–100" },
  { key: "resp_rate", label: "Respiratory rate", unit: "/min", low: 12, high: 20, normalText: "12–20" },
  { key: "weight_kg", label: "Weight", unit: "kg", low: null, high: null, normalText: "—" },
  { key: "blood_sugar", label: "Blood sugar (random)", unit: "mg/dL", low: 70, high: 140, normalText: "70–140" },
];

export type VitalValues = Partial<Record<VitalKey, string>>;

/** "high" / "low" when outside the normal range, else null. */
export function vitalFlag(key: VitalKey, value: string | number | null | undefined): "high" | "low" | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  const norm = VITAL_NORMS.find((v) => v.key === key);
  if (!norm || !Number.isFinite(n)) return null;
  if (norm.high !== null && n > norm.high) return "high";
  if (norm.low !== null && n < norm.low) return "low";
  return null;
}

export const fToC = (f: number) => Math.round(((f - 32) * 5) / 9 * 10) / 10;
export const cToF = (c: number) => Math.round((c * 9) / 5 * 10 + 320) / 10;

/** One line for the visit notes and prints: "BP 130/85 (high) · Pulse 72 · Temp 98.6 °F · ...". */
export function vitalsSummary(v: VitalValues): string {
  const has = (k: VitalKey) => (v[k] ?? "").trim() !== "";
  const mark = (k: VitalKey) => { const f = vitalFlag(k, v[k]); return f ? ` (${f})` : ""; };
  const parts: string[] = [];
  if (has("bp_systolic") && has("bp_diastolic")) {
    const f = vitalFlag("bp_systolic", v.bp_systolic) ?? vitalFlag("bp_diastolic", v.bp_diastolic);
    parts.push(`BP ${v.bp_systolic}/${v.bp_diastolic} mmHg${f ? ` (${f})` : ""}`);
  }
  if (has("pulse")) parts.push(`Pulse ${v.pulse}/min${mark("pulse")}`);
  if (has("temperature_f")) parts.push(`Temp ${v.temperature_f} °F${mark("temperature_f")}`);
  if (has("spo2")) parts.push(`SpO2 ${v.spo2}%${mark("spo2")}`);
  if (has("resp_rate")) parts.push(`RR ${v.resp_rate}/min${mark("resp_rate")}`);
  if (has("weight_kg")) parts.push(`Weight ${v.weight_kg} kg`);
  if (has("blood_sugar")) parts.push(`Sugar ${v.blood_sugar} mg/dL${mark("blood_sugar")}`);
  return parts.join(" · ");
}
