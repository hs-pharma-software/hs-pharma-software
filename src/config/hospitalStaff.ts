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

const DOCTOR_PAGES = ["hospital_doctor_desk", "hospital_patients", "hospital_lab_reports", "hospital_radiology_reports"];

export const DESIGNATIONS: Designation[] = [
  { key: "hod", label: "Head of Department (HoD)", prefix: "HOD", license: "PMDC", licenseRequired: true, doctor: true,
    pages: ["hospital_dashboard", ...DOCTOR_PAGES, "hospital_episodes", "hospital_departments", "hospital_lab", "hospital_radiology", "hospital_surgery"] },
  { key: "consultant", label: "Consultant", prefix: "CON", license: "PMDC", licenseRequired: true, doctor: true, pages: DOCTOR_PAGES },
  { key: "medical_specialist", label: "Medical Specialist", prefix: "MS", license: "PMDC", licenseRequired: true, doctor: true, pages: DOCTOR_PAGES },
  { key: "medical_officer", label: "Medical Officer", prefix: "MO", license: "PMDC", licenseRequired: true, doctor: true, pages: DOCTOR_PAGES },
  { key: "nursing_superintendent", label: "Nursing Superintendent", prefix: "NS", license: "PNC", licenseRequired: true, doctor: false,
    pages: ["hospital_dashboard", "hospital_admissions", "hospital_patients", "hospital_episodes"] },
  { key: "head_nurse", label: "Head Nurse (department)", prefix: "HN", license: "PNC", licenseRequired: true, doctor: false,
    pages: ["hospital_admissions", "hospital_patients", "hospital_episodes"] },
  { key: "nurse", label: "Nurse", prefix: "NUR", license: "PNC", licenseRequired: true, doctor: false, pages: ["hospital_patients", "hospital_episodes"] },
  { key: "pathologist", label: "Pathologist (verifies lab reports)", prefix: "PATH", license: "PMDC", licenseRequired: true, doctor: false,
    pages: ["hospital_lab", "hospital_patients"] },
  { key: "lab_receptionist", label: "Lab Counter Receptionist", prefix: "LR", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_lab_orders", "hospital_lab_reports", "hospital_patients", "hospital_reception"] },
  { key: "collection_center_receptionist", label: "Collection Center Receptionist", prefix: "CCR", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_lab_orders", "hospital_lab_reports", "hospital_patients", "hospital_reception"] },
  { key: "lab_technician", label: "Lab Technician (Paramedic)", prefix: "LT", license: "LICENSE", licenseRequired: false, doctor: false, pages: ["hospital_lab"] },
  { key: "radiographer", label: "Radiographer (Paramedic)", prefix: "RT", license: "LICENSE", licenseRequired: false, doctor: false, pages: ["hospital_radiology"] },
  { key: "paramedic", label: "Paramedic (other)", prefix: "PM", license: "LICENSE", licenseRequired: false, doctor: false, pages: ["hospital_patients", "hospital_episodes"] },
  { key: "store_keeper", label: "Store Keeper", prefix: "SK", license: null, licenseRequired: false, doctor: false, pages: ["products", "suppliers", "tasks"] },
  { key: "hr_officer", label: "HR Officer", prefix: "HR", license: null, licenseRequired: false, doctor: false, pages: ["hospital_hr"] },
  { key: "admin", label: "Admin", prefix: "ADM", license: null, licenseRequired: false, doctor: false, pages: null },
  { key: "receptionist", label: "Receptionist", prefix: "REC", license: null, licenseRequired: false, doctor: false,
    pages: ["hospital_reception", "hospital_patients", "hospital_episodes", "hospital_lab_reports", "hospital_radiology_reports"] },
  { key: "other", label: "Other", prefix: "EMP", license: null, licenseRequired: false, doctor: false, pages: ["hospital_dashboard"] },
];

/** Confirm admissions: the Head Nurse for their own department, the Nursing
 * Superintendent for every department. */
export const ADMISSION_CONFIRM_ALL_ROLES = ["nursing_superintendent"];
export const ADMISSION_CONFIRM_DEPT_ROLES = ["head_nurse"];

export const DOCTOR_CATEGORIES = DESIGNATIONS.filter((d) => d.doctor).map((d) => d.key);

export function designation(key: string | null | undefined): Designation | null {
  return DESIGNATIONS.find((d) => d.key === key) ?? null;
}

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
