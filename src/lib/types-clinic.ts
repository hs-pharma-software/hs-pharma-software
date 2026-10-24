import type { BaseRow, TenantRow } from "./repo/base";

export interface ClinicPatient extends TenantRow {
  mrn: string | null;
  name: string;
  dob: string | null;
  gender: string | null;
  phone: string | null;
  address: string | null;
  blood_group: string | null;
  allergies: string | null;
  emergency_contact: string | null;
  notes: string | null;
}

export interface ClinicDoctor extends TenantRow {
  name: string;
  specialization: string | null;
  qualification: string | null;
  phone: string | null;
  email: string | null;
  consultation_fee: number;
  follow_up_fee: number;
  follow_up_days: number;
  slot_minutes: number;
  available_days: string | null;
  notes: string | null;
}

export interface ClinicAppointment extends TenantRow {
  patient_id: string;
  doctor_id: string | null;
  date: string;
  time: string | null;
  status: "scheduled" | "arrived" | "in_consultation" | "completed" | "cancelled" | "no_show";
  type: "routine" | "follow_up" | "emergency";
  reason: string | null;
  notes: string | null;
  token_no: number | null;
}

export interface ClinicConsultation extends TenantRow {
  appointment_id: string | null;
  patient_id: string;
  doctor_id: string | null;
  date: string;
  complaint: string | null;
  history: string | null;
  vitals: string | null;
  findings: string | null;
  diagnosis: string | null;
  advice: string | null;
  followup_date: string | null;
  followup_notes: string | null;
}

export interface ClinicPrescription extends TenantRow {
  consultation_id: string;
  patient_id: string;
  doctor_id: string | null;
  date: string;
  status: "draft" | "sent" | "acknowledged" | "dispensed" | "cancelled";
  pharmacy_tenant_id: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  dispensed_at: string | null;
  notes: string | null;
}

export interface ClinicRxItem extends BaseRow {
  /** Owning clinic (v39); older rows are owned through their prescription. */
  tenant_id?: string | null;
  prescription_id: string;
  product_id: string | null;
  product_name: string;
  strength: string | null;
  dosage_form: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  qty: number;
  instructions: string | null;
}

export interface PharmacyRxNotification extends BaseRow {
  pharmacy_tenant_id: string;
  prescription_id: string;
  clinic_tenant_id: string;
  clinic_name: string | null;
  patient_name: string | null;
  patient_id: string | null;
  doctor_name: string | null;
  rx_date: string | null;
  item_count: number;
  status: "pending" | "acknowledged" | "dispensed" | "rejected";
  invoice_id: string | null;
  read_at: string | null;
  rx_notes?: string | null;
}

export interface ClinicPharmacyLink extends BaseRow {
  clinic_tenant_id: string;
  pharmacy_tenant_id: string;
  is_active: number;
}
