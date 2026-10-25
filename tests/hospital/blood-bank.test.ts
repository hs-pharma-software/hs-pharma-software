/** Blood bank (MSDS COP-2 Ind. 21-25, CQI-2 Ind. 104): donor screening,
 * quarantine until every infection screen is non-reactive, ABO/Rh-checked
 * compatibility, no expired issue, consent and a two-person bedside check
 * before transfusion, reactions reported, and the indicators. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { admitFromVisit } from "@/lib/repo/hospitalCare";
import { saveForm, finalizeForm } from "@/lib/repo/medicalRecord";
import {
  saveDonor, recordDonation, createUnit, recordUnitTesting, releaseUnit, discardUnit, availableUnits,
  requestBlood, recordPatientGroup, recordCrossmatch, issueUnit, returnUnit, startTransfusion, finishTransfusion,
  recordReaction, analyseReaction, reportReactionToAuthority, bloodIndicators, bbUnitsRepo, bbRequestsRepo, episodeTransfusions, listOpenRequests,
} from "@/lib/repo/bloodBank";
import { aboRhCompatible } from "@/config/bloodBank";
import { designation } from "@/config/hospitalStaff";
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
const inDays = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const ALL_CLEAR = { tti_hbv: "nonreactive", tti_hcv: "nonreactive", tti_hiv: "nonreactive", tti_syphilis: "nonreactive", tti_malaria: "nonreactive" } as const;

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function setup() {
  const bbt = await saveHospitalStaff(null, { name: "Kamran", staff_category: "blood_bank_technologist", basic_pay: 0 });
  const doctor = await saveHospitalStaff(null, { name: "Dr Hamid", staff_category: "consultant", license_no: lic(), consultation_fee: 0, department: "Surgery", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Rukhsana", staff_category: "nurse", license_no: lic(), department: "Surgery", basic_pay: 0 });
  const nurse2 = await saveHospitalStaff(null, { name: "Nasreen", staff_category: "nurse", license_no: lic(), department: "Surgery", basic_pay: 0 });
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const { episode: visit } = await bookOpdVisit({ patientId: patient.id, doctorId: doctor.id });
  const { admission } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "GI bleed", plan: "ipd", department: "Surgery" });
  return { bbt, doctor, nurse, nurse2, patient, visit, admission };
}
type S = Awaited<ReturnType<typeof setup>>;

/** A received unit, tested and released. */
async function stockUnit(s: S, component: string, abo: string, rh: string, expiresOn = inDays(30)) {
  await as(s.bbt);
  const u = await createUnit({ source: "received", supplierName: "Regional Blood Centre", supplierLicence: "PBTA-123", supplierUnitNo: `RBC-${++n}`, component, collectedOn: inDays(-2), expiresOn });
  await recordUnitTesting(u.id, { abo, rh, ...ALL_CLEAR });
  return releaseUnit(u.id);
}

async function consent(s: S) {
  await as(s.doctor);
  const f = await saveForm({ formKey: "transfusion_consent", patientId: s.patient.id, episodeId: s.admission.id, data: {
    component: "Packed red cells", reason: "Hb 6.1 with ongoing bleed", risks: "Reactions, infection, overload", alternatives: "Iron, wait",
    language: "Urdu", emergency_no_family: "No", consent_by: "Zahid Iqbal", relationship: "Self", signed_on_paper: "Yes",
  } });
  await finalizeForm(f.id);
}

test("ABO/Rh compatibility rules", () => {
  const rc = (u: string, ur: string, p: string, pr: string) => aboRhCompatible("Packed red cells", { abo: u, rh: ur }, { abo: p, rh: pr }).ok;
  assert.equal(rc("O", "Negative", "AB", "Positive"), true);
  assert.equal(rc("A", "Positive", "O", "Positive"), false);
  assert.equal(rc("B", "Positive", "AB", "Positive"), true);
  assert.equal(rc("O", "Positive", "O", "Negative"), false, "Rh-negative patient needs Rh-negative red cells");
  const ffp = (u: string, p: string) => aboRhCompatible("Fresh frozen plasma", { abo: u, rh: "Positive" }, { abo: p, rh: "Positive" }).ok;
  assert.equal(ffp("AB", "O"), true);
  assert.equal(ffp("O", "A"), false);
});

test("donor screening: deferral needs a reason, eligible donation makes a quarantined unit", async () => {
  const s = await setup();
  await as(s.nurse);
  await assert.rejects(saveDonor(null, { name: "Ali" }), /Only blood bank staff/);
  await as(s.bbt);
  const donor = await saveDonor(null, { name: "Ali Raza", cnic: "35202-1234567-1", abo: "B", rh: "Positive" });
  assert.match(donor.donor_no, /^DN-\d{6}-001$/);
  await assert.rejects(saveDonor(null, { name: "Other", cnic: "35202-1234567-1" }), /already registered/);
  const low = { donationType: "Replacement" as const, hb: 11, weightKg: 70, bp: "120/80", questionnaireOk: true, consentSigned: true };
  await assert.rejects(recordDonation(donor.id, low), /deferral reason/);
  await assert.rejects(recordDonation(donor.id, { ...low, deferralReason: "Low Hb", collect: { component: "Whole blood", volumeMl: 450, expiresOn: inDays(35) } }), /deferred donor/);
  const deferred = await recordDonation(donor.id, { ...low, deferralReason: "Hb 11 g/dL" });
  assert.equal(deferred.donation.eligible, 0);
  assert.equal(deferred.unit, null);
  const ok = { ...low, hb: 14 };
  await assert.rejects(recordDonation(donor.id, { ...ok, consentSigned: false, collect: { component: "Whole blood", volumeMl: 450, expiresOn: inDays(35) } }), /signed consent/);
  const given = await recordDonation(donor.id, { ...ok, collect: { component: "Whole blood", volumeMl: 450, expiresOn: inDays(35) } });
  assert.equal(given.unit!.status, "quarantine");
  assert.equal(given.unit!.abo, "B");
  assert.equal(given.donation.unit_id, given.unit!.id);
});

test("release: every screen recorded and non-reactive; reactive unit only discarded", async () => {
  const s = await setup();
  await as(s.bbt);
  await assert.rejects(createUnit({ source: "received", supplierName: "RBC", component: "Platelets", collectedOn: today, expiresOn: inDays(5) }), /licence/);
  const u = await createUnit({ source: "received", supplierName: "RBC", supplierLicence: "PBTA-1", supplierUnitNo: "X1", component: "Packed red cells", collectedOn: today, expiresOn: inDays(30) });
  await assert.rejects(releaseUnit(u.id), /not grouped|Screening not recorded/);
  await recordUnitTesting(u.id, { abo: "A", rh: "Positive", tti_hbv: "nonreactive", tti_hcv: "nonreactive" });
  await assert.rejects(releaseUnit(u.id), /Screening not recorded: HIV 1\/2, Syphilis, Malaria/);
  await recordUnitTesting(u.id, { abo: "A", rh: "Positive", tti_hiv: "nonreactive", tti_syphilis: "reactive", tti_malaria: "nonreactive" });
  await assert.rejects(releaseUnit(u.id), /reactive for Syphilis.*discarded/);
  await assert.rejects(discardUnit(u.id, " "), /reason/);
  const d = await discardUnit(u.id, "Syphilis reactive");
  assert.equal(d.status, "discarded");
  await assert.rejects(discardUnit(u.id, "again"), /already discarded/);
  const good = await stockUnit(s, "Packed red cells", "O", "Negative");
  assert.equal(good.status, "available");
  assert.deepEqual((await availableUnits("Packed red cells")).map((x) => x.id), [good.id]);
});

test("request, crossmatch with ABO/Rh check, issue, bedside check with consent, finish, reaction, indicators", async () => {
  const s = await setup();
  const aPos = await stockUnit(s, "Packed red cells", "A", "Positive");
  const bPos = await stockUnit(s, "Packed red cells", "B", "Positive");
  const expiring = await stockUnit(s, "Packed red cells", "A", "Positive", inDays(1));

  await as(s.nurse);
  await assert.rejects(requestBlood(s.admission.id, { component: "Packed red cells", units: 1, urgency: "Urgent", indication: "Hb 6" }), /A doctor requests/);
  await as(s.doctor);
  await assert.rejects(requestBlood(s.visit.id, { component: "Packed red cells", units: 1, urgency: "Urgent", indication: "Hb 6" }), /admitted or emergency/);
  await assert.rejects(requestBlood(s.admission.id, { component: "Packed red cells", units: 1, urgency: "Urgent", indication: " " }), /indication/);
  const req = await requestBlood(s.admission.id, { component: "Packed red cells", units: 1, urgency: "Urgent", indication: "Hb 6.1 with bleed" });
  assert.equal((await listOpenRequests()).length, 1);

  await as(s.bbt);
  await assert.rejects(recordCrossmatch(req.id, aPos.id, "compatible"), /Group the patient's sample/);
  await recordPatientGroup(req.id, "A", "Positive");
  await assert.rejects(recordCrossmatch(req.id, bPos.id, "compatible"), /Group B red cells are not compatible with a group A patient/);
  await recordCrossmatch(req.id, bPos.id, "incompatible");
  assert.equal((await bbUnitsRepo.get(bPos.id))!.status, "available", "an incompatible test does not reserve");
  await assert.rejects(issueUnit(req.id, aPos.id, { receivedBy: "Ward boy Akram" }), /compatible test/);
  await recordCrossmatch(req.id, aPos.id, "compatible");
  assert.equal((await bbUnitsRepo.get(aPos.id))!.status, "reserved");
  await assert.rejects(issueUnit(req.id, aPos.id, { receivedBy: " " }), /who collected/);
  const issue = await issueUnit(req.id, aPos.id, { receivedBy: "Ward boy Akram" });
  assert.equal((await bbUnitsRepo.get(aPos.id))!.status, "issued");
  assert.equal((await bbRequestsRepo.get(req.id))!.status, "fulfilled");
  void expiring;

  // Bedside: consent first, then two different clinical staff.
  await as(s.nurse);
  const check = { checkBy1: s.nurse.id, checkBy2: s.nurse2.id, vitalsPre: "BP 100/60, P 110, T 37.0" };
  await assert.rejects(startTransfusion(issue.id, check), /Consent for Blood Transfusion/);
  await consent(s);
  await as(s.nurse);
  await assert.rejects(startTransfusion(issue.id, { ...check, checkBy2: s.nurse.id }), /Two different staff/);
  await assert.rejects(startTransfusion(issue.id, { ...check, checkBy2: s.bbt.id }), /nurses or doctors/);
  const started = await startTransfusion(issue.id, check);
  assert.match(started.check_by_1!, /Rukhsana/);
  await as(s.bbt);
  await assert.rejects(returnUnit(issue.id, "Not needed", true), /started/);
  await as(s.nurse);
  const r = await recordReaction(issue.id, { reactionType: "Acute haemolytic", severity: "Severe", symptoms: "Fever, back pain, hypotension", actions: "Stopped, saline, informed doctor and blood bank" });
  await finishTransfusion(issue.id, { vitals15: "BP 90/50", vitalsEnd: "BP 100/60", volumeMl: 80, outcome: "Stopped (reaction)" });
  assert.equal((await bbUnitsRepo.get(aPos.id))!.status, "transfused");
  await assert.rejects(finishTransfusion(issue.id, { vitals15: "x", vitalsEnd: "y", volumeMl: 1, outcome: "Completed" }), /already finished/);

  await as(s.bbt);
  let ind = await bloodIndicators({ from: today, to: today });
  assert.equal(ind.seriousNotReported, 1);
  await analyseReaction(r.id, { investigation: "DAT positive, clerical error at sampling", analysis: "Sample labelled away from bedside; retrain, two-sample rule", outcome: "Recovered" });
  await assert.rejects(reportReactionToAuthority(r.id, "x", "ref"), /date reported/);
  await reportReactionToAuthority(r.id, today, "PBTA/HV/2026/14");
  ind = await bloodIndicators({ from: today, to: today });
  assert.deepEqual([ind.transfused, ind.reactions, ind.reactionRate, ind.seriousNotReported], [1, 1, 100, 0]);
  assert.deepEqual(ind.byComponent, [{ component: "Packed red cells", transfused: 1, share: 100 }]);
  assert.equal(typeof ind.issueTatMedian, "number");

  const rec = await episodeTransfusions(s.admission.id);
  assert.equal(rec.issues[0].unit_no, aPos.unit_no);
  assert.equal(rec.reactions.length, 1);
});

test("expired units are never issued; emergency release is O-negative on a named doctor's authority; returns", async () => {
  const s = await setup();
  const oNeg = await stockUnit(s, "Packed red cells", "O", "Negative");
  const aPos = await stockUnit(s, "Packed red cells", "A", "Positive");
  const old = await stockUnit(s, "Packed red cells", "O", "Negative", inDays(1));
  await as(s.doctor);
  const urgent = await requestBlood(s.admission.id, { component: "Packed red cells", units: 2, urgency: "Urgent", indication: "Bleed" });
  await as(s.bbt);
  await assert.rejects(issueUnit(urgent.id, oNeg.id, { receivedBy: "Akram", emergencyAuthorizedBy: "Dr Hamid" }), /emergency request/);

  await as(s.doctor);
  const em = await requestBlood(s.admission.id, { component: "Packed red cells", units: 2, urgency: "Emergency", indication: "Haemorrhagic shock" });
  await as(s.bbt);
  await assert.rejects(issueUnit(em.id, aPos.id, { receivedBy: "Akram", emergencyAuthorizedBy: "Dr Hamid" }), /group O Rh-negative/);
  await assert.rejects(issueUnit(em.id, oNeg.id, { receivedBy: "Akram" }), /authorizing doctor/);
  const issued = await issueUnit(em.id, oNeg.id, { receivedBy: "Akram", emergencyAuthorizedBy: "Dr Hamid" });
  assert.equal(issued.emergency_release, 1);
  assert.equal((await bbRequestsRepo.get(em.id))!.status, "open", "one of two units issued");

  // Expired stock: simulate the date passing.
  await bbUnitsRepo.update(old.id, { expires_on: inDays(-1) });
  await assert.rejects(issueUnit(em.id, old.id, { receivedBy: "Akram", emergencyAuthorizedBy: "Dr Hamid" }), /expired/);
  assert.ok(!(await availableUnits("Packed red cells")).some((u) => u.id === old.id));

  // Return: one back to stock, the same unit can then be discarded.
  const back = await returnUnit(issued.id, "Patient stabilised", true);
  assert.ok(back.returned_at);
  assert.equal((await bbUnitsRepo.get(oNeg.id))!.status, "available");
  await assert.rejects(returnUnit(issued.id, "again", true), /Already returned/);
  await discardUnit(old.id, "Expired");
  const ind = await bloodIndicators({ from: today, to: today });
  assert.deepEqual([ind.transfused, ind.discarded, ind.wastageRate], [0, 1, 100]);
});
