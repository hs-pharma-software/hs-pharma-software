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
}

export type EpisodeType = "opd" | "ipd" | "emergency";
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
  surgeon_id: string | null;
  planned_date: string | null;
  status: SurgeryStatus;
  notes: string | null;
  performed_at: string | null;
}
