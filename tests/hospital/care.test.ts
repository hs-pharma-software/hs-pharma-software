/** Patient history on the doctor's desk, admitting from a visit (IPD or
 * surgery), and the Surgery tab: types with fees, planned surgeries. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { localDate } from "@/lib/localDate";
import { hospitalEpisodesRepo, hospitalPatientsRepo, hospitalServicesRepo, nextMrNo, listChargesForEpisode } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit, saveConsultationNotes, saveRx, orderInvestigation, payOrderFee, reportLabResult, reportImaging, listVisitOrders } from "@/lib/repo/hospitalOpd";
import { verifyLabResult, getLabReport } from "@/lib/repo/labReports";
import { getRadiologyReport } from "@/lib/repo/radiology";
import {
  listSurgeryTypes, saveSurgeryType, admitFromVisit, listSurgeryBookings, markSurgeryDone, cancelSurgery, getPatientHistory,
} from "@/lib/repo/hospitalCare";
import { visibleNavFor } from "@/config/navFilter";
import { designation } from "@/config/hospitalStaff";

const H = "hosp-a";
const TODAY = localDate();
let sql: DatabaseSync;

function login(tenantId = H) {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 10,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

const doctor = () => saveHospitalStaff(null, { name: "Dr Ayesha Khan", staff_category: "consultant", license_no: `PMDC-${Math.random().toString(36).slice(2, 7)}`, consultation_fee: 0, department: "General Surgery", basic_pay: 0 });
const patient = async () => hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Bilal Ahmed", gender: "Male" });

beforeEach(() => {
  sql = fullSchemaDb();
  setTestDb(sql);
  login();
});

test("surgery types: auto code, fee, department; duplicates refused; inactive hidden from the admit list", async () => {
  const a = await saveSurgeryType(null, { name: "Appendectomy", rate: 85000, department: "General Surgery" });
  const b = await saveSurgeryType(null, { name: "Cholecystectomy (laparoscopic)", rate: 120000 });
  assert.deepEqual([a.code, a.category, a.billing_unit, a.department, a.rate, a.is_active], ["SURG-001", "ot", "procedure", "General Surgery", 85000, 1]);
  assert.equal(b.code, "SURG-002");
  assert.equal(b.department, "Surgery", "default department");
  await assert.rejects(saveSurgeryType(null, { name: " appendectomy ", rate: 1 }), /already in the surgery list/);
  await assert.rejects(saveSurgeryType(null, { name: "X", rate: -1 }), /cannot be negative/);

  const edited = await saveSurgeryType(a.id, { name: "Appendectomy", rate: 90000, is_active: 1 });
  assert.deepEqual([edited.code, edited.rate], ["SURG-001", 90000]);
  await saveSurgeryType(b.id, { name: b.name, rate: b.rate, is_active: 0 });
  assert.deepEqual((await listSurgeryTypes()).map((s) => s.name), ["Appendectomy"]);
  assert.equal((await listSurgeryTypes({ includeInactive: true })).length, 2);

  // A lab test is not a surgery.
  const lab = await hospitalServicesRepo.create({ code: "CBC", name: "CBC", department: "Lab", category: "lab", billing_unit: "test", rate: 500, is_active: 1, notes: null });
  await assert.rejects(saveSurgeryType(lab.id, { name: "CBC", rate: 1 }), /Surgery not found/);
});

test("admit for surgery: IPD admission linked to the visit, surgery booked, fee on the admission bill; cancel removes the fee", async () => {
  const dr = await doctor();
  const p = await patient();
  const { episode: visit } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });
  await saveConsultationNotes(visit.id, { complaint: "Pain right lower abdomen", diagnosis: "Acute appendicitis", consult_status: "in_consultation" });
  const surg = await saveSurgeryType(null, { name: "Appendectomy", rate: 85000, department: "General Surgery" });

  await assert.rejects(admitFromVisit({ fromEpisodeId: visit.id, reason: " ", plan: "ipd" }), /reason for admission/);
  await assert.rejects(admitFromVisit({ fromEpisodeId: visit.id, reason: "Surgery", plan: "surgery" }), /type of surgery/);

  const { admission, booking } = await admitFromVisit({
    fromEpisodeId: visit.id, reason: "Appendicitis, for appendectomy", plan: "surgery", surgeryTypeId: surg.id, plannedDate: TODAY, surgeonId: dr.id, wardRoom: "Surgical", bedNo: "12",
  });
  assert.equal(admission.type, "ipd");
  assert.equal(admission.from_episode_id, visit.id);
  assert.equal(admission.admission_date, TODAY);
  assert.equal(admission.diagnosis, "Acute appendicitis", "diagnosis carried over");
  assert.equal(admission.department, "General Surgery");
  assert.deepEqual([admission.room_ward, admission.bed_no], ["Surgical", "12"]);
  assert.match(admission.episode_no, /^IPD-/);
  const after = (await hospitalEpisodesRepo.get(visit.id))!;
  assert.equal(after.consult_status, "done");
  assert.match(after.notes ?? "", new RegExp(admission.episode_no));

  assert.ok(booking);
  assert.deepEqual([booking.status, booking.fee, booking.surgery_name, booking.surgeon_id, booking.planned_date], ["planned", 85000, "Appendectomy", dr.id, TODAY]);
  const charges = await listChargesForEpisode(admission.id);
  assert.deepEqual(charges.map((c) => [c.description, c.amount, c.category]), [["Surgery: Appendectomy", 85000, "ot"]]);
  assert.equal(booking.charge_id, charges[0].id);

  await assert.rejects(admitFromVisit({ fromEpisodeId: visit.id, reason: "again", plan: "ipd" }), /already admitted/);

  const planned = await listSurgeryBookings("planned");
  assert.deepEqual(planned.map((b) => [b.patient_name, b.episode_no, b.surgeon_name]), [["Bilal Ahmed", admission.episode_no, "Dr Ayesha Khan"]]);

  await assert.rejects(cancelSurgery(booking.id, " "), /why/);
  await cancelSurgery(booking.id, "Patient refused");
  assert.equal((await listChargesForEpisode(admission.id)).length, 0, "fee taken off the bill");
  await assert.rejects(markSurgeryDone(booking.id), /not planned/);
  assert.equal((await listSurgeryBookings("cancelled")).length, 1);
});

test("admit to IPD without surgery; done surgery is recorded", async () => {
  const dr = await doctor();
  const p = await patient();
  const { episode: visit } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });
  const { admission, booking } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Dehydration, IV fluids", plan: "ipd" });
  assert.equal(booking, null);
  assert.equal((await listChargesForEpisode(admission.id)).length, 0);
  assert.match(admission.notes ?? "", /^Admitted: Dehydration/);
  await assert.rejects(admitFromVisit({ fromEpisodeId: admission.id, reason: "x", plan: "ipd" }), /already an admission/);

  // A second patient admitted for surgery, then operated.
  const p2 = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Sana Iqbal", gender: "Female" });
  const { episode: v2 } = await bookOpdVisit({ patientId: p2.id, doctorId: dr.id });
  const s = await saveSurgeryType(null, { name: "Hernia repair", rate: 60000 });
  const r = await admitFromVisit({ fromEpisodeId: v2.id, reason: "Inguinal hernia", plan: "surgery", surgeryTypeId: s.id });
  assert.equal(r.booking!.surgeon_id, dr.id, "the visit's doctor when no surgeon is chosen");
  await markSurgeryDone(r.booking!.id);
  const done = await listSurgeryBookings("done");
  assert.equal(done.length, 1);
  assert.ok(done[0].performed_at);
});

test("history shows earlier visits with notes, prescription, verified lab results, radiology and surgery; not the current visit", async () => {
  const dr = await doctor();
  const p = await patient();
  const { episode: first } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id, date: "2026-09-01" });
  await saveConsultationNotes(first.id, { complaint: "Fever", vitals: "T 101F", diagnosis: "Typhoid fever", advice: "Plenty of fluids", consult_status: "done" });
  await saveRx(first.id, [{ product_id: null, product_name: "Azithromycin 500mg", generic_name: "Azithromycin", dose: "1", route: "Oral", frequency: "OD (once a day)", duration: "7", qty: 7, instructions: "After meals" }]);
  const hb = await hospitalServicesRepo.create({ code: "HB", name: "Haemoglobin", department: "Lab", category: "lab", billing_unit: "test", rate: 300, is_active: 1, notes: null });
  const tlc = await hospitalServicesRepo.create({ code: "TLC", name: "TLC", department: "Lab", category: "lab", billing_unit: "test", rate: 300, is_active: 1, notes: null });
  const xr = await hospitalServicesRepo.create({ code: "XR", name: "Chest X-Ray", department: "Radiology", category: "imaging", billing_unit: "test", rate: 1200, is_active: 1, notes: null });
  const lab = await orderInvestigation(first.id, hb.id);
  const unverified = await orderInvestigation(first.id, tlc.id);
  const rad = await orderInvestigation(first.id, xr.id);
  for (const o of [lab, unverified]) await payOrderFee("lab", o.order.id, "cash");
  await payOrderFee("imaging", rad.order.id, "cash");
  await reportLabResult(lab.order.id, { result_value: "10.1", unit: "g/dL", ref_range: "13-17", flag: "L" });
  await verifyLabResult(lab.order.id);
  await reportLabResult(unverified.order.id, { result_value: "99999", unit: null, ref_range: null, flag: "H" });
  await reportImaging(rad.order.id, { findings: "No consolidation", impression: "Normal chest", radiologist: "Dr R" });

  const { episode: current } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });
  const h = await getPatientHistory(p.id, current.id);
  assert.equal(h.length, 1, "only the earlier visit");
  const v = h[0];
  assert.equal(v.episode.id, first.id);
  assert.equal(v.doctorName, "Dr Ayesha Khan");
  assert.deepEqual([v.episode.complaint, v.episode.vitals, v.episode.diagnosis, v.episode.advice], ["Fever", "T 101F", "Typhoid fever", "Plenty of fluids"]);
  assert.deepEqual(v.prescriptions.map((r) => [r.product_name, r.frequency, r.duration]), [["Azithromycin 500mg", "OD (once a day)", "7"]]);
  assert.deepEqual(v.labs.map((l) => [l.test_name, l.result_value, l.flag]), [["Haemoglobin", "10.1", "L"]]);
  assert.deepEqual(v.pendingLabs, ["TLC"], "an unverified result is not shown");
  assert.ok(!JSON.stringify(v.labs).includes("99999"));
  assert.deepEqual(v.imaging.map((i) => i.impression), ["Normal chest"]);

  // Admission and surgery show in the history of the next visit.
  const s = await saveSurgeryType(null, { name: "Appendectomy", rate: 1000 });
  const { admission } = await admitFromVisit({ fromEpisodeId: current.id, reason: "Appendicitis", plan: "surgery", surgeryTypeId: s.id, plannedDate: TODAY });
  const later = await getPatientHistory(p.id);
  assert.equal(later.length, 3);
  const adm = later.find((x) => x.episode.id === admission.id)!;
  assert.deepEqual(adm.surgeries.map((x) => [x.surgery_name, x.status]), [["Appendectomy", "planned"]]);
});

test("another hospital cannot read the history or admit its patients", async () => {
  const dr = await doctor();
  const p = await patient();
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });
  login("hosp-b");
  await assert.rejects(getPatientHistory(p.id), /not found/);
  await assert.rejects(admitFromVisit({ fromEpisodeId: episode.id, reason: "x", plan: "ipd" }), /not found/);
  assert.deepEqual(await listSurgeryBookings(), []);
});

test("Surgery is in the hospital menu after Radiology; the HoD may open it, a consultant may not", () => {
  const labels = visibleNavFor("hospital", null, null).map((n) => n.label);
  assert.equal(labels[labels.indexOf("Radiology") + 1], "Surgery");
  const hod = visibleNavFor("hospital", null, designation("hod")!.pages).map((n) => n.label);
  assert.ok(hod.includes("Surgery"));
  const con = visibleNavFor("hospital", null, designation("consultant")!.pages).map((n) => n.label);
  assert.ok(!con.includes("Surgery"));
});

test("doctor desk: a reported test or scan of the visit opens its report for the treating doctor", async () => {
  const dr = await doctor();
  const p = await patient();
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });
  const hb = await hospitalServicesRepo.create({ code: "HB", name: "Haemoglobin", department: "Lab", category: "lab", billing_unit: "test", rate: 300, is_active: 1, notes: null });
  const xr = await hospitalServicesRepo.create({ code: "XR", name: "Chest X-Ray", department: "Radiology", category: "imaging", billing_unit: "test", rate: 1200, is_active: 1, notes: null });
  const lab = await orderInvestigation(episode.id, hb.id);
  const rad = await orderInvestigation(episode.id, xr.id);
  await payOrderFee("lab", lab.order.id, "cash");
  await payOrderFee("imaging", rad.order.id, "cash");
  await reportLabResult(lab.order.id, { result_value: "10.1", unit: "g/dL", ref_range: "13-17", flag: "L" });
  await verifyLabResult(lab.order.id);
  await reportImaging(rad.order.id, { findings: "No consolidation", impression: "Normal chest", radiologist: "Dr R" });

  const orders = await listVisitOrders(episode.id);
  const labRow = orders.find((o) => o.kind === "lab")!;
  assert.ok(labRow.request_id, "the lab test carries its lab request");
  assert.equal(orders.find((o) => o.kind === "imaging")!.request_id, null);

  // The consultant's own login: Doctor Desk pages only.
  useAuthStore.setState({
    currentUser: { id: "dr-user", username: "dr", displayName: "Dr Ayesha Khan", role: "staff", tenantId: H, permissions: designation("consultant")!.pages },
  });
  const report = await getLabReport(labRow.request_id!, { checked: true, method: `treating doctor, visit ${episode.episode_no}` });
  assert.deepEqual(report.tests.map((t) => [t.test_name, t.result_value, t.flag]), [["Haemoglobin", "10.1", "L"]]);
  assert.equal(report.patient.name, "Bilal Ahmed");
  const scan = await getRadiologyReport(rad.order.id);
  assert.equal(scan.order.impression, "Normal chest");
});
