/** Inpatient medication orders and the medication administration record
 * (MSDS MOM-1, MOM-3): who may order, verbal orders, high-risk verification,
 * the bedside checks, and corrections. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit, saveRx, listRx } from "@/lib/repo/hospitalOpd";
import { admitFromVisit } from "@/lib/repo/hospitalCare";
import {
  addMedicationOrder, listMedicationOrders, countersignOrder, verifyHighRiskOrder, stopMedicationOrder,
  recordAdministration, voidAdministration, listAdministrations,
} from "@/lib/repo/medication";
import { highRiskGroup } from "@/config/highRiskMedicines";
import { designation } from "@/config/hospitalStaff";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 20,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  await staffRepo.update(staff.id, { user_id: `user-${staff.id}` } as Partial<Staff>);
  useAuthStore.setState({ currentUser: { id: `user-${staff.id}`, username: staff.name, displayName: staff.name, role: "staff", tenantId: H, permissions: designation(staff.staff_category)!.pages }, currentTenant: tenant });
}
let n = 0;
const lic = () => `L-${++n}`;
const CHECKS = { medicine: true, dose: true, route: true, time: true };

async function setup() {
  const consultant = await saveHospitalStaff(null, { name: "Dr Saima Rauf", staff_category: "consultant", license_no: lic(), consultation_fee: 0, department: "Medicine", basic_pay: 0 });
  const mo = await saveHospitalStaff(null, { name: "Dr Usman", staff_category: "medical_officer", license_no: lic(), consultation_fee: 0, department: "Medicine", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Nusrat", staff_category: "nurse", license_no: lic(), department: "Medicine", basic_pay: 0 });
  const nurse2 = await saveHospitalStaff(null, { name: "Sadia", staff_category: "nurse", license_no: lic(), department: "Medicine", basic_pay: 0 });
  const pharmacist = await saveHospitalStaff(null, { name: "Kamran", staff_category: "pharmacist", license_no: lic(), basic_pay: 0 });
  const receptionist = await saveHospitalStaff(null, { name: "Rabia", staff_category: "receptionist", basic_pay: 0 });
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ghulam Abbas", gender: "Male" });
  const { episode: visit } = await bookOpdVisit({ patientId: patient.id, doctorId: consultant.id });
  const { admission } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "DKA", plan: "ipd", department: "Medicine" });
  return { consultant, mo, nurse, nurse2, pharmacist, receptionist, patient, visit, admission };
}
const CEFTRIAXONE = { product_name: "Ceftriaxone 1g inj", generic_name: "Ceftriaxone", dose: "1 g", route: "IV", frequency: "BD (twice a day)", duration: "5 days" };
const INSULIN = { product_name: "Insulin Regular (Humulin R)", generic_name: "Insulin human", dose: "6 units", route: "SC", frequency: "TDS (before meals)", duration: "Until review" };

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

test("high-risk list matches brand and generic names", () => {
  assert.equal(highRiskGroup("Clexane 40mg"), "Anticoagulants");
  assert.equal(highRiskGroup("Inj KCl 15%"), "Concentrated electrolytes");
  assert.equal(highRiskGroup("Panadol", "Paracetamol"), null);
});

test("orders: complete and attributed; only doctors write them; a nurse's verbal order waits for the doctor's countersignature", async () => {
  const s = await setup();
  await as(s.consultant);
  await assert.rejects(addMedicationOrder(s.visit.id, CEFTRIAXONE), /OPD prescriptions are written on the Doctor Desk/);
  await assert.rejects(addMedicationOrder(s.admission.id, { ...CEFTRIAXONE, route: " " }), /Route is required/);
  const o = await addMedicationOrder(s.admission.id, CEFTRIAXONE);
  assert.deepEqual([o.order_status, o.order_source, o.ordered_by, o.ordered_by_name, o.high_risk], ["active", "written", s.consultant.id, "Dr Saima Rauf, Consultant", 0]);
  assert.ok(o.ordered_at);

  await as(s.nurse);
  await assert.rejects(addMedicationOrder(s.admission.id, CEFTRIAXONE), /Only a doctor writes medication orders/);
  await assert.rejects(addMedicationOrder(s.admission.id, { ...CEFTRIAXONE, source: "telephone" }), /Choose the doctor/);
  const verbal = await addMedicationOrder(s.admission.id, { product_name: "Paracetamol 1g IV", dose: "1 g", route: "IV", frequency: "SOS", duration: "24 hours", source: "telephone", prescriberId: s.mo.id });
  assert.deepEqual([verbal.ordered_by, verbal.received_by_name, verbal.countersigned_at], [s.mo.id, "Nusrat, Nurse", null]);
  await assert.rejects(countersignOrder(verbal.id), /countersigns it/);
  await as(s.mo);
  const signed = await countersignOrder(verbal.id);
  assert.equal(signed.countersigned_by_name, "Dr Usman, Medical Officer");
  await assert.rejects(countersignOrder(o.id), /nothing to countersign/);

  await as(s.receptionist);
  await assert.rejects(addMedicationOrder(s.admission.id, { ...CEFTRIAXONE, source: "verbal", prescriberId: s.mo.id }), /Only nursing staff or doctors/);
});

test("giving a dose: two different identifiers and every check confirmed; a dose not given needs the reason", async () => {
  const s = await setup();
  await as(s.consultant);
  const o = await addMedicationOrder(s.admission.id, CEFTRIAXONE);
  await as(s.nurse);
  await assert.rejects(recordAdministration(o.id, { status: "given", checks: CHECKS }), /two different identifiers/);
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: ["Full name", "Full name"], checks: CHECKS }), /two different identifiers/);
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: ["Full name", "MR number"], checks: { ...CHECKS, route: false, time: false } }), /Check the route, time/);
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: ["Full name", "MR number"] }), /Check the medicine, dose, route, time/);
  const given = await recordAdministration(o.id, { status: "given", identifiers: ["Full name", "MR number"], checks: CHECKS, givenAt: "2026-10-25T08:00" });
  assert.deepEqual([given.status, given.dose_given, given.route_given, given.given_by_name, given.checked_medicine], ["given", "1 g", "IV", "Nusrat, Nurse", 1]);
  assert.match(given.given_at, /Z$/);

  await assert.rejects(recordAdministration(o.id, { status: "refused" }), /reason the dose was refused/);
  const refused = await recordAdministration(o.id, { status: "refused", reason: "Patient vomiting, doctor informed" });
  assert.deepEqual([refused.identifier_1, refused.checked_dose], [null, 0], "a dose not given never shows checks as done");

  await as(s.receptionist);
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: ["Full name", "MR number"], checks: CHECKS }), /Only nursing staff and doctors/);
});

test("high-risk: flagged automatically, verified by someone other than the prescriber, then given with a second person's check", async () => {
  const s = await setup();
  await as(s.consultant);
  const o = await addMedicationOrder(s.admission.id, INSULIN);
  assert.equal(o.high_risk, 1);
  await as(s.nurse);
  const id: [string, string] = ["Full name", "Wristband"];
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: id, checks: CHECKS, secondCheckerId: s.nurse2.id }), /verified by a pharmacist or senior doctor before the first dose/);
  await assert.rejects(verifyHighRiskOrder(o.id), /A pharmacist or a senior doctor verifies/);
  await as(s.consultant);
  await assert.rejects(verifyHighRiskOrder(o.id), /cannot verify their own/);
  await as(s.pharmacist);
  const v = await verifyHighRiskOrder(o.id);
  assert.equal(v.verified_by_name, "Kamran, Pharmacist");

  await as(s.nurse);
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: id, checks: CHECKS }), /second person to check/);
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: id, checks: CHECKS, secondCheckerId: s.nurse.id }), /another person/);
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: id, checks: CHECKS, secondCheckerId: s.receptionist.id }), /must be a nurse, doctor or pharmacist/);
  const given = await recordAdministration(o.id, { status: "given", identifiers: id, checks: CHECKS, secondCheckerId: s.nurse2.id });
  assert.equal(given.second_checker_name, "Sadia, Nurse");
});

test("a stopped medicine cannot be given; an entry made in error is voided, not deleted; OPD prescriptions never touch inpatient orders", async () => {
  const s = await setup();
  await as(s.consultant);
  const o = await addMedicationOrder(s.admission.id, CEFTRIAXONE);
  await as(s.nurse);
  const e = await recordAdministration(o.id, { status: "given", identifiers: ["Full name", "MR number"], checks: CHECKS });
  await assert.rejects(stopMedicationOrder(o.id, "x"), /Only a doctor stops/);
  await as(s.nurse2);
  await assert.rejects(voidAdministration(e.id, "wrong patient"), /Only the person who recorded it/);
  await as(s.nurse);
  await assert.rejects(voidAdministration(e.id, " "), /reason/);
  await voidAdministration(e.id, "Recorded on the wrong order");
  const mar = await listAdministrations(s.admission.id);
  assert.equal(mar.length, 1, "kept");
  assert.equal(mar[0].void_reason, "Recorded on the wrong order");

  await as(s.consultant);
  await assert.rejects(stopMedicationOrder(o.id, " "), /reason/);
  await stopMedicationOrder(o.id, "Culture: switch to oral");
  await as(s.nurse);
  await assert.rejects(recordAdministration(o.id, { status: "given", identifiers: ["Full name", "MR number"], checks: CHECKS }), /stopped/);

  // Saving an OPD prescription on the same patient's admission episode leaves inpatient orders alone.
  asOwner();
  await saveRx(s.admission.id, [{ product_id: null, product_name: "Discharge: Cefixime", generic_name: null, dose: "400mg", route: "Oral", frequency: "OD", duration: "5", qty: 5, instructions: null }]);
  const orders = await listMedicationOrders(s.admission.id);
  assert.equal(orders.length, 1, "inpatient order kept");
  assert.equal((await listRx(s.admission.id)).length, 2, "both kinds are in the record");
});
