/** The doctor's queue on Consultations: today's waiting appointments in
 * order, the consultation started from one, and the logged-in doctor found
 * from their login (Staff > Login) by name. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { savePatient, saveAppointment, saveConsultation, doctorsRepo, listConsultQueue, myClinicDoctorId } from "@/lib/repo/clinic";

const T = "clinic-a";
const DAY = "2026-10-31";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Clinic", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "clinic",
};
const login = (id: string, permissions: string[] | null = null) =>
  useAuthStore.setState({ currentUser: { id, username: id, displayName: id, role: id === "owner" ? "owner" : "staff", tenantId: T, permissions }, currentTenant: tenant });

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  login("owner");
});

test("today's queue: waiting patients in order, with the consultation started from one", async () => {
  const d = await doctorsRepo.create({ name: "Rab Nawaz" });
  const e = await doctorsRepo.create({ name: "Sana Ali" });
  const p1 = await savePatient(null, { name: "Bilal" });
  const p2 = await savePatient(null, { name: "Ayesha" });
  const p3 = await savePatient(null, { name: "Zain" });
  const a1 = await saveAppointment(null, { patient_id: p1.id, doctor_id: d.id, date: DAY, status: "scheduled", type: "routine" });
  const a2 = await saveAppointment(null, { patient_id: p2.id, doctor_id: d.id, date: DAY, status: "arrived", type: "follow_up" });
  await saveAppointment(null, { patient_id: p3.id, doctor_id: e.id, date: DAY, status: "completed", type: "routine" });
  await saveAppointment(null, { patient_id: p3.id, doctor_id: e.id, date: "2026-11-01", status: "scheduled", type: "routine" });
  let q = await listConsultQueue(DAY);
  assert.deepEqual(q.map((r) => [r.patient_name, r.token_no, r.status]), [["Ayesha", 2, "arrived"], ["Bilal", 1, "scheduled"]]);
  const c = await saveConsultation(null, { patient_id: p1.id, doctor_id: d.id, appointment_id: a1.id, date: DAY });
  q = await listConsultQueue(DAY);
  assert.equal(q.find((r) => r.id === a1.id)?.consultation_id, c.id);
  assert.equal(q.find((r) => r.id === a2.id)?.consultation_id, null);
});

test("the logged-in doctor is found from the staff record linked to their login", async () => {
  const d = await doctorsRepo.create({ name: "Rab Nawaz" });
  db.prepare(`INSERT INTO staff (id, tenant_id, name, designation, user_id, created_at, updated_at) VALUES ('s1', ?, 'Dr. Rab Nawaz', 'MBBS', 'u-rab', 'x', 'x')`).run(T);
  login("u-rab", ["clinic_consultations"]);
  assert.equal(await myClinicDoctorId(), d.id);
  login("u-other", ["clinic_consultations"]);
  assert.equal(await myClinicDoctorId(), null);
});
