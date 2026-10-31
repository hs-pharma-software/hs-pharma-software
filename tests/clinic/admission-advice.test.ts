/** Admission advice on a consultation: saved with reason, ward, stay and
 * urgency, withdrawn, listed for the day's queue, and a clear message (and an
 * empty list) before the v65 database update. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { savePatient, saveAppointment, saveConsultation, doctorsRepo, adviseAdmission, admissionsAdvisedOn } from "@/lib/repo/clinic";

const T = "clinic-a";
const DAY = "2026-10-31";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Clinic", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "clinic",
};

function setup(upTo?: number) {
  db = fullSchemaDb(upTo);
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "owner", username: "owner", displayName: "owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
}
beforeEach(() => setup());

async function visit() {
  const d = await doctorsRepo.create({ name: "Rab Nawaz" });
  const p = await savePatient(null, { name: "Bilal" });
  const a = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: DAY, status: "arrived", type: "routine" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: d.id, appointment_id: a.id, date: DAY });
  return { a, c };
}

test("advise, change and withdraw admission; the day's queue sees it", async () => {
  const { a, c } = await visit();
  assert.equal((await admissionsAdvisedOn(DAY)).size, 0);
  let r = await adviseAdmission(c.id, { reason: "  Severe dehydration ", ward: "General ward", days: 3, urgency: "urgent" });
  assert.equal(r.admit_advised, 1);
  assert.equal(r.admit_reason, "Severe dehydration");
  assert.equal(r.admit_days, 3);
  const at = r.admit_advised_at;
  assert.ok(at);
  assert.deepEqual((await admissionsAdvisedOn(DAY)).get(a.id), { reason: "Severe dehydration", urgency: "urgent" });
  r = await adviseAdmission(c.id, { reason: "IV fluids", ward: "", days: null });
  assert.equal(r.admit_urgency, "routine");
  assert.equal(r.admit_ward, null);
  assert.equal(r.admit_advised_at, at);
  r = await adviseAdmission(c.id, null);
  assert.equal(r.admit_advised, 0);
  assert.equal(r.admit_reason, null);
  assert.equal((await admissionsAdvisedOn(DAY)).size, 0);
});

test("reason required and whole days only", async () => {
  const { c } = await visit();
  await assert.rejects(adviseAdmission(c.id, { reason: " " }), /reason/);
  await assert.rejects(adviseAdmission(c.id, { reason: "x", days: 1.5 }), /whole number/);
  await assert.rejects(adviseAdmission("missing", { reason: "x" }), /Save the consultation/);
});

test("before v65: a clear message and an empty queue list", async () => {
  setup(64);
  const { c } = await visit();
  await assert.rejects(adviseAdmission(c.id, { reason: "x" }), /v65/);
  assert.equal((await admissionsAdvisedOn(DAY)).size, 0);
});
