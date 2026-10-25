/** Medicines management reference lists (MSDS MOM). Starting lists for the
 * hospital's pharmacy and therapeutics committee to review: the antibiotic
 * groups follow the WHO AWaRe idea (Access / Watch / Reserve), the
 * controlled drugs are those usually kept under the narcotics register, and
 * causality uses the WHO-UMC categories. */

// ── Antibiotic stewardship ────────────────────────────────────────────────

export type AbxClass = "reserve" | "watch" | "access";
const ABX: Record<AbxClass, string[]> = {
  /** Last-resort agents: a consultant / HoD approves within 24 hours. */
  reserve: [
    "meropenem", "imipenem", "ertapenem", "doripenem", "colistin", "polymyxin", "tigecycline", "linezolid", "vancomycin", "teicoplanin",
    "ceftazidime-avibactam", "ceftazidime avibactam", "fosfomycin iv", "daptomycin", "aztreonam",
  ],
  /** Broader spectrum: indication and a 72-hour review. */
  watch: [
    "ceftriaxone", "cefotaxime", "ceftazidime", "cefepime", "cefixime", "cefuroxime", "cefoperazone", "piperacillin", "tazobactam",
    "ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin", "azithromycin", "clarithromycin", "erythromycin", "amikacin", "gentamicin",
    "clindamycin", "teicoplanin",
  ],
  access: [
    "amoxicillin", "co-amoxiclav", "amoxiclav", "augmentin", "ampicillin", "cloxacillin", "flucloxacillin", "benzylpenicillin", "penicillin",
    "cefalexin", "cephalexin", "cefazolin", "cefradine", "doxycycline", "metronidazole", "nitrofurantoin", "co-trimoxazole", "cotrimoxazole",
    "trimethoprim", "chloramphenicol",
  ],
};

/** The antibiotic class of a medicine, from its brand or generic name; null if not an antibiotic on the list. */
export function antibioticClass(name: string | null | undefined, generic?: string | null): AbxClass | null {
  const text = `${name ?? ""} ${generic ?? ""}`.toLowerCase();
  for (const c of ["reserve", "watch", "access"] as const) if (ABX[c].some((w) => text.includes(w))) return c;
  return null;
}
export const ABX_LABEL: Record<AbxClass, string> = { reserve: "Reserve antibiotic", watch: "Watch antibiotic", access: "Access antibiotic" };
/** Hours within which a reserve antibiotic must be approved before further doses. */
export const RESERVE_APPROVAL_HOURS = 24;
/** Hours after which every Watch / Reserve antibiotic is reviewed. */
export const ABX_REVIEW_HOURS = 72;
export const ABX_REVIEW_OUTCOMES = ["Continue (reason recorded)", "De-escalate to narrower antibiotic", "Switch IV to oral", "Stop (no infection / course complete)"] as const;

// ── Adverse drug reactions ────────────────────────────────────────────────

export const ADR_SERIOUSNESS = ["Death", "Life-threatening", "Hospitalisation or longer stay", "Disability", "Congenital anomaly", "Other medically important"] as const;
export const ADR_ACTIONS = ["Drug withdrawn", "Dose reduced", "Dose not changed", "Not applicable"] as const;
export const ADR_OUTCOMES = ["Recovered", "Recovering", "Not recovered", "Recovered with sequelae", "Fatal", "Unknown"] as const;
export const ADR_CHALLENGE = ["Yes, reaction stopped / reduced", "No change", "Not done", "Unknown"] as const;
/** WHO-UMC causality categories. */
export const ADR_CAUSALITY = ["Certain", "Probable / likely", "Possible", "Unlikely", "Conditional / unclassified", "Unassessable / unclassifiable"] as const;
/** Days within which a serious reaction is sent to the national pharmacovigilance centre (DRAP). */
export const ADR_SERIOUS_REPORT_DAYS = 15;

// ── Controlled drugs ──────────────────────────────────────────────────────

export const CONTROLLED_DRUGS = [
  "Morphine 10 mg/mL injection", "Pethidine 50 mg/mL injection", "Fentanyl 50 mcg/mL injection", "Nalbuphine 10 mg/mL injection",
  "Buprenorphine 0.3 mg/mL injection", "Tramadol 50 mg/mL injection", "Midazolam 5 mg/mL injection", "Diazepam 10 mg/2 mL injection",
  "Ketamine 50 mg/mL injection", "Morphine 10 mg tablet", "Alprazolam 0.5 mg tablet", "Other",
] as const;
export const CD_ENTRY_TYPES = {
  receipt: "Received from pharmacy", administered: "Given to patient", wasted: "Wasted / discarded", returned: "Returned to pharmacy", count: "Stock count",
} as const;
export type CdEntryType = keyof typeof CD_ENTRY_TYPES;

// ── Medicine fridges ──────────────────────────────────────────────────────

export const FRIDGE_MIN_C = 2;
export const FRIDGE_MAX_C = 8;
