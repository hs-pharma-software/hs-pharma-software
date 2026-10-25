/** Emergency, patient safety and quality reference rules (MSDS COP-1, PRE-4,
 * ROM-5, CQI-3). The limits and targets below are this hospital's working
 * defaults; the hospital's own policies and the lab's own critical-value list
 * take precedence and are where these numbers must be checked. */

// ── Emergency triage (five levels) ────────────────────────────────────────

export interface TriageLevel {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  /** Minutes within which a doctor should see the patient. */
  targetMin: number;
  cls: string;
}

export const TRIAGE_LEVELS: TriageLevel[] = [
  { level: 1, label: "1 Resuscitation", targetMin: 0, cls: "bg-rose-600 text-white" },
  { level: 2, label: "2 Emergent", targetMin: 10, cls: "bg-orange-500 text-white" },
  { level: 3, label: "3 Urgent", targetMin: 30, cls: "bg-amber-300 text-amber-950" },
  { level: 4, label: "4 Less urgent", targetMin: 60, cls: "bg-emerald-500 text-white" },
  { level: 5, label: "5 Non-urgent", targetMin: 120, cls: "bg-sky-500 text-white" },
];
export const triageLevel = (n: number | null | undefined) => TRIAGE_LEVELS.find((l) => l.level === n) ?? null;

export interface TriageVitals {
  pulse: number;
  sbp: number;
  rr: number;
  spo2: number;
  gcs: number;
  temp_c?: number | null;
  pain?: number | null;
}

/** The most urgent level the vital signs call for, with the signs that set it.
 * Level 5 is never suggested: only the triage nurse or doctor can judge a
 * patient non-urgent. */
export function suggestTriage(v: TriageVitals): { level: 1 | 2 | 3 | 4; reasons: string[] } {
  const rules: [1 | 2 | 3, boolean, string][] = [
    [1, v.gcs <= 8, `GCS ${v.gcs}`],
    [1, v.spo2 < 85, `SpO₂ ${v.spo2}%`],
    [1, v.sbp < 80, `systolic BP ${v.sbp}`],
    [1, v.rr < 8 || v.rr > 35, `respiratory rate ${v.rr}`],
    [1, v.pulse < 40 || v.pulse > 150, `pulse ${v.pulse}`],
    [2, v.gcs <= 12, `GCS ${v.gcs}`],
    [2, v.spo2 < 90, `SpO₂ ${v.spo2}%`],
    [2, v.sbp < 90, `systolic BP ${v.sbp}`],
    [2, v.rr > 30, `respiratory rate ${v.rr}`],
    [2, v.pulse > 130, `pulse ${v.pulse}`],
    [2, v.temp_c != null && v.temp_c >= 40, `temperature ${v.temp_c} °C`],
    [2, v.pain != null && v.pain >= 8, `pain ${v.pain}/10`],
    [3, v.gcs < 15, `GCS ${v.gcs}`],
    [3, v.spo2 < 94, `SpO₂ ${v.spo2}%`],
    [3, v.sbp < 100 || v.sbp >= 180, `systolic BP ${v.sbp}`],
    [3, v.rr > 24, `respiratory rate ${v.rr}`],
    [3, v.pulse > 110, `pulse ${v.pulse}`],
    [3, v.temp_c != null && v.temp_c >= 39, `temperature ${v.temp_c} °C`],
    [3, v.pain != null && v.pain >= 5, `pain ${v.pain}/10`],
  ];
  for (const level of [1, 2, 3] as const) {
    const reasons = rules.filter(([l, hit]) => l === level && hit).map(([, , r]) => r);
    if (reasons.length) return { level, reasons };
  }
  return { level: 4, reasons: [] };
}

export const DISPOSITIONS = {
  admitted: "Admitted", discharged: "Discharged home", referred: "Referred to another hospital",
  lama: "Left against medical advice (LAMA)", absconded: "Left without being seen / absconded", died: "Died in emergency",
} as const;
export type Disposition = keyof typeof DISPOSITIONS;

// ── Medico-legal cases ────────────────────────────────────────────────────

export const MLC_NATURES = [
  "Road traffic accident", "Assault / injury by another person", "Firearm injury", "Burn", "Poisoning", "Alleged sexual assault",
  "Fall from height", "Suspected suicide attempt", "Brought dead", "Dog bite / animal attack", "Electric injury", "Other",
] as const;

// ── Critical results ──────────────────────────────────────────────────────

/** Minutes from detection to the clinician being told (CQI indicator). */
export const CRITICAL_NOTIFY_MINUTES = 30;

interface CriticalLimit {
  name: string;
  /** Matches the test name, or a panel parameter's key / name. */
  match: RegExp;
  low?: number;
  high?: number;
  unit: string;
  /** Results entered as cells/µL instead of ×10³/µL are scaled down. */
  perThousandAbove?: number;
}

export const CRITICAL_LIMITS: CriticalLimit[] = [
  { name: "Potassium", match: /\bpotassium\b|^k\+?$|serum k\b/i, low: 2.8, high: 6.2, unit: "mmol/L" },
  { name: "Sodium", match: /\bsodium\b|^na\+?$|serum na\b/i, low: 120, high: 160, unit: "mmol/L" },
  { name: "Glucose", match: /glucose|blood sugar|\bbsr\b|\bbsf\b|\brbs\b|\bfbs\b/i, low: 40, high: 450, unit: "mg/dL" },
  { name: "Calcium", match: /\bcalcium\b/i, low: 6, high: 13, unit: "mg/dL" },
  { name: "Haemoglobin", match: /^hb$|ha?emoglobin/i, low: 7, high: 20, unit: "g/dL" },
  { name: "Platelets", match: /^plt$|platelet/i, low: 20, high: 1000, unit: "×10³/µL", perThousandAbove: 5000 },
  { name: "White cells", match: /^tlc$|^wbc$|leucocyte|leukocyte|white cell/i, low: 2, high: 30, unit: "×10³/µL", perThousandAbove: 500 },
  { name: "INR", match: /\binr\b/i, high: 5, unit: "" },
  { name: "Blood pH", match: /^ph$|blood ph|arterial ph/i, low: 7.2, high: 7.6, unit: "" },
];
/** Qualitative results that are always critical. */
const CRITICAL_POSITIVE = /blood culture|csf|cerebrospinal/i;
const POSITIVE_WORDS = /positive|growth|isolated|organisms? seen/i;

export interface CriticalFinding {
  test: string;
  value: string;
  why: string;
}

/** A value outside the critical limits for its test, or null. */
export function criticalCheck(testName: string, value: string): CriticalFinding | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (CRITICAL_POSITIVE.test(testName) && POSITIVE_WORDS.test(raw) && !/no growth|negative/i.test(raw)) {
    return { test: testName, value: raw, why: "positive result" };
  }
  const lim = CRITICAL_LIMITS.find((l) => l.match.test(testName.trim()));
  const m = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!lim || !m) return null;
  let n = Number(m[0]);
  if (lim.perThousandAbove && n > lim.perThousandAbove) n = n / 1000;
  if (lim.low !== undefined && n < lim.low) return { test: testName, value: raw, why: `below the critical limit of ${lim.low} ${lim.unit}`.trim() };
  if (lim.high !== undefined && n > lim.high) return { test: testName, value: raw, why: `above the critical limit of ${lim.high} ${lim.unit}`.trim() };
  return null;
}

/** Every critical value in a result: a single value, or each panel parameter. */
export function criticalFindings(testName: string, resultValue: string | null, components: { key: string; name: string; value: string }[] | null): CriticalFinding[] {
  if (components?.length) {
    return components.flatMap((c) => {
      const f = criticalCheck(c.key, c.value) ?? criticalCheck(c.name, c.value);
      return f ? [{ ...f, test: `${testName}: ${c.name}` }] : [];
    });
  }
  const f = resultValue ? criticalCheck(testName, resultValue) : null;
  return f ? [f] : [];
}

export const NOTIFY_METHODS = ["Phone", "In person", "Hospital messaging"] as const;

// ── Complaints ────────────────────────────────────────────────────────────

export const COMPLAINT_CHANNELS = ["In person", "Written", "Phone", "Complaint box", "Online / social media"] as const;
export const COMPLAINT_CATEGORIES = [
  "Clinical care", "Nursing care", "Staff behaviour", "Waiting time", "Billing and charges", "Cleanliness", "Food",
  "Privacy and dignity", "Medicines", "Facilities", "Other",
] as const;
export const COMPLAINT_SEVERITY = ["Low", "Medium", "High"] as const;
/** Days to acknowledge and to resolve a complaint (hospital policy). */
export const COMPLAINT_ACK_DAYS = 2;
export const COMPLAINT_RESOLVE_DAYS = 15;

// ── Incidents ─────────────────────────────────────────────────────────────

export const INCIDENT_TYPES = [
  "Medication error", "Patient fall", "Wrong patient / site / procedure", "Transfusion error or reaction", "Hospital-acquired pressure injury",
  "Healthcare-associated infection", "Needle-stick / sharps injury", "Equipment failure", "Surgical complication", "Retained foreign object",
  "Patient identification error", "Delay in treatment", "Unexpected death", "Maternal death", "Neonatal death or injury", "Infant abduction",
  "Suicide or self-harm", "Violence or aggression", "Fire / electrical hazard", "Documentation error", "Other",
] as const;
export const OUTCOME_CLASSES = {
  near_miss: "Near miss (did not reach the patient)",
  no_harm: "Reached the patient, no harm",
  adverse_event: "Adverse event (harm)",
  sentinel: "Sentinel event",
} as const;
export type OutcomeClass = keyof typeof OUTCOME_CLASSES;
export const HARM_LEVELS = ["None", "Mild", "Moderate", "Severe", "Death"] as const;
/** Days the root cause analysis of a sentinel event must be finished in. */
export const SENTINEL_RCA_DAYS = 45;
/** Incident types that are sentinel events whatever harm was recorded. */
export const SENTINEL_TYPES = ["Wrong patient / site / procedure", "Retained foreign object", "Unexpected death", "Maternal death", "Infant abduction", "Suicide or self-harm"];

/** The class an incident must be recorded under at least. */
export function minimumClass(type: string, harm: string): OutcomeClass | null {
  if (SENTINEL_TYPES.includes(type) || harm === "Death" || harm === "Severe") return "sentinel";
  if (harm === "Mild" || harm === "Moderate") return "adverse_event";
  return null;
}

// ── CAPA ──────────────────────────────────────────────────────────────────

export const CAPA_SOURCES = { incident: "Incident", complaint: "Complaint", audit: "Audit", indicator: "Quality indicator", drill: "Mock drill", other: "Other" } as const;
export type CapaSource = keyof typeof CAPA_SOURCES;
