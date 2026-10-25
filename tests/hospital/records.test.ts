/** Medical records (MSDS IMS): completeness of each discharged admission from
 * its signed forms, and the release-of-information register (authority,
 * identity, approval, then release). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, hospitalEpisodesRepo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { admitFromVisit } from "@/lib/repo/hospitalCare";
import { addMedicationOrder } from "@/lib/repo/medication";
import { formRecordsRepo } from "@/lib/repo/medicalRecord";
import { recordCompleteness, requestRelease, decideRelease, recordRelease, listReleases } from "@/lib/repo/records";
import { designation } from "@/config/hospitalStaff";
import { localDate } from "@/lib/localDate";
import type { Staff } from "@/lib/types";
import type { FormRecord } from "@/lib/types-hospital";

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

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function admitted(name: string, doctor: Staff) {
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name, gender: "Male" });
  const { episode: visit } = await bookOpdVisit({ patientId: patient.id, doctorId: doctor.id });
  const { admission } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Observation", plan: "ipd", department: "Medicine" });
  return { patient, admission };
}
const sign = (patientId: string, episodeId: string, formKey: string, status: FormRecord["status"] = "final") =>
  formRecordsRepo.create({ form_key: formKey, form_version: 1, scope: "patient", patient_id: patientId, episode_id: episodeId, status, data: "{}", revision_no: 1 } as Partial<FormRecord>);
const discharge = (id: string) => hospitalEpisodesRepo.update(id, { status: "discharged", discharge_date: today });

test("completeness: each discharged admission is checked against its signed forms; drafts and open verbal orders count as missing", async () => {
  const doctor = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: lic(), consultation_fee: 0, department: "Medicine", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Rukhsana", staff_category: "nurse", license_no: lic(), department: "Medicine", basic_pay: 0 });
  const a = await admitted("Complete Record", doctor);
  for (const k of ["general_consent", "admission_note", "nursing_assessment", "discharge_summary"]) await sign(a.patient.id, a.admission.id, k);
  const b = await admitted("Gaps Record", doctor);
  await sign(b.patient.id, b.admission.id, "general_consent");
  await sign(b.patient.id, b.admission.id, "discharge_summary", "draft");
  await as(nurse);
  await addMedicationOrder(b.admission.id, { product_name: "Paracetamol 1 g", dose: "1 g", route: "IV", frequency: "SOS", duration: "1 day", source: "telephone", prescriberId: doctor.id });
  asOwner();
  const open = await admitted("Still Admitted", doctor);
  await discharge(a.admission.id);
  await discharge(b.admission.id);

  const c = await recordCompleteness({ from: today, to: today });
  assert.equal(c.rows.length, 2, "only discharged admissions are audited");
  assert.ok(!c.rows.some((r) => r.episode_id === open.admission.id));
  assert.deepEqual(c.rows.find((r) => r.patient_name === "Complete Record")!.missing, []);
  assert.deepEqual(c.rows.find((r) => r.patient_name === "Gaps Record")!.missing, [
    "Admission note", "Nursing assessment", "Discharge summary / transfer / LAMA / death record", "Verbal / telephone orders countersigned",
  ], "an unsigned draft does not count");
  assert.equal(c.completePct, 50);
  assert.equal(c.byItem.find((i) => i.key === "general_consent")!.pct, 100);
  assert.equal(c.byItem.find((i) => i.key === "surgery")!.applicable, 0);
});

test("release of information: authority and ID required, decided by the records officer or HoD, released after an ID check", async () => {
  const doctor = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: lic(), consultation_fee: 0, basic_pay: 0 });
  const mro = await saveHospitalStaff(null, { name: "Tariq", staff_category: "medical_records_officer", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Rukhsana", staff_category: "nurse", license_no: lic(), basic_pay: 0 });
  const a = await admitted("Zahid Iqbal", doctor);
  const base = { patientId: a.patient.id, episodeId: a.admission.id, purpose: "Insurance claim", recordsRequested: "Discharge summary, bills" };

  await as(nurse);
  await assert.rejects(requestRelease({ ...base, requesterName: "Zahid", requesterType: "Patient", authority: "patient", requesterIdNo: "35202-1" }), /Medical Records Officer/);
  await as(mro);
  await assert.rejects(requestRelease({ ...base, requesterName: "EFU Insurance", requesterType: "Insurance / employer", authority: "patient", requesterIdNo: "X" }), /Only the patient/);
  await assert.rejects(requestRelease({ ...base, requesterName: "EFU Insurance", requesterType: "Insurance / employer", authority: "patient_consent", requesterIdNo: "X" }), /signed consent is kept/);
  await assert.rejects(requestRelease({ ...base, requesterName: "Zahid", requesterType: "Patient", authority: "patient" }), /CNIC/);
  const r = await requestRelease({ ...base, requesterName: "EFU Insurance (A. Khan)", requesterType: "Insurance / employer", authority: "patient_consent", authorityRef: "Consent in file, page 14", requesterIdNo: "EMP-7781" });
  assert.match(r.release_no, /^ROI-\d{2}-0001$/);
  await assert.rejects(recordRelease(r.id, { recordsReleased: "Discharge summary", copies: 1, idChecked: true }), /not been approved/);

  await as(nurse);
  await assert.rejects(decideRelease(r.id, true, ""), /Records Officer or an HoD/);
  await as(doctor);
  await assert.rejects(decideRelease(r.id, true, ""), /Records Officer or an HoD/, "a consultant is not an approver");
  await as(mro);
  await assert.rejects(decideRelease(r.id, false, ""), /reason for refusing/);
  await decideRelease(r.id, true, "Consent verified");
  await assert.rejects(recordRelease(r.id, { recordsReleased: "Discharge summary", copies: 1, idChecked: false }), /identity/);
  await recordRelease(r.id, { recordsReleased: "Discharge summary, final bill", copies: 1, idChecked: true });
  const [row] = await listReleases({ patientId: a.patient.id });
  assert.equal(row.status, "released");
  assert.equal(row.patient_name, "Zahid Iqbal");
  assert.equal((await listReleases({ status: "open" })).length, 0);
});
