import { dbExecute, dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";
import type {
  ClinicPatient,
  ClinicDoctor,
  ClinicAppointment,
  ClinicConsultation,
  ClinicPrescription,
  ClinicRxItem,
  PharmacyRxNotification,
  ClinicPharmacyLink,
} from "../types-clinic";

export type { PharmacyRxNotification } from "../types-clinic";

export const patientsRepo = createTenantRepo<ClinicPatient>("clinic_patients");
export const doctorsRepo = createTenantRepo<ClinicDoctor>("clinic_doctors");
export const appointmentsRepo = createTenantRepo<ClinicAppointment>("clinic_appointments");
export const consultationsRepo = createTenantRepo<ClinicConsultation>("clinic_consultations");

// ── Prescriptions ──────────────────────────────────────────────────────────

export const prescriptionsRepo = createTenantRepo<ClinicPrescription>("clinic_prescriptions");

export async function getRxItems(prescriptionId: string): Promise<ClinicRxItem[]> {
  return dbSelect<ClinicRxItem>(
    `SELECT * FROM clinic_rx_items WHERE prescription_id = ? AND deleted_at IS NULL ORDER BY created_at`,
    [prescriptionId]
  );
}

export async function saveRxItems(prescriptionId: string, items: Omit<ClinicRxItem, "id" | "created_at" | "updated_at" | "deleted_at">[]): Promise<void> {
  const ts = nowIso();
  await dbExecute(`DELETE FROM clinic_rx_items WHERE prescription_id = ?`, [prescriptionId]);
  for (const item of items) {
    const id = newId();
    await dbExecute(
      `INSERT INTO clinic_rx_items (id, prescription_id, product_id, product_name, strength, dosage_form, dose, route, frequency, duration, qty, instructions, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [id, prescriptionId, item.product_id ?? null, item.product_name, item.strength ?? null, item.dosage_form ?? null, item.dose ?? null, item.route ?? null, item.frequency ?? null, item.duration ?? null, item.qty, item.instructions ?? null, ts, ts]
    );
  }
}

/** Full prescription with items and patient/doctor names. */
export interface PrescriptionWithDetails extends ClinicPrescription {
  patient_name: string | null;
  doctor_name: string | null;
  item_count: number;
}

export async function getPrescriptionsForConsultation(consultationId: string): Promise<PrescriptionWithDetails[]> {
  return dbSelect<PrescriptionWithDetails>(
    `SELECT p.*, pt.name AS patient_name, d.name AS doctor_name,
            (SELECT COUNT(*) FROM clinic_rx_items ri WHERE ri.prescription_id = p.id AND ri.deleted_at IS NULL) AS item_count
     FROM clinic_prescriptions p
     LEFT JOIN clinic_patients pt ON pt.id = p.patient_id
     LEFT JOIN clinic_doctors d ON d.id = p.doctor_id
     WHERE p.consultation_id = ? AND p.deleted_at IS NULL`,
    [consultationId]
  );
}

// ── Pharmacy RX Notifications (inbox for hospital_pharmacy tenants) ─────────
// Note: this table uses pharmacy_tenant_id not tenant_id, so no generic repo.

export async function listRxNotifications(opts: { status?: string } = {}): Promise<PharmacyRxNotification[]> {
  const tenantId = requireCurrentTenantId();
  const where = opts.status ? `AND status = ?` : "";
  const params: unknown[] = opts.status ? [tenantId, opts.status] : [tenantId];
  return dbSelect<PharmacyRxNotification>(
    `SELECT * FROM pharmacy_rx_notifications WHERE pharmacy_tenant_id = ? ${where} ORDER BY created_at DESC`,
    params
  );
}

// Re-export as rxNotificationsRepo shape for the inbox page
export const rxNotificationsRepo = {
  list: (opts: { orderBy?: string } = {}) => listRxNotifications(),
};

export async function getPendingRxNotifications(limit = 50): Promise<PharmacyRxNotification[]> {
  const tenantId = requireCurrentTenantId();
  return dbSelect<PharmacyRxNotification>(
    `SELECT * FROM pharmacy_rx_notifications
     WHERE pharmacy_tenant_id = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT ?`,
    [tenantId, limit]
  );
}

export async function markRxNotificationRead(id: string): Promise<void> {
  const ts = nowIso();
  await dbExecute(
    `UPDATE pharmacy_rx_notifications SET read_at = ?, updated_at = ? WHERE id = ? AND pharmacy_tenant_id = ?`,
    [ts, ts, id, requireCurrentTenantId()]
  );
}

export async function acknowledgeRxNotification(id: string): Promise<void> {
  const ts = nowIso();
  await dbExecute(
    `UPDATE pharmacy_rx_notifications SET status = 'acknowledged', read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ? AND pharmacy_tenant_id = ?`,
    [ts, ts, id, requireCurrentTenantId()]
  );
}

export async function dispenseRxNotification(id: string, invoiceId: string): Promise<void> {
  const ts = nowIso();
  await dbExecute(
    `UPDATE pharmacy_rx_notifications SET status = 'dispensed', invoice_id = ?, updated_at = ? WHERE id = ? AND pharmacy_tenant_id = ?`,
    [invoiceId, ts, id, requireCurrentTenantId()]
  );
}

/** Send a prescription to the linked pharmacy. Creates a notification row in
 * the pharmacy tenant's notifications table and marks the prescription "sent". */
export async function sendPrescriptionToPharmacy(
  prescriptionId: string,
  pharmacyTenantId: string,
  opts: { patientName: string; patientId: string; doctorName: string | null; clinicTenantId: string; clinicName: string | null; rxDate: string; itemCount: number }
): Promise<void> {
  const ts = nowIso();
  const notifId = newId();
  // Insert notification for the pharmacy tenant
  await dbExecute(
    `INSERT OR REPLACE INTO pharmacy_rx_notifications
     (id, tenant_id, prescription_id, clinic_tenant_id, clinic_name, patient_name, patient_id, doctor_name, rx_date, item_count, status, invoice_id, read_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
    [notifId, pharmacyTenantId, prescriptionId, opts.clinicTenantId, opts.clinicName, opts.patientName, opts.patientId, opts.doctorName, opts.rxDate, opts.itemCount, ts, ts]
  );
  // Mark prescription as sent
  await dbExecute(
    `UPDATE clinic_prescriptions SET status = 'sent', pharmacy_tenant_id = ?, sent_at = ?, updated_at = ? WHERE id = ?`,
    [pharmacyTenantId, ts, ts, prescriptionId]
  );
  await recordOutbox("pharmacy_rx_notifications", notifId, "insert", { id: notifId, tenant_id: pharmacyTenantId });
}

// ── Clinic ↔ Pharmacy link ───────────────────────────────────────────────

export async function getPharmacyLink(): Promise<ClinicPharmacyLink | null> {
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<ClinicPharmacyLink>(
    `SELECT * FROM clinic_pharmacy_link WHERE clinic_tenant_id = ? AND is_active = 1 LIMIT 1`,
    [tenantId]
  );
  return rows[0] ?? null;
}

export async function savePharmacyLink(pharmacyTenantId: string): Promise<void> {
  const tenantId = requireCurrentTenantId();
  const ts = nowIso();
  await dbExecute(
    `INSERT INTO clinic_pharmacy_link (id, clinic_tenant_id, pharmacy_tenant_id, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(clinic_tenant_id) DO UPDATE SET pharmacy_tenant_id = excluded.pharmacy_tenant_id, is_active = 1, updated_at = excluded.updated_at`,
    [newId(), tenantId, pharmacyTenantId, ts, ts]
  );
}

// ── Dashboard stats ───────────────────────────────────────────────────────

export interface ClinicStats {
  totalPatients: number;
  totalDoctors: number;
  todayAppointments: number;
  pendingRx: number;
}

export async function getClinicStats(): Promise<ClinicStats> {
  const tenantId = requireCurrentTenantId();
  const today = new Date().toISOString().slice(0, 10);
  const [pats, docs, appts, rx] = await Promise.all([
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM clinic_patients WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM clinic_doctors WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM clinic_appointments WHERE tenant_id = ? AND date = ? AND deleted_at IS NULL AND status != 'cancelled'`, [tenantId, today]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM clinic_prescriptions WHERE tenant_id = ? AND status = 'draft' AND deleted_at IS NULL`, [tenantId]),
  ]);
  return {
    totalPatients: pats[0]?.n ?? 0,
    totalDoctors: docs[0]?.n ?? 0,
    todayAppointments: appts[0]?.n ?? 0,
    pendingRx: rx[0]?.n ?? 0,
  };
}

export interface TodayAppointmentRow {
  id: string;
  patient_name: string;
  doctor_name: string | null;
  time: string | null;
  token_no: number | null;
  status: string;
  type: string;
}

export async function getTodayAppointments(limit = 20): Promise<TodayAppointmentRow[]> {
  const tenantId = requireCurrentTenantId();
  const today = new Date().toISOString().slice(0, 10);
  return dbSelect<TodayAppointmentRow>(
    `SELECT a.id, pt.name AS patient_name, d.name AS doctor_name, a.time, a.token_no, a.status, a.type
     FROM clinic_appointments a
     LEFT JOIN clinic_patients pt ON pt.id = a.patient_id
     LEFT JOIN clinic_doctors d ON d.id = a.doctor_id
     WHERE a.tenant_id = ? AND a.date = ? AND a.deleted_at IS NULL
     ORDER BY COALESCE(a.token_no, 9999), COALESCE(a.time, '99:99')
     LIMIT ?`,
    [tenantId, today, limit]
  );
}

export interface AppointmentWithNames extends ClinicAppointment {
  patient_name: string;
  doctor_name: string | null;
}

export async function listAppointments(opts: { date?: string; status?: string } = {}): Promise<AppointmentWithNames[]> {
  const tenantId = requireCurrentTenantId();
  const conditions: string[] = ["a.tenant_id = ?", "a.deleted_at IS NULL"];
  const params: unknown[] = [tenantId];
  if (opts.date) { conditions.push("a.date = ?"); params.push(opts.date); }
  if (opts.status) { conditions.push("a.status = ?"); params.push(opts.status); }
  return dbSelect<AppointmentWithNames>(
    `SELECT a.*, pt.name AS patient_name, d.name AS doctor_name
     FROM clinic_appointments a
     LEFT JOIN clinic_patients pt ON pt.id = a.patient_id
     LEFT JOIN clinic_doctors d ON d.id = a.doctor_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.date DESC, COALESCE(a.token_no, 9999)`,
    params
  );
}

export interface ConsultationWithNames extends ClinicConsultation {
  patient_name: string;
  doctor_name: string | null;
}

export async function listConsultations(limit = 50): Promise<ConsultationWithNames[]> {
  const tenantId = requireCurrentTenantId();
  return dbSelect<ConsultationWithNames>(
    `SELECT c.*, pt.name AS patient_name, d.name AS doctor_name
     FROM clinic_consultations c
     LEFT JOIN clinic_patients pt ON pt.id = c.patient_id
     LEFT JOIN clinic_doctors d ON d.id = c.doctor_id
     WHERE c.tenant_id = ? AND c.deleted_at IS NULL
     ORDER BY c.date DESC, c.created_at DESC
     LIMIT ?`,
    [tenantId, limit]
  );
}

export async function getConsultationWithPrescriptions(consultationId: string) {
  const consultation = await consultationsRepo.get(consultationId);
  if (!consultation) return null;
  const prescriptions = await getPrescriptionsForConsultation(consultationId);
  const rxItems = await Promise.all(prescriptions.map((p) => getRxItems(p.id)));
  return { consultation, prescriptions, rxItems };
}

/** Returns all tenants of type hospital_pharmacy for use in the clinic's
 * "link to pharmacy" dropdown. Reads from the tenants table. */
export async function listPharmacyTenants(): Promise<{ id: string; name: string }[]> {
  return dbSelect<{ id: string; name: string }>(
    `SELECT id, name FROM tenants WHERE business_type = 'hospital_pharmacy' AND deleted_at IS NULL ORDER BY name`,
    []
  );
}

/** Unread notification count for the pharmacy inbox badge. */
export async function unreadRxCount(): Promise<number> {
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pharmacy_rx_notifications WHERE pharmacy_tenant_id = ? AND read_at IS NULL`,
    [tenantId]
  );
  return rows[0]?.n ?? 0;
}
