/** Emergency and quality (MSDS COP-1, COP-6, PRE-4, CQI-3, CQI-4, ROM-5):
 * triage from vital signs with a reason for under-triage, door-to-doctor,
 * disposition, the MLC chain, critical results with read-back, complaints,
 * incidents / sentinel events with RCA, CAPA verified by another person, and
 * the indicators. Nothing is completed on its own. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { hospitalPatientsRepo, hospitalEpisodesRepo, hospitalLabRepo, nextMrNo, nextEpisodeNo, nextOrderNo } from "@/lib/repo/hospital";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { enterLabResult, verifyLabResult } from "@/lib/repo/labReports";
import {
  recordTriage, markSeenByDoctor, recordDisposition, erBoard, erIndicators, episodeTriage,
  registerMlc, recordPoliceIntimation, recordMlcExamination, issueMlcReport, closeMlc, listMlc,
} from "@/lib/repo/emergency";
import {
  listCriticalAlerts, notifyCritical, raiseCriticalAlert, recordComplaint, acknowledgeComplaint, resolveComplaint, closeComplaint, listComplaints,
  reportIncident, reviewIncident, recordRca, closeIncident, listIncidents, raiseCapa, markCapaDone, verifyCapa, listCapa, qualityIndicators,
} from "@/lib/repo/quality";
import { suggestTriage, criticalCheck, criticalFindings, minimumClass } from "@/config/quality";
import { designation } from "@/config/hospitalStaff";
import { localDate, localDateTime } from "@/lib/localDate";
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
const STABLE = { pulse: 84, sbp: 124, rr: 16, spo2: 98, gcs: 15 };

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function setup() {
  const doctor = await saveHospitalStaff(null, { name: "Dr Hamid", staff_category: "medical_officer", license_no: lic(), consultation_fee: 0, department: "Emergency", basic_pay: 0 });
  const nurse = await saveHospitalStaff(null, { name: "Rukhsana", staff_category: "nurse", license_no: lic(), department: "Emergency", basic_pay: 0 });
  const clerk = await saveHospitalStaff(null, { name: "Bilal", staff_category: "receptionist", basic_pay: 0 });
  const qm = await saveHospitalStaff(null, { name: "Sana", staff_category: "quality_manager", basic_pay: 0 });
  const ns = await saveHospitalStaff(null, { name: "Farzana", staff_category: "nursing_superintendent", license_no: lic(), basic_pay: 0 });
  const path = await saveHospitalStaff(null, { name: "Dr Saima", staff_category: "pathologist", license_no: lic(), basic_pay: 0 });
  const tech = await saveHospitalStaff(null, { name: "Asad", staff_category: "lab_technician", basic_pay: 0 });
  const patient = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const er = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("emergency", today), type: "emergency", patient_id: patient.id, doctor_id: null, department: "Emergency",
    date: today, time: null, status: "open", room_ward: "ER", bed_no: "3", admission_date: null, discharge_date: null, diagnosis: null, notes: null,
  });
  return { doctor, nurse, clerk, qm, ns, path, tech, patient, er };
}

test("triage suggestion follows the vital signs; level 5 is never suggested", () => {
  assert.equal(suggestTriage({ ...STABLE, gcs: 7 }).level, 1);
  assert.equal(suggestTriage({ ...STABLE, spo2: 88 }).level, 2);
  assert.deepEqual(suggestTriage({ ...STABLE, pulse: 118 }), { level: 3, reasons: ["pulse 118"] });
  assert.equal(suggestTriage(STABLE).level, 4);
});

test("triage: nurse records, under-triage needs a reason, doctor sees, disposition, ER board and indicators", async () => {
  const s = await setup();
  await as(s.clerk);
  await assert.rejects(recordTriage(s.er.id, { chiefComplaint: "Chest pain", ...STABLE }), /nurse or doctor/);
  await as(s.nurse);
  await assert.rejects(recordTriage(s.er.id, { chiefComplaint: "Chest pain", ...STABLE, spo2: 140 }), /outside/);
  await assert.rejects(recordTriage(s.er.id, { chiefComplaint: "Chest pain", ...STABLE, sbp: 85, level: 4 }), /call for level 2.*reason/);
  const t = await recordTriage(s.er.id, { chiefComplaint: "Chest pain", ...STABLE, sbp: 85 });
  assert.equal(t.level, 2);
  assert.equal(t.suggested_level, 2);

  const board = await erBoard(new Date(Date.now() + 25 * 60000));
  assert.equal(board.length, 1);
  assert.equal(board[0].overdue, true, "level 2 waiting 25 minutes is past its 10 minute target");

  await assert.rejects(markSeenByDoctor(s.er.id), /Only a doctor/);
  await assert.rejects(recordDisposition(s.er.id, "discharged"), /doctor records/);
  await as(s.doctor);
  await assert.rejects(recordDisposition(s.er.id, "discharged"), /seen the patient first/);
  await markSeenByDoctor(s.er.id);
  await assert.rejects(markSeenByDoctor(s.er.id), /already seen/);
  await assert.rejects(recordDisposition(s.er.id, "lama"), /LAMA form/);
  await recordDisposition(s.er.id, "lama", "Risks explained to son, LAMA form signed");
  await assert.rejects(recordDisposition(s.er.id, "discharged"), /already recorded/);
  assert.equal((await erBoard()).length, 0, "a patient with a disposition leaves the board");
  assert.equal((await episodeTriage(s.er.id))[0].seen_by_name?.startsWith("Dr Hamid"), true);
  const ep = await hospitalEpisodesRepo.get(s.er.id);
  assert.equal(ep!.status, "open", "disposition never closes the visit by itself");

  const ind = await erIndicators({ from: today, to: today });
  assert.equal(ind.visits, 1);
  assert.equal(ind.triaged, 1);
  assert.equal(ind.byLevel.find((b) => b.level === 2)!.n, 1);
  assert.equal(ind.dispositions.lama, 1);
  assert.equal(ind.lamaPct, 100);
});

test("medico-legal case: police informed and examination before the report; one case per visit", async () => {
  const s = await setup();
  await as(s.nurse);
  await assert.rejects(registerMlc(s.er.id, { nature: "Road traffic accident" }), /doctor registers/);
  await as(s.doctor);
  const m = await registerMlc(s.er.id, { nature: "Road traffic accident", broughtBy: "Rescue 1122", history: "Motorbike hit by car" });
  assert.match(m.mlc_no, /^MLC-\d{2}-0001$/);
  await assert.rejects(registerMlc(s.er.id, { nature: "Burn" }), /already registered/);
  await assert.rejects(issueMlcReport(m.id, "SI Akram, PS Saddar"), /police were informed/);
  await as(s.nurse);
  await recordPoliceIntimation(m.id, { station: "PS Saddar", informedAt: localDateTime(), ref: "Rapat 42" });
  await assert.rejects(recordMlcExamination(m.id, { injuries: "Laceration" }), /Only a doctor/);
  await as(s.doctor);
  await assert.rejects(issueMlcReport(m.id, "SI Akram, PS Saddar"), /examination first/);
  await assert.rejects(recordMlcExamination(m.id, { injuries: "5 cm laceration left forearm", samples: "Clothes" }), /chain of custody/);
  await recordMlcExamination(m.id, { injuries: "5 cm laceration left forearm", opinion: "Simple, blunt", samples: "Clothes", samplesHandedTo: "HC Rashid" });
  await assert.rejects(closeMlc(m.id), /Issue the medico-legal report/);
  await issueMlcReport(m.id, "SI Akram, PS Saddar");
  await assert.rejects(recordMlcExamination(m.id, { injuries: "changed" }), /no longer be changed/);
  await closeMlc(m.id);
  const rows = await listMlc({ search: "Zahid" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "closed");
});

test("critical results: verified lab value raises a pending alert; notification needs read-back", async () => {
  assert.ok(criticalCheck("Potassium", "6.9"));
  assert.equal(criticalCheck("Potassium", "4.1"), null);
  assert.ok(criticalCheck("Platelet count", "15000"), "cells/µL are scaled to ×10³/µL");
  assert.equal(criticalCheck("Blood culture", "No growth after 48 h"), null);
  assert.ok(criticalCheck("Blood culture", "Growth of S. aureus"));
  assert.deepEqual(criticalFindings("CBC", null, [{ key: "hb", name: "Haemoglobin (Hb)", value: "5.8" }, { key: "plt", name: "Platelet count", value: "210" }]).map((f) => f.test), ["CBC: Haemoglobin (Hb)"]);

  const s = await setup();
  const order = await hospitalLabRepo.create({
    order_no: await nextOrderNo("hospital_lab_orders"), episode_id: s.er.id, patient_id: s.patient.id, test_name: "Serum Potassium", priority: "urgent", status: "collected",
    result_value: null, unit: null, ref_range: null, flag: null, ordered_by: "Dr Hamid", ordered_at: localDateTime(), reported_at: null, notes: null,
  });
  await as(s.tech);
  await enterLabResult(order.id, { result_value: "6.9", unit: "mmol/L", ref_range: "3.5-5.1", flag: "H" });
  assert.equal((await listCriticalAlerts()).length, 0, "nothing is raised before the result is verified");
  await as(s.path);
  await verifyLabResult(order.id);
  const [alert] = await listCriticalAlerts({ status: "pending" });
  assert.ok(alert, "a pending critical alert");
  assert.equal(alert.episode_id, s.er.id);
  assert.equal(alert.location, "ER 3");
  await assert.rejects(notifyCritical(alert.id, { notifiedTo: "Dr Hamid, MO", method: "Phone", readBack: false }), /read the result back/);
  await notifyCritical(alert.id, { notifiedTo: "Dr Hamid, MO", method: "Phone", readBack: true, actionTaken: "Calcium gluconate, ECG" });
  await assert.rejects(notifyCritical(alert.id, { notifiedTo: "x", method: "Phone", readBack: true }), /already notified/);
  assert.equal((await listCriticalAlerts({ status: "pending" })).length, 0);

  await as(s.clerk);
  await assert.rejects(raiseCriticalAlert({ source: "radiology", episodeId: s.er.id, testName: "CT brain", value: "Large extradural haematoma" }), /clinical staff/);
  await as(s.doctor);
  await raiseCriticalAlert({ source: "radiology", episodeId: s.er.id, testName: "CT brain", value: "Large extradural haematoma" });
  const q = await qualityIndicators({ from: today, to: today });
  assert.equal(q.critical, 2);
  assert.equal(q.criticalPending, 1);
  assert.equal(q.criticalInTargetPct, 50);
});

test("complaints: acknowledged, resolved and closed only by the quality team, closed after the complainant is told", async () => {
  const s = await setup();
  await as(s.clerk);
  const c = await recordComplaint({ channel: "In person", complainantName: "Imran (son)", category: "Waiting time", description: "Waited 3 hours in ER", severity: "Medium", episodeId: s.er.id });
  assert.match(c.complaint_no, /^CMP-\d{2}-0001$/);
  assert.equal(c.patient_id, s.patient.id);
  await assert.rejects(acknowledgeComplaint(c.id, "ER in-charge"), /quality team/);
  await as(s.qm);
  await assert.rejects(resolveComplaint(c.id, { investigation: "x", resolution: "y" }), /Acknowledge/);
  await acknowledgeComplaint(c.id, "ER in-charge");
  await resolveComplaint(c.id, { investigation: "Two MOs on leave", resolution: "Roster changed, apology given" });
  await assert.rejects(closeComplaint(c.id, false), /Tell the complainant/);
  await closeComplaint(c.id, true);
  assert.equal((await listComplaints({ status: "active" })).length, 0);
  const late = await listComplaints({}, inDays(30));
  assert.equal(late[0].ack_overdue, false, "a closed complaint is not overdue");
});

test("incidents: anyone reports (anonymously too), sentinel needs RCA and a CAPA; CAPA verified by someone else", async () => {
  const s = await setup();
  assert.equal(minimumClass("Wrong patient / site / procedure", "None"), "sentinel");
  assert.equal(minimumClass("Patient fall", "Moderate"), "adverse_event");

  await as(s.nurse);
  await assert.rejects(reportIncident({ occurredAt: localDateTime(), location: "Ward 4", incidentType: "Patient fall", outcomeClass: "near_miss", harm: "Moderate", description: "Fell from bed" }), /adverse event/);
  const fall = await reportIncident({ occurredAt: localDateTime(), location: "Ward 4", incidentType: "Patient fall", outcomeClass: "adverse_event", harm: "Moderate", description: "Fell from bed, wrist fracture", anonymous: true });
  assert.equal(fall.reporter_name, null, "anonymous reports keep no name");
  assert.equal(fall.status, "reported");
  await assert.rejects(reportIncident({ occurredAt: localDateTime(), location: "OT 2", incidentType: "Wrong patient / site / procedure", outcomeClass: "adverse_event", harm: "None", description: "x" }), /sentinel/);
  const wrong = await reportIncident({ occurredAt: localDateTime(), location: "OT 2", incidentType: "Wrong patient / site / procedure", outcomeClass: "sentinel", harm: "Moderate", description: "Incision on the wrong side, stopped", episodeId: s.er.id });
  assert.equal(wrong.status, "rca");
  assert.equal(wrong.rca_due_on, inDays(45));
  await assert.rejects(closeIncident(fall.id), /quality team/);

  await as(s.qm);
  await assert.rejects(closeIncident(fall.id), /Review the incident/);
  await assert.rejects(reviewIncident(fall.id, { outcomeClass: "no_harm", harm: "Moderate", notes: "x" }), /adverse event/);
  await reviewIncident(fall.id, { outcomeClass: "adverse_event", harm: "Moderate", notes: "Bed rails not raised" });
  await closeIncident(fall.id);

  await assert.rejects(closeIncident(wrong.id), /Finish the root cause analysis/);
  await recordRca(wrong.id, { team: "QM, HoD Surgery, OT in-charge", rootCauses: "Site not marked; time-out skipped", summary: "Universal protocol not followed" });
  await assert.rejects(closeIncident(wrong.id), /at least one corrective/);
  const capa = await raiseCapa({ source: "incident", sourceId: wrong.id, problem: "Time-out skipped", actionType: "corrective", action: "Mandatory site marking and time-out checklist", ownerName: "OT in-charge", dueOn: inDays(14) });
  assert.match(capa.capa_no, /^CAPA-\d{2}-0001$/);
  await closeIncident(wrong.id);
  const [row] = await listIncidents({ outcomeClass: "sentinel" });
  assert.equal(row.capa_count, 1);
  assert.equal(row.capa_open, 1);

  await assert.rejects(verifyCapa(capa.id, { effective: true, note: "x" }), /recorded as done/);
  await markCapaDone(capa.id, "Checklist in use in all theatres from today");
  await assert.rejects(verifyCapa(capa.id, { effective: true, note: "Audit" }), /someone other/);
  await as(s.ns);
  const back = await verifyCapa(capa.id, { effective: false, note: "Audit: 3 of 10 cases without time-out" });
  assert.equal(back.status, "open", "an action that did not work is reopened");
  await as(s.qm);
  await markCapaDone(capa.id, "Retrained all OT staff");
  await as(s.ns);
  const ok = await verifyCapa(capa.id, { effective: true, note: "Audit: 10 of 10 with time-out" });
  assert.equal(ok.status, "verified");
  assert.match(ok.effectiveness!, /Not effective[\s\S]*Effective/);
  assert.equal((await listCapa({ status: "active" })).length, 0);
  assert.equal((await listCapa())[0].source_ref, wrong.incident_no);

  const q = await qualityIndicators({ from: today, to: today });
  assert.equal(q.incidents, 2);
  assert.equal(q.sentinel, 1);
  assert.equal(q.byClass.adverse_event, 1);
  assert.equal(q.rcaOnTimePct, 100);
  assert.equal(q.capaEffectivePct, 0, "the action needed a second attempt");
});
