/** Theatre and anaesthesia records of one surgery (MSDS COP-4 anaesthesia,
 * COP-5 surgery; Category I, CG-01MS-Ed2-01092023). Each belongs to a surgery
 * booking of the admission. Field lists follow the indicators' compliance
 * requirements; the PHC prescribes no layout. */
import type { FormDef } from "./types";

const RELATIONS = ["Self", "Parent", "Spouse", "Sibling", "Child", "Guardian", "Attorney", "Care provider"];
const LANGUAGES = ["Urdu", "Punjabi", "English", "Saraiki", "Other"];
const ANAESTHESIA = ["General", "Spinal", "Epidural", "Combined spinal-epidural", "Regional nerve block", "Local with sedation", "Sedation only"];
const base = { department: "Operation Theatre", scope: "patient" as const, episodeTypes: ["ipd" as const], subject: "surgery" as const };

export const PRE_ANAESTHESIA: FormDef = {
  ...base, key: "pre_anaesthesia", version: 1, title: "Pre-anaesthesia Assessment and Anaesthesia Plan",
  msds: ["COP-4 · 32", "COP-4 · 33", "COP-4 · 31"], classification: "Conditional", onePerEpisode: true,
  createRoles: ["doctor"], finalizeRoles: ["doctor"], summaryField: "asa",
  fields: [
    { key: "h_assess", label: "Assessment", type: "heading" },
    { key: "history", label: "Medical history and previous anaesthesia", type: "textarea", required: true },
    { key: "allergies", label: "Allergies", type: "text", required: true, help: "Write None known if none." },
    { key: "current_medicines", label: "Current medicines", type: "textarea" },
    { key: "fasting_since", label: "Nil by mouth since", type: "datetime", required: true },
    { key: "airway", label: "Airway (Mallampati)", type: "select", required: true, options: ["Class I", "Class II", "Class III", "Class IV"] },
    { key: "asa", label: "ASA physical status", type: "select", required: true, options: ["ASA I", "ASA II", "ASA III", "ASA IV", "ASA V", "ASA VI"] },
    { key: "emergency", label: "Emergency case (E)", type: "yesno", required: true },
    { key: "investigations", label: "Investigations reviewed", type: "textarea", required: true },
    { key: "h_plan", label: "Anaesthesia plan", type: "heading" },
    { key: "anaesthesia_type", label: "Planned anaesthesia", type: "select", required: true, options: ANAESTHESIA },
    { key: "plan", label: "Plan (drugs, airway, monitoring, post-operative pain relief)", type: "textarea", required: true },
    { key: "blood_arranged", label: "Blood arranged", type: "yesno", required: true },
  ],
};

export const PRE_INDUCTION: FormDef = {
  ...base, key: "pre_induction", version: 1, title: "Pre-induction Re-evaluation",
  msds: ["COP-4 · 34"], classification: "Conditional", onePerEpisode: true, requiresFinal: ["pre_anaesthesia"],
  createRoles: ["doctor"], finalizeRoles: ["doctor"], summaryField: "plan_changed",
  fields: [
    { key: "bp", label: "Blood pressure", type: "text", unit: "mmHg", required: true, help: "e.g. 124/78" },
    { key: "pulse", label: "Pulse", type: "number", unit: "/min", min: 20, max: 250, required: true },
    { key: "spo2", label: "SpO2", type: "number", unit: "%", min: 40, max: 100, required: true },
    { key: "resp_rate", label: "Respiratory rate", type: "number", unit: "/min", min: 4, max: 80, required: true },
    { key: "condition_changed", label: "Condition changed since the pre-anaesthesia assessment", type: "yesno", required: true },
    { key: "changes", label: "What changed", type: "textarea", required: true, showIf: { field: "condition_changed", equals: "Yes" } },
    { key: "plan_changed", label: "Anaesthesia plan changed", type: "yesno", required: true },
    { key: "new_plan", label: "New plan", type: "textarea", required: true, showIf: { field: "plan_changed", equals: "Yes" } },
  ],
};

export const ANAESTHESIA_CONSENT: FormDef = {
  ...base, key: "anaesthesia_consent", version: 1, title: "Consent for Anaesthesia",
  msds: ["COP-4 · 35", "PRE-1 · 74"], classification: "Conditional", onePerEpisode: true,
  createRoles: ["doctor"], finalizeRoles: ["doctor"], printSignatures: ["Patient / attendant", "Witness"], summaryField: "anaesthesia_type",
  fields: [
    { key: "anaesthesia_type", label: "Type of anaesthesia", type: "select", required: true, options: ANAESTHESIA },
    { key: "risks", label: "Risks explained", type: "textarea", required: true },
    { key: "benefits", label: "Benefits explained", type: "textarea", required: true },
    { key: "alternatives", label: "Alternatives explained", type: "textarea", required: true },
    { key: "language", label: "Explained in", type: "select", options: LANGUAGES, required: true },
    { key: "understood", label: "Explained at a level the patient / family understood", type: "yesno", required: true },
    { key: "consent_by", label: "Consent given by (name)", type: "text", required: true },
    { key: "relationship", label: "Relationship to the patient", type: "select", options: RELATIONS, required: true },
    { key: "signed_on_paper", label: "Signature of the patient / attendant taken on the printed form", type: "yesno", required: true },
  ],
};

export const PRE_OP_ASSESSMENT: FormDef = {
  ...base, key: "pre_op_assessment", version: 1, title: "Pre-operative Assessment",
  msds: ["COP-5 · 42", "COP-5 · 41"], classification: "Conditional", onePerEpisode: true,
  createRoles: ["doctor"], finalizeRoles: ["doctor"], summaryField: "provisional_diagnosis",
  fields: [
    { key: "history", label: "Clinical history", type: "textarea", required: true },
    { key: "examination", label: "Physical examination", type: "textarea", required: true },
    { key: "investigations", label: "Relevant investigations", type: "textarea" },
    { key: "provisional_diagnosis", label: "Provisional diagnosis", type: "text", required: true },
    { key: "operation_plan", label: "Operation plan", type: "textarea", required: true },
    { key: "site_side", label: "Operation site and side", type: "text", required: true, help: "e.g. Right inguinal; midline, no side" },
  ],
};

export const SURGICAL_CONSENT: FormDef = {
  ...base, key: "surgical_consent", version: 1, title: "Consent for Surgery",
  msds: ["COP-5 · 43", "PRE-1 · 74", "PRE-1 · 75"], classification: "Conditional", onePerEpisode: true,
  createRoles: ["doctor"], finalizeRoles: ["doctor"], printSignatures: ["Patient / next of kin", "Witness"], summaryField: "procedure",
  fields: [
    { key: "procedure", label: "Operation", type: "text", required: true },
    { key: "site_side", label: "Site and side", type: "text", required: true },
    { key: "performed_by", label: "Who will perform the operation", type: "text", required: true },
    { key: "risks", label: "Risks explained", type: "textarea", required: true },
    { key: "benefits", label: "Benefits explained", type: "textarea", required: true },
    { key: "alternatives", label: "Alternatives explained", type: "textarea", required: true },
    { key: "language", label: "Explained in", type: "select", options: LANGUAGES, required: true },
    { key: "patient_capable", label: "Patient able to decide independently", type: "yesno", required: true },
    { key: "substitute_reason", label: "Why the patient cannot consent", type: "text", required: true, showIf: { field: "patient_capable", equals: "No" } },
    { key: "consent_by", label: "Consent given by (name)", type: "text", required: true },
    { key: "relationship", label: "Relationship to the patient", type: "select", options: RELATIONS, required: true },
    { key: "questions_answered", label: "The patient's / family's questions were answered", type: "yesno", required: true },
    { key: "signed_on_paper", label: "Signature of the patient / next of kin taken on the printed form", type: "yesno", required: true },
  ],
};

export const OPERATIVE_NOTE: FormDef = {
  ...base, key: "operative_note", version: 1, title: "Operative Note",
  msds: ["COP-5 · 46", "COP-5 · 45", "IMS-2 · 150"], classification: "Conditional", onePerEpisode: true,
  createRoles: ["doctor"], finalizeRoles: ["doctor"], summaryField: "procedure_performed",
  fields: [
    { key: "started_at", label: "Operation started", type: "datetime", required: true },
    { key: "ended_at", label: "Operation ended", type: "datetime", required: true },
    { key: "surgeon", label: "Surgeon", type: "text", required: true },
    { key: "assistants", label: "Assistants / team", type: "text", required: true },
    { key: "anaesthetist", label: "Anaesthetist", type: "text", required: true },
    { key: "anaesthesia_type", label: "Type of anaesthesia", type: "select", required: true, options: ANAESTHESIA },
    { key: "procedure_performed", label: "Procedure performed", type: "textarea", required: true },
    { key: "findings", label: "Findings", type: "textarea", required: true },
    { key: "specimens", label: "Specimens removed (for biopsy)", type: "textarea", required: true, help: "Write None if none." },
    { key: "blood_loss_ml", label: "Blood loss", type: "number", unit: "mL", min: 0, max: 20000, required: true },
    { key: "transfusion", label: "Blood transfused", type: "text", help: "e.g. 1 unit packed cells; None" },
    { key: "events", label: "Unexpected developments", type: "textarea", required: true, help: "Write None if uneventful." },
    { key: "condition_at_end", label: "Patient's condition at the end of the procedure", type: "select", required: true, options: ["Stable", "Stable, to ICU / HDU", "Unstable", "Critical"] },
  ],
};

export const POST_OP_PLAN: FormDef = {
  ...base, key: "post_op_plan", version: 1, title: "Post-operative Plan of Care",
  msds: ["COP-5 · 47", "COP-5 · 41"], classification: "Conditional", onePerEpisode: true,
  createRoles: ["doctor"], finalizeRoles: ["doctor"], summaryField: "monitoring",
  fields: [
    { key: "monitoring", label: "Monitoring parameters", type: "textarea", required: true },
    { key: "monitoring_frequency", label: "Frequency", type: "select", required: true, options: ["Every 15 minutes", "Every 30 minutes", "Hourly", "Every 2 hours", "Every 4 hours"] },
    { key: "medication", label: "Medication orders", type: "textarea", required: true, help: "Also write them in Medication orders so they appear on the administration record." },
    { key: "wound_care", label: "Wound care", type: "textarea", required: true },
    { key: "drains", label: "Care of drains and catheters", type: "textarea", required: true, help: "Write None if none." },
    { key: "positioning", label: "Special positioning", type: "text", required: true, help: "Write None if none." },
    { key: "nutrition", label: "Nutrition instructions", type: "text", required: true },
    { key: "referrals", label: "Special referrals (physiotherapy, respiratory therapy)", type: "text" },
    { key: "fluid_chart", label: "Fluid input / output chart required", type: "yesno", required: true },
    { key: "transfusion", label: "Instructions on blood transfusion", type: "text" },
  ],
};

export const RECOVERY_DISCHARGE: FormDef = {
  ...base, key: "recovery_discharge", version: 1, title: "Discharge from Recovery",
  // The operative note and the post-operative plan come before the patient leaves recovery (COP-5 Ind. 46, 41f).
  msds: ["COP-4 · 39", "COP-5 · 46"], classification: "Conditional", onePerEpisode: true, requiresFinal: ["operative_note", "post_op_plan"],
  createRoles: ["doctor", "nurse"], finalizeRoles: ["doctor"], summaryField: "transferred_to",
  fields: [
    { key: "aldrete", label: "Recovery score (Aldrete)", type: "number", min: 0, max: 10, required: true },
    { key: "criteria_met", label: "Discharge criteria met", type: "yesno", required: true },
    { key: "not_met_reason", label: "Why the patient leaves without meeting the criteria", type: "textarea", required: true, showIf: { field: "criteria_met", equals: "No" } },
    { key: "discharged_at", label: "Left recovery at", type: "datetime", required: true },
    { key: "transferred_to", label: "Transferred to", type: "select", required: true, options: ["Ward", "ICU", "HDU", "Home (day case)"] },
    { key: "handover_to", label: "Handed over to (name)", type: "text", required: true },
  ],
};

export const ANAESTHESIA_EVENT: FormDef = {
  ...base, key: "anaesthesia_event", version: 1, title: "Adverse Anaesthesia Event",
  msds: ["COP-4 · 40", "CQI-2 · 103"], classification: "Conditional",
  createRoles: ["doctor", "nurse"], finalizeRoles: ["doctor"], summaryField: "event_type",
  fields: [
    { key: "event_at", label: "Date and time", type: "datetime", required: true },
    { key: "event_type", label: "Event", type: "select", required: true, options: ["Difficult airway", "Aspiration", "Cardiac arrest", "Arrhythmia", "Severe hypotension", "Anaphylaxis", "Awareness", "Dental injury", "Unplanned ventilation / ICU", "Wrong drug or dose", "Other"] },
    { key: "description", label: "What happened", type: "textarea", required: true },
    { key: "action", label: "Action taken", type: "textarea", required: true },
    { key: "outcome", label: "Outcome", type: "select", required: true, options: ["No harm", "Temporary harm", "Prolonged stay", "Permanent harm", "Death"] },
    { key: "recommendation", label: "Recommendation to prevent recurrence", type: "textarea" },
  ],
};

/** In the order of care. */
export const THEATRE_FORMS: FormDef[] = [
  PRE_OP_ASSESSMENT, SURGICAL_CONSENT, PRE_ANAESTHESIA, ANAESTHESIA_CONSENT, PRE_INDUCTION, OPERATIVE_NOTE, POST_OP_PLAN, RECOVERY_DISCHARGE, ANAESTHESIA_EVENT,
];
