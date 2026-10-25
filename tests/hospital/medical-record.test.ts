/** The PHC MSDS medical record foundation: forms tied to the right patient
 * and admission, finalizing, audited corrections, checklists that are never
 * filled in for the user, and vital signs. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalEpisodesRepo, hospitalPatientsRepo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { admitFromVisit } from "@/lib/repo/hospitalCare";
import {
  saveForm, finalizeForm, amendForm, voidForm, listForms, listRevisions, episodeForms,
  saveChecklist, correctChecklistEntry, listChecklistEntries, checklistContext, recordVitals, listVitals,
} from "@/lib/repo/medicalRecord";
import { FORMS, validateForm, formDef } from "@/config/forms";
import { DOCTOR_VISIT_CHECKLIST, applicableItems, validateChecklist } from "@/config/forms/checklists";
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
async function setup() {
  const consultant = await saveHospitalStaff(null, { name: "Dr Saima Rauf", staff_category: "consultant", license_no: `PMDC-${++n}`, consultation_fee: 0, department: "Medicine", basic_pay: 0 });
  const mo = await saveHospitalStaff(null, { name: "Dr Usman", staff_category: "medical_officer", license_no: `PMDC-${++n}`, consultation_fee: 0, department: "Medicine", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Nusrat", staff_category: "nurse", license_no: `PNC-${++n}`, department: "Medicine", basic_pay: 0 });
  const receptionist = await saveHospitalStaff(null, { name: "Rabia", staff_category: "receptionist", basic_pay: 0 });
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ghulam Abbas", gender: "Male" });
  return { consultant, mo, nurse, receptionist, patient };
}
async function admit(patientId: string, doctorId: string) {
  const { episode: visit } = await bookOpdVisit({ patientId, doctorId });
  const { admission } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Pneumonia", plan: "ipd", department: "Medicine" });
  return { visit, admission };
}
const ADMISSION_NOTE = { reason_for_admission: "Fever, breathlessness", history: "5 days", allergies: "None known", examination: "Crackles right base", provisional_diagnosis: "Community-acquired pneumonia", care_plan: "IV antibiotics, oxygen", desired_outcome: "Afebrile, SpO2 > 94% on air" };

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

test("every form definition is well formed and cites the MSDS", () => {
  const keys = new Set<string>();
  for (const f of FORMS) {
    assert.ok(!keys.has(f.key), `unique key ${f.key}`);
    keys.add(f.key);
    assert.ok(f.msds.length > 0 && f.msds.every((m) => /^(AAC|COP|MOM|PRE|IPC|CQI|ROM|FMS|HRM|IMS)-\d · \d+[a-z]?$/.test(m)), `${f.key} cites MSDS indicators`);
    const fk = new Set(f.fields.map((x) => x.key));
    assert.equal(fk.size, f.fields.length, `${f.key}: field keys unique`);
    for (const x of f.fields) {
      if (x.showIf) assert.ok(fk.has(x.showIf.field), `${f.key}.${x.key} depends on a real field`);
      if (x.type === "select") assert.ok(x.options?.length, `${f.key}.${x.key} has options`);
    }
  }
  // Conditional fields: the substitute's reason is required only when the patient cannot decide.
  const consent = formDef("informed_consent")!;
  const base = { procedure: "Chest drain", procedure_type: "Invasive / diagnostic procedure", performed_by: "Dr S", risks: "Bleeding", benefits: "Lung re-expansion", alternatives: "Aspiration", language: "Urdu", consent_by: "Ghulam Abbas", relationship: "Self", questions_answered: "Yes", signed_on_paper: "Yes" };
  assert.deepEqual(validateForm(consent, { ...base, patient_capable: "Yes" }), []);
  assert.deepEqual(validateForm(consent, { ...base, patient_capable: "No" }), ["Why the patient cannot consent is required."]);
});

test("admission forms belong to that admission; one admission note per admission; countersigned by a senior doctor", async () => {
  const s = await setup();
  const { visit, admission } = await admit(s.patient.id, s.consultant.id);

  const opdForms = (await episodeForms(visit.id)).map((x) => x.def.key);
  assert.ok(!opdForms.includes("admission_note") && !opdForms.includes("discharge_summary"), "inpatient forms are not offered on an OPD visit");
  const ipdForms = (await episodeForms(admission.id)).map((x) => x.def.key);
  for (const k of ["general_consent", "admission_note", "nursing_assessment", "progress_note", "discharge_summary"]) assert.ok(ipdForms.includes(k), k);
  await assert.rejects(saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: visit.id, data: ADMISSION_NOTE }), /not used for OPD visits/);

  // The MO writes the note; it cannot be signed until complete, and only a senior doctor countersigns.
  await as(s.mo);
  const draft = await saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: admission.id, data: { reason_for_admission: "Fever" } });
  assert.equal(draft.status, "draft");
  assert.equal(draft.created_by_name, "Dr Usman, Medical Officer");
  await assert.rejects(saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: admission.id, data: ADMISSION_NOTE }), /already has its Admission Note/);
  await saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: admission.id, data: ADMISSION_NOTE, recordId: draft.id });
  await assert.rejects(finalizeForm(draft.id), /countersigned by the responsible consultant/);
  await as(s.consultant);
  await assert.rejects(saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: admission.id, data: ADMISSION_NOTE, recordId: draft.id }), /Only the author can edit this draft/);
  const signed = await finalizeForm(draft.id);
  assert.deepEqual([signed.status, signed.finalized_by_name, signed.revision_no], ["final", "Dr Saima Rauf, Consultant", 1]);
  assert.ok(signed.finalized_at);
  await assert.rejects(saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: admission.id, data: ADMISSION_NOTE, recordId: draft.id }), /finalized. Use Correct/);

  // Another patient's admission cannot receive this patient's form.
  const other = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Other", gender: "Female" });
  await assert.rejects(saveForm({ formKey: "progress_note", patientId: other.id, episodeId: admission.id, data: { note: "x" } }), /not this patient's/);
});

test("a finalized form is corrected only with a reason, and the earlier values are kept; voiding allows a fresh one", async () => {
  const s = await setup();
  const { admission } = await admit(s.patient.id, s.consultant.id);
  await as(s.consultant);
  const rec = await saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: admission.id, data: ADMISSION_NOTE });
  await finalizeForm(rec.id);
  await assert.rejects(amendForm(rec.id, { ...ADMISSION_NOTE, final_diagnosis: "Lobar pneumonia" }, " "), /reason for the correction/);
  await assert.rejects(amendForm(rec.id, ADMISSION_NOTE, "no change"), /Nothing was changed/);
  await assert.rejects(amendForm(rec.id, { ...ADMISSION_NOTE, care_plan: "" }, "x"), /Plan of care is required/);
  const amended = await amendForm(rec.id, { ...ADMISSION_NOTE, final_diagnosis: "Lobar pneumonia" }, "Chest X-ray reported");
  assert.equal(amended.status, "amended");
  assert.equal(JSON.parse(amended.data).final_diagnosis, "Lobar pneumonia");
  const history = await listRevisions(rec.id);
  assert.deepEqual(history.map((h) => [h.revision_no, h.action, h.reason]), [[1, "finalize", null], [2, "amend", "Chest X-ray reported"]]);
  assert.equal(JSON.parse(history[1].data_before!).final_diagnosis, undefined, "the value before the correction is kept");

  await as(s.nurse);
  await assert.rejects(amendForm(rec.id, { ...ADMISSION_NOTE, final_diagnosis: "x" }, "y"), /Only the author or a person who can sign/);
  await assert.rejects(voidForm(rec.id, "x"), /cannot void/);
  await as(s.consultant);
  await voidForm(rec.id, "Entered on the wrong admission");
  assert.equal((await listForms({ episodeId: admission.id })).length, 0, "void records are hidden by default");
  assert.equal((await listForms({ episodeId: admission.id, includeVoided: true }))[0].status, "voided", "but kept");
  const again = await saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: admission.id, data: ADMISSION_NOTE });
  assert.equal(again.status, "draft", "a voided single-instance form can be filled again");
});

test("progress notes are final when saved, dated, timed and attributed; doctors and nurses write in one sequence", async () => {
  const s = await setup();
  const { admission } = await admit(s.patient.id, s.consultant.id);
  await as(s.consultant);
  await assert.rejects(saveForm({ formKey: "progress_note", patientId: s.patient.id, episodeId: admission.id, data: { note: "  " } }), /Note is required/);
  await saveForm({ formKey: "progress_note", patientId: s.patient.id, episodeId: admission.id, data: { note: "Day 2: afebrile", plan: "Continue antibiotics" } });
  await as(s.nurse);
  await saveForm({ formKey: "progress_note", patientId: s.patient.id, episodeId: admission.id, data: { note: "Vitals stable, ate well" } });
  const notes = await listForms({ episodeId: admission.id, formKey: "progress_note" });
  assert.deepEqual(notes.map((x) => [x.status, x.created_by_name]), [["final", "Dr Saima Rauf, Consultant"], ["final", "Nusrat, Nurse"]]);
  assert.ok(notes.every((x) => x.created_at && x.finalized_at));
  // Reception cannot write clinical notes but can take the general consent.
  await as(s.receptionist);
  await assert.rejects(saveForm({ formKey: "progress_note", patientId: s.patient.id, episodeId: admission.id, data: { note: "x" } }), /cannot write the Progress Note/);
  const consent = await saveForm({ formKey: "general_consent", patientId: s.patient.id, episodeId: admission.id, data: { need_for_admission: "Pneumonia", estimated_duration: "5 days", estimated_cost: "40000", rules_agreed: "Yes", disclosure_agreed: "Yes", data_sharing: "Yes", language: "Urdu", consent_by: "Ghulam Abbas", relationship: "Self", signed_on_paper: "Yes" } });
  assert.equal((await finalizeForm(consent.id)).status, "final");
});

test("a second admission keeps its own record; the first admission's forms are untouched", async () => {
  const s = await setup();
  const first = await admit(s.patient.id, s.consultant.id);
  await as(s.consultant);
  const note1 = await saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: first.admission.id, data: ADMISSION_NOTE });
  await finalizeForm(note1.id);
  asOwner();
  await hospitalEpisodesRepo.update(first.admission.id, { status: "discharged" });
  const second = await admit(s.patient.id, s.consultant.id);
  await as(s.consultant);
  const note2 = await saveForm({ formKey: "admission_note", patientId: s.patient.id, episodeId: second.admission.id, data: { ...ADMISSION_NOTE, reason_for_admission: "Relapse" } });
  assert.notEqual(note1.id, note2.id);
  assert.equal(JSON.parse((await listForms({ episodeId: first.admission.id }))[0].data).reason_for_admission, "Fever, breathlessness");
  assert.equal((await listForms({ patientId: s.patient.id, formKey: "admission_note" })).length, 2, "both are in the patient's record");
});

test("checklists: only the steps that apply are asked, nothing is answered for the user, a 'not done' needs a reason", async () => {
  const s = await setup();
  const { visit, admission } = await admit(s.patient.id, s.consultant.id);
  const opdCtx = await checklistContext(visit.id);
  const ipdCtx = await checklistContext(admission.id);
  assert.ok(!applicableItems(DOCTOR_VISIT_CHECKLIST, opdCtx).some((i) => i.key === "medicines_reviewed"), "medicine review is for admitted patients");
  assert.ok(applicableItems(DOCTOR_VISIT_CHECKLIST, ipdCtx).some((i) => i.key === "medicines_reviewed"));
  assert.ok(!applicableItems(DOCTOR_VISIT_CHECKLIST, ipdCtx).some((i) => i.key === "consent_before_procedure"), "no procedure planned");
  // An empty submission is refused, never saved as "done".
  assert.ok(validateChecklist(DOCTOR_VISIT_CHECKLIST, ipdCtx, []).length >= 4);

  await as(s.consultant);
  await assert.rejects(saveChecklist("doctor_visit", admission.id, []), /Answer: Patient identity/);
  await assert.rejects(saveChecklist("doctor_visit", admission.id, [
    { item: "identity_verified", status: "completed" }, { item: "hand_hygiene", status: "not_completed" },
    { item: "allergies_reviewed", status: "completed" }, { item: "medicines_reviewed", status: "pending" },
  ]), /reason it was not done: Hand hygiene/);
  const saved = await saveChecklist("doctor_visit", admission.id, [
    { item: "identity_verified", status: "completed" }, { item: "hand_hygiene", status: "not_completed", reason: "No sanitizer at bed 4" },
    { item: "ppe", status: "na" }, { item: "allergies_reviewed", status: "completed" }, { item: "medicines_reviewed", status: "pending" },
  ]);
  assert.equal(saved.length, 5);
  assert.ok(saved.every((e) => e.kind === "self_confirmation" && e.user_name === "Dr Saima Rauf, Consultant" && e.episode_id === admission.id));
  assert.equal(new Set(saved.map((e) => e.session_id)).size, 1);
  assert.equal(saved.find((e) => e.item_key === "hand_hygiene")!.status, "not_completed", "recorded exactly as answered");

  // A correction is a new entry; the first answer is kept and points to it.
  const pending = saved.find((e) => e.item_key === "medicines_reviewed")!;
  await assert.rejects(correctChecklistEntry(pending.id, "completed", " "), /reason/);
  const fixed = await correctChecklistEntry(pending.id, "completed", "Reviewed with the family");
  const all = await listChecklistEntries(admission.id);
  assert.equal(all.length, 6);
  assert.equal(all.find((e) => e.id === pending.id)!.superseded_by, fixed.id);
  await assert.rejects(correctChecklistEntry(pending.id, "completed", "again"), /already corrected/);
  await as(s.receptionist);
  await assert.rejects(saveChecklist("doctor_visit", admission.id, saved.map((e) => ({ item: e.item_key, status: e.status, reason: e.reason ?? undefined }))), /Only clinical staff/);
});

test("vital signs: limits checked, both BP values together, stored in UTC and attributed", async () => {
  const s = await setup();
  const { admission } = await admit(s.patient.id, s.consultant.id);
  await as(s.nurse);
  await assert.rejects(recordVitals(admission.id, {}), /at least one/);
  await assert.rejects(recordVitals(admission.id, { spo2: 120 }), /SpO2 must be between 40 and 100/);
  await assert.rejects(recordVitals(admission.id, { bp_systolic: 120 }), /both systolic and diastolic/);
  await assert.rejects(recordVitals(admission.id, { pulse: 80, recorded_at: "2999-01-01T10:00" }), /future/);
  const v = await recordVitals(admission.id, { bp_systolic: 118, bp_diastolic: 76, pulse: 88, temperature_c: 38.2, spo2: 95, recorded_at: "2026-10-25T08:00" });
  assert.match(v.recorded_at, /Z$/);
  assert.equal(v.recorded_by_name, "Nusrat, Nurse");
  assert.equal((await listVitals(admission.id)).length, 1);
  await as(s.receptionist);
  await assert.rejects(recordVitals(admission.id, { pulse: 80 }), /Only clinical staff/);
});
