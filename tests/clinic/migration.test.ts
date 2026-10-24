/** Root-cause reproduction + migration safety for the clinic module.
 * The v34 schema declared several foreign keys NOT NULL that the screens
 * legitimately leave empty (walk-in appointment without a doctor, a
 * consultation without an appointment, a prescription without a doctor).
 * Every such save failed on the real database. v36/v37 rebuild those tables. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb, applySchema } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { patientsRepo, doctorsRepo, appointmentsRepo, consultationsRepo, prescriptionsRepo } from "@/lib/repo/clinic";

const T = "clinic-a";
let sql: DatabaseSync;

function loginAs(tenantId: string) {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "clinic",
  };
  useAuthStore.setState({ currentUser: { id: `${tenantId}-u`, username: "u", displayName: "U", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

beforeEach(() => {
  loginAs(T);
});

test("v34/v35 schema (as first shipped) rejects walk-in appointment, consultation without appointment, prescription without doctor", async () => {
  sql = fullSchemaDb(35);
  setTestDb(sql);
  const p = await patientsRepo.create({ name: "Ali" });
  await assert.rejects(appointmentsRepo.create({ patient_id: p.id, doctor_id: null, date: "2026-10-24", status: "scheduled", type: "routine" } as never), /NOT NULL/);
  await assert.rejects(consultationsRepo.create({ patient_id: p.id, doctor_id: null, appointment_id: null, date: "2026-10-24" } as never), /NOT NULL/);
  await assert.rejects(prescriptionsRepo.create({ patient_id: p.id, doctor_id: null, date: "2026-10-24", status: "draft" } as never), /NOT NULL/);
});

test("v36 + v37 make those columns optional and keep existing rows", async () => {
  sql = fullSchemaDb(35);
  setTestDb(sql);
  const p = await patientsRepo.create({ name: "Sara" });
  const d = await doctorsRepo.create({ name: "Khan" });
  const a = await appointmentsRepo.create({ patient_id: p.id, doctor_id: d.id, date: "2026-10-24", time: "10:00", token_no: 3, status: "arrived", type: "routine" } as never);
  const c = await consultationsRepo.create({ patient_id: p.id, doctor_id: d.id, appointment_id: a.id, date: "2026-10-24", diagnosis: "Flu" } as never);
  const rx = await prescriptionsRepo.create({ patient_id: p.id, doctor_id: d.id, consultation_id: c.id, date: "2026-10-24", status: "sent" } as never);

  applySchema(sql, 36);
  applySchema(sql, 37);

  const a2 = await appointmentsRepo.get(a.id);
  const c2 = await consultationsRepo.get(c.id);
  const rx2 = await prescriptionsRepo.get(rx.id);
  assert.equal(a2?.token_no, 3);
  assert.equal(a2?.status, "arrived");
  assert.equal(c2?.diagnosis, "Flu");
  assert.equal(c2?.appointment_id, a.id);
  assert.equal(rx2?.status, "sent");

  const walkIn = await appointmentsRepo.create({ patient_id: p.id, doctor_id: null, date: "2026-10-24", status: "scheduled", type: "routine" } as never);
  const noAppt = await consultationsRepo.create({ patient_id: p.id, doctor_id: null, appointment_id: null, date: "2026-10-24" } as never);
  const noDoc = await prescriptionsRepo.create({ patient_id: p.id, doctor_id: null, date: "2026-10-24", status: "draft" } as never);
  assert.equal((await appointmentsRepo.get(walkIn.id))?.doctor_id, null);
  assert.equal((await consultationsRepo.get(noAppt.id))?.appointment_id, null);
  assert.equal((await prescriptionsRepo.get(noDoc.id))?.doctor_id, null);
});
