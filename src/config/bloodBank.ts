/** Blood bank reference rules (MSDS COP-2 Ind. 21; Punjab Blood Transfusion
 * Safety Act 2016 and PBTA guidelines). ABO/Rh compatibility is checked by
 * the software before a unit can be recorded as compatible; the serological
 * crossmatch itself is done and recorded by the blood bank. */

export const COMPONENTS = ["Whole blood", "Packed red cells", "Fresh frozen plasma", "Platelets", "Cryoprecipitate"] as const;
export type Component = (typeof COMPONENTS)[number];
export const ABO = ["O", "A", "B", "AB"] as const;
export const RH = ["Positive", "Negative"] as const;
/** Transfusion-transmitted infection screening every unit must pass (non-reactive). */
export const TTI_TESTS = [
  ["tti_hbv", "Hepatitis B (HBsAg)"], ["tti_hcv", "Hepatitis C (anti-HCV)"], ["tti_hiv", "HIV 1/2"], ["tti_syphilis", "Syphilis"], ["tti_malaria", "Malaria"],
] as const;
export type TtiKey = (typeof TTI_TESTS)[number][0];

const RED_CELLS: Record<string, string[]> = { O: ["O"], A: ["A", "O"], B: ["B", "O"], AB: ["AB", "A", "B", "O"] };
const PLASMA: Record<string, string[]> = { O: ["O", "A", "B", "AB"], A: ["A", "AB"], B: ["B", "AB"], AB: ["AB"] };

/** Whether a donor unit may be given to this recipient; the reason when not. */
export function aboRhCompatible(component: string, unit: { abo: string; rh: string }, recipient: { abo: string; rh: string }): { ok: true } | { ok: false; reason: string } {
  if (!RED_CELLS[recipient.abo] || !RED_CELLS[unit.abo]) return { ok: false, reason: "Blood groups of the patient and the unit must both be known." };
  if (component === "Whole blood" || component === "Packed red cells") {
    if (!RED_CELLS[recipient.abo].includes(unit.abo)) return { ok: false, reason: `Group ${unit.abo} red cells are not compatible with a group ${recipient.abo} patient.` };
    if (recipient.rh === "Negative" && unit.rh !== "Negative") return { ok: false, reason: "An Rh-negative patient needs Rh-negative red cells." };
    return { ok: true };
  }
  if (component === "Fresh frozen plasma" || component === "Cryoprecipitate") {
    if (!PLASMA[recipient.abo].includes(unit.abo)) return { ok: false, reason: `Group ${unit.abo} plasma is not compatible with a group ${recipient.abo} patient.` };
    return { ok: true };
  }
  // Platelets: ABO-identical preferred, others acceptable by policy.
  return { ok: true };
}

/** Donor screening thresholds (blood centre SOP; adjust to the hospital's PBTA-approved SOP). */
export const DONOR_MIN_HB = 12.5;
export const DONOR_MIN_WEIGHT_KG = 50;

export const REACTION_TYPES = [
  "Febrile non-haemolytic", "Allergic / urticarial", "Anaphylaxis", "Acute haemolytic", "Delayed haemolytic",
  "Transfusion-associated circulatory overload (TACO)", "Transfusion-related acute lung injury (TRALI)", "Bacterial contamination / sepsis", "Other",
];
export const SEVERITIES = ["Mild", "Moderate", "Severe", "Life-threatening", "Death"] as const;
/** Serious adverse reactions: the Authority is informed (Act, Section 13; COP-2 Ind. 25). */
export const SERIOUS = new Set(["Severe", "Life-threatening", "Death"]);
