/** High-risk medicines (MSDS MOM-1 Ind. 56-57). The MSDS requires each
 * hospital to define and display its own list; this is a starting list of
 * commonly listed groups, to be reviewed and approved by the hospital's
 * pharmacy and therapeutics committee. A matching order is flagged high-risk
 * automatically: it then needs verification before the first dose and a
 * second person's check at each administration. */
export interface HighRiskGroup {
  group: string;
  /** Lower-case words matched in the medicine's brand or generic name. */
  match: string[];
}

export const HIGH_RISK_MEDICINES: HighRiskGroup[] = [
  { group: "Insulins", match: ["insulin", "insulatard", "mixtard", "lantus", "novorapid", "humulin", "glargine", "aspart", "lispro", "detemir"] },
  { group: "Anticoagulants", match: ["heparin", "enoxaparin", "clexane", "warfarin", "rivaroxaban", "apixaban", "dabigatran", "fondaparinux"] },
  { group: "Thrombolytics", match: ["streptokinase", "alteplase", "tenecteplase"] },
  { group: "Opioids", match: ["morphine", "pethidine", "fentanyl", "tramadol", "nalbuphine", "buprenorphine", "methadone", "oxycodone"] },
  { group: "Concentrated electrolytes", match: ["potassium chloride", "kcl", "sodium chloride 3%", "hypertonic saline", "magnesium sulphate", "magnesium sulfate", "calcium gluconate", "sodium bicarbonate"] },
  { group: "Sedatives / anaesthetics", match: ["midazolam", "propofol", "ketamine", "thiopental", "dexmedetomidine"] },
  { group: "Neuromuscular blockers", match: ["suxamethonium", "succinylcholine", "atracurium", "rocuronium", "vecuronium", "pancuronium"] },
  { group: "Inotropes / vasopressors", match: ["adrenaline", "epinephrine", "noradrenaline", "norepinephrine", "dopamine", "dobutamine", "vasopressin"] },
  { group: "Cardiac glycosides and antiarrhythmics", match: ["digoxin", "amiodarone", "lignocaine iv", "lidocaine iv"] },
  { group: "Oxytocics", match: ["oxytocin", "syntocinon", "misoprostol", "ergometrine", "carboprost"] },
  { group: "Chemotherapy", match: ["methotrexate", "cyclophosphamide", "doxorubicin", "cisplatin", "carboplatin", "vincristine", "fluorouracil", "paclitaxel"] },
  { group: "Oral hypoglycaemics (sulfonylureas)", match: ["glibenclamide", "gliclazide", "glimepiride"] },
];

/** The high-risk group a medicine belongs to, if any. */
export function highRiskGroup(name: string | null | undefined, generic?: string | null): string | null {
  const text = `${name ?? ""} ${generic ?? ""}`.toLowerCase();
  for (const g of HIGH_RISK_MEDICINES) if (g.match.some((m) => text.includes(m))) return g.group;
  return null;
}

/** Ways to identify the patient at the bedside: two different ones are used (MOM-3 Ind. 64). */
export const PATIENT_IDENTIFIERS = ["Full name", "MR number", "Date of birth / age", "Wristband", "Father's / husband's name", "Patient states own name"];

export const ROUTES = ["Oral", "IV", "IM", "SC", "Sublingual", "Inhaled", "Nebulised", "Topical", "Rectal", "Per vaginal", "Eye", "Ear", "Nasal", "NG tube"];
