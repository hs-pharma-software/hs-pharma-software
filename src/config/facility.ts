/** Facility, human resources and document control reference lists (MSDS FMS,
 * HRM, ROM, IMS). Frequencies, validity periods and the required document
 * list are this hospital's working defaults: the hospital's own policies and
 * the current PHC standards are where they must be checked. */

// ── Equipment ─────────────────────────────────────────────────────────────

export const EQUIPMENT_CATEGORIES = [
  "Life support (ventilator, defibrillator, anaesthesia machine)", "Patient monitoring", "Infusion / syringe pumps", "Imaging", "Laboratory analyser",
  "Sterilization", "Theatre equipment", "Blood bank (refrigerator, centrifuge)", "Cold chain (vaccine / medicine fridge)", "Electrical (generator, UPS)",
  "Medical gases", "Biomedical (other)", "Furniture and fixtures", "IT", "Other",
] as const;
export const EQUIPMENT_LOG_KINDS = { ppm: "Preventive maintenance", calibration: "Calibration", breakdown: "Breakdown", repair: "Repair" } as const;
export type EquipmentLogKind = keyof typeof EQUIPMENT_LOG_KINDS;
/** Days before a due date that a check shows as "due soon". */
export const DUE_SOON_DAYS = 30;

// ── Licences ──────────────────────────────────────────────────────────────

export interface LicenceKind { key: string; label: string; required: boolean }
/** Licences a Category I hospital offering every service is expected to hold. */
export const LICENCE_KINDS: LicenceKind[] = [
  { key: "phc", label: "PHC registration / licence", required: true },
  { key: "drug_sale", label: "Drug sale licence (hospital pharmacy)", required: true },
  { key: "blood_bank", label: "Blood bank licence (Punjab Blood Transfusion Authority)", required: true },
  { key: "pnra", label: "PNRA licence (X-ray / radiology)", required: true },
  { key: "epa_waste", label: "Environmental approval / hospital waste (EPA)", required: true },
  { key: "waste_contract", label: "Hospital waste disposal contract", required: true },
  { key: "fire", label: "Fire safety certificate (Civil Defence / Rescue 1122)", required: true },
  { key: "building", label: "Building completion certificate / NOC", required: false },
  { key: "lift", label: "Lift / elevator inspection", required: false },
  { key: "boiler", label: "Boiler / pressure vessel inspection", required: false },
  { key: "medical_gas", label: "Medical gas supply contract", required: false },
  { key: "lab_accreditation", label: "Laboratory accreditation / registration", required: false },
  { key: "other", label: "Other", required: false },
];
export const licenceLabel = (k: string) => LICENCE_KINDS.find((l) => l.key === k)?.label ?? k;
export const LICENCE_WARN_DAYS = 60;

// ── Drills ────────────────────────────────────────────────────────────────

export interface DrillKind { key: string; label: string; everyDays: number }
export const DRILL_KINDS: DrillKind[] = [
  { key: "fire", label: "Fire / evacuation (Code Red)", everyDays: 180 },
  { key: "code_blue", label: "Cardiac arrest (Code Blue)", everyDays: 90 },
  { key: "mass_casualty", label: "Mass casualty / disaster", everyDays: 365 },
  { key: "infant_abduction", label: "Infant abduction (Code Pink)", everyDays: 365 },
  { key: "chemical_spill", label: "Chemical / mercury spill", everyDays: 365 },
  { key: "violence", label: "Violence / security (Code Grey)", everyDays: 365 },
];
export const drillLabel = (k: string) => DRILL_KINDS.find((d) => d.key === k)?.label ?? k;
export const SHIFTS = ["Morning", "Evening", "Night"] as const;

// ── Training and credentials ──────────────────────────────────────────────

export interface TrainingKind {
  key: string;
  label: string;
  /** Months a certificate stays valid; null = does not expire. */
  validMonths: number | null;
  /** Who must have it: everyone, clinical staff (doctors and nurses), or nobody in particular. */
  requiredFor: "all" | "clinical" | null;
}
export const TRAINING_KINDS: TrainingKind[] = [
  { key: "orientation", label: "General orientation (hospital, policies, safety)", validMonths: null, requiredFor: "all" },
  { key: "dept_orientation", label: "Department orientation", validMonths: null, requiredFor: "all" },
  { key: "jd_received", label: "Job description received and explained", validMonths: null, requiredFor: "all" },
  { key: "fire_safety", label: "Fire safety", validMonths: 12, requiredFor: "all" },
  { key: "ipc", label: "Infection prevention and control", validMonths: 12, requiredFor: "all" },
  { key: "bls", label: "Basic Life Support (BLS)", validMonths: 24, requiredFor: "clinical" },
  { key: "acls", label: "Advanced Cardiac Life Support (ACLS)", validMonths: 24, requiredFor: null },
  { key: "pals_nrp", label: "Paediatric / neonatal resuscitation (PALS / NRP)", validMonths: 24, requiredFor: null },
  { key: "patient_rights", label: "Patient rights and communication", validMonths: null, requiredFor: null },
  { key: "waste", label: "Hospital waste management", validMonths: 12, requiredFor: null },
  { key: "radiation", label: "Radiation safety", validMonths: 24, requiredFor: null },
  { key: "transfusion", label: "Blood transfusion safety", validMonths: 24, requiredFor: null },
  { key: "cme", label: "CME / CNE", validMonths: null, requiredFor: null },
  { key: "other", label: "Other", validMonths: null, requiredFor: null },
];
export const trainingKind = (k: string) => TRAINING_KINDS.find((t) => t.key === k) ?? null;

export const CREDENTIAL_KINDS = [
  "Professional registration (PMDC / PNC / allied council)", "Basic degree / diploma", "Postgraduate qualification", "Experience certificate",
  "CNIC", "Police character certificate", "Medical fitness / vaccination (Hepatitis B)", "Other",
] as const;
export const VERIFICATION_METHODS = ["Online council register checked", "Letter from the issuing body", "Original document seen and copy kept"] as const;

// ── Appraisals ────────────────────────────────────────────────────────────

export const APPRAISAL_CRITERIA = [
  ["knowledge", "Professional knowledge and skill"], ["quality", "Quality and safety of work"], ["teamwork", "Teamwork and communication"],
  ["patients", "Conduct with patients and families"], ["reliability", "Attendance and reliability"], ["learning", "Learning and development"],
] as const;
export const APPRAISAL_EVERY_MONTHS = 12;

// ── Duty roster ───────────────────────────────────────────────────────────

export const ROSTER_SHIFTS = {
  M: "Morning 08:00-14:00", E: "Evening 14:00-20:00", N: "Night 20:00-08:00", L: "Long day 08:00-20:00", C: "On call", O: "Off", LV: "Leave",
} as const;
export type RosterShift = keyof typeof ROSTER_SHIFTS;
export const ON_DUTY_SHIFTS: RosterShift[] = ["M", "E", "N", "L", "C"];

// ── Controlled documents ──────────────────────────────────────────────────

export const DOCUMENT_KINDS = {
  policy: ["Policy", "POL"], sop: ["Standard operating procedure", "SOP"], protocol: ["Clinical protocol / guideline", "PRT"], plan: ["Plan / programme", "PLN"],
  manual: ["Manual", "MAN"], form: ["Form / register format", "FRM"], jd: ["Job description", "JD"],
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;
/** Years until an approved document must be reviewed. */
export const DOCUMENT_REVIEW_YEARS = 2;

/** Key documents the hospital is expected to have approved and in date. */
export const REQUIRED_DOCUMENTS: { key: string; title: string; area: string }[] = [
  { key: "patient_rights", title: "Patient and family rights and responsibilities", area: "PRE" },
  { key: "consent", title: "Informed consent policy", area: "PRE" },
  { key: "complaints", title: "Complaint handling policy", area: "PRE" },
  { key: "triage", title: "Emergency triage and care policy", area: "AAC" },
  { key: "admission_discharge", title: "Admission, transfer and discharge policy", area: "AAC" },
  { key: "critical_results", title: "Critical results reporting policy", area: "COP" },
  { key: "code_blue", title: "Resuscitation (Code Blue) policy", area: "COP" },
  { key: "transfusion", title: "Blood transfusion policy", area: "COP" },
  { key: "anaesthesia_surgery", title: "Anaesthesia and surgical safety policy", area: "COP" },
  { key: "medication", title: "Medication management policy", area: "MOM" },
  { key: "high_alert", title: "High-alert and look-alike / sound-alike medicines", area: "MOM" },
  { key: "antibiotic", title: "Antibiotic policy", area: "MOM" },
  { key: "ipc_manual", title: "Infection prevention and control manual", area: "IPC" },
  { key: "sterilization", title: "Sterilization (CSSD) procedures", area: "IPC" },
  { key: "waste", title: "Hospital waste management plan", area: "IPC" },
  { key: "quality_plan", title: "Quality improvement and patient safety programme", area: "CQI" },
  { key: "incident_reporting", title: "Incident and sentinel event reporting policy", area: "CQI" },
  { key: "fire_plan", title: "Fire safety and evacuation plan", area: "FMS" },
  { key: "disaster_plan", title: "Disaster / mass casualty plan", area: "FMS" },
  { key: "equipment_plan", title: "Medical equipment management plan", area: "FMS" },
  { key: "hr_policy", title: "Human resource policy (recruitment, credentialing, training)", area: "HRM" },
  { key: "medical_records", title: "Medical records policy (retention, access, confidentiality)", area: "IMS" },
];
