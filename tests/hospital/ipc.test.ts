/** Infection prevention and control (MSDS IPC-1, IPC-2): hand-hygiene
 * observation audits kept apart from self-confirmations, sterilization loads
 * that cannot be shown as usable unless properly released, traceability to
 * surgeries, and the IPC registers. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { admitFromVisit, saveSurgeryType } from "@/lib/repo/hospitalCare";
import { saveChecklist, saveForm, finalizeForm, listRegister } from "@/lib/repo/medicalRecord";
import { startHhSession, addHhObservation, voidHhObservation, closeHhSession, hhCompliance, clinicianConfirmations, listHhSessions } from "@/lib/repo/handHygiene";
import {
  saveSteriliser, startCycle, recordCycleResults, releaseCycle, failCycle, recallCycle, recordBiologicalResult,
  availableSets, recordSetUsage, usageForSurgery, recallImpact, listCycleItems,
} from "@/lib/repo/cssd";
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

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function people() {
  const icn = await saveHospitalStaff(null, { name: "Samina", staff_category: "infection_control_nurse", license_no: lic(), basic_pay: 0 });
  const icn2 = await saveHospitalStaff(null, { name: "Tahira", staff_category: "infection_control_nurse", license_no: lic(), basic_pay: 0 });
  const tech = await saveHospitalStaff(null, { name: "Waqas", staff_category: "cssd_technician", basic_pay: 0 });
  const sup = await saveHospitalStaff(null, { name: "Irfan", staff_category: "cssd_supervisor", basic_pay: 0 });
  const doctor = await saveHospitalStaff(null, { name: "Dr Hamid", staff_category: "consultant", license_no: lic(), consultation_fee: 0, department: "Surgery", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Rukhsana", staff_category: "nurse", license_no: lic(), basic_pay: 0 });
  return { icn, icn2, tech, sup, doctor, nurse };
}

test("hand-hygiene audit: auditors only, observer records, compliance from observations; self-confirmations kept apart", async () => {
  const p = await people();
  await as(p.nurse);
  await assert.rejects(startHhSession({ area: "Surgical ward" }), /recorded by the Infection Control Nurse/);
  await as(p.icn);
  const s = await startHhSession({ area: "Surgical ward", department: "Surgery" });
  await addHhObservation(s.id, { profession: "Doctor", moment: 1, action: "handrub" });
  await addHhObservation(s.id, { profession: "Doctor", moment: 4, action: "missed" });
  await addHhObservation(s.id, { profession: "Nurse", moment: 2, action: "handwash" });
  const wrong = await addHhObservation(s.id, { profession: "Nurse", moment: 5, action: "missed" });
  await assert.rejects(addHhObservation(s.id, { profession: "Doctor", moment: 6, action: "handrub" }), /moment/);
  await as(p.icn2);
  await assert.rejects(addHhObservation(s.id, { profession: "Nurse", moment: 1, action: "handrub" }), /Only the observer/);
  await as(p.icn);
  await voidHhObservation(wrong.id, "Recorded for the wrong bed");
  await closeHhSession(s.id);
  await assert.rejects(addHhObservation(s.id, { profession: "Nurse", moment: 1, action: "handrub" }), /closed/);

  // A doctor's own "I performed hand hygiene" on the visit checklist is not an observation.
  const pt = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Patient", gender: "Male" });
  const { episode } = await bookOpdVisit({ patientId: pt.id, doctorId: p.doctor.id });
  await as(p.doctor);
  await saveChecklist("doctor_visit", episode.id, [
    { item: "identity_verified", status: "completed" }, { item: "hand_hygiene", status: "completed" }, { item: "allergies_reviewed", status: "completed" },
  ]);
  await as(p.icn);
  const c = await hhCompliance({ from: today, to: today });
  assert.deepEqual([c.overall.opportunities, c.overall.performed, c.overall.rate], [3, 2, 66.7], "only observed opportunities; the voided one is out");
  assert.deepEqual(c.byProfession.map((x) => [x.profession, x.rate]).sort(), [["Doctor", 50], ["Nurse", 100]]);
  assert.deepEqual(await clinicianConfirmations({ from: today, to: today }), { completed: 1, notCompleted: 0, other: 0 }, "self-confirmations are counted on their own");
  assert.deepEqual((await listHhSessions({ from: today, to: today })).map((x) => [x.opportunities, x.performed]), [[3, 2]]);
});

async function steriliser(p: Awaited<ReturnType<typeof people>>) {
  await as(p.sup);
  return saveSteriliser(null, { code: "AC-1", name: "Autoclave 1", kind: "steam_autoclave", location: "CSSD" });
}
const PASS = { physical_result: "pass" as const, chemical_result: "pass" as const, temperature_c: 134, pressure_kpa: 210, exposure_min: 4 };

test("a load is usable only after a proper release by someone else; failures never become usable", async () => {
  const p = await people();
  const ac = await steriliser(p);
  await as(p.nurse);
  await assert.rejects(startCycle({ equipmentId: ac.id, items: [{ set_name: "Major set" }] }), /Only CSSD staff/);
  await as(p.tech);
  await assert.rejects(startCycle({ equipmentId: ac.id, items: [] }), /instrument sets/);
  const c1 = await startCycle({ equipmentId: ac.id, items: [{ set_name: "Major laparotomy set", set_code: "MLS-01" }, { set_name: "Hernia set" }] });
  assert.equal(c1.status, "awaiting_release");
  assert.equal(c1.operator_name, "Waqas, CSSD Technician");
  assert.match(c1.cycle_no, /^\d{8}-01$/);
  assert.deepEqual(await availableSets(), [], "nothing is usable before release");

  await recordCycleResults(c1.id, { physical_result: "pass", chemical_result: "fail" });
  await as(p.sup);
  await assert.rejects(releaseCycle(c1.id), /chemical indicator has not passed/);
  await as(p.tech);
  await assert.rejects(releaseCycle(c1.id), /Only the CSSD supervisor/);
  await assert.rejects(failCycle(c1.id, "Chemical strip did not change", " "), /corrective action/);
  await failCycle(c1.id, "Chemical strip did not change", "Door gasket replaced; load reprocessed");
  await as(p.sup);
  await assert.rejects(releaseCycle(c1.id), /failed; it cannot be released/);
  assert.deepEqual(await availableSets(), []);

  // Reprocessed: the operator cannot release their own load; the supervisor checks every result.
  await as(p.icn);
  const c2 = await startCycle({ equipmentId: ac.id, items: [{ set_name: "Major laparotomy set", set_code: "MLS-01" }], reprocessOf: c1.id });
  await recordCycleResults(c2.id, { ...PASS, sterilized_on: today });
  await assert.rejects(releaseCycle(c2.id), /ran the cycle cannot release it/);
  await as(p.sup);
  await assert.rejects(releaseCycle(c2.id), /sterilization and expiry dates/);
  await as(p.icn);
  await assert.rejects(recordCycleResults(c2.id, { expires_on: today }), /expiry date must be after/);
  await recordCycleResults(c2.id, { expires_on: inDays(30) });
  await as(p.sup);
  const released = await releaseCycle(c2.id);
  assert.deepEqual([released.status, released.released_by_name], ["released", "Irfan, CSSD Supervisor (releases sterile loads)"]);
  await assert.rejects(recordCycleResults(c2.id, { physical_result: "fail" }), /cannot be changed/);
  assert.deepEqual((await availableSets()).map((s) => s.set_name), ["Major laparotomy set"]);
});

test("implant loads wait for the biological indicator; a late biological failure recalls the load and shows who it was used on", async () => {
  const p = await people();
  const ac = await steriliser(p);
  await as(p.tech);
  const implant = await startCycle({ equipmentId: ac.id, implantLoad: true, items: [{ set_name: "Ortho implant tray" }] });
  await recordCycleResults(implant.id, { ...PASS, biological_result: "pending", sterilized_on: today, expires_on: inDays(30) });
  await as(p.sup);
  await assert.rejects(releaseCycle(implant.id), /implant load is released only after the biological indicator has passed/);

  await as(p.tech);
  const c = await startCycle({ equipmentId: ac.id, items: [{ set_name: "Hernia set" }] });
  await recordCycleResults(c.id, { ...PASS, biological_result: "pending", sterilized_on: today, expires_on: inDays(30) });
  await as(p.sup);
  await releaseCycle(c.id);

  // The set is used in a real surgery: that is the only link to a patient.
  asOwner();
  const pt = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const type = await saveSurgeryType(null, { name: "Hernia repair", rate: 1000 });
  const { episode } = await bookOpdVisit({ patientId: pt.id, doctorId: p.doctor.id });
  const { booking } = await admitFromVisit({ fromEpisodeId: episode.id, reason: "Hernia", plan: "surgery", surgeryTypeId: type.id, department: "Surgery" });
  const [item] = await listCycleItems(c.id);
  await as(p.nurse);
  await recordSetUsage(booking!.id, item.id);
  await assert.rejects(recordSetUsage(booking!.id, item.id), /already recorded/);
  assert.deepEqual((await usageForSurgery(booking!.id)).map((u) => [u.set_name, u.cycle_no]), [["Hernia set", c.cycle_no]]);

  await as(p.tech);
  const after = await recordBiologicalResult(c.id, "fail");
  assert.deepEqual([after.status, after.recall_reason], ["recalled", "Biological indicator failed after release"]);
  assert.deepEqual(await availableSets(), [], "a recalled load is never offered");
  assert.deepEqual((await recallImpact(c.id)).map((r) => [r.patient_name, r.surgery_name]), [["Zahid Iqbal", "Hernia repair"]]);
  await as(p.nurse);
  const [implantItem] = await listCycleItems(implant.id);
  await assert.rejects(recordSetUsage(booking!.id, implantItem.id), /awaiting release; it must not be used/);
});

test("expired sets cannot be used; a released load can be recalled by an authorized person", async () => {
  const p = await people();
  const ac = await steriliser(p);
  await as(p.tech);
  const c = await startCycle({ equipmentId: ac.id, items: [{ set_name: "Dressing set" }] });
  await recordCycleResults(c.id, { ...PASS, biological_result: "na", sterilized_on: inDays(-40), expires_on: inDays(-1) });
  await as(p.sup);
  await releaseCycle(c.id);
  assert.deepEqual(await availableSets(), [], "expired yesterday");
  await as(p.tech);
  await assert.rejects(recallCycle(c.id, "x"), /Only the CSSD supervisor/);
  await as(p.sup);
  await assert.rejects(recallCycle(c.id, " "), /reason/);
  assert.equal((await recallCycle(c.id, "Steriliser failed its weekly test")).status, "recalled");
});

test("IPC registers: entries without a patient; the exposure register is restricted", async () => {
  const p = await people();
  await as(p.icn);
  const round = await saveForm({ formKey: "ipc_round", patientId: null, data: {
    round_date: today, area: "ICU", team: "Samina, Dr Hamid", hand_hygiene: "Satisfactory", ppe: "Needs improvement", waste: "Satisfactory",
    cleaning: "Satisfactory", isolation: "Not applicable", findings: "Gloves reused between beds", actions: "Re-training by Friday (Samina)",
  } });
  assert.equal(round.patient_id, null);
  assert.equal((await finalizeForm(round.id)).status, "final");
  await as(p.nurse);
  await assert.rejects(saveForm({ formKey: "progress_note", patientId: null, data: { note: "x" } }), /belongs to a patient/);
  const exposure = await saveForm({ formKey: "sharps_exposure", patientId: null, data: {
    exposed_at: new Date().toISOString(), staff_name: "Rukhsana", staff_role: "Nurse", area: "Ward 3", exposure_type: "Needle-stick",
    source_known: "No", first_aid: "Yes", hbv_immunized: "Yes", pep: "No, not indicated", follow_up: "Baseline HBV, HCV, HIV; repeat at 6 weeks",
  } });
  assert.equal(exposure.status, "draft", "any staff member reports");
  await assert.rejects(listRegister("sharps_exposure"), /restricted/, "but only IPC / senior staff read the register");
  await as(p.icn);
  assert.equal((await listRegister("sharps_exposure")).length, 1);
  assert.equal((await listRegister("ipc_round")).length, 1);
});
