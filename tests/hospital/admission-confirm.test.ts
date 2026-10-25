/** Head Nurse / Nursing Superintendent: an admission made by a consultant or
 * referred from Emergency waits for the department's Head Nurse to confirm it. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { localDate } from "@/lib/localDate";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalEpisodesRepo, hospitalPatientsRepo, nextMrNo, nextEpisodeNo, listChargesForEpisode, listEpisodes } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { invoicesRepo } from "@/lib/repo/invoices";
import {
  admitFromVisit, listAdmissionRequests, confirmAdmission, declineAdmission, admissionConfirmScope, saveSurgeryType, listSurgeryBookings,
} from "@/lib/repo/hospitalCare";
import { designation } from "@/config/hospitalStaff";
import { visibleNavFor } from "@/config/navFilter";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 20,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
/** Logs in as a staff member with the pages of their designation. */
async function as(staff: Staff) {
  const userId = `user-${staff.id}`;
  asOwner();
  await staffRepo.update(staff.id, { user_id: userId } as Partial<Staff>);
  useAuthStore.setState({ currentUser: { id: userId, username: staff.name, displayName: staff.name, role: "staff", tenantId: H, permissions: designation(staff.staff_category)!.pages }, currentTenant: tenant });
}

let n = 0;
const lic = () => `PNC-${++n}`;
const ORTHO = "Orthopedic Department";
const SURGERY = "General Surgery";

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function setup() {
  const consultant = await saveHospitalStaff(null, { name: "Dr Rab Nawaz", staff_category: "consultant", license_no: "PMDC-1", consultation_fee: 0, department: ORTHO, basic_pay: 0 });
  const hnOrtho = await saveHospitalStaff(null, { name: "Shazia", staff_category: "head_nurse", license_no: lic(), department: ORTHO, basic_pay: 0 });
  const hnSurgery = await saveHospitalStaff(null, { name: "Imran", staff_category: "head_nurse", license_no: lic(), department: SURGERY, basic_pay: 0 });
  const ns = await saveHospitalStaff(null, { name: "Farzana", staff_category: "nursing_superintendent", license_no: lic(), basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Asma", staff_category: "nurse", license_no: lic(), department: ORTHO, basic_pay: 0 });
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Bilal Khalid", gender: "Male" });
  return { consultant, hnOrtho, hnSurgery, ns, nurse, patient };
}

test("designations: Head Nurse and Nursing Superintendent, PNC number, employee ids; a Head Nurse needs a department", async () => {
  for (const key of ["head_nurse", "nursing_superintendent"]) {
    const d = designation(key)!;
    assert.equal(d.license, "PNC");
    assert.ok(d.licenseRequired);
    assert.ok(d.pages!.includes("hospital_admissions"));
  }
  const hn = await saveHospitalStaff(null, { name: "Shazia", staff_category: "head_nurse", license_no: "PNC-77", department: ORTHO, basic_pay: 0 });
  const ns = await saveHospitalStaff(null, { name: "Farzana", staff_category: "nursing_superintendent", license_no: "PNC-78", basic_pay: 0 });
  assert.deepEqual([hn.employee_id, hn.designation, ns.employee_id, ns.designation], ["HN-01", "Head Nurse (department)", "NS-01", "Nursing Superintendent"]);
  await assert.rejects(saveHospitalStaff(null, { name: "No dept", staff_category: "head_nurse", license_no: "PNC-79", basic_pay: 0 }), /Head Nurse's department/);
  await assert.rejects(saveHospitalStaff(null, { name: "No PNC", staff_category: "head_nurse", department: ORTHO, basic_pay: 0 }), /PNC number/);

  // The menu: both see Admission Requests; a plain nurse does not.
  const labels = (pages: string[] | null) => visibleNavFor("hospital", null, pages).flatMap((i) => [i.label, ...(i.children ?? []).map((c) => c.label)]);
  assert.ok(labels(designation("head_nurse")!.pages).includes("Admission Requests"));
  assert.ok(labels(designation("nursing_superintendent")!.pages).includes("Admission Requests"));
  assert.ok(!labels(designation("nurse")!.pages).includes("Admission Requests"));
});

test("a consultant's admission waits for its department's Head Nurse, who confirms it with the ward and bed", async () => {
  const s = await setup();
  const { episode: visit } = await bookOpdVisit({ patientId: s.patient.id, doctorId: s.consultant.id });
  await as(s.consultant);
  const { admission } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Fracture femur", plan: "ipd", department: ORTHO });
  assert.equal(admission.admission_status, "pending");
  assert.equal(admission.department, ORTHO);
  assert.equal((await listEpisodes({ type: "ipd" }))[0].admission_status, "pending", "IPD list shows it waiting");

  // Another department's Head Nurse neither sees nor confirms it; nor does a nurse.
  await as(s.hnSurgery);
  assert.deepEqual(await listAdmissionRequests(), []);
  await assert.rejects(confirmAdmission(admission.id, { wardRoom: "W", bedNo: "1" }), /Only the Head Nurse of Orthopedic Department/);
  await as(s.nurse);
  assert.deepEqual(await listAdmissionRequests(), []);
  await assert.rejects(confirmAdmission(admission.id, { wardRoom: "W", bedNo: "1" }), /Only the Head Nurse/);

  await as(s.hnOrtho);
  assert.deepEqual(await admissionConfirmScope(), { all: false, department: ORTHO, staffId: s.hnOrtho.id, staffName: "Shazia" });
  const waiting = await listAdmissionRequests();
  assert.deepEqual(waiting.map((r) => [r.patient_name, r.department, r.doctor_name, r.from_episode_no, r.from_type]), [["Bilal Khalid", ORTHO, "Dr Rab Nawaz", visit.episode_no, "opd"]]);
  await assert.rejects(confirmAdmission(admission.id, { wardRoom: "Ortho ward" }), /ward \/ room and bed/);
  const confirmed = await confirmAdmission(admission.id, { wardRoom: "Ortho ward", bedNo: "7" });
  assert.deepEqual([confirmed.admission_status, confirmed.room_ward, confirmed.bed_no, confirmed.admission_confirmed_by], ["confirmed", "Ortho ward", "7", s.hnOrtho.id]);
  assert.ok(confirmed.admission_confirmed_at);
  assert.match(confirmed.notes ?? "", /confirmed by Shazia/);
  assert.deepEqual(await listAdmissionRequests(), []);
  assert.deepEqual((await listAdmissionRequests("confirmed")).map((r) => [r.bed_no, r.confirmed_by_name]), [["7", "Shazia"]]);
  await assert.rejects(confirmAdmission(admission.id, { wardRoom: "X", bedNo: "1" }), /not waiting for confirmation/);
});

test("a referral from Emergency goes to the chosen department; the Nursing Superintendent can confirm for any department", async () => {
  const s = await setup();
  const er = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("emergency"), type: "emergency", patient_id: s.patient.id, doctor_id: s.consultant.id, department: "Emergency",
    date: localDate(), time: null, status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null, diagnosis: "Road accident", notes: null,
  });
  // No department chosen and none on the visit: refused, its Head Nurse would be unknown.
  const erNoDept = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("emergency"), type: "emergency", patient_id: s.patient.id, doctor_id: null, department: null,
    date: localDate(), time: null, status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null, diagnosis: null, notes: null,
  });
  await assert.rejects(admitFromVisit({ fromEpisodeId: erNoDept.id, reason: "x", plan: "ipd", department: "  " }), /Choose the department/);

  const { admission } = await admitFromVisit({ fromEpisodeId: er.id, reason: "Polytrauma", plan: "ipd", department: SURGERY });
  assert.equal(admission.department, SURGERY);
  assert.equal(admission.diagnosis, "Road accident");

  await as(s.hnOrtho);
  assert.deepEqual(await listAdmissionRequests(), [], "not Ortho's");
  await as(s.ns);
  const all = await listAdmissionRequests();
  assert.deepEqual(all.map((r) => [r.department, r.from_type]), [[SURGERY, "emergency"]]);
  await confirmAdmission(admission.id, { wardRoom: "Surgical ICU", bedNo: "2" });
  assert.equal((await hospitalEpisodesRepo.get(admission.id))!.admission_confirmed_by, s.ns.id);
});

test("not accepted: the admission and its planned surgery and invoice are cancelled, and the visit can be admitted elsewhere", async () => {
  const s = await setup();
  const surgery = await saveSurgeryType(null, { name: "ORIF femur", department: ORTHO, breakdown: { operation_fee: 60000, room_type: "VIP Room", room_charges: 10000 } });
  const { episode: visit } = await bookOpdVisit({ patientId: s.patient.id, doctorId: s.consultant.id });
  const { admission, booking } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Fracture", plan: "surgery", surgeryTypeId: surgery.id });
  assert.equal(admission.department, ORTHO, "the surgery's department");

  await as(s.hnOrtho);
  await assert.rejects(declineAdmission(admission.id, " "), /Say why/);
  await declineAdmission(admission.id, "No bed free");
  const after = (await hospitalEpisodesRepo.get(admission.id))!;
  assert.deepEqual([after.admission_status, after.status], ["declined", "cancelled"]);
  assert.match(after.notes ?? "", /Not accepted by Shazia: No bed free/);
  assert.equal((await listSurgeryBookings("cancelled"))[0].id, booking!.id);
  assert.equal((await listChargesForEpisode(admission.id)).length, 0);
  assert.ok((await invoicesRepo.get(booking!.invoice_id!))!.deleted_at, "surgery invoice removed");
  assert.match((await hospitalEpisodesRepo.get(visit.id))!.notes ?? "", /not accepted by Orthopedic Department: No bed free/);
  assert.deepEqual((await listAdmissionRequests("declined")).map((r) => r.episode_no), [admission.episode_no]);

  // The doctor admits the same visit to another department.
  await as(s.consultant);
  const again = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Fracture, to surgery", plan: "ipd", department: SURGERY });
  assert.equal(again.admission.admission_status, "pending");
});

test("an admission with other charges on its bill cannot be declined", async () => {
  const s = await setup();
  const { episode: visit } = await bookOpdVisit({ patientId: s.patient.id, doctorId: s.consultant.id });
  const { admission } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Observation", plan: "ipd" });
  const { addCharge } = await import("@/lib/repo/hospital");
  await addCharge({ tenant_id: "", episode_id: admission.id, service_id: null, description: "Bed (1 day)", department: null, category: "bed", qty: 1, rate: 3000, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: localDate(), notes: null, invoice_id: null });
  await as(s.hnOrtho);
  await assert.rejects(declineAdmission(admission.id, "No bed"), /other charges/);
  assert.equal((await hospitalEpisodesRepo.get(admission.id))!.admission_status, "pending", "nothing changed");
});
