/** Doctors, patients, appointments, consultations and prescriptions through the
 * app's real repositories on the complete schema (v1..v37), in-memory SQLite.
 * Reading a row back through the normal repo API is the persistence check. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import {
  patientsRepo, doctorsRepo, appointmentsRepo, consultationsRepo, prescriptionsRepo,
  savePatient, saveAppointment, saveConsultation,
  listAppointments, listConsultations, getClinicStats,
  getRxItems, saveRxItems, getPrescriptionsForConsultation,
  sendPrescriptionToPharmacy, listRxNotifications, getRxForInvoice,
  savePharmacyLink, searchProductsForPharmacy, acknowledgeRxNotification,
} from "@/lib/repo/clinic";
import { mayPush } from "@/lib/sync/engine";
import { OWNER_COLUMNS, SYNCABLE_TABLES, TENANT_SCOPED_TABLES } from "@/lib/sync/tables";

const A = "clinic-a";
const B = "clinic-b";
const PHARM = "hosp-pharm";
const TODAY = new Date().toISOString().slice(0, 10);
let sql: DatabaseSync;

function loginAs(tenantId: string, businessType = "clinic") {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType,
  };
  useAuthStore.setState({ currentUser: { id: `${tenantId}-u`, username: "u", displayName: "U", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

const count = (table: string, tenant = A) => (sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND deleted_at IS NULL`).get(tenant) as { n: number }).n;

/** Adds a tenants row (filling required columns). */
function addTenant(id: string, businessType: string) {
  const cols = sql.prepare(`PRAGMA table_info(tenants)`).all() as { name: string; notnull: number; dflt_value: unknown }[];
  const r: Record<string, unknown> = { id, name: id, business_type: businessType, created_at: TODAY, updated_at: TODAY };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in r)) r[c.name] = c.name.endsWith("_at") ? TODAY : 0;
  const keys = Object.keys(r).filter((k) => cols.some((c) => c.name === k));
  sql.prepare(`INSERT INTO tenants (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k]) as never[]));
}

beforeEach(async () => {
  sql = fullSchemaDb(39);
  setTestDb(sql);
  for (const [id, type] of [[A, "clinic"], [B, "clinic"], [PHARM, "hospital_pharmacy"], ["other-pharm", "hospital_pharmacy"], ["retail-1", "retail_pharmacy"]]) addTenant(id, type);
  loginAs(A);
  await savePharmacyLink(PHARM);
});

// ── Doctors ────────────────────────────────────────────────────────────────

test("doctor: create, list, reopen with every field, edit, persist", async () => {
  const d = await doctorsRepo.create({
    name: "Imran Shah", specialization: "Cardiology", qualification: "MBBS, FCPS", phone: "0300-1112223", email: "i@x.pk",
    consultation_fee: 1500, follow_up_fee: 800, follow_up_days: 14, slot_minutes: 20, available_days: JSON.stringify(["Mon", "Wed"]), notes: "n",
  });
  const listed = await doctorsRepo.list({ orderBy: "name ASC" });
  assert.equal(listed.length, 1);
  const back = await doctorsRepo.get(d.id);
  assert.equal(back?.specialization, "Cardiology");
  assert.equal(back?.consultation_fee, 1500);
  assert.deepEqual(JSON.parse(back!.available_days!), ["Mon", "Wed"]);

  await doctorsRepo.update(d.id, { consultation_fee: 2000, phone: "0300-9999999" });
  const edited = await doctorsRepo.get(d.id);
  assert.equal(edited?.consultation_fee, 2000);
  assert.equal(edited?.phone, "0300-9999999");
  assert.equal(edited?.name, "Imran Shah");
  assert.equal(count("clinic_doctors"), 1, "edit updated the row, no duplicate");
});

test("doctor: deactivating keeps historical appointments and consultations readable", async () => {
  const d = await doctorsRepo.create({ name: "Retired Doc" });
  const p = await savePatient(null, { name: "Hina" });
  const a = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "09:00", status: "scheduled", type: "routine" });
  await saveConsultation(null, { patient_id: p.id, doctor_id: d.id, appointment_id: a.id, date: TODAY });
  await doctorsRepo.remove(d.id);
  assert.equal((await doctorsRepo.list()).length, 0, "no longer selectable");
  assert.equal((await listAppointments({ date: TODAY }))[0].doctor_name, "Retired Doc");
  assert.equal((await listConsultations())[0].doctor_name, "Retired Doc");
});

// ── Patients ───────────────────────────────────────────────────────────────

test("patient: unique MRN generated, same name / phone allowed, duplicate MRN refused", async () => {
  const p1 = await savePatient(null, { name: "Ali Khan", phone: "0300-1" });
  const p2 = await savePatient(null, { name: "Ali Khan", phone: "0300-1" });
  assert.match(p1.mrn!, /^MRN-\d{6}$/);
  assert.notEqual(p1.mrn, p2.mrn);
  await assert.rejects(savePatient(null, { name: "Other", mrn: p1.mrn }), /already used/);
  assert.equal(count("clinic_patients"), 2);
});

test("patient: edit keeps the same row and MRN; blank name refused; data persists", async () => {
  const p = await savePatient(null, { name: "Sana", gender: "Female", blood_group: "O+", allergies: "Penicillin", dob: "1990-02-03" });
  const edited = await savePatient(p.id, { name: "Sana Malik", mrn: "", phone: "0301-7" });
  assert.equal(edited.id, p.id);
  assert.equal(edited.mrn, p.mrn, "blank MRN on edit keeps the existing one");
  const back = await patientsRepo.get(p.id);
  assert.equal(back?.name, "Sana Malik");
  assert.equal(back?.blood_group, "O+");
  assert.equal(back?.phone, "0301-7");
  await assert.rejects(savePatient(null, { name: "   " }), /name is required/);
  assert.equal(count("clinic_patients"), 1);
});

// ── Appointments ───────────────────────────────────────────────────────────

test("appointment: a doctor is required; tokens are given per doctor and day; listed with names", async () => {
  const p = await savePatient(null, { name: "Zara" });
  const d = await doctorsRepo.create({ name: "Dr Q" });
  const e = await doctorsRepo.create({ name: "Dr E" });
  await assert.rejects(saveAppointment(null, { patient_id: p.id, doctor_id: null, date: TODAY, status: "scheduled", type: "emergency" }), /Select the doctor/);
  const first = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, status: "scheduled", type: "emergency", reason: "Fever" });
  const booked = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "10:30", token_no: 99, status: "scheduled", type: "follow_up" });
  const other = await saveAppointment(null, { patient_id: p.id, doctor_id: e.id, date: TODAY, status: "scheduled", type: "routine" });
  assert.deepEqual([first.token_no, booked.token_no, other.token_no], [1, 2, 1], "next token of that doctor; a typed token is ignored");
  const rows = await listAppointments({ date: TODAY });
  assert.equal(rows.length, 3);
  const b = rows.find((r) => r.id === booked.id)!;
  assert.deepEqual([b.doctor_name, b.patient_name, b.time, b.type], ["Dr Q", "Zara", "10:30", "follow_up"]);
  assert.equal(rows.find((r) => r.id === first.id)!.reason, "Fever");

  const kept = await saveAppointment(first.id, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "09:00", status: "arrived", type: "emergency" });
  assert.equal(kept.token_no, 1, "editing keeps the token");
  const movedDoctor = await saveAppointment(first.id, { patient_id: p.id, doctor_id: e.id, date: TODAY, status: "scheduled", type: "emergency" });
  assert.equal(movedDoctor.token_no, 2, "moved to another doctor: his next token");
});

test("appointment: reschedule, cancel, double booking, bad dates", async () => {
  const p = await savePatient(null, { name: "P1" });
  const q = await savePatient(null, { name: "P2" });
  const d = await doctorsRepo.create({ name: "Dr R" });
  const a1 = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "11:00", token_no: 1, status: "scheduled", type: "routine" });

  await assert.rejects(saveAppointment(null, { patient_id: q.id, doctor_id: d.id, date: TODAY, time: "11:00", status: "scheduled", type: "routine" }), /already has an appointment/);
  await assert.rejects(saveAppointment(null, { patient_id: q.id, doctor_id: d.id, date: "2026-13-45", status: "scheduled", type: "routine" }), /valid appointment date/);
  await assert.rejects(saveAppointment(null, { patient_id: "", doctor_id: d.id, date: TODAY, status: "scheduled", type: "routine" }), /Select a patient/);
  assert.equal(count("clinic_appointments"), 1, "rejected requests created nothing");

  // Reschedule the first one (editing itself is not a clash), then use its old slot.
  const moved = await saveAppointment(a1.id, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "13:00", token_no: 1, status: "scheduled", type: "routine" });
  assert.equal(moved.id, a1.id);
  assert.equal((await appointmentsRepo.get(a1.id))?.time, "13:00");
  await saveAppointment(null, { patient_id: q.id, doctor_id: d.id, date: TODAY, time: "11:00", token_no: 2, status: "scheduled", type: "routine" });

  // Cancelling frees the slot.
  await saveAppointment(a1.id, { status: "cancelled", patient_id: p.id, doctor_id: d.id, date: TODAY, time: "13:00" });
  assert.equal((await appointmentsRepo.get(a1.id))?.status, "cancelled");
  await saveAppointment(null, { patient_id: q.id, doctor_id: d.id, date: TODAY, time: "13:00", status: "scheduled", type: "routine" });
  assert.equal(count("clinic_appointments"), 3);
});

// ── Consultations ──────────────────────────────────────────────────────────

test("consultation: from an appointment it is linked, moves the appointment on, and is never duplicated", async () => {
  const p = await savePatient(null, { name: "Nadia" });
  const d = await doctorsRepo.create({ name: "Dr C" });
  const a = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "09:30", status: "arrived", type: "routine" });

  const c = await saveConsultation(null, {
    patient_id: p.id, doctor_id: d.id, appointment_id: a.id, date: TODAY,
    complaint: "Cough", history: "3 days", vitals: "BP 120/80", findings: "Chest clear", diagnosis: "Viral URTI", advice: "Rest", followup_date: "2026-11-01", followup_notes: "If fever",
  });
  assert.equal((await appointmentsRepo.get(a.id))?.status, "in_consultation");

  // A repeated submit for the same appointment updates, it does not create a second record.
  const again = await saveConsultation(null, { patient_id: p.id, doctor_id: d.id, appointment_id: a.id, date: TODAY, diagnosis: "Viral URTI (updated)" });
  assert.equal(again.id, c.id);
  assert.equal(count("clinic_consultations"), 1);

  const back = await consultationsRepo.get(c.id);
  assert.equal(back?.appointment_id, a.id);
  assert.equal(back?.patient_id, p.id);
  assert.equal(back?.doctor_id, d.id);
  assert.equal(back?.complaint, "Cough");
  assert.equal(back?.vitals, "BP 120/80");
  assert.equal(back?.followup_date, "2026-11-01");
  assert.equal(back?.diagnosis, "Viral URTI (updated)");

  // Editing by id keeps the appointment link and the other fields.
  await saveConsultation(c.id, { patient_id: p.id, doctor_id: d.id, date: TODAY, advice: "Rest and fluids" });
  const edited = await consultationsRepo.get(c.id);
  assert.equal(edited?.advice, "Rest and fluids");
  assert.equal(edited?.appointment_id, a.id);
  assert.equal(edited?.findings, "Chest clear");

  const listed = await listConsultations();
  assert.equal(listed[0].patient_name, "Nadia");
  assert.equal(listed[0].doctor_name, "Dr C");
});

test("consultation: standalone (no appointment, no doctor) saves; a failed submit saves nothing", async () => {
  const p = await savePatient(null, { name: "Walk In" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: null, appointment_id: null, date: TODAY, diagnosis: "Gastritis" });
  assert.equal((await consultationsRepo.get(c.id))?.diagnosis, "Gastritis");
  await assert.rejects(saveConsultation(null, { patient_id: "", date: TODAY }), /Select a patient/);
  await assert.rejects(saveConsultation(null, { patient_id: "no-such-patient", date: TODAY }), /Patient not found/);
  assert.equal(count("clinic_consultations"), 1);
});

// ── Prescriptions ──────────────────────────────────────────────────────────

test("prescription: saved without a doctor, items round-trip, send creates the pharmacy notification", async () => {
  const p = await savePatient(null, { name: "Rx Patient" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: null, date: TODAY });
  const rx = await prescriptionsRepo.create({ consultation_id: c.id, patient_id: p.id, doctor_id: null, date: TODAY, status: "draft", pharmacy_tenant_id: null, sent_at: null, acknowledged_at: null, dispensed_at: null, notes: "n" });
  await saveRxItems(rx.id, [
    { prescription_id: rx.id, product_id: null, product_name: "Panadol", strength: "500mg", dosage_form: "Tablet", dose: "1", route: "Oral", frequency: "TDS", duration: "5 days", qty: 15, instructions: "After meals" },
    { prescription_id: rx.id, product_id: null, product_name: "ORS", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 3, instructions: null },
  ]);
  const items = await getRxItems(rx.id);
  assert.deepEqual(items.map((i) => i.product_name).sort(), ["ORS", "Panadol"]);
  const list = await getPrescriptionsForConsultation(c.id);
  assert.equal(list[0].item_count, 2);
  assert.equal(list[0].doctor_name, null);

  // Re-saving replaces the items instead of piling up duplicates.
  await saveRxItems(rx.id, [{ prescription_id: rx.id, product_id: null, product_name: "Panadol", strength: "500mg", dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 10, instructions: null }]);
  assert.equal((await getRxItems(rx.id)).length, 1);

  // Send to a pharmacy tenant (no doctor name, no clinic name: still valid).
  await sendPrescriptionToPharmacy(rx.id, PHARM, { patientName: "Rx Patient", patientId: p.id, doctorName: null, clinicTenantId: A, clinicName: null, rxDate: TODAY, itemCount: 1 });
  assert.equal((await prescriptionsRepo.get(rx.id))?.status, "sent");
  loginAs(PHARM, "hospital_pharmacy");
  const inbox = await listRxNotifications();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].patient_name, "Rx Patient");
  assert.equal(inbox[0].prescription_id, rx.id);
  assert.equal(inbox[0].status, "pending");
});

// ── Tenant isolation ───────────────────────────────────────────────────────

test("tenant isolation: another clinic cannot read, change, link or list these records", async () => {
  const p = await savePatient(null, { name: "A Patient" });
  const d = await doctorsRepo.create({ name: "A Doctor" });
  const a = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "10:00", status: "scheduled", type: "routine" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: d.id, appointment_id: a.id, date: TODAY });
  const rx = await prescriptionsRepo.create({ consultation_id: c.id, patient_id: p.id, doctor_id: d.id, date: TODAY, status: "draft", pharmacy_tenant_id: null, sent_at: null, acknowledged_at: null, dispensed_at: null, notes: null });
  await saveRxItems(rx.id, [{ prescription_id: rx.id, product_id: null, product_name: "Secret", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 1, instructions: null }]);

  loginAs(B);
  assert.equal((await patientsRepo.list()).length, 0);
  assert.equal((await doctorsRepo.list()).length, 0);
  assert.equal((await listAppointments()).length, 0);
  assert.equal((await listConsultations()).length, 0);
  assert.equal((await getPrescriptionsForConsultation(c.id)).length, 0);
  assert.equal((await getRxItems(rx.id)).length, 0);
  assert.equal(await patientsRepo.get(p.id), null);
  assert.equal(await doctorsRepo.get(d.id), null);
  assert.equal(await appointmentsRepo.get(a.id), null);
  assert.equal(await consultationsRepo.get(c.id), null);

  await patientsRepo.update(p.id, { name: "Hijacked" });
  await doctorsRepo.remove(d.id);
  const row = sql.prepare(`SELECT name FROM clinic_patients WHERE id = ?`).get(p.id) as { name: string };
  assert.equal(row.name, "A Patient", "update from another tenant changed nothing");
  assert.equal((sql.prepare(`SELECT deleted_at FROM clinic_doctors WHERE id = ?`).get(d.id) as { deleted_at: string | null }).deleted_at, null);

  const ownDoctor = await doctorsRepo.create({ name: "Dr B" });
  await assert.rejects(saveAppointment(null, { patient_id: p.id, doctor_id: ownDoctor.id, date: TODAY, status: "scheduled", type: "routine" }), /Patient not found in this business/);
  await assert.rejects(saveConsultation(null, { patient_id: p.id, date: TODAY }), /Patient not found in this business/);
  await assert.rejects(saveRxItems(rx.id, []), /Prescription not found/);
  await assert.rejects(patientsRepo.create({ name: "x", tenant_id: A } as never), /another business/);

  loginAs(A);
  assert.equal((await patientsRepo.get(p.id))?.name, "A Patient");
  assert.equal((await getRxItems(rx.id)).length, 1);
});

test("dashboard counts reflect saved records", async () => {
  const p = await savePatient(null, { name: "S1" });
  await savePatient(null, { name: "S2" });
  const d = await doctorsRepo.create({ name: "D1" });
  await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "10:00", status: "scheduled", type: "routine" });
  await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, time: "11:00", status: "cancelled", type: "routine" });
  const s = await getClinicStats();
  assert.equal(s.totalPatients, 2);
  assert.equal(s.totalDoctors, 1);
  assert.equal(s.todayAppointments, 1);
});

test("pharmacy can bill a prescription a clinic sent it; sending twice does not duplicate; other pharmacies cannot see it", async () => {
  const p = await savePatient(null, { name: "Bill Me" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: null, date: TODAY });
  const rx = await prescriptionsRepo.create({ consultation_id: c.id, patient_id: p.id, doctor_id: null, date: TODAY, status: "draft", pharmacy_tenant_id: null, sent_at: null, acknowledged_at: null, dispensed_at: null, notes: "Take care" });
  await saveRxItems(rx.id, [
    { prescription_id: rx.id, product_id: "prod-1", product_name: "Panadol", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 12, instructions: null },
    { prescription_id: rx.id, product_id: null, product_name: "ORS", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 3, instructions: null },
  ]);
  const send = () => sendPrescriptionToPharmacy(rx.id, PHARM, { patientName: "Bill Me", patientId: p.id, doctorName: "Dr X", clinicTenantId: A, clinicName: "Clinic A", rxDate: TODAY, itemCount: 2 });
  await send();
  await send();

  // The clinic still bills from its own prescription.
  assert.equal((await getRxForInvoice(rx.id)).items.length, 2);

  loginAs(PHARM, "hospital_pharmacy");
  const billed = await getRxForInvoice(rx.id);
  assert.deepEqual(billed.items.map((i) => [i.product_name, i.qty, i.product_id]).sort(), [["ORS", 3, null], ["Panadol", 12, "prod-1"]]);
  assert.equal(billed.notes, "Take care");
  assert.equal((await listRxNotifications()).length, 1, "one mailbox entry after sending twice");

  loginAs("other-pharm", "hospital_pharmacy");
  assert.equal((await getRxForInvoice(rx.id)).items.length, 0);
});

test("integration is explicit: only the linked hospital pharmacy can be searched or sent a prescription", async () => {
  const p = await savePatient(null, { name: "Linked" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: null, date: TODAY });
  const rx = await prescriptionsRepo.create({ consultation_id: c.id, patient_id: p.id, doctor_id: null, date: TODAY, status: "draft", pharmacy_tenant_id: null, sent_at: null, acknowledged_at: null, dispensed_at: null, notes: null });
  await saveRxItems(rx.id, [{ prescription_id: rx.id, product_id: null, product_name: "Panadol", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 1, instructions: null }]);
  const opts = { patientName: "Linked", patientId: p.id, doctorName: null, clinicName: null, rxDate: TODAY };

  await assert.rejects(sendPrescriptionToPharmacy(rx.id, "other-pharm", opts), /Link this pharmacy/);
  await assert.rejects(searchProductsForPharmacy("pan", "other-pharm"), /Link this pharmacy/);
  await assert.rejects(savePharmacyLink("retail-1"), /pharmacy was not found/, "only hospital pharmacies");
  await assert.rejects(savePharmacyLink(B), /pharmacy was not found/, "not another clinic");

  await sendPrescriptionToPharmacy(rx.id, PHARM, opts);
  // An empty prescription is not sent.
  const empty = await prescriptionsRepo.create({ consultation_id: c.id, patient_id: p.id, doctor_id: null, date: TODAY, status: "draft", pharmacy_tenant_id: null, sent_at: null, acknowledged_at: null, dispensed_at: null, notes: null });
  await assert.rejects(sendPrescriptionToPharmacy(empty.id, PHARM, opts), /no medicines/);

  // The sending clinic is always the logged-in one, whatever the caller passes.
  const row = sql.prepare(`SELECT clinic_tenant_id FROM pharmacy_rx_notifications WHERE prescription_id = ?`).get(rx.id) as { clinic_tenant_id: string };
  assert.equal(row.clinic_tenant_id, A);
});

test("sending does not touch the pharmacy's stock, prices or invoices", async () => {
  const before = ["product_batches", "invoices", "invoice_items", "price_list", "cash_register_entries"].map(
    (t) => (sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  );
  const p = await savePatient(null, { name: "Stock Safe" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: null, date: TODAY });
  const rx = await prescriptionsRepo.create({ consultation_id: c.id, patient_id: p.id, doctor_id: null, date: TODAY, status: "draft", pharmacy_tenant_id: null, sent_at: null, acknowledged_at: null, dispensed_at: null, notes: null });
  await saveRxItems(rx.id, [{ prescription_id: rx.id, product_id: null, product_name: "X", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 4, instructions: null }]);
  await sendPrescriptionToPharmacy(rx.id, PHARM, { patientName: "Stock Safe", patientId: p.id, doctorName: null, clinicName: null, rxDate: TODAY });
  loginAs(PHARM, "hospital_pharmacy");
  const [n] = await listRxNotifications();
  await acknowledgeRxNotification(n.id);
  const after = ["product_batches", "invoices", "invoice_items", "price_list", "cash_register_entries"].map(
    (t) => (sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  );
  assert.deepEqual(after, before);
  assert.equal((await listRxNotifications())[0].status, "acknowledged");
});

test("prescription lines carry their clinic so they sync like other tenant rows", async () => {
  const p = await savePatient(null, { name: "Sync" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: null, date: TODAY });
  const rx = await prescriptionsRepo.create({ consultation_id: c.id, patient_id: p.id, doctor_id: null, date: TODAY, status: "draft", pharmacy_tenant_id: null, sent_at: null, acknowledged_at: null, dispensed_at: null, notes: null });
  await saveRxItems(rx.id, [{ prescription_id: rx.id, product_id: null, product_name: "A", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 1, instructions: null }]);
  await saveRxItems(rx.id, [{ prescription_id: rx.id, product_id: null, product_name: "B", strength: null, dosage_form: null, dose: null, route: null, frequency: null, duration: null, qty: 1, instructions: null }]);
  const rows = sql.prepare(`SELECT product_name, tenant_id, deleted_at FROM clinic_rx_items WHERE prescription_id = ? ORDER BY product_name`).all(rx.id) as { product_name: string; tenant_id: string; deleted_at: string | null }[];
  assert.deepEqual(rows.map((r) => [r.product_name, r.tenant_id, r.deleted_at === null]), [["A", A, false], ["B", A, true]], "old line soft-deleted, both owned by the clinic");
});

test("sync: clinic and hospital tables are pulled per tenant; the mailbox only by its two parties", () => {
  for (const t of ["clinic_patients", "clinic_rx_items", "hospital_patients", "hospital_episodes", "hospital_lab_orders", "pharmacy_rx_notifications"]) {
    assert.ok((SYNCABLE_TABLES as readonly string[]).includes(t), `${t} syncs`);
    assert.ok(TENANT_SCOPED_TABLES.includes(t), `${t} is tenant-scoped`);
  }
  assert.deepEqual(OWNER_COLUMNS.pharmacy_rx_notifications, ["pharmacy_tenant_id", "clinic_tenant_id"]);
  const clinic = { tenantId: A, superAdmin: false };
  const pharmacy = { tenantId: PHARM, superAdmin: false };
  const stranger = { tenantId: B, superAdmin: false };
  const notif = { id: "n", pharmacy_tenant_id: PHARM, clinic_tenant_id: A };
  assert.equal(mayPush("pharmacy_rx_notifications", "insert", notif, clinic), true);
  assert.equal(mayPush("pharmacy_rx_notifications", "update", notif, pharmacy), true);
  assert.equal(mayPush("pharmacy_rx_notifications", "update", notif, stranger), false);
  assert.equal(mayPush("pharmacy_rx_notifications", "insert", notif, { tenantId: null, superAdmin: true }), false);
  assert.equal(mayPush("clinic_patients", "insert", { id: "x", tenant_id: A }, clinic), true);
  assert.equal(mayPush("clinic_patients", "insert", { id: "x", tenant_id: B }, clinic), false);
  assert.equal(mayPush("hospital_patients", "insert", { id: "x", tenant_id: A }, stranger), false);
});
