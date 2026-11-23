/** Hospital stage C: medical officers, nurses and paramedics see the
 * admissions, emergency patients and ER board of the department they are on
 * duty in (duty roster), else their own department; seniors see all. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hospitalEpisodesRepo, hospitalPatientsRepo, listEpisodes, nextEpisodeNo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { erBoard } from "@/lib/repo/emergency";
import { canSeeEpisode, departmentScope, episodeDept, normDept } from "@/lib/repo/deptScope";
import { staffRepo } from "@/lib/repo/staff";
import { designation } from "@/config/hospitalStaff";
import { localDate } from "@/lib/localDate";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  await staffRepo.update(staff.id, { user_id: `user-${staff.id}` } as Partial<Staff>);
  useAuthStore.setState({ currentUser: { id: `user-${staff.id}`, username: staff.name, displayName: staff.name, role: "staff", tenantId: H, permissions: designation(staff.staff_category)!.pages }, currentTenant: tenant });
}
const today = localDate();
const yesterday = (() => { const t = new Date(`${today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); })();
const roster = (staffId: string, date: string, shift: string, department: string | null) =>
  db.prepare(`INSERT INTO hospital_duty_roster (id, tenant_id, staff_id, duty_date, shift, department, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 'x')`)
    .run(`r-${staffId}-${date}`, H, staffId, date, shift, department);

async function episode(type: "ipd" | "emergency", department: string | null, name: string) {
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name, gender: "Male" });
  return hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo(type, today), type, patient_id: p.id, doctor_id: null, department, date: today, time: null,
    status: "open", room_ward: null, bed_no: null, admission_date: type === "ipd" ? today : null, discharge_date: null, diagnosis: null, notes: null,
  });
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  asOwner();
});

test("department names: case-free, and ER / Casualty are the Emergency department", () => {
  assert.equal(normDept("  Orthopedic "), "orthopedic");
  assert.equal(normDept("Casualty"), "emergency");
  assert.equal(episodeDept({ type: "emergency", department: null }), "emergency");
  assert.equal(episodeDept({ type: "ipd", department: "ER" }), "emergency");
});

test("each MO, nurse and paramedic sees only their department's patients; seniors see all", async () => {
  const ortho = await episode("ipd", "Orthopedic", "Ortho patient");
  const gynae = await episode("ipd", "Gynae", "Gynae patient");
  const er1 = await episode("emergency", null, "ER walk-in");
  const er2 = await episode("emergency", "Casualty", "RTA");

  const orthoNurse = await saveHospitalStaff(null, { name: "Nurse Rabia", staff_category: "nurse", license_no: "PNC-1", department: "Orthopedic", basic_pay: 0 });
  const mo = await saveHospitalStaff(null, { name: "Dr Hina (WMO)", staff_category: "medical_officer", license_no: "PMDC-2", department: "Orthopedic", basic_pay: 0 });
  const para = await saveHospitalStaff(null, { name: "Asif", staff_category: "paramedic", license_no: "", department: "Orthopedic", basic_pay: 0 });
  const nightNurse = await saveHospitalStaff(null, { name: "Nurse Sana", staff_category: "nurse", license_no: "PNC-4", department: "Medicine", basic_pay: 0 });
  const offNurse = await saveHospitalStaff(null, { name: "Nurse Off", staff_category: "nurse", license_no: "PNC-5", department: "Gynae", basic_pay: 0 });
  const consultant = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: "PMDC-6", department: "Orthopedic", basic_pay: 0 });
  roster(mo.id, today, "M", "Gynae");                 // on duty in Gynae today, though Ortho staff
  roster(para.id, today, "L", "Emergency");
  roster(nightNurse.id, yesterday, "N", "Orthopedic"); // last night's shift runs into today
  roster(offNurse.id, today, "O", "Gynae");            // off today: her own department

  const names = async () => (await listEpisodes({ status: "open" })).map((e) => e.patient_name).sort();
  assert.equal((await names()).length, 4, "the owner sees every department");

  await as(orthoNurse);
  assert.deepEqual(await names(), ["Ortho patient"]);
  assert.deepEqual(await erBoard(), []);
  assert.equal(await canSeeEpisode(gynae), false);
  assert.equal(await canSeeEpisode(ortho), true);

  await as(mo);
  assert.deepEqual(await departmentScope(), ["gynae"]);
  assert.deepEqual(await names(), ["Gynae patient"]);

  await as(para);
  assert.deepEqual(await names(), ["ER walk-in", "RTA"]);
  assert.deepEqual((await erBoard()).map((r) => r.patient_name).sort(), ["ER walk-in", "RTA"]);
  assert.equal(await canSeeEpisode(er2), true);
  assert.equal(await canSeeEpisode(er1), true);

  await as(nightNurse);
  assert.deepEqual(await names(), ["Ortho patient"]);

  await as(offNurse);
  assert.deepEqual(await names(), ["Gynae patient"]);

  await as(consultant);
  assert.equal(await departmentScope(), null);
  assert.equal((await names()).length, 4);
});
