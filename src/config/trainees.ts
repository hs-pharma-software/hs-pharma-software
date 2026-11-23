/** Trainees and interns placed in the hospital's departments: who they are,
 * their programme and institute, and the section they train in (an MLT
 * student in the Lab's Haematology bench, a radiography student in CT Scan).
 * Pure data: the HR Trainees page, the demo hospital and the tests share it. */

export const TRAINEE_PROGRAMS = [
  "MLT (Medical Lab Technology)",
  "Radiography / Medical Imaging Technology",
  "Nursing (BSN)",
  "Nursing (General / Midwifery)",
  "House Officer (MBBS)",
  "Pharm-D",
  "DPT (Physiotherapy)",
  "Operation Theatre Technology",
  "Anaesthesia Technology",
  "Cardiology Technology",
  "Dental Technology",
  "Other",
] as const;

/** Departments a trainee can be placed in, each with its sections (benches, modalities, wards). */
export const TRAINING_SECTIONS: Record<string, string[]> = {
  Laboratory: ["Haematology", "Clinical Chemistry", "Microbiology", "Immunology / Serology", "Histopathology", "Blood Bank", "Sample Collection"],
  Radiology: ["X-Ray", "Ultrasound", "CT Scan", "MRI", "Fluoroscopy", "Mammography"],
  Nursing: ["Medical Ward", "Surgical Ward", "Gynae Ward", "Paediatric Ward", "ICU", "Emergency"],
  Medicine: ["OPD", "Ward", "Emergency"],
  Surgery: ["OPD", "Ward", "Operation Theatre"],
  "Gynae & Obstetrics": ["OPD", "Labour Room", "Ward"],
  Paediatrics: ["OPD", "Ward", "Nursery"],
  Emergency: ["Triage", "Resuscitation", "Observation"],
  "Operation Theatre": ["Main OT", "Minor OT", "Recovery"],
  Pharmacy: ["OPD Pharmacy", "Main Store", "Ward Supply"],
  Physiotherapy: ["OPD", "Ward"],
};

export const TRAINEE_STATUS = {
  active: "In training",
  completed: "Completed",
  left: "Left early",
} as const;
export type TraineeStatus = keyof typeof TRAINEE_STATUS;

/** The program most trainees of a department come from (a starting suggestion in the form). */
export const PROGRAM_FOR_DEPARTMENT: Record<string, string> = {
  Laboratory: "MLT (Medical Lab Technology)",
  Radiology: "Radiography / Medical Imaging Technology",
  Nursing: "Nursing (BSN)",
  Pharmacy: "Pharm-D",
  Physiotherapy: "DPT (Physiotherapy)",
  "Operation Theatre": "Operation Theatre Technology",
};
