import type { BaseRow, TenantRow } from "./repo/base";

export interface HospitalPatient extends TenantRow {
  mr_no: string;
  name: string;
  father_name: string | null;
  dob: string | null;
  age_years: number | null;
  age_months: number | null;
  gender: "Male" | "Female" | "Other" | "Unknown";
  phone: string | null;
  address: string | null;
  city: string | null;
  cnic: string | null;
  blood_group: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  insurance_company: string | null;
  insurance_no: string | null;
  next_of_kin_name: string | null;
  next_of_kin_phone: string | null;
  next_of_kin_relation: string | null;
  notes: string | null;
}

export type HospitalServiceCategory =
  | "consultation"
  | "procedure"
  | "lab"
  | "imaging"
  | "bed"
  | "nursing"
  | "ot"
  | "pharmacy"
  | "misc";

export type HospitalServiceBillingUnit =
  | "visit"
  | "day"
  | "test"
  | "procedure"
  | "hour"
  | "unit";

export interface HospitalService extends TenantRow {
  code: string;
  name: string;
  department: string;
  category: HospitalServiceCategory;
  billing_unit: HospitalServiceBillingUnit;
  rate: number;
  is_active: number;
  notes: string | null;
  // Lab "Performing Tests" details (v41).
  sample_type?: string | null;
  unit?: string | null;
  ref_range?: string | null;
  turnaround_hours?: number | null;
  /** Radiology study modality in Performing Images (v44): X-Ray, Ultrasound, CT... */
  modality?: string | null;
  /** Surgery types: the charge breakdown as JSON (v45); see config/surgeryCharges. */
  fee_breakdown?: string | null;
}

export type EpisodeType = "opd" | "ipd" | "emergency";
export type AdmissionStatus = "pending" | "confirmed" | "declined";
export type EpisodeStatus = "open" | "discharged" | "cancelled";

export interface HospitalEpisode extends TenantRow {
  episode_no: string;
  type: EpisodeType;
  patient_id: string;
  doctor_id: string | null;
  department: string | null;
  date: string;
  time: string | null;
  status: EpisodeStatus;
  room_ward: string | null;
  bed_no: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  diagnosis: string | null;
  notes: string | null;
  // OPD visit and the doctor's notes (v40).
  token_no?: number | null;
  consult_status?: "waiting" | "in_consultation" | "done" | null;
  complaint?: string | null;
  vitals?: string | null;
  findings?: string | null;
  advice?: string | null;
  followup_date?: string | null;
  /** The OPD visit an admission came from (v43). */
  from_episode_id?: string | null;
  /** Admission confirmation (v47): pending until the department Head Nurse confirms; null = not needed. */
  admission_status?: AdmissionStatus | null;
  admission_confirmed_by?: string | null;
  admission_confirmed_at?: string | null;
}

/** A medicine a hospital doctor prescribes in an episode (v40). */
export interface HospitalRxItem extends TenantRow {
  episode_id: string;
  product_id: string | null;
  product_name: string;
  generic_name: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  qty: number;
  instructions: string | null;
  sent_at: string | null;
  // Inpatient medication order (v49); absent on OPD prescriptions.
  order_type?: "inpatient" | null;
  ordered_by?: string | null;
  ordered_by_name?: string | null;
  ordered_at?: string | null;
  order_status?: "active" | "stopped" | null;
  stopped_at?: string | null;
  stopped_by_name?: string | null;
  stop_reason?: string | null;
  high_risk?: number | null;
  order_source?: "written" | "verbal" | "telephone" | null;
  received_by_name?: string | null;
  countersigned_by_name?: string | null;
  countersigned_at?: string | null;
  verified_by_name?: string | null;
  verified_at?: string | null;
  /** The patient's own medicine brought from outside (MOM-3 Ind. 71). */
  own_supply?: number | null;
}

/** Fee fields of a lab / radiology order (v40): an order with a fee can only be
 * processed once that fee is paid. */
export interface OrderFee {
  service_id?: string | null;
  charge_id?: string | null;
  fee?: number | null;
  paid?: number | null;
}

export interface HospitalCharge extends TenantRow {
  episode_id: string;
  service_id: string | null;
  description: string;
  department: string | null;
  category: string | null;
  qty: number;
  rate: number;
  discount_pct: number;
  amount: number;
  doctor_id: string | null;
  performed_by: string | null;
  charge_date: string;
  notes: string | null;
  invoice_id: string | null;
}

export type PaymentType = "deposit" | "payment" | "refund";
export type PaymentMethod = "cash" | "card" | "online" | "bank";

export interface HospitalPayment extends TenantRow {
  episode_id: string;
  type: PaymentType;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  received_at: string;
}

export interface HospitalDepartment extends TenantRow {
  name: string;
  type: "clinical" | "diagnostic" | "support" | "admin";
  head: string | null;
  phone: string | null;
  notes: string | null;
  is_active: number;
}

export type OrderPriority = "routine" | "urgent" | "stat";

export interface HospitalLabOrder extends TenantRow, OrderFee {
  order_no: string;
  episode_id: string | null;
  patient_id: string;
  test_name: string;
  priority: OrderPriority;
  /** pending = registered, sample awaited; collected = sample received; processing; awaiting_verification =
   * result entered, not released; reported = verified and released; cancelled / superseded. */
  status: LabTestStatus;
  request_id?: string | null;
  sample_type?: string | null;
  result_entered_by?: string | null;
  result_entered_at?: string | null;
  verified_by?: string | null;
  verified_by_name?: string | null;
  verified_by_license?: string | null;
  verified_at?: string | null;
  /** Results of a test with several parameters (CBC), JSON LabComponent[] (v44). */
  components?: string | null;
  result_value: string | null;
  unit: string | null;
  ref_range: string | null;
  flag: "N" | "H" | "L" | null;
  ordered_by: string | null;
  ordered_at: string;
  reported_at: string | null;
  notes: string | null;
}

export interface HospitalImagingOrder extends TenantRow, OrderFee {
  order_no: string;
  episode_id: string | null;
  patient_id: string;
  modality: string;
  body_part: string | null;
  priority: OrderPriority;
  status: "pending" | "performed" | "reported" | "cancelled";
  findings: string | null;
  impression: string | null;
  radiologist: string | null;
  ordered_by: string | null;
  ordered_at: string;
  reported_at: string | null;
  notes: string | null;
}

/** One parameter of a panel test result (Hb, TLC, platelets... of a CBC). */
export interface LabComponent {
  key: string;
  name: string;
  group: string | null;
  value: string;
  unit: string | null;
  ref_range: string | null;
  flag: "N" | "H" | "L" | null;
}

export type LabTestStatus = "pending" | "collected" | "processing" | "awaiting_verification" | "reported" | "cancelled" | "superseded";

/** A place of this hospital where lab tests are registered and samples taken. */
export interface CollectionCenter extends TenantRow {
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: number;
}

export type RegistrationLocation = "hospital_lab" | "department" | "collection_center" | "referral";

/** One patient order of one or more lab tests (v42). lab_no is the Unique Lab
 * Number; invoice_no the Lab Invoice Number. Both are unique per hospital. */
export interface LabRequest extends TenantRow {
  lab_no: string;
  invoice_no: string;
  episode_id: string | null;
  patient_id: string;
  referring_doctor: string | null;
  registration_location: RegistrationLocation;
  collection_center_id: string | null;
  external_ref: string | null;
  registered_by: string | null;
  sample_collected_at: string | null;
  sample_received_at: string | null;
  print_count: number;
  last_printed_at: string | null;
  notes: string | null;
  /** Random token in the report QR code for the online copy (v44). */
  public_token?: string | null;
}

export type SurgeryStatus = "planned" | "done" | "cancelled";

/** A surgery planned for an admission (v43). */
export interface SurgeryBooking extends TenantRow {
  episode_id: string;
  patient_id: string;
  service_id: string;
  surgery_name: string;
  fee: number;
  charge_id: string | null;
  /** The charges this surgery is billed with, as JSON (v45). */
  fee_breakdown?: string | null;
  /** The surgery invoice in Billing (v45). */
  invoice_id?: string | null;
  surgeon_id: string | null;
  planned_date: string | null;
  status: SurgeryStatus;
  notes: string | null;
  performed_at: string | null;
}

// ── Medical record forms, checklists, vital signs (v48) ──────────────────

export type FormStatus = "draft" | "final" | "amended" | "voided";

/** One filled form (src/config/forms) for a patient and visit / admission, or a register entry. */
export interface FormRecord extends TenantRow {
  form_key: string;
  form_version: number;
  scope: "patient" | "register";
  patient_id: string | null;
  episode_id: string | null;
  department: string | null;
  status: FormStatus;
  /** JSON of the field values. */
  data: string;
  summary: string | null;
  unique_key: string | null;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  finalized_by: string | null;
  finalized_by_name: string | null;
  finalized_at: string | null;
  revision_no: number;
  /** The surgery booking a theatre / anaesthesia form belongs to (v50). */
  subject_id?: string | null;
}

/** Append-only history of a form record: finalize, amend (with the values before) and void. */
export interface FormRevision extends TenantRow {
  record_id: string;
  revision_no: number;
  action: "finalize" | "amend" | "void";
  status_before: FormStatus | null;
  data_before: string | null;
  reason: string | null;
  user_id: string | null;
  user_name: string | null;
}

export interface ChecklistEntry extends TenantRow {
  session_id: string;
  checklist_key: string;
  item_key: string;
  kind: "self_confirmation" | "observation";
  status: "completed" | "not_completed" | "na" | "pending";
  reason: string | null;
  patient_id: string | null;
  episode_id: string | null;
  record_id: string | null;
  department: string | null;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  recorded_at: string;
  /** A later entry that corrects this one. */
  superseded_by: string | null;
  /** The surgery booking (surgical safety checklist, v50). */
  subject_id?: string | null;
}

export interface VitalSigns extends TenantRow {
  patient_id: string;
  episode_id: string;
  recorded_at: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  pulse: number | null;
  resp_rate: number | null;
  temperature_c: number | null;
  spo2: number | null;
  pain_score: number | null;
  consciousness: string | null;
  blood_sugar: number | null;
  weight_kg: number | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  /** ward (default), intra_op (during anaesthesia) or recovery (v50). */
  phase?: "ward" | "intra_op" | "recovery" | null;
  subject_id?: string | null;
  rhythm?: string | null;
  airway?: string | null;
}

/** One dose given, held, refused or missed (medication administration record, v49). */
export interface MarEntry extends TenantRow {
  patient_id: string;
  episode_id: string;
  order_id: string;
  status: "given" | "held" | "refused" | "missed";
  given_at: string;
  dose_given: string | null;
  route_given: string | null;
  identifier_1: string | null;
  identifier_2: string | null;
  checked_medicine: number;
  checked_dose: number;
  checked_route: number;
  checked_time: number;
  second_checker_id: string | null;
  second_checker_name: string | null;
  reason: string | null;
  notes: string | null;
  given_by: string | null;
  given_by_name: string | null;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}

// ── Infection prevention and control (v52) ──────────────────────────────

/** A hand-hygiene observation session by an IPC auditor in one area. */
export interface HhSession extends TenantRow {
  department: string | null;
  area: string;
  session_date: string;
  observer_id: string | null;
  observer_name: string | null;
  observer_role: string | null;
  status: "open" | "closed";
  notes: string | null;
  closed_at: string | null;
}

/** One observed hand-hygiene opportunity (WHO moment 1-5). */
export interface HhObservation extends TenantRow {
  session_id: string;
  profession: string;
  moment: number;
  action: "handrub" | "handwash" | "missed";
  gloves_misuse: number;
  observed_at: string;
  recorded_by_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface SterilEquipment extends TenantRow {
  code: string;
  name: string;
  kind: "steam_autoclave" | "eto" | "plasma" | "dry_heat" | "other";
  location: string | null;
  is_active: number;
  notes: string | null;
}

export type SterilCycleStatus = "awaiting_release" | "released" | "failed" | "recalled";

/** One sterilization cycle (load) of an autoclave. */
export interface SterilCycle extends TenantRow {
  equipment_id: string;
  cycle_no: string;
  started_at: string;
  ended_at: string | null;
  operator_id: string | null;
  operator_name: string | null;
  program: string | null;
  temperature_c: number | null;
  pressure_kpa: number | null;
  exposure_min: number | null;
  load_description: string | null;
  implant_load: number;
  physical_result: "pass" | "fail" | null;
  chemical_result: "pass" | "fail" | null;
  biological_result: "pending" | "pass" | "fail" | "na" | null;
  status: SterilCycleStatus;
  sterilized_on: string | null;
  expires_on: string | null;
  released_by_id: string | null;
  released_by_name: string | null;
  released_at: string | null;
  failure_reason: string | null;
  corrective_action: string | null;
  failed_by_name: string | null;
  failed_at: string | null;
  recall_reason: string | null;
  recalled_by_name: string | null;
  recalled_at: string | null;
  reprocessed_in_cycle_id: string | null;
}

/** An instrument set in a load. */
export interface SterilItem extends TenantRow {
  cycle_id: string;
  set_code: string | null;
  set_name: string;
  quantity: number;
}

/** A sterile set recorded as used in a surgery (traceability). */
export interface SterilUsage extends TenantRow {
  item_id: string;
  cycle_id: string;
  booking_id: string;
  patient_id: string;
  episode_id: string;
  used_at: string;
  recorded_by_name: string | null;
}
