/** Facility, HR and document control (MSDS FMS, HRM, ROM, IMS) and the
 * self-assessment: failed checks take equipment out of service until a
 * person returns it, licence renewals keep history, drills fall due, training
 * and credentials checked by someone else, appraisals acknowledged by the
 * staff member, roster rest rule, document approval by a non-author with
 * versions, and a snapshot that never shows "met" without records. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import {
  saveEquipment, recordEquipmentLog, returnToService, condemnEquipment, listEquipment, dueState, saveLicence, renewLicence, listLicences,
  recordDrill, drillSchedule, addDays,
} from "@/lib/repo/facility";
import {
  recordTraining, recordCredential, verifyCredential, saveAppraisal, finalizeAppraisal, acknowledgeAppraisal, staffHrStatus, setRosterShift, rosterRange,
} from "@/lib/repo/hrRecords";
import { createDocument, approveDocument, reviseDocument, confirmReviewed, listDocuments, documentHistory, requiredDocumentStatus, jobDescriptionFor } from "@/lib/repo/documents";
import { complianceSnapshot } from "@/lib/repo/compliance";
import { designation } from "@/config/hospitalStaff";
import { APPRAISAL_CRITERIA, REQUIRED_DOCUMENTS } from "@/config/facility";
import { localDate } from "@/lib/localDate";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
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
const today = localDate();
const days = (d: number) => addDays(today, d);

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function setup() {
  return {
    fm: await saveHospitalStaff(null, { name: "Waqas", staff_category: "facility_manager", basic_pay: 0 }),
    hr: await saveHospitalStaff(null, { name: "Hina", staff_category: "hr_officer", basic_pay: 0 }),
    hr2: await saveHospitalStaff(null, { name: "Omer", staff_category: "hr_officer", basic_pay: 0 }),
    qm: await saveHospitalStaff(null, { name: "Sana", staff_category: "quality_manager", basic_pay: 0 }),
    ns: await saveHospitalStaff(null, { name: "Farzana", staff_category: "nursing_superintendent", license_no: lic(), basic_pay: 0 }),
    nurse: await saveHospitalStaff(null, { name: "Rukhsana", staff_category: "nurse", license_no: lic(), department: "Medicine", basic_pay: 0, date_of_joining: days(-500) }),
    clerk: await saveHospitalStaff(null, { name: "Bilal", staff_category: "receptionist", basic_pay: 0, date_of_joining: days(-30) }),
  };
}

test("periodic checks: due, soon, overdue, never", () => {
  assert.deepEqual(dueState(null, 180, today), { due: null, state: "never" });
  assert.equal(dueState(days(-200), 180, today).state, "overdue");
  assert.equal(dueState(days(-170), 180, today).state, "soon");
  assert.equal(dueState(days(-10), 180, today).state, "ok");
  assert.equal(dueState(days(-10), null, today).state, "na");
});

test("equipment: failed calibration and breakdowns take it out of service; a person returns it only when safe", async () => {
  const s = await setup();
  await as(s.nurse);
  await assert.rejects(saveEquipment(null, { name: "Defibrillator", category: "Life support (ventilator, defibrillator, anaesthesia machine)" }), /facility manager/);
  await as(s.fm);
  await assert.rejects(saveEquipment(null, { name: "Defibrillator", category: "Life support (ventilator, defibrillator, anaesthesia machine)", isCritical: true }), /preventive maintenance interval/);
  const d = await saveEquipment(null, { name: "Defibrillator", category: "Life support (ventilator, defibrillator, anaesthesia machine)", isCritical: true, ppmIntervalDays: 180, calibrationIntervalDays: 365, department: "Emergency" });
  assert.match(d.asset_no, /^EQ-\d{2}-0001$/);
  let [row] = await listEquipment({}, today);
  assert.equal(row.ppm.state, "never");

  await assert.rejects(recordEquipmentLog(d.id, { kind: "calibration", performedOn: today, performedBy: "BioMed Co", result: "pass" }), /certificate/);
  await recordEquipmentLog(d.id, { kind: "calibration", performedOn: today, performedBy: "BioMed Co", result: "fail", description: "Energy delivered 20% low" });
  assert.equal((await listEquipment({}, today))[0].status, "out_of_service");
  await assert.rejects(returnToService(d.id), /last calibration failed/);
  await recordEquipmentLog(d.id, { kind: "calibration", performedOn: today, performedBy: "BioMed Co", result: "pass", certificateRef: "CAL-778" });
  await recordEquipmentLog(d.id, { kind: "ppm", performedOn: today, performedBy: "BioMed Co", result: "pass" });
  assert.equal((await listEquipment({}, today))[0].status, "out_of_service", "a passing check never puts it back by itself");
  await returnToService(d.id);

  await recordEquipmentLog(d.id, { kind: "breakdown", performedOn: today, description: "Does not charge" });
  await assert.rejects(recordEquipmentLog(d.id, { kind: "breakdown", performedOn: today, description: "x" }), /already open/);
  await assert.rejects(returnToService(d.id), /repair of the open breakdown/);
  await recordEquipmentLog(d.id, { kind: "repair", performedOn: today, performedBy: "BioMed Co", description: "Battery replaced" });
  await returnToService(d.id);
  [row] = await listEquipment({}, today);
  assert.equal(row.status, "in_service");
  assert.equal(row.ppm.due, addDays(today, 180));
  assert.equal(row.breakdown_open, false);
  await condemnEquipment(d.id, "Beyond economical repair");
  assert.equal((await listEquipment({ status: "active" }, today)).length, 0);
});

test("licences: required ones listed as missing, expiry states, renewal keeps the history", async () => {
  const s = await setup();
  await as(s.fm);
  let l = await listLicences(today);
  assert.ok(l.missing.includes("PHC registration / licence"));
  const fire = await saveLicence(null, { kind: "fire", number: "R1122-55", issuedOn: days(-340), expiresOn: days(25) });
  l = await listLicences(today);
  assert.equal(l.current[0].state, "expiring");
  await assert.rejects(renewLicence(fire.id, { kind: "fire", number: "R1122-90", issuedOn: days(-1), expiresOn: days(10) }), /expire after/);
  await renewLicence(fire.id, { kind: "fire", number: "R1122-90", issuedOn: days(-1), expiresOn: days(364) });
  l = await listLicences(today);
  assert.equal(l.current.length, 1);
  assert.equal(l.current[0].number, "R1122-90");
  assert.equal(l.current[0].state, "valid");
  assert.equal(l.history.length, 1);
  await assert.rejects(saveLicence(fire.id, { kind: "fire", number: "x" }), /renewed/);
});

test("drills: schedule from the last drill of each kind", async () => {
  const s = await setup();
  await as(s.nurse);
  await assert.rejects(recordDrill({ kind: "fire", heldOn: today, location: "Ward 4", observations: "ok" }), /facility manager, quality team/);
  await as(s.ns);
  await assert.rejects(recordDrill({ kind: "fire", heldOn: days(1), location: "Ward 4", observations: "ok" }), /not in the future/);
  await recordDrill({ kind: "code_blue", heldOn: days(-100), location: "ICU", observations: "Defib arrived in 4 min", gaps: "Crash cart seal broken", participants: 9 });
  const sched = await drillSchedule(today);
  assert.equal(sched.find((d) => d.key === "code_blue")!.state, "overdue", "Code Blue every 90 days");
  assert.equal(sched.find((d) => d.key === "fire")!.state, "never");
});

test("HR: training, credentials verified by someone else, appraisal acknowledged by the staff member, file gaps", async () => {
  const s = await setup();
  await as(s.hr);
  let st = (await staffHrStatus(today)).find((h) => h.staff.id === s.nurse.id)!;
  assert.ok(st.missingTraining.some((t) => t.includes("BLS")), "clinical staff need BLS");
  assert.equal(st.registrationVerified, false);
  assert.equal((await staffHrStatus(today)).find((h) => h.staff.id === s.clerk.id)!.registrationVerified, null, "a receptionist needs no registration");

  const bls = await recordTraining(s.nurse.id, { kind: "bls", heldOn: days(-800), provider: "Rescue 1122" });
  assert.ok(bls.valid_until && bls.valid_until > days(-800) && bls.valid_until < today, "valid for 24 months from the course");
  st = (await staffHrStatus(today)).find((h) => h.staff.id === s.nurse.id)!;
  assert.ok(st.expiredTraining.some((t) => t.includes("BLS")), "BLS lasts two years");
  for (const kind of ["orientation", "dept_orientation", "jd_received", "fire_safety", "ipc", "bls"]) await recordTraining(s.nurse.id, { kind, heldOn: days(-5) });
  st = (await staffHrStatus(today)).find((h) => h.staff.id === s.nurse.id)!;
  assert.deepEqual([st.missingTraining, st.expiredTraining], [[], []]);

  const reg = await recordCredential(s.nurse.id, { kind: "Professional registration (PMDC / PNC / allied council)", number: "PNC-1234", validUntil: days(300) });
  const mine = await recordCredential(s.hr.id, { kind: "Basic degree / diploma" });
  await assert.rejects(verifyCredential(mine.id, { method: "Original document seen and copy kept" }), /someone else/);
  await verifyCredential(reg.id, { method: "Online council register checked" });
  assert.equal((await staffHrStatus(today)).find((h) => h.staff.id === s.nurse.id)!.registrationVerified, true);
  await as(s.hr2);
  await verifyCredential(mine.id, { method: "Original document seen and copy kept" });

  await as(s.nurse);
  await assert.rejects(saveAppraisal(null, s.nurse.id, { periodFrom: days(-365), periodTo: today, ratings: {} }), /Appraisals are written/);
  await as(s.ns);
  await assert.rejects(saveAppraisal(null, s.ns.id, { periodFrom: days(-365), periodTo: today, ratings: {} }), /yourself/);
  const ap = await saveAppraisal(null, s.nurse.id, { periodFrom: days(-365), periodTo: today, ratings: { knowledge: 4 } });
  await assert.rejects(finalizeAppraisal(ap.id), /Score every criterion/);
  await saveAppraisal(ap.id, s.nurse.id, { periodFrom: days(-365), periodTo: today, ratings: Object.fromEntries(APPRAISAL_CRITERIA.map(([k], i) => [k, i % 2 ? 4 : 5])), goals: "ACLS this year" });
  const fin = await finalizeAppraisal(ap.id);
  assert.equal(fin.overall, 4.5);
  await assert.rejects(acknowledgeAppraisal(ap.id), /Only the staff member/);
  await as(s.nurse);
  await acknowledgeAppraisal(ap.id, "Agreed");
  assert.equal((await staffHrStatus(today)).find((h) => h.staff.id === s.nurse.id)!.appraisalDue, false);
});

test("roster: no morning shift after a night; clearing a shift", async () => {
  const s = await setup();
  await as(s.nurse);
  await assert.rejects(setRosterShift(s.nurse.id, today, "M"), /roster is made/);
  await as(s.ns);
  await setRosterShift(s.nurse.id, today, "N");
  await assert.rejects(setRosterShift(s.nurse.id, days(1), "M"), /no rest/);
  await setRosterShift(s.nurse.id, days(1), "O");
  await setRosterShift(s.nurse.id, days(2), "M");
  await assert.rejects(setRosterShift(s.nurse.id, days(1), "N"), /no rest/);
  assert.equal((await rosterRange(today, days(6))).length, 3);
  await setRosterShift(s.nurse.id, days(1), "");
  assert.equal((await rosterRange(today, days(6))).length, 2);
  assert.equal((await rosterRange(today, days(6)))[0].department, "Medicine");
});

test("documents: approved by someone other than the author, revisions obsolete the old version, review dates", async () => {
  const s = await setup();
  await as(s.clerk);
  await assert.rejects(createDocument({ kind: "policy", title: "Consent", body: "x" }), /drafted by/);
  await as(s.ns);
  const d = await createDocument({ kind: "policy", title: "Informed consent policy", standardKey: "consent", body: "1. Purpose ..." });
  assert.equal(d.doc_no, "POL-001");
  await assert.rejects(approveDocument(d.id), /someone other than its author/);
  assert.equal((await requiredDocumentStatus(today)).find((r) => r.key === "consent")!.state, "draft");
  await as(s.qm);
  const v1 = await approveDocument(d.id);
  assert.equal(v1.review_due_on, addDays(today, 731));
  const v2 = await reviseDocument(v1.id, "Add emergency consent by two doctors");
  assert.equal(v2.version, 2);
  await assert.rejects(reviseDocument(v1.id, "again"), /already being drafted/);
  let [row] = await listDocuments({}, today);
  assert.equal(row.version, 1, "the approved version stays in use while the revision is drafted");
  assert.equal(row.draft_version, 2);
  await as(s.ns);
  await approveDocument(v2.id);
  const hist = await documentHistory("POL-001");
  assert.deepEqual(hist.map((h) => [h.version, h.status]), [[2, "approved"], [1, "obsolete"]]);
  [row] = await listDocuments({}, addDays(today, 800));
  assert.equal(row.review_overdue, true);
  assert.equal((await requiredDocumentStatus(addDays(today, 800))).find((r) => r.key === "consent")!.state, "review_overdue");
  await as(s.qm);
  await confirmReviewed(v2.id, "Checked against current law");

  await as(s.hr);
  await assert.rejects(createDocument({ kind: "jd", title: "Staff Nurse", body: "Duties" }), /designation/);
  const jd = await createDocument({ kind: "jd", title: "Staff Nurse", designationKey: "nurse", body: "Reports to Head Nurse. Duties: ..." });
  await as(s.qm);
  await approveDocument(jd.id);
  assert.equal((await jobDescriptionFor("nurse"))!.doc_no, "JD-001");
});

test("self-assessment: no records shows no data or attention, never met", async () => {
  const s = await setup();
  await as(s.qm);
  const { checks } = await complianceSnapshot(today);
  assert.ok(checks.length > 10);
  assert.ok(checks.every((c) => c.state !== "ok" || !/^0 of/.test(c.detail)));
  const docs = checks.filter((c) => c.label.startsWith("Key policies"));
  assert.equal(docs.length, new Set(REQUIRED_DOCUMENTS.map((r) => r.area)).size);
  assert.ok(docs.every((c) => c.state === "attention"));
  assert.equal(checks.find((c) => c.label.startsWith("Incidents are"))!.state, "attention", "zero reports is a warning");
  assert.equal(checks.find((c) => c.label.startsWith("Equipment"))!.state, "no_data");
  assert.equal(checks.find((c) => c.label.startsWith("Mock drills"))!.state, "attention");
  assert.equal(checks.find((c) => c.label.startsWith("Hand hygiene"))!.state, "no_data");
});
