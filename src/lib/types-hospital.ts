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

export interface HospitalLabOrder extends TenantRow {
  order_no: string;
  episode_id: string | null;
  patient_id: string;
  test_name: string;
  priority: OrderPriority;
  status: "pending" | "collected" | "reported" | "cancelled";
  result_value: string | null;
  unit: string | null;
  ref_range: string | null;
  flag: "N" | "H" | "L" | null;
  ordered_by: string | null;
  ordered_at: string;
  reported_at: string | null;
  notes: string | null;
}

export interface HospitalImagingOrder extends TenantRow {
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
