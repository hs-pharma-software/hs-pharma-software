/** Theatre and anaesthesia records (MSDS COP-4, COP-5): each belongs to one
 * surgery of the admission, signing follows the order of care, the safety
 * checklist is answered by the team, and anaesthesia / recovery monitoring
 * is kept apart from ward vitals. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { admitFromVisit, saveSurgeryType, cancelSurgery } from "@/lib/repo/hospitalCare";
import { saveForm, finalizeForm, surgeryForms, episodeForms, saveChecklist, listChecklistEntries, recordVitals, listVitals } from "@/lib/repo/medicalRecord";
import { SURGICAL_SAFETY_CHECKLIST } from "@/config/forms/checklists";
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
  const surgeon = await saveHospitalStaff(null, { name: "Dr Hamid", staff_category: "consultant", license_no: `P-${++n}`, consultation_fee: 0, department: "Surgery", basic_pay: 0 });
  const anaesthetist = await saveHospitalStaff(null, { name: "Dr Lubna", staff_category: "consultant", license_no: `P-${++n}`, consultation_fee: 0, department: "Anaesthesia", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Rukhsana", staff_category: "nurse", license_no: `N-${++n}`, department: "Surgery", basic_pay: 0 });
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const hernia = await saveSurgeryType(null, { name: "Inguinal hernia repair", rate: 50000, department: "Surgery" });
  const { episode: visit } = await bookOpdVisit({ patientId: patient.id, doctorId: surgeon.id });
  const { admission, booking } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Hernia", plan: "surgery", surgeryTypeId: hernia.id, department: "Surgery" });
  return { surgeon, anaesthetist, nurse, patient, admission, booking: booking!, hernia };
}
const PRE_ANAES = { history: "Fit", allergies: "None known", fasting_since: "2026-10-25T00:00:00.000Z", airway: "Class I", asa: "ASA I", emergency: "No", investigations: "CBC, RFT normal", anaesthesia_type: "Spinal", plan: "Bupivacaine 0.5% heavy", blood_arranged: "No" };
const OP_NOTE = { started_at: "2026-10-25T09:00:00.000Z", ended_at: "2026-10-25T10:00:00.000Z", surgeon: "Dr Hamid", assistants: "Dr Ali", anaesthetist: "Dr Lubna", anaesthesia_type: "Spinal", procedure_performed: "Lichtenstein repair, right", findings: "Indirect sac", specimens: "None", blood_loss_ml: "50", events: "None", condition_at_end: "Stable" };
const POST_OP = { monitoring: "BP, pulse, SpO2, wound", monitoring_frequency: "Hourly", medication: "Analgesia as charted", wound_care: "Keep dry", drains: "None", positioning: "None", nutrition: "Oral after 6 h", fluid_chart: "No" };

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

test("theatre forms belong to one surgery on this admission, one of each per surgery, kept out of the admission's general list", async () => {
  const s = await setup();
  await as(s.surgeon);
  await assert.rejects(saveForm({ formKey: "pre_op_assessment", patientId: s.patient.id, episodeId: s.admission.id, data: {} }), /Open this record from the surgery/);
  await assert.rejects(saveForm({ formKey: "pre_op_assessment", patientId: s.patient.id, episodeId: s.admission.id, data: {}, subjectId: "nope" }), /not on this admission/);
  const pre = await saveForm({ formKey: "pre_op_assessment", patientId: s.patient.id, episodeId: s.admission.id, subjectId: s.booking.id, data: { history: "Swelling 6 months" } });
  assert.equal(pre.subject_id, s.booking.id);
  await assert.rejects(saveForm({ formKey: "pre_op_assessment", patientId: s.patient.id, episodeId: s.admission.id, subjectId: s.booking.id, data: {} }), /This surgery already has its Pre-operative Assessment/);

  const listed = await surgeryForms(s.booking.id);
  assert.deepEqual(listed.map((x) => x.def.key), ["pre_op_assessment", "surgical_consent", "pre_anaesthesia", "anaesthesia_consent", "pre_induction", "operative_note", "post_op_plan", "recovery_discharge", "anaesthesia_event"]);
  assert.equal(listed[0].records.length, 1);
  assert.ok(!(await episodeForms(s.admission.id)).some((x) => x.def.subject), "theatre forms are shown with their surgery");

  // A second operation on the same admission gets its own records.
  asOwner();
  const other = await saveSurgeryType(null, { name: "Excision of lipoma", rate: 15000 });
  const { surgeryBookingsRepo } = await import("@/lib/repo/hospitalCare");
  const second = await surgeryBookingsRepo.create({ episode_id: s.admission.id, patient_id: s.patient.id, service_id: other.id, surgery_name: other.name, fee: 0, charge_id: null, surgeon_id: s.surgeon.id, planned_date: null, status: "planned", notes: null, performed_at: null });
  await as(s.surgeon);
  const pre2 = await saveForm({ formKey: "pre_op_assessment", patientId: s.patient.id, episodeId: s.admission.id, subjectId: second.id, data: { history: "Lump back" } });
  assert.notEqual(pre2.id, pre.id);
  asOwner();
  await cancelSurgery(second.id, "Deferred");
  await as(s.surgeon);
  await assert.rejects(saveForm({ formKey: "operative_note", patientId: s.patient.id, episodeId: s.admission.id, subjectId: second.id, data: OP_NOTE }), /was cancelled/);
});

test("signing follows the order of care: re-evaluation after the pre-anaesthesia plan; leaving recovery after the operative note and post-op plan", async () => {
  const s = await setup();
  const ids = { patientId: s.patient.id, episodeId: s.admission.id, subjectId: s.booking.id };
  await as(s.anaesthetist);
  const reeval = await saveForm({ formKey: "pre_induction", ...ids, data: { bp: "120/80", pulse: "76", spo2: "98", resp_rate: "14", condition_changed: "No", plan_changed: "No" } });
  await assert.rejects(finalizeForm(reeval.id), /Sign the Pre-anaesthesia Assessment and Anaesthesia Plan first/);
  await finalizeForm((await saveForm({ formKey: "pre_anaesthesia", ...ids, data: PRE_ANAES })).id);
  assert.equal((await finalizeForm(reeval.id)).status, "final");

  await as(s.nurse);
  const rec = await saveForm({ formKey: "recovery_discharge", ...ids, data: { aldrete: "9", criteria_met: "Yes", discharged_at: "2026-10-25T11:00:00.000Z", transferred_to: "Ward", handover_to: "Rukhsana" } });
  await assert.rejects(finalizeForm(rec.id), /Your designation cannot sign/, "a nurse prepares it, a doctor signs it");
  // The nurse prepared it; the doctor signs it, once the operative note and post-op plan are signed.
  await as(s.surgeon);
  await assert.rejects(finalizeForm(rec.id), /Sign the Operative Note first/);
  await finalizeForm((await saveForm({ formKey: "operative_note", ...ids, data: OP_NOTE })).id);
  await assert.rejects(finalizeForm(rec.id), /Sign the Post-operative Plan of Care first/);
  await finalizeForm((await saveForm({ formKey: "post_op_plan", ...ids, data: POST_OP })).id);
  assert.equal((await finalizeForm(rec.id)).status, "final");
});

test("surgical safety checklist: answered for its surgery, by the team, with reasons; time-out steps can't be skipped silently", async () => {
  const s = await setup();
  await as(s.nurse);
  await assert.rejects(saveChecklist("surgical_safety", s.admission.id, []), /Open this record from the surgery/);
  const answers = SURGICAL_SAFETY_CHECKLIST.items.map((i) => ({ item: i.key, status: "completed" as const }));
  await assert.rejects(saveChecklist("surgical_safety", s.admission.id, answers.map((a) => (a.item === "timeout_patient" ? { ...a, status: "not_completed" as const } : a)), s.booking.id), /reason it was not done: All team members agree: correct patient/);
  const saved = await saveChecklist("surgical_safety", s.admission.id, answers.map((a) => (a.item === "site_marked" ? { item: a.item, status: "na" as const } : a)), s.booking.id);
  assert.equal(saved.length, SURGICAL_SAFETY_CHECKLIST.items.length);
  assert.ok(saved.every((e) => e.subject_id === s.booking.id && e.user_name === "Rukhsana, Nurse"));
  assert.equal((await listChecklistEntries(s.admission.id, s.booking.id)).length, saved.length);
});

test("anaesthesia and recovery monitoring belong to the surgery and record rhythm and airway; ward charts are separate", async () => {
  const s = await setup();
  await as(s.anaesthetist);
  await assert.rejects(recordVitals(s.admission.id, { pulse: 80, phase: "intra_op" }), /Open this record from the surgery/);
  await recordVitals(s.admission.id, { phase: "intra_op", subjectId: s.booking.id, pulse: 82, bp_systolic: 110, bp_diastolic: 70, resp_rate: 14, spo2: 99, rhythm: "Sinus", airway: "Patent, LMA" });
  await recordVitals(s.admission.id, { phase: "recovery", subjectId: s.booking.id, pulse: 78, consciousness: "Alert", pain_score: 3, airway: "Patent" });
  await recordVitals(s.admission.id, { pulse: 76 });
  const intra = await listVitals(s.admission.id, { phase: "intra_op", subjectId: s.booking.id });
  assert.deepEqual(intra.map((v) => [v.rhythm, v.airway, v.spo2]), [["Sinus", "Patent, LMA", 99]]);
  assert.equal((await listVitals(s.admission.id, { phase: "recovery", subjectId: s.booking.id }))[0].pain_score, 3);
  assert.deepEqual((await listVitals(s.admission.id)).map((v) => v.pulse), [76], "the ward chart shows ward readings only");
});
