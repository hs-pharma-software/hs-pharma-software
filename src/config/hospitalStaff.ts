/** Hospital HR: designations, their employee-id prefix, the professional
 * licence each needs, and what a login for that role may open. */

export type LicenseKind = "PMDC" | "PNC" | "LICENSE";

export interface Designation {
  key: string;
  label: string;
  /** Employee id prefix: MO -> MO-01, MO-02 ... */
  prefix: string;
  license: LicenseKind | null;
  licenseRequired: boolean;
  /** Sees patients in OPD and prescribes (appears in Reception's doctor list). */
  doctor: boolean;
  /** Sections a login with this role may open (module keys); null = everything. */
  pages: string[] | null;
}

const DOCTOR_PAGES = ["hospital_doctor_desk", "hospital_patients", "hospital_lab_reports", "hospital_radiology_reports", "hospital_medicines"];

export const DESIGNATIONS: Designation[] = [
  { key: "hod", label: "Head of Department (HoD)", prefix: "HOD", license: "PMDC", licenseRequired: true, doctor: true,
    pages: ["hospital_dashboard", ...DOCTOR_PAGES, "hospital_episodes", "hospital_departments", "hospital_lab", "hospital_radiology", "hospital_surgery", "hospital_quality"] },
  { key: "consultant", label: "Consultant", prefix: "CON", license: "PMDC", licenseRequired: true, doctor: true, pages: DOCTOR_PAGES },
  { key: "medical_specialist", label: "Medical Specialist", prefix: "MS", license: "PMDC", licenseRequired: true, doctor: true, pages: DOCTOR_PAGES },
  { key: "medical_officer", label: "Medical Officer", prefix: "MO", license: "PMDC", licenseRequired: true, doctor: true, pages: DOCTOR_PAGES },
  { key: "nursing_superintendent", label: "Nursing Superintendent", prefix: "NS", license: "PNC", licenseRequired: true, doctor: false,
    pages: ["hospital_dashboard", "hospital_admissions", "hospital_patients", "hospital_episodes", "hospital_ipc", "hospital_quality", "hospital_medicines"] },
  { key: "infection_control_nurse", label: "Infection Control Nurse", prefix: "ICN", license: "PNC", licenseRequired: true, doctor: false,
    pages: ["hospital_ipc", "hospital_cssd", "hospital_patients", "hospital_episodes"] },
  { key: "cssd_supervisor", label: "CSSD Supervisor (releases sterile loads)", prefix: "CSS", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_cssd"] },
  { key: "cssd_technician", label: "CSSD Technician", prefix: "CST", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_cssd"] },
  { key: "head_nurse", label: "Head Nurse (department)", prefix: "HN", license: "PNC", licenseRequired: true, doctor: false,
    pages: ["hospital_admissions", "hospital_patients", "hospital_episodes", "hospital_medicines"] },
  { key: "nurse", label: "Nurse", prefix: "NUR", license: "PNC", licenseRequired: true, doctor: false, pages: ["hospital_patients", "hospital_episodes", "hospital_medicines"] },
  { key: "pathologist", label: "Pathologist (verifies lab reports)", prefix: "PATH", license: "PMDC", licenseRequired: true, doctor: false,
    pages: ["hospital_lab", "hospital_patients", "hospital_blood_bank"] },
  { key: "blood_bank_technologist", label: "Blood Bank Technologist", prefix: "BBT", license: "LICENSE", licenseRequired: false, doctor: false,
    pages: ["hospital_blood_bank", "hospital_patients"] },
  { key: "lab_receptionist", label: "Lab Counter Receptionist", prefix: "LR", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_lab_orders", "hospital_lab_reports", "hospital_patients", "hospital_reception", "hospital_my_cash"] },
  { key: "collection_center_receptionist", label: "Collection Center Receptionist", prefix: "CCR", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_lab_orders", "hospital_lab_reports", "hospital_patients", "hospital_reception", "hospital_my_cash"] },
  { key: "radiology_receptionist", label: "Radiology Counter Receptionist", prefix: "RR", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_reception", "hospital_radiology_orders", "hospital_radiology_reports", "hospital_patients", "hospital_my_cash"] },
  { key: "lab_technician", label: "Lab Technician (Paramedic)", prefix: "LT", license: "LICENSE", licenseRequired: false, doctor: false, pages: ["hospital_lab"] },
  { key: "radiographer", label: "Radiology Technologist / Radiographer (Paramedic)", prefix: "RT", license: "LICENSE", licenseRequired: false, doctor: false,
    pages: ["hospital_radiology_tech", "hospital_radiology_reports", "hospital_patients"] },
  { key: "radiologist", label: "Radiologist (reports imaging)", prefix: "RAD", license: "PMDC", licenseRequired: true, doctor: false,
    pages: ["hospital_radiology_reporting", "hospital_radiology_reports", "hospital_patients"] },
  { key: "radiology_admin", label: "Radiology Administrator", prefix: "RA", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_radiology", "hospital_patients"] },
  { key: "paramedic", label: "Paramedic (other)", prefix: "PM", license: "LICENSE", licenseRequired: false, doctor: false, pages: ["hospital_patients", "hospital_episodes"] },
  { key: "pharmacist", label: "Pharmacist", prefix: "PH", license: "LICENSE", licenseRequired: true, doctor: false,
    pages: ["hospital_episodes", "hospital_patients", "hospital_medicines", "products", "suppliers"] },
  { key: "store_keeper", label: "Store Keeper", prefix: "SK", license: null, licenseRequired: false, doctor: false, pages: ["products", "suppliers", "tasks"] },
  { key: "quality_manager", label: "Quality Manager / Patient Safety Officer", prefix: "QM", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_quality", "hospital_facility", "hospital_records", "hospital_dashboard", "hospital_patients", "hospital_episodes"] },
  { key: "facility_manager", label: "Facility Manager / Biomedical Engineer", prefix: "FM", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_facility"] },
  { key: "medical_records_officer", label: "Medical Records Officer", prefix: "MRO", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_records", "hospital_patients", "hospital_episodes"] },
  { key: "accountant", label: "Accountant / Finance Officer", prefix: "ACC", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_finance", "hospital_dashboard", "hospital_my_cash"] },
  { key: "hr_officer", label: "HR Officer", prefix: "HR", license: null, licenseRequired: false, doctor: false, pages: ["hospital_hr"] },
  { key: "admin", label: "Admin", prefix: "ADM", license: null, licenseRequired: false, doctor: false, pages: null },
  { key: "receptionist", label: "Receptionist", prefix: "REC", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_reception", "hospital_patients", "hospital_episodes", "hospital_lab_reports", "hospital_radiology_reports", "hospital_my_cash"] },
  { key: "computer_operator", label: "Computer Operator", prefix: "CO", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_reception", "hospital_patients", "hospital_episodes", "hospital_my_cash", "hospital_hr_roster"] },
  { key: "security_guard", label: "Security Guard", prefix: "SG", license: null, licenseRequired: false, doctor: false, pages: ["hospital_hr_roster"] },
  { key: "other", label: "Other", prefix: "EMP", license: null, licenseRequired: false, doctor: false, pages: ["hospital_dashboard"] },
];

/** Duty roster groups: who is on the floor, by the kind of work. */
export const STAFF_GROUPS = {
  doctors: "Doctors",
  nurses: "Nurses",
  paramedical: "Paramedical staff",
  technical: "Technical staff",
  support: "Support and admin",
} as const;
export type StaffGroup = keyof typeof STAFF_GROUPS;
const GROUP_OF: Record<string, StaffGroup> = {
  hod: "doctors", consultant: "doctors", medical_specialist: "doctors", medical_officer: "doctors", pathologist: "doctors", radiologist: "doctors",
  nursing_superintendent: "nurses", head_nurse: "nurses", nurse: "nurses", infection_control_nurse: "nurses",
  lab_technician: "paramedical", radiographer: "paramedical", paramedic: "paramedical", blood_bank_technologist: "paramedical", pharmacist: "paramedical",
  cssd_supervisor: "technical", cssd_technician: "technical", facility_manager: "technical", computer_operator: "technical", radiology_admin: "technical",
};
/** The roster group of a designation (support and admin when not clinical or technical). */
export const staffGroup = (category: string | null | undefined): StaffGroup => GROUP_OF[category ?? ""] ?? "support";

/** Confirm admissions: the Head Nurse for their own department, the Nursing
 * Superintendent for every department. */
export const ADMISSION_CONFIRM_ALL_ROLES = ["nursing_superintendent"];
export const ADMISSION_CONFIRM_DEPT_ROLES = ["head_nurse"];

/** Sterilization (MSDS IPC-2): who runs cycles, who releases loads. A load is
 * never released by the person who ran it. */
export const CSSD_OPERATOR_ROLES = ["cssd_technician", "cssd_supervisor", "infection_control_nurse"];
export const CSSD_RELEASE_ROLES = ["cssd_supervisor", "infection_control_nurse", "nursing_superintendent"];
/** Blood bank (MSDS COP-2): screening, release to stock, compatibility testing and issue. */
export const BLOOD_BANK_ROLES = ["blood_bank_technologist", "pathologist"];

/** Quality and patient safety (MSDS PRE-4, CQI-3, ROM-5): review incidents,
 * run root cause analyses, handle complaints and verify corrective actions. */
export const QUALITY_ROLES = ["quality_manager", "nursing_superintendent", "hod"];

/** Facility management and safety (MSDS FMS): equipment, maintenance, licences, drills. */
export const FACILITY_ROLES = ["facility_manager"];
/** Mock drills are also run by the quality team and the Nursing Superintendent. */
export const DRILL_ROLES = ["facility_manager", "quality_manager", "nursing_superintendent"];
/** Human resources (MSDS HRM): training records, credential verification, rosters, appraisals. */
export const HR_ROLES = ["hr_officer"];
export const TRAINING_ROLES = ["hr_officer", "nursing_superintendent", "quality_manager", "infection_control_nurse"];
export const ROSTER_ROLES = ["hr_officer", "nursing_superintendent", "head_nurse", "hod"];
/** Who places trainees and interns: HR, nursing, heads of department and the department leads who supervise them. */
export const TRAINEE_ROLES = ["hr_officer", "nursing_superintendent", "hod", "pathologist", "radiologist", "radiology_admin"];
export const APPRAISER_ROLES = ["hod", "nursing_superintendent", "head_nurse", "hr_officer"];
/** Controlled documents: drafted by these, approved by the quality team (never by the author). */
export const DOCUMENT_AUTHOR_ROLES = ["quality_manager", "nursing_superintendent", "hod", "hr_officer", "infection_control_nurse", "facility_manager", "pathologist"];

/** Medicines management (MSDS MOM): the formulary, ADR assessment and controlled drug receipts. */
export const PHARMACY_ROLES = ["pharmacist"];

/** Medical records (MSDS IMS): release of information is decided by the records officer or an HoD. */
export const RECORDS_ROLES = ["medical_records_officer"];
export const RECORDS_APPROVER_ROLES = ["medical_records_officer", "hod"];

/** Which fees a login sees at Reception: the lab counter only lab fees, the
 * radiology counter only radiology fees; everyone else every fee. */
export const FEE_SCOPE_LAB_ROLES = ["lab_receptionist", "collection_center_receptionist", "lab_technician", "pathologist"];
export const FEE_SCOPE_IMAGING_ROLES = ["radiology_receptionist", "radiographer", "radiologist", "radiology_admin"];

/** Radiology portal: who sets up modalities, machines (and their DICOM keys)
 * and the PACS; who performs examinations; who assigns machines to technologists. */
export const RADIOLOGY_ADMIN_ROLES = ["radiology_admin", "hod"];
export const TECHNOLOGIST_ROLES = ["radiographer", "radiology_admin"];
export const TECHNOLOGIST_ASSIGN_ROLES = ["radiology_admin", "hod"];

/** Finance (collections, receptionist day closings): verified by the accountant or a full-access login. */
export const FINANCE_ROLES = ["accountant"];
/** Desks that take money and close their day. */
export const CASH_DESK_ROLES = ["receptionist","lab_receptionist","collection_center_receptionist","radiology_receptionist"];

/** Hand-hygiene observation audits (MSDS IPC-1 Ind. 84, 86). */
export const IPC_AUDITOR_ROLES = ["infection_control_nurse", "nursing_superintendent", "head_nurse"];

export const DOCTOR_CATEGORIES = DESIGNATIONS.filter((d) => d.doctor).map((d) => d.key);

export function designation(key: string | null | undefined): Designation | null {
  return DESIGNATIONS.find((d) => d.key === key) ?? null;
}

/** A staff member's other roles (v101), read from their stored JSON list. */
export function extraRoles(raw: string | null | undefined): string[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && Boolean(designation(k))) : [];
  } catch {
    return [];
  }
}

/** Every role of a staff member: the designation first, then the others. */
export function staffRoles(s: { staff_category?: string | null; extra_roles?: string | null } | null | undefined): string[] {
  return [...new Set([s?.staff_category ?? "", ...extraRoles(s?.extra_roles)].filter(Boolean))];
}

/** The pages a login with these roles opens: all of each role's (null = every section). */
export function pagesForRoles(roles: string[]): string[] | null {
  const ds = roles.map((r) => designation(r)).filter((d): d is Designation => Boolean(d));
  if (!ds.length) return ["hospital_dashboard"];
  if (ds.some((d) => d.pages === null)) return null;
  return [...new Set(ds.flatMap((d) => d.pages ?? []))];
}

/** Business types whose staff have designations, licences and role-based logins. */
export const usesHospitalStaff = (typeId: string | null | undefined) => typeId === "hospital" || typeId === "radiology_center";

const RADIOLOGY_CENTER_ROLES = ["radiology_admin", "radiology_receptionist", "radiographer", "radiologist", "accountant", "admin"];

/** The designations a business of this type can give its staff. */
export const designationsFor = (typeId: string | null | undefined): Designation[] =>
  typeId === "radiology_center" ? DESIGNATIONS.filter((d) => RADIOLOGY_CENTER_ROLES.includes(d.key)) : DESIGNATIONS;

export const LICENSE_LABEL: Record<LicenseKind, string> = {
  PMDC: "PMDC No",
  PNC: "PNC No",
  LICENSE: "Licence No",
};

/** "MO-07": prefix plus the number, at least two digits. */
export function formatEmployeeId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(2, "0")}`;
}

/** What a role may do in the lab. Owners and full-access logins may do everything. */
export const LAB_VERIFY_ROLES = ["pathologist", "hod"];
export const LAB_PROCESS_ROLES = ["pathologist", "hod", "lab_technician"];
export const LAB_REGISTER_ROLES = [...LAB_PROCESS_ROLES, "lab_receptionist", "collection_center_receptionist", "receptionist"];
