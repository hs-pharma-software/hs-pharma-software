/** Hospital F1: age from the date of birth, the insured amount per policy
 * year, staff with more than one role, and the ordering doctor's share on lab
 * and radiology services. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { usersRepo } from "@/lib/repo/users";
import { addCharge, hospitalEpisodesRepo, hospitalPatientsRepo, hospitalServicesRepo, listChargesForEpisode, nextEpisodeNo, nextMrNo } from "@/lib/repo/hospital";
import { bookOpdVisit, orderInvestigation, saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { linkStaffLogin } from "@/lib/hospitalLogins";
import type { DatabaseSync } from "node:sqlite";
import { currentActor, roleAllowed } from "@/lib/repo/medicalRecord";
import { addInsuranceCompany } from "@/lib/repo/insurance";
import { insuredEpisodes, policyYearEnd } from "@/lib/repo/hospitalInsurance";
import { doctorShares } from "@/lib/repo/hospitalReports";
import { ageFromDob } from "@/lib/hospitalMr";
import { IPC_AUDITOR_ROLES, designation, pagesForRoles, staffRoles } from "@/config/hospitalStaff";
import { localDate } from "@/lib/localDate";

const H = "hosp-a";
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });

let db: DatabaseSync;
beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  asOwner();
});

test("age in years and months from the date of birth", () => {
  assert.deepEqual(ageFromDob("1990-05-10", "2026-11-24"), { years: 36, months: 6 });
  assert.deepEqual(ageFromDob("2026-03-25", "2026-11-24"), { years: 0, months: 7 }, "the day of the month not reached yet");
  assert.deepEqual(ageFromDob("2025-11-24", "2026-11-24"), { years: 1, months: 0 });
  assert.equal(ageFromDob("2027-01-01", "2026-11-24"), null, "a birth date in the future");
  assert.equal(ageFromDob("", "2026-11-24"), null);
});

test("the insured amount is per policy year (from the Valid Till day) and starts from 0 each year", async () => {
  assert.equal(policyYearEnd("2026-05-01", "2027-06-30"), "2026-06-30");
  assert.equal(policyYearEnd("2026-07-01", "2027-06-30"), "2027-06-30");
  assert.equal(policyYearEnd("2026-07-01", null), "2026-12-31", "no Valid Till: the calendar year");
  const co = await addInsuranceCompany("State Life");
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ayesha", gender: "Female", insurance_no: "SL-9", insured: 1, insurance_company_id: co.id, insured_amount: 50000, insurance_valid_till: "2027-06-30" });
  for (const [date, amount] of [["2026-05-01", 40000], ["2026-06-20", 20000], ["2026-07-05", 30000]] as const) {
    const e = await hospitalEpisodesRepo.create({ episode_no: await nextEpisodeNo("ipd", date), type: "ipd", patient_id: p.id, doctor_id: null, department: null, date, time: null, status: "open", room_ward: null, bed_no: null, admission_date: date, discharge_date: null, diagnosis: null, notes: null });
    await addCharge({ tenant_id: "", episode_id: e.id, service_id: null, description: "Charges", department: null, category: "misc", qty: 1, rate: amount, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: date, notes: null, invoice_id: null });
  }
  const rows = (await insuredEpisodes()).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(rows.map((r) => [r.date, r.cover, r.patientShare]), [["2026-05-01", 40000, 0], ["2026-06-20", 10000, 10000], ["2026-07-05", 30000, 0]]);
});

test("a person with more than one role: the login opens every role's pages and may do what each role does", async () => {
  assert.deepEqual(pagesForRoles(["nurse", "infection_control_nurse"])?.sort(), [...new Set([...designation("nurse")!.pages!, ...designation("infection_control_nurse")!.pages!])].sort());
  assert.equal(pagesForRoles(["nurse", "admin"]), null, "an admin role opens everything");
  const nurse = await saveHospitalStaff(null, { name: "Rabia", staff_category: "nurse", license_no: "PNC-1", basic_pay: 0, extra_roles: JSON.stringify(["infection_control_nurse", "nurse", "made_up"]) });
  assert.deepEqual(staffRoles(nurse), ["nurse", "infection_control_nurse"], "the designation is not repeated; an unknown role is dropped");
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, 'Hospital', 'hospital', 'x', 'x')`).run(H);
  db.prepare(`INSERT INTO users (id, tenant_id, username, display_name, role, password_hash, password_salt, is_active, created_at, updated_at) VALUES ('u-rabia', ?, 'rabia', 'Rabia', 'staff', 'x', 'x', 1, 'x', 'x')`).run(H);
  await linkStaffLogin(nurse.id, "u-rabia");
  const login = { id: "u-rabia" };
  assert.deepEqual(JSON.parse(String((await usersRepo.get(login.id))!.permissions)).sort(), pagesForRoles(staffRoles(nurse))!.sort());
  useAuthStore.setState({ currentUser: { id: login.id, username: "rabia", displayName: "Rabia", role: "staff", tenantId: H, permissions: ["hospital_patients"] }, currentTenant: tenant });
  assert.ok(roleAllowed(IPC_AUDITOR_ROLES, await currentActor()), "an infection control duty");
  assert.ok(roleAllowed(["nurse"], await currentActor()), "still a nurse");
  // The other role is taken away: the login follows.
  asOwner();
  await saveHospitalStaff(nurse.id, { name: "Rabia", staff_category: "nurse", license_no: "PNC-1", basic_pay: 0, extra_roles: "[]" });
  assert.deepEqual(JSON.parse(String((await usersRepo.get(login.id))!.permissions)).sort(), [...designation("nurse")!.pages!].sort());
});

test("lab and radiology: the performing doctor's and the ordering doctor's shares", async () => {
  const doc = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: "PMDC-1", consultation_fee: 0, basic_pay: 0 });
  const xr = await hospitalServicesRepo.create({ code: "XR", name: "X-Ray", department: "Radiology", category: "imaging", billing_unit: "test", rate: 1200, is_active: 1, notes: null, doctor_share: 300, ordering_doctor_share: 150 });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid", gender: "Male" });
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: doc.id });
  await orderInvestigation(episode.id, xr.id);
  const line = (await listChargesForEpisode(episode.id)).find((c) => c.service_id === xr.id)!;
  assert.deepEqual([line.doctor_share, line.ordering_doctor_share], [300, 150]);
  const today = localDate();
  const rows = await doctorShares({ from: today, to: today }, "range");
  assert.deepEqual(rows.map((r) => [r.doctor, r.ordered, r.services, r.total]), [
    ["Doctor not recorded (lab / radiology)", 0, 300, 300],
    ["Dr Saeed", 150, 0, 150],
  ]);
});
