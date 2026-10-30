/** Radiology portal: modalities and machines, a paid order in its machine's
 * queue, the technologist's examination (required checks are never ticked
 * for them, warnings must be confirmed), reporting with templates; and the
 * DICOM machine API (key check, worklist as DICOM JSON, procedure steps,
 * images received). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hospitalPatientsRepo, hospitalImagingRepo, nextMrNo } from "@/lib/repo/hospital";
import { payOrderFee } from "@/lib/repo/hospitalOpd";
import { staffRepo } from "@/lib/repo/staff";
import { saveImagingStudy, orderImaging } from "@/lib/repo/radiology";
import {
  loadStandardModalities, listModalities, saveModality, saveMachine, createMachineKey, revokeMachineKey, machineQueue, listMachinesWithQueue,
  startExam, returnToQueue, completeExam, saveTemplate, templatesFor, listForReporting, reportStudy, savePacs, imagesUrl, radiologyStats,
  listPortalOrders, searchPatients, assignMachine, listTechnologists, machinesRepo, machineConnection,
} from "@/lib/repo/radiologyPortal";
import {
  authenticateMachine, getWorklist, postProcedureStep, postStudyReceived, studyUidFor, toDicomJson, accessionFor, orderNoFor, modalityCodeFor, mppsStatusOf, type DicomDb,
} from "@/lib/dicomApi";
import { emptyExam, validateExam } from "@/config/radiologyPortal";

const T = "hosp-a";
let db: DatabaseSync;
const io: DicomDb = {
  select: async <R,>(sql: string, params: unknown[]) => db.prepare(sql).all(...(params as never[])) as R[],
  execute: async (sql: string, params: unknown[]) => db.prepare(sql).run(...(params as never[])),
};

function login(user: { id: string; role?: "owner" | "staff"; permissions?: string[] | null } = { id: "owner" }) {
  const tenant: SessionTenant = {
    id: T, name: "City Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 10,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({
    currentUser: { id: user.id, username: user.id, displayName: user.id, role: user.role ?? "owner", tenantId: T, permissions: user.permissions ?? null },
    currentTenant: tenant,
  });
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  login();
});

async function setup() {
  await loadStandardModalities();
  const study = await saveImagingStudy(null, { name: "X-Ray Hand", modality: "X-Ray", rate: 250 });
  const xray = await saveMachine(null, { name: "X-Ray Room 1", modality_code: "XRAY", ae_title: "xray01", model: "400 mA", serial_no: "XR-001" });
  const ct = await saveMachine(null, { name: "CT", modality_code: "CT", ae_title: "CT01" });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zainab Noor", gender: "Female", age_years: 30, phone: "0300-1112233", cnic: "35202-1234567-8", dob: "1996-04-02" });
  const { order } = await orderImaging({ patientId: p.id, serviceId: study.id, bodyPart: "Right hand", orderedBy: "Dr Hamid", clinicalHistory: "Fall on hand" });
  return { study, xray, ct, p, order };
}

test("modalities: the standard list once; codes are unique; a study's modality text finds its code", async () => {
  assert.equal(await loadStandardModalities(), 10);
  assert.equal(await loadStandardModalities(), 0);
  await assert.rejects(saveModality(null, { code: "ct", name: "Another CT" }), /already exists/);
  const own = await saveModality(null, { code: "OPG", name: "Dental OPG", dicom_code: "DX", universal_name: "Orthopantomogram" });
  assert.equal(own.code, "OPG");
  const refs = (await listModalities()).map((m) => ({ code: m.code, name: m.name, universal_name: m.universal_name, dicom_code: m.dicom_code }));
  assert.equal(modalityCodeFor("X-Ray", refs), "XRAY");
  assert.equal(modalityCodeFor("ct scan", refs), "CT");
  assert.equal(modalityCodeFor("Orthopantomogram", refs), "OPG");
  assert.equal(modalityCodeFor("Hearing test", refs), null);
});

test("machines: codes MACH-nnn, AE Titles unique, the key is shown once and only its hash is stored", async () => {
  const { xray } = await setup();
  assert.deepEqual([xray.machine_code, xray.ae_title], ["MACH-001", "XRAY01"]);
  await assert.rejects(saveMachine(null, { name: "Second", modality_code: "XRAY", ae_title: "XRAY01" }), /already uses AE Title/);
  await assert.rejects(saveMachine(null, { name: "No modality", modality_code: "NOPE" }), /modality/);
  const key = await createMachineKey(xray.id);
  assert.match(key, /^hmsk_[A-Za-z0-9_-]{43}$/);
  const row = (await machinesRepo.get(xray.id))!;
  assert.notEqual(row.api_key_hash, key);
  assert.equal(row.api_key_hash?.length, 64);
  assert.equal(row.api_key_hint, `${key.slice(0, 9)}…`);
  assert.equal((await authenticateMachine(io, key)).id, xray.id);
  const again = await createMachineKey(xray.id);
  await assert.rejects(authenticateMachine(io, key), /not valid/, "the old key stops working");
  await revokeMachineKey(xray.id);
  await assert.rejects(authenticateMachine(io, again), /not valid/);
  assert.equal(machineConnection({ last_seen_at: null }), "never");
  assert.equal(machineConnection({ last_seen_at: new Date().toISOString() }), "online");
});

test("an order joins its modality's machine queue only once its fee is paid", async () => {
  const { xray, ct, order } = await setup();
  assert.equal(order.modality_code, "XRAY");
  assert.equal(order.clinical_history, "Fall on hand");
  assert.deepEqual(await machineQueue(xray), [], "fee not paid");
  await payOrderFee("imaging", order.id, "cash");
  assert.deepEqual((await machineQueue(xray)).map((o) => o.order_no), [order.order_no]);
  assert.deepEqual(await machineQueue(ct), []);
  assert.deepEqual((await listMachinesWithQueue()).map((m) => [m.name, m.queue]), [["X-Ray Room 1", 1], ["CT", 0]]);
  const s = await radiologyStats();
  assert.deepEqual([s.todaysOrders, s.pending, s.waitingQueue, s.activeMachines], [1, 1, 1, 2]);
  assert.equal((await listPortalOrders({ search: "35202" })).total, 1, "by CNIC");
  assert.equal((await listPortalOrders({ search: "zainab", status: "reported" })).total, 0);
  assert.equal((await searchPatients({ phone: "03001112233" })).length, 1);
  await assert.rejects(searchPatients({}), /at least one/);
});

test("technologist: start, required checks block completion, warnings need confirming, then it waits for the report", async () => {
  const { xray, ct, order } = await setup();
  await assert.rejects(startExam(order.id, xray.id), /not paid/);
  await payOrderFee("imaging", order.id, "cash");
  await startExam(order.id, xray.id);
  await assert.rejects(startExam(order.id, ct.id), /another machine/);
  await returnToQueue(order.id);
  assert.equal((await hospitalImagingRepo.get(order.id))!.status, "pending");
  await startExam(order.id, xray.id);

  const exam = emptyExam("Fall on hand");
  await assert.rejects(completeExam(order.id, exam), /Consent signed is not ticked.*Identity verified/);
  exam.safety.prep = { consent: true, identity: true };
  const first = await completeExam(order.id, exam);
  assert.ok(first.warnings.some((w) => /No examination protocol/.test(w)));
  assert.ok(first.warnings.some((w) => /Pregnancy status/.test(w)), "a woman of 30 needs her pregnancy status or LMP");
  assert.equal((await hospitalImagingRepo.get(order.id))!.status, "in_progress", "nothing completed until the warnings are confirmed");
  await completeExam(order.id, exam, true);
  const done = (await hospitalImagingRepo.get(order.id))!;
  assert.deepEqual([done.status, done.performed_by_name, done.series_count, done.images_count], ["performed", "owner", 1, 1]);
  assert.deepEqual(await machineQueue(xray), []);
  assert.deepEqual((await listForReporting("to_report")).map((o) => o.id), [order.id]);
});

test("safety checks: nothing is ticked for the technologist; contrast with kidney disease is a warning", () => {
  const d = emptyExam();
  assert.deepEqual(d.safety.prep, {});
  d.safety.prep = { consent: true, identity: true };
  d.protocol = { ...d.protocol, name: "Plain", contrast: true, contrastAgent: "Iohexol" };
  d.safety.checks = { kidney_disease: true };
  assert.deepEqual(validateExam(d, { gender: "Male", ageYears: 40 }), { errors: [], warnings: ["Contrast was given to a patient with a contrast allergy or kidney disease."] });
  assert.deepEqual(validateExam({ ...d, safety: { ...d.safety, checks: {} } }, { gender: "Female", ageYears: 2 }).warnings, [], "no LMP asked for a child");
});

test("roles: a technologist performs examinations but cannot set up machines or keys", async () => {
  const { xray, order } = await setup();
  await payOrderFee("imaging", order.id, "cash");
  await staffRepo.create({ name: "Bilal Ahmed", staff_category: "radiographer", user_id: "u-rt" } as never);
  assert.deepEqual((await listTechnologists()).map((t) => t.name), ["Bilal Ahmed"]);
  await assignMachine(xray.id, "u-rt");
  assert.equal((await machinesRepo.get(xray.id))!.assigned_user_name, "Bilal Ahmed");
  login({ id: "u-rt", role: "staff", permissions: ["hospital_radiology_tech"] });
  await startExam(order.id, xray.id);
  await assert.rejects(saveMachine(null, { name: "X", modality_code: "XRAY" }), /cannot set up machines/);
  await assert.rejects(createMachineKey(xray.id), /cannot create machine keys/);
  await assert.rejects(assignMachine(xray.id, null), /cannot assign/);
});

test("reporting: templates of the study first, the report names the radiologist", async () => {
  const { study, xray, order } = await setup();
  await saveTemplate(null, { name: "Normal X-ray", modality_code: "XRAY", findings: "No fracture.", impression: "Normal study." });
  await saveTemplate(null, { name: "Normal hand", service_id: study.id, findings: "Bones of the hand intact.", impression: "Normal hand." });
  await saveTemplate(null, { name: "Normal CT brain", modality_code: "CT", findings: "x", impression: "y" });
  assert.deepEqual((await templatesFor(order)).map((t) => t.name), ["Normal hand", "Normal X-ray"]);
  await payOrderFee("imaging", order.id, "cash");
  assert.deepEqual((await listForReporting("unexamined")).map((o) => o.id), [order.id]);
  await startExam(order.id, xray.id);
  await completeExam(order.id, { ...emptyExam(), safety: { checks: {}, prep: { consent: true, identity: true }, otherNotes: "" } }, true);
  await reportStudy(order.id, { findings: "Bones of the hand intact.", impression: "Normal hand." });
  const r = (await hospitalImagingRepo.get(order.id))!;
  assert.deepEqual([r.status, r.radiologist], ["reported", "owner"]);
  assert.deepEqual((await listForReporting("reported")).map((o) => o.id), [order.id]);
});

test("PACS: the viewer address needs the study; images open only once received", async () => {
  await assert.rejects(savePacs({ name: "PACS", viewer_url: "https://pacs.example.pk/viewer" }), /StudyInstanceUID/);
  await assert.rejects(savePacs({ name: "PACS", dicom_port: 70000 }), /port/);
  const pacs = await savePacs({ name: "PACS", orthanc_url: "https://pacs.example.pk/", viewer_url: "https://pacs.example.pk/stone-webviewer/index.html?study={StudyInstanceUID}", dicom_port: 4242 });
  assert.equal(pacs.orthanc_url, "https://pacs.example.pk");
  const o = { study_uid: "1.2.3", order_no: "RAD-1", images_received_at: null };
  assert.equal(imagesUrl(o, pacs), null);
  assert.equal(imagesUrl({ ...o, images_received_at: "x" }, pacs), "https://pacs.example.pk/stone-webviewer/index.html?study=1.2.3");
  assert.equal(imagesUrl({ ...o, images_received_at: "x" }, { ...pacs, viewer_url: null }), "https://pacs.example.pk/stone-webviewer/index.html?study=1.2.3");
});

test("DICOM API: worklist items for the machine, as DICOM JSON, with a stable Study Instance UID", async () => {
  const { xray, ct, order, p } = await setup();
  await payOrderFee("imaging", order.id, "cash");
  const key = await createMachineKey(xray.id);
  const m = await authenticateMachine(io, key);
  const [item] = (await getWorklist(io, m, "keywords")) as Record<string, unknown>[];
  assert.equal(item.AccessionNumber, accessionFor(order.order_no));
  assert.match(String(item.AccessionNumber), /^\d{12}$/, "16 characters at most");
  assert.equal(orderNoFor(String(item.AccessionNumber)), order.order_no);
  assert.equal(item.PatientID, p.mr_no);
  assert.equal(item.PatientName, "Zainab Noor");
  assert.deepEqual([item.PatientSex, item.PatientBirthDate, item.OtherPatientIDs, item.ReferringPhysicianName], ["F", "19960402", "35202-1234567-8", "Dr Hamid"]);
  assert.equal(item.RequestedProcedureDescription, "X-Ray Hand - Right hand");
  const sps = (item.ScheduledProcedureStepSequence as Record<string, unknown>[])[0];
  assert.deepEqual([sps.Modality, sps.ScheduledStationAETitle], ["DX", "XRAY01"]);
  assert.match(String(sps.ScheduledProcedureStepStartDate), /^\d{8}$/);
  assert.equal(item.StudyInstanceUID, await studyUidFor(order.id));
  assert.match(String(item.StudyInstanceUID), /^2\.25\.\d+$/);
  assert.ok(String(item.StudyInstanceUID).length <= 64);
  assert.equal((await hospitalImagingRepo.get(order.id))!.study_uid, item.StudyInstanceUID, "stored on first worklist");

  const [json] = (await getWorklist(io, m)) as Record<string, { vr: string; Value?: unknown[] }>[];
  assert.deepEqual(json["00100010"], { vr: "PN", Value: [{ Alphabetic: "Zainab Noor" }] });
  assert.deepEqual(json["00080050"], { vr: "SH", Value: [accessionFor(order.order_no)] });
  assert.equal(json["00400100"].vr, "SQ");
  assert.deepEqual((json["00400100"].Value![0] as Record<string, { Value: string[] }>)["00080060"].Value, ["DX"]);
  assert.deepEqual(toDicomJson({ PatientSex: "" }), { "00100040": { vr: "CS" } });

  const ctKey = await createMachineKey(ct.id);
  assert.deepEqual(await getWorklist(io, await authenticateMachine(io, ctKey)), [], "another modality's machine");
  await saveMachine(xray.id, { name: "X-Ray Room 1", modality_code: "XRAY", ae_title: "XRAY01", status: "maintenance" });
  await assert.rejects(authenticateMachine(io, key), /maintenance/);
  await assert.rejects(authenticateMachine(io, "Bearer nonsense"), /machine key/);
});

test("DICOM API: procedure steps and received images; the machine never completes the examination", async () => {
  const { xray, ct, order } = await setup();
  const m = await authenticateMachine(io, await createMachineKey(xray.id));
  await assert.rejects(postProcedureStep(io, m, { accessionNumber: order.order_no, status: "IN PROGRESS" }), /not paid/);
  await payOrderFee("imaging", order.id, "cash");
  await assert.rejects(postProcedureStep(io, m, { accessionNumber: order.order_no, status: "STARTED" }), /status must be/);
  await assert.rejects(postProcedureStep(io, m, { accessionNumber: "RAD-NOPE", status: "IN PROGRESS" }), /No radiology order/);

  assert.deepEqual(await postProcedureStep(io, m, { accessionNumber: accessionFor(order.order_no), status: "in progress" }), { accessionNumber: order.order_no, status: "in_progress", acquisition: "in_progress" });
  let o = (await hospitalImagingRepo.get(order.id))!;
  assert.deepEqual([o.status, o.machine_id, o.exam_started_by_name], ["in_progress", xray.id, "X-Ray Room 1 (machine)"]);
  const other = await authenticateMachine(io, await createMachineKey(ct.id));
  await assert.rejects(postProcedureStep(io, other, { accessionNumber: order.order_no, status: "COMPLETED" }), /another machine/);

  await postProcedureStep(io, m, { accessionNumber: order.order_no, status: "COMPLETED", seriesCount: 1, imagesCount: 2 });
  o = (await hospitalImagingRepo.get(order.id))!;
  assert.deepEqual([o.status, o.acquisition_status, o.images_count], ["in_progress", "completed", 2], "completed by the technologist, not the machine");

  await assert.rejects(postStudyReceived(io, m, { studyInstanceUid: "abc" }), /DICOM UID/);
  await assert.rejects(postStudyReceived(io, m, { accessionNumber: "RAD-NOPE", studyInstanceUid: "1.2.3.4" }), /No radiology order/);
  await postStudyReceived(io, m, { accessionNumber: order.order_no, studyInstanceUid: "1.2.826.0.1.3680043.2.1", seriesCount: 1, imagesCount: 3 });
  o = (await hospitalImagingRepo.get(order.id))!;
  assert.deepEqual([o.study_uid, o.images_count, Boolean(o.images_received_at)], ["1.2.826.0.1.3680043.2.1", 3, true]);
  const kinds = db.prepare(`SELECT kind FROM radiology_dicom_events ORDER BY created_at, kind`).all().map((r) => (r as { kind: string }).kind);
  assert.deepEqual(kinds.sort(), ["mpps", "mpps", "study", "study_unmatched"]);
  assert.equal(mppsStatusOf("Discontinued"), "discontinued");
});

test("DICOM API: a key only reaches its own hospital's orders", async () => {
  const { xray, order } = await setup();
  await payOrderFee("imaging", order.id, "cash");
  const m = await authenticateMachine(io, await createMachineKey(xray.id));
  db.prepare(`UPDATE hospital_imaging_orders SET tenant_id = 'hosp-b' WHERE id = ?`).run(order.id);
  assert.deepEqual(await getWorklist(io, m), []);
  await assert.rejects(postProcedureStep(io, m, { accessionNumber: order.order_no, status: "IN PROGRESS" }), /No radiology order/);
});

test("before the v59 migration, radiology orders are still placed (without the portal fields)", async () => {
  db = fullSchemaDb(58);
  setTestDb(db);
  const study = await saveImagingStudy(null, { name: "X-Ray Chest PA", modality: "X-Ray", rate: 0 });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Old Schema", gender: "Male" });
  const { order } = await orderImaging({ patientId: p.id, serviceId: study.id, bodyPart: "Chest", priority: "urgent", clinicalHistory: "Cough" });
  assert.deepEqual([order.body_part, order.priority, order.status], ["Chest", "urgent", "pending"]);
});
