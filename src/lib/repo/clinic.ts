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
import { localDate } from "../localDate";

export type { PharmacyRxNotification } from "../types-clinic";

export const patientsRepo = createTenantRepo<ClinicPatient>("clinic_patients");
export const doctorsRepo = createTenantRepo<ClinicDoctor>("clinic_doctors");

// `refs` makes every write prove that the patient / doctor / appointment it
// points at belongs to the logged-in tenant.
const PATIENT_REF: [string, string, string] = ["patient_id", "clinic_patients", "Patient"];
const DOCTOR_REF: [string, string, string] = ["doctor_id", "clinic_doctors", "Doctor"];
export const appointmentsRepo = createTenantRepo<ClinicAppointment>("clinic_appointments", { refs: [PATIENT_REF, DOCTOR_REF] });
export const consultationsRepo = createTenantRepo<ClinicConsultation>("clinic_consultations", {
  refs: [PATIENT_REF, DOCTOR_REF, ["appointment_id", "clinic_appointments", "Appointment"]],
});

// ── Prescriptions ──────────────────────────────────────────────────────────

export const prescriptionsRepo = createTenantRepo<ClinicPrescription>("clinic_prescriptions", {
  refs: [PATIENT_REF, DOCTOR_REF, ["consultation_id", "clinic_consultations", "Consultation"]],
});

// ── Patients ───────────────────────────────────────────────────────────────

/** Next free MRN for this clinic (MRN-000001, ...). Skips numbers already taken. */
export async function nextPatientMrn(): Promise<string> {
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM clinic_patients WHERE tenant_id = ?`, [tenantId]);
  let seq = (rows[0]?.n ?? 0) + 1;
  for (;;) {
    const mrn = `MRN-${String(seq).padStart(6, "0")}`;
    const taken = await dbSelect(`SELECT 1 FROM clinic_patients WHERE tenant_id = ? AND mrn = ? AND deleted_at IS NULL`, [tenantId, mrn]);
    if (!taken.length) return mrn;
    seq++;
  }
}

/** Creates or updates a patient. A blank MRN is generated; an MRN already used
 * by another patient is refused. Same name or phone as another patient is allowed. */
export async function savePatient(id: string | null, data: Partial<ClinicPatient>): Promise<ClinicPatient> {
  const tenantId = requireCurrentTenantId();
  const name = (data.name ?? "").trim();
  if (!name) throw new Error("Patient name is required.");
  let mrn = (data.mrn ?? "").trim();
  if (!mrn) mrn = id ? ((await patientsRepo.get(id))?.mrn ?? (await nextPatientMrn())) : await nextPatientMrn();
  const clash = await dbSelect<{ id: string; name: string }>(
    `SELECT id, name FROM clinic_patients WHERE tenant_id = ? AND mrn = ? AND deleted_at IS NULL AND id != ?`,
    [tenantId, mrn, id ?? ""]
  );
  if (clash.length) throw new Error(`MRN ${mrn} is already used by ${clash[0].name}.`);
  const payload = { ...data, name, mrn };
  if (id) {
    const updated = await patientsRepo.update(id, payload);
    if (!updated) throw new Error("Patient not found.");
    return updated;
  }
  return patientsRepo.create(payload);
}

// ── Appointments ───────────────────────────────────────────────────────────

/** An active (not cancelled / no-show) appointment of the same doctor at the
 * same date and time, or the same token that day. */
export async function findAppointmentConflict(a: { doctor_id: string | null; date: string; time: string | null; token_no: number | null }, excludeId?: string): Promise<ClinicAppointment | null> {
  if (!a.doctor_id) return null;
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<ClinicAppointment>(
    `SELECT * FROM clinic_appointments
     WHERE tenant_id = ? AND doctor_id = ? AND date = ? AND deleted_at IS NULL
       AND status NOT IN ('cancelled', 'no_show') AND id != ?
       AND ((? IS NOT NULL AND time = ?) OR (? IS NOT NULL AND token_no = ?))
     LIMIT 1`,
    [tenantId, a.doctor_id, a.date, excludeId ?? "", a.time, a.time, a.token_no, a.token_no]
  );
  return rows[0] ?? null;
}

/** Creates or updates an appointment with validation and double-booking protection. */
export async function saveAppointment(id: string | null, data: Partial<ClinicAppointment>): Promise<ClinicAppointment> {
  if (!data.patient_id) throw new Error("Select a patient.");
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || Number.isNaN(Date.parse(data.date))) throw new Error("Enter a valid appointment date.");
  if (data.status !== "cancelled" && data.status !== "no_show") {
    const clash = await findAppointmentConflict(
      { doctor_id: data.doctor_id ?? null, date: data.date, time: data.time ?? null, token_no: data.token_no ?? null },
      id ?? undefined
    );
    if (clash) throw new Error(clash.time === (data.time ?? null) && data.time ? `The doctor already has an appointment at ${clash.time} on ${clash.date}.` : `Token ${clash.token_no} is already taken for this doctor on ${clash.date}.`);
  }
  if (id) {
    const updated = await appointmentsRepo.update(id, data);
    if (!updated) throw new Error("Appointment not found.");
    return updated;
  }
  return appointmentsRepo.create(data);
}

// ── Consultations ──────────────────────────────────────────────────────────

/** Creates or updates a consultation. Starting one from an appointment links
 * it, moves the appointment to "in consultation", and never creates a second
 * consultation for the same appointment (the existing one is updated). */
export async function saveConsultation(id: string | null, data: Partial<ClinicConsultation>): Promise<ClinicConsultation> {
  if (!data.patient_id) throw new Error("Select a patient.");
  if (!data.date) throw new Error("Enter the consultation date.");
  let targetId = id;
  if (!targetId && data.appointment_id) {
    const existing = await dbSelect<{ id: string }>(
      `SELECT id FROM clinic_consultations WHERE tenant_id = ? AND appointment_id = ? AND deleted_at IS NULL LIMIT 1`,
      [requireCurrentTenantId(), data.appointment_id]
    );
    targetId = existing[0]?.id ?? null;
  }
  if (targetId) {
    const updated = await consultationsRepo.update(targetId, data);
    if (!updated) throw new Error("Consultation not found.");
    return updated;
  }
  const created = await consultationsRepo.create(data);
  if (created.appointment_id) {
    const appt = await appointmentsRepo.get(created.appointment_id);
    if (appt && (appt.status === "scheduled" || appt.status === "arrived")) {
      await appointmentsRepo.update(appt.id, { status: "in_consultation" });
    }
  }
  return created;
}

export async function getRxItems(prescriptionId: string): Promise<ClinicRxItem[]> {
  // Ownership is proven through the prescription (rows written before v39 have no tenant_id).
  return dbSelect<ClinicRxItem>(
    `SELECT i.* FROM clinic_rx_items i
     JOIN clinic_prescriptions p ON p.id = i.prescription_id
     WHERE i.prescription_id = ? AND p.tenant_id = ? AND i.deleted_at IS NULL ORDER BY i.created_at`,
    [prescriptionId, requireCurrentTenantId()]
  );
}

/** Replaces a prescription's lines. Old lines are soft-deleted (so the change
 * syncs), new ones carry the clinic's tenant id. */
export async function saveRxItems(prescriptionId: string, items: Omit<ClinicRxItem, "id" | "created_at" | "updated_at" | "deleted_at">[]): Promise<void> {
  if (!(await prescriptionsRepo.get(prescriptionId))) throw new Error("Prescription not found in this business.");
  const tenantId = requireCurrentTenantId();
  const ts = nowIso();
  const old = await getRxItems(prescriptionId);
  for (const o of old) {
    await dbExecute(`UPDATE clinic_rx_items SET deleted_at = ?, updated_at = ? WHERE id = ?`, [ts, ts, o.id]);
    await recordOutbox("clinic_rx_items", o.id, "delete", null);
  }
  for (const item of items) {
    const row = {
      id: newId(), tenant_id: tenantId, prescription_id: prescriptionId, product_id: item.product_id ?? null, product_name: item.product_name,
      strength: item.strength ?? null, dosage_form: item.dosage_form ?? null, dose: item.dose ?? null, route: item.route ?? null,
      frequency: item.frequency ?? null, duration: item.duration ?? null, qty: item.qty, instructions: item.instructions ?? null,
      created_at: ts, updated_at: ts, deleted_at: null,
    };
    const cols = Object.keys(row);
    await dbExecute(
      `INSERT INTO clinic_rx_items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((c) => (row as Record<string, unknown>)[c])
    );
    await recordOutbox("clinic_rx_items", row.id, "insert", row);
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
     WHERE p.consultation_id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL`,
    [consultationId, requireCurrentTenantId()]
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

/** Applies a pharmacy-side change to one of its received prescriptions and
 * queues the whole row for sync. Only the receiving pharmacy can change it. */
async function updateNotification(id: string, setSql: string, params: unknown[]): Promise<void> {
  const tenantId = requireCurrentTenantId();
  await dbExecute(`UPDATE pharmacy_rx_notifications SET ${setSql} WHERE id = ? AND pharmacy_tenant_id = ?`, [...params, id, tenantId]);
  const row = (await dbSelect<Record<string, unknown>>(`SELECT * FROM pharmacy_rx_notifications WHERE id = ? AND pharmacy_tenant_id = ?`, [id, tenantId]))[0];
  if (row) await recordOutbox("pharmacy_rx_notifications", id, "update", row);
}

export async function markRxNotificationRead(id: string): Promise<void> {
  const ts = nowIso();
  await updateNotification(id, `read_at = ?, updated_at = ?`, [ts, ts]);
}

export async function acknowledgeRxNotification(id: string): Promise<void> {
  const ts = nowIso();
  await updateNotification(id, `status = 'acknowledged', read_at = COALESCE(read_at, ?), updated_at = ?`, [ts, ts]);
}

export async function dispenseRxNotification(id: string, invoiceId: string): Promise<void> {
  const ts = nowIso();
  await updateNotification(id, `status = 'dispensed', invoice_id = ?, updated_at = ?`, [invoiceId, ts]);
}

/** Send a prescription to the linked pharmacy. The pharmacy is another tenant
 * and cannot read the clinic's records, so it receives its own copy: a mailbox
 * entry plus the prescription lines (pharmacy_rx_notifications /
 * pharmacy_rx_items). Then the prescription is marked "sent". Sending again
 * refreshes the pharmacy's copy instead of duplicating it. Only the pharmacy
 * this clinic has linked can receive it, and the pharmacy's stock and
 * invoices are untouched: it decides itself whether to bill. */
export async function sendPrescriptionToPharmacy(
  prescriptionId: string,
  pharmacyTenantId: string,
  opts: { patientName: string; patientId: string; doctorName: string | null; clinicTenantId?: string; clinicName: string | null; rxDate: string; itemCount?: number }
): Promise<void> {
  const clinicTenantId = requireCurrentTenantId();
  await assertLinkedPharmacy(pharmacyTenantId);
  const prescription = await prescriptionsRepo.get(prescriptionId);
  if (!prescription) throw new Error("Prescription not found in this business.");
  const items = await getRxItems(prescriptionId);
  if (!items.length) throw new Error("This prescription has no medicines to send.");
  const ts = nowIso();

  // 1) The pharmacy's copy first: if the clinic-side update below fails, sending again is safe.
  const existing = await dbSelect<{ id: string; created_at: string }>(
    `SELECT id, created_at FROM pharmacy_rx_notifications WHERE pharmacy_tenant_id = ? AND prescription_id = ? LIMIT 1`,
    [pharmacyTenantId, prescriptionId]
  );
  const notification = {
    id: existing[0]?.id ?? newId(), pharmacy_tenant_id: pharmacyTenantId, prescription_id: prescriptionId, clinic_tenant_id: clinicTenantId,
    clinic_name: opts.clinicName ?? "", patient_name: opts.patientName, patient_id: opts.patientId, doctor_name: opts.doctorName ?? "",
    rx_date: opts.rxDate, item_count: items.length, status: "pending", invoice_id: null, read_at: null, rx_notes: prescription.notes ?? null,
    created_at: existing[0]?.created_at ?? ts, updated_at: ts,
  };
  const cols = Object.keys(notification);
  await dbExecute(
    `INSERT INTO pharmacy_rx_notifications (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
     ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== "id" && c !== "created_at").map((c) => `${c} = excluded.${c}`).join(", ")}`,
    cols.map((c) => (notification as Record<string, unknown>)[c])
  );
  await recordOutbox("pharmacy_rx_notifications", notification.id, "insert", notification);

  const oldLines = await dbSelect<{ id: string }>(
    `SELECT id FROM pharmacy_rx_items WHERE pharmacy_tenant_id = ? AND prescription_id = ? AND deleted_at IS NULL`,
    [pharmacyTenantId, prescriptionId]
  );
  for (const o of oldLines) {
    await dbExecute(`UPDATE pharmacy_rx_items SET deleted_at = ?, updated_at = ? WHERE id = ?`, [ts, ts, o.id]);
    const full = (await dbSelect<Record<string, unknown>>(`SELECT * FROM pharmacy_rx_items WHERE id = ?`, [o.id]))[0];
    if (full) await recordOutbox("pharmacy_rx_items", o.id, "update", full);
  }
  for (const it of items) {
    const line = {
      id: newId(), pharmacy_tenant_id: pharmacyTenantId, clinic_tenant_id: clinicTenantId, prescription_id: prescriptionId,
      product_id: it.product_id, product_name: it.product_name, strength: it.strength, dosage_form: it.dosage_form, dose: it.dose,
      route: it.route, frequency: it.frequency, duration: it.duration, qty: it.qty, instructions: it.instructions,
      created_at: ts, updated_at: ts, deleted_at: null,
    };
    const lc = Object.keys(line);
    await dbExecute(
      `INSERT INTO pharmacy_rx_items (${lc.join(", ")}) VALUES (${lc.map(() => "?").join(", ")})`,
      lc.map((c) => (line as Record<string, unknown>)[c])
    );
    await recordOutbox("pharmacy_rx_items", line.id, "insert", line);
  }

  // 2) The clinic's own record.
  await prescriptionsRepo.update(prescriptionId, { status: "sent", pharmacy_tenant_id: pharmacyTenantId, sent_at: ts });
}

export interface RxLine {
  product_id: string | null;
  product_name: string;
  qty: number;
}

/** The prescription lines to bill: the clinic's own prescription when it is
 * the one billing, otherwise the copy the clinic sent to this pharmacy. */
export async function getRxForInvoice(prescriptionId: string): Promise<{ items: RxLine[]; notes: string | null }> {
  const own = await prescriptionsRepo.get(prescriptionId);
  if (own) return { items: await getRxItems(prescriptionId), notes: own.notes };
  const tenantId = requireCurrentTenantId();
  const items = await dbSelect<RxLine>(
    `SELECT product_id, product_name, qty FROM pharmacy_rx_items
     WHERE pharmacy_tenant_id = ? AND prescription_id = ? AND deleted_at IS NULL ORDER BY created_at`,
    [tenantId, prescriptionId]
  );
  const notif = await dbSelect<{ rx_notes: string | null }>(
    `SELECT rx_notes FROM pharmacy_rx_notifications WHERE pharmacy_tenant_id = ? AND prescription_id = ? LIMIT 1`,
    [tenantId, prescriptionId]
  );
  return { items, notes: notif[0]?.rx_notes ?? null };
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

/** Links this clinic to one hospital pharmacy: the explicit, clinic-made choice
 * that allows searching that pharmacy's catalogue and sending it prescriptions. */
export async function savePharmacyLink(pharmacyTenantId: string): Promise<void> {
  const tenantId = requireCurrentTenantId();
  const ok = await dbSelect<{ id: string }>(
    `SELECT id FROM tenants WHERE id = ? AND business_type = 'hospital_pharmacy' AND deleted_at IS NULL`,
    [pharmacyTenantId]
  );
  if (!ok.length) throw new Error("That pharmacy was not found.");
  const ts = nowIso();
  await dbExecute(
    `INSERT INTO clinic_pharmacy_link (id, clinic_tenant_id, pharmacy_tenant_id, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(clinic_tenant_id) DO UPDATE SET pharmacy_tenant_id = excluded.pharmacy_tenant_id, is_active = 1, updated_at = excluded.updated_at`,
    [newId(), tenantId, pharmacyTenantId, ts, ts]
  );
  const link = await getPharmacyLink();
  if (link) await recordOutbox("clinic_pharmacy_link", link.id, "insert", link as unknown as Record<string, unknown>);
}

/** Throws unless the given pharmacy is the one this clinic has linked. */
export async function assertLinkedPharmacy(pharmacyTenantId: string): Promise<void> {
  const link = await getPharmacyLink();
  if (!link || link.pharmacy_tenant_id !== pharmacyTenantId) {
    throw new Error("Link this pharmacy to the clinic first (Linked Pharmacy, on the consultation screen).");
  }
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
  const today = localDate();
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
  const today = localDate();
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

/** Search a specific pharmacy tenant's products (plus the shared pharma catalog)
 * by name or barcode. Used by the clinic prescription builder. */
export async function searchProductsForPharmacy(
  term: string,
  pharmacyTenantId: string
): Promise<{ id: string; name: string; barcode: string | null; company_name: string | null; description: string | null }[]> {
  if (!term.trim()) return [];
  const like = `%${term.trim()}%`;
  // Another tenant's catalogue: only the pharmacy this clinic has linked.
  await assertLinkedPharmacy(pharmacyTenantId);
  return dbSelect(
    `SELECT id, name, barcode, company_name, description
     FROM products
     WHERE deleted_at IS NULL
       AND (
         tenant_id = ?
         OR (tenant_id IS NULL AND catalog_group = 'pharma')
       )
       AND (name LIKE ? OR barcode LIKE ?)
     ORDER BY name ASC LIMIT 20`,
    [pharmacyTenantId, like, like]
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
