/** Infection prevention and control registers (MSDS IPC-1, COP-5 Ind. 50;
 * Category I, CG-01MS-Ed2-01092023). Department-wide records: an entry is
 * linked to a patient only when it is about one (an infection case). */
import type { FormDef } from "./types";

const IPC_STAFF = ["infection_control_nurse", "nursing_superintendent", "head_nurse"];
const base = { department: "Infection Control", scope: "register" as const };

export const IPC_COMMITTEE: FormDef = {
  ...base, key: "ipc_committee_meeting", version: 1, title: "IPC Committee Meeting",
  msds: ["IPC-1 · 85"], classification: "Required",
  createRoles: [...IPC_STAFF, "senior_doctor"], finalizeRoles: [...IPC_STAFF, "senior_doctor"], summaryField: "meeting_date",
  fields: [
    { key: "meeting_date", label: "Meeting date", type: "date", required: true },
    { key: "chair", label: "Chaired by", type: "text", required: true },
    { key: "attendees", label: "Members present (and departments)", type: "textarea", required: true },
    { key: "observations", label: "Observations discussed", type: "textarea", required: true },
    { key: "decisions", label: "Recommended actions, who and by when", type: "textarea", required: true },
    { key: "next_meeting", label: "Next meeting", type: "date" },
  ],
};

export const IPC_ROUND: FormDef = {
  ...base, key: "ipc_round", version: 1, title: "Infection Control Round",
  msds: ["IPC-1 · 86", "IPC-1 · 84"], classification: "Required",
  createRoles: IPC_STAFF, finalizeRoles: IPC_STAFF, summaryField: "area",
  fields: [
    { key: "round_date", label: "Date", type: "date", required: true },
    { key: "area", label: "Ward / department visited", type: "text", required: true },
    { key: "team", label: "IPC team members", type: "text", required: true },
    { key: "hand_hygiene", label: "Hand-rub available and in use", type: "select", required: true, options: ["Satisfactory", "Needs improvement", "Not available"] },
    { key: "ppe", label: "PPE available and used correctly", type: "select", required: true, options: ["Satisfactory", "Needs improvement", "Not available"] },
    { key: "waste", label: "Waste segregation (colour-coded bins, sharps boxes)", type: "select", required: true, options: ["Satisfactory", "Needs improvement", "Not available"] },
    { key: "cleaning", label: "Environmental cleaning", type: "select", required: true, options: ["Satisfactory", "Needs improvement"] },
    { key: "isolation", label: "Isolation precautions followed (if any patient needs them)", type: "select", required: true, options: ["Satisfactory", "Needs improvement", "Not applicable"] },
    { key: "findings", label: "Findings", type: "textarea", required: true },
    { key: "actions", label: "Actions assigned (who, by when)", type: "textarea", required: true },
  ],
};

export const WASTE_LOG: FormDef = {
  ...base, key: "waste_log", version: 1, title: "Hospital Waste Collection",
  msds: ["IPC-1 · 88"], classification: "Required",
  createRoles: [...IPC_STAFF, "nurse", "store_keeper", "other"], finalizeRoles: [...IPC_STAFF, "nurse"], summaryField: "collected_on",
  fields: [
    { key: "collected_on", label: "Date", type: "date", required: true },
    { key: "area", label: "Area / collection point", type: "text", required: true },
    { key: "infectious_kg", label: "Infectious waste (yellow)", type: "number", unit: "kg", min: 0, max: 10000, required: true },
    { key: "sharps_containers", label: "Sharps containers", type: "number", min: 0, max: 1000, required: true },
    { key: "pharmaceutical_kg", label: "Pharmaceutical / chemical waste", type: "number", unit: "kg", min: 0, max: 10000 },
    { key: "general_kg", label: "General (non-risk) waste", type: "number", unit: "kg", min: 0, max: 100000 },
    { key: "segregation_ok", label: "Segregated correctly at source", type: "yesno", required: true },
    { key: "transported_to", label: "Taken to", type: "select", required: true, options: ["Central storage", "Incinerator (on site)", "Collected by licensed contractor"] },
    { key: "manifest_no", label: "Contractor manifest / receipt no", type: "text", showIf: { field: "transported_to", equals: "Collected by licensed contractor" }, required: true },
    { key: "collected_by", label: "Collected by", type: "text", required: true },
  ],
};

export const SHARPS_EXPOSURE: FormDef = {
  ...base, key: "sharps_exposure", version: 1, title: "Needle-stick / Exposure Report",
  msds: ["IPC-1 · 84d", "IPC-1 · 84f"], classification: "Required",
  // Anyone can report; only IPC / senior staff read the register (staff health information).
  createRoles: ["any_clinical", "lab_technician", "radiographer", "cssd_technician", "cssd_supervisor", "other"],
  finalizeRoles: IPC_STAFF, viewRoles: [...IPC_STAFF, "hr_officer"], summaryField: "exposure_type",
  fields: [
    { key: "exposed_at", label: "Date and time of exposure", type: "datetime", required: true },
    { key: "staff_name", label: "Staff member exposed", type: "text", required: true },
    { key: "staff_role", label: "Designation", type: "text", required: true },
    { key: "area", label: "Where it happened", type: "text", required: true },
    { key: "exposure_type", label: "Exposure", type: "select", required: true, options: ["Needle-stick", "Cut with sharp instrument", "Blood / body fluid splash (eyes, mouth)", "Splash on broken skin"] },
    { key: "source_known", label: "Source patient known", type: "yesno", required: true },
    { key: "source_mr", label: "Source patient MR number", type: "text", showIf: { field: "source_known", equals: "Yes" }, required: true },
    { key: "first_aid", label: "First aid done (wash, encourage bleeding, no scrubbing)", type: "yesno", required: true },
    { key: "hbv_immunized", label: "Staff member vaccinated against hepatitis B", type: "select", required: true, options: ["Yes", "No", "Not known"] },
    { key: "pep", label: "Post-exposure prophylaxis given", type: "select", required: true, options: ["Yes", "No, not indicated", "Declined"] },
    { key: "follow_up", label: "Follow-up testing plan", type: "textarea", required: true },
  ],
};

export const HAI_CASE: FormDef = {
  ...base, key: "hai_case", version: 1, title: "Healthcare-associated Infection",
  msds: ["IPC-1 · 84", "COP-5 · 50"], classification: "Required",
  createRoles: [...IPC_STAFF, "doctor"], finalizeRoles: IPC_STAFF, summaryField: "infection_type",
  fields: [
    { key: "infection_type", label: "Infection", type: "select", required: true, options: ["Surgical site infection", "Catheter-associated urinary tract infection", "Central line bloodstream infection", "Ventilator-associated pneumonia", "Other"] },
    { key: "onset_on", label: "Date of onset", type: "date", required: true },
    { key: "ward", label: "Ward", type: "text", required: true },
    { key: "organism", label: "Organism (culture)", type: "text" },
    { key: "h_ssi", label: "Surgery (for surgical site infection)", type: "heading", showIf: { field: "infection_type", equals: "Surgical site infection" } },
    { key: "procedure", label: "Procedure", type: "text", required: true, showIf: { field: "infection_type", equals: "Surgical site infection" } },
    { key: "surgeon", label: "Surgeon", type: "text", required: true, showIf: { field: "infection_type", equals: "Surgical site infection" } },
    { key: "theatre", label: "Operation theatre / room", type: "text", required: true, showIf: { field: "infection_type", equals: "Surgical site infection" } },
    { key: "surgery_on", label: "Date of surgery", type: "date", required: true, showIf: { field: "infection_type", equals: "Surgical site infection" } },
    { key: "actions", label: "Actions taken", type: "textarea", required: true },
  ],
};

export const IPC_REGISTERS: FormDef[] = [IPC_COMMITTEE, IPC_ROUND, WASTE_LOG, SHARPS_EXPOSURE, HAI_CASE];
