/** Blood transfusion consent (MSDS COP-2 Ind. 23, PRE-1 Ind. 74). */
import type { FormDef } from "./types";

export const TRANSFUSION_CONSENT: FormDef = {
  key: "transfusion_consent", version: 1, title: "Consent for Blood Transfusion",
  department: "Blood Bank", msds: ["COP-2 · 23", "PRE-1 · 74"], classification: "Required",
  scope: "patient", episodeTypes: ["ipd", "emergency"], onePerEpisode: true,
  createRoles: ["doctor"], finalizeRoles: ["doctor"], printSignatures: ["Patient / next of kin", "Witness"], summaryField: "component",
  fields: [
    { key: "component", label: "Blood component(s) to be transfused", type: "text", required: true },
    { key: "reason", label: "Why the transfusion is needed", type: "textarea", required: true },
    { key: "risks", label: "Risks explained (reactions, infection, overload)", type: "textarea", required: true },
    { key: "alternatives", label: "Alternatives explained", type: "textarea", required: true },
    { key: "language", label: "Explained in", type: "select", required: true, options: ["Urdu", "Punjabi", "English", "Saraiki", "Other"] },
    { key: "emergency_no_family", label: "Emergency: patient unconscious and no family / guardian present", type: "yesno", required: true },
    { key: "doctor_note", label: "Doctor's note of the emergency decision", type: "textarea", required: true, showIf: { field: "emergency_no_family", equals: "Yes" } },
    { key: "consent_by", label: "Consent given by (name)", type: "text", required: true, showIf: { field: "emergency_no_family", equals: "No" } },
    { key: "relationship", label: "Relationship to the patient", type: "select", required: true, showIf: { field: "emergency_no_family", equals: "No" }, options: ["Self", "Parent", "Spouse", "Sibling", "Child", "Guardian", "Attorney", "Care provider"] },
    { key: "signed_on_paper", label: "Signature taken on the printed form", type: "yesno", required: true, showIf: { field: "emergency_no_family", equals: "No" } },
  ],
};

export const BLOOD_BANK_FORMS: FormDef[] = [TRANSFUSION_CONSENT];
