/** Central lab report search and printing: the 10 acceptance tests, with real
 * logins per role and location, through the app's repositories on the complete
 * schema. One hospital, its lab counter and two collection centers share one
 * set of report records. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb, applySchema } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { localDate } from "@/lib/localDate";
import { hospitalPatientsRepo, nextMrNo, listChargesForEpisode } from "@/lib/repo/hospital";
import { saveHospitalStaff, saveLabTest, orderLabTests, payOrderFee, bookOpdVisit, orderInvestigation } from "@/lib/repo/hospitalOpd";
import {
  saveCollectionCenter, searchLabReports, getLabReport, recordReportPrint, listReportLog, receiveSample, enterLabResult,
  verifyLabResult, returnLabResult, labCapabilities, isValidLabNumber, formatLabNumber, checkDigit, createLabRequest, labRequestsRepo,
} from "@/lib/repo/labReports";
import { createStaffLogin } from "@/lib/hospitalLogins";
import type { UserAccount } from "@/lib/types2";

const H = "hosp-a";
const TODAY = localDate();
let sql: DatabaseSync;
type Who = { user: UserAccount; staffId: string };
let owner: () => void;
let pathologist: Who, tech: Who, labDesk: Who, centerA: Who, centerB: Who, nurse: Who;
let ccA: string, ccB: string;

function session(tenantId: string, user: { id: string; role: "owner" | "staff"; permissions: string[] | null; name: string }) {
  const tenant: SessionTenant = {
    id: tenantId, name: "Test Hospital Sargodha", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 20,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: user.id, username: user.name, displayName: user.name, role: user.role, tenantId, permissions: user.permissions }, currentTenant: tenant });
}
const as = (w: Who) => session(H, { id: w.user.id, role: "staff", permissions: JSON.parse(w.user.permissions!), name: w.user.display_name ?? "staff" });

function insert(table: string, values: Record<string, unknown>) {
  const cols = sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: unknown }[];
  const r: Record<string, unknown> = { created_at: TODAY, updated_at: TODAY, ...values };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in r)) r[c.name] = c.name.endsWith("_at") ? TODAY : 0;
  const keys = Object.keys(r).filter((k) => cols.some((c) => c.name === k));
  sql.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k]) as never[]));
}

async function hire(name: string, staff_category: string, license_no: string | null, collection_center_id: string | null = null): Promise<Who> {
  owner();
  const s = await saveHospitalStaff(null, { name, staff_category, license_no, collection_center_id, basic_pay: 0 });
  const user = await createStaffLogin(s.id, name.toLowerCase().replace(/\W/g, ""), "pass1234");
  return { user, staffId: s.id };
}

let cbc: string, sugar: string;

beforeEach(async () => {
  sql = fullSchemaDb(42);
  setTestDb(sql);
  insert("subscription_plans", { id: "plan", name: "Plan", max_staff_logins: 20, price: 0 });
  insert("tenants", { id: H, name: "Test Hospital Sargodha", business_type: "hospital", subscription_plan_id: "plan" });
  insert("tenants", { id: "hosp-b", name: "Other Hospital", business_type: "hospital", subscription_plan_id: "plan" });
  owner = () => session(H, { id: "owner-u", role: "owner", permissions: null, name: "Owner" });
  owner();
  ccA = (await saveCollectionCenter(null, { code: "CC-A", name: "Satellite Town Center" })).id;
  ccB = (await saveCollectionCenter(null, { code: "CC-B", name: "Cantt Center" })).id;
  cbc = (await saveLabTest(null, { name: "CBC", sample_type: "Whole blood (EDTA)", unit: "g/dL", ref_range: "13-17", rate: 800 })).id;
  sugar = (await saveLabTest(null, { name: "Blood Sugar Random", sample_type: "Blood", unit: "mg/dL", ref_range: "70-140", rate: 300 })).id;
  pathologist = await hire("Dr Path", "pathologist", "PMDC-555");
  tech = await hire("Tech One", "lab_technician", null);
  labDesk = await hire("Lab Desk", "lab_receptionist", null);
  centerA = await hire("Center A Desk", "collection_center_receptionist", null, ccA);
  centerB = await hire("Center B Desk", "collection_center_receptionist", null, ccB);
  nurse = await hire("Nurse N", "nurse", "PNC-1");
});

const patient = async (name = "Bilal Khalid") => {
  owner();
  return hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name, gender: "Male", phone: "0300-7654321", age_years: 34 });
};

/** Registers an order as `who`, pays it, and takes it through the lab to the given stage. */
async function order(who: Who, stage: "registered" | "entered" | "verified", tests = [cbc, sugar]) {
  const p = await patient();
  as(who);
  const { request, orders, episode } = await orderLabTests({ patientId: p.id, serviceIds: tests, orderedBy: "Dr Rab Nawaz", sampleCollected: true });
  owner();
  for (const o of orders) await payOrderFee("lab", o.id, "cash");
  if (stage !== "registered") {
    as(tech);
    await receiveSample(request.id);
    for (const o of orders) await enterLabResult(o.id, { result_value: o.test_name === "CBC" ? "11.2" : "120", unit: o.unit, ref_range: o.ref_range, flag: o.test_name === "CBC" ? "L" : "N" });
  }
  if (stage === "verified") {
    as(pathologist);
    for (const o of orders) await verifyLabResult(o.id);
  }
  return { patient: p, request, orders, episode };
}

// 1
test("1. an order registered at a collection center is found at the hospital lab counter by its Lab Invoice Number", async () => {
  const { request } = await order(centerA, "verified");
  assert.equal(request.registration_location, "collection_center");
  assert.equal(request.collection_center_id, ccA);
  as(labDesk);
  const r = await searchLabReports(request.invoice_no);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].request.id, request.id);
  assert.equal(r.rows[0].location, "Collection center: Satellite Town Center");
  assert.equal(r.rows[0].status, "Authorized");
  assert.deepEqual(r.rows[0].tests.map((t) => t.test_name).sort(), ["Blood Sugar Random", "CBC"]);
});

// 2
test("2. the same order is found by its Unique Lab Number (and by order number, MRN, reference, name)", async () => {
  const { request, orders, patient: p } = await order(centerA, "verified");
  as(labDesk);
  assert.equal((await searchLabReports(request.lab_no)).rows[0].request.id, request.id);
  assert.equal((await searchLabReports(request.lab_no.toLowerCase(), "lab_no")).rows[0].request.id, request.id, "case does not matter");
  assert.equal((await searchLabReports(orders[0].order_no)).rows[0].request.id, request.id);
  assert.equal((await searchLabReports(p.mr_no)).rows[0].request.id, request.id);
  assert.equal((await searchLabReports("bilal", "name_phone")).rows[0].request.id, request.id);
  assert.equal((await searchLabReports("7654321", "name_phone")).rows[0].request.id, request.id);
  assert.ok(isValidLabNumber("LN", request.lab_no));
  assert.ok(isValidLabNumber("LI", request.invoice_no));
  assert.notEqual(request.lab_no, request.invoice_no, "two separate identifiers");
});

// 3
test("3. an order registered at the hospital lab is found at a collection center", async () => {
  const { request } = await order(labDesk, "verified");
  assert.equal(request.registration_location, "hospital_lab");
  as(centerA);
  const r = await searchLabReports(request.invoice_no);
  assert.equal(r.rows[0].location, "Hospital lab counter");
  assert.ok(r.rows[0].printable);
});

// 4
test("4. an order from Collection Center A is found and printed at Collection Center B", async () => {
  const { request } = await order(centerA, "verified");
  as(centerB);
  const r = await searchLabReports(request.lab_no);
  assert.equal(r.rows.length, 1);
  const rep = await getLabReport(r.rows[0].request.id, { checked: true, method: "CNIC" });
  assert.equal(rep.centerName, "Satellite Town Center");
  assert.equal((await recordReportPrint(request.id)).printCount, 1);
  const log = await listReportLog(request.id);
  assert.equal(log[0].user_name, "Center B Desk");
});

// 5
test("5. a finalized report opens (after the identity check) with everything the print needs, and prints", async () => {
  const { request } = await order(centerA, "verified");
  as(labDesk);
  await assert.rejects(getLabReport(request.id, { checked: false }), /Confirm the patient's identity/);
  const rep = await getLabReport(request.id, { checked: true, method: "Lab slip" });
  assert.equal(rep.hospital.name, "Test Hospital Sargodha");
  assert.equal(rep.patient.name, "Bilal Khalid");
  assert.equal(rep.referringDoctor, "Dr Rab Nawaz");
  assert.equal(rep.location, "Collection center: Satellite Town Center");
  assert.ok(rep.request.sample_collected_at && rep.request.sample_received_at && rep.reportDate);
  const cbcRow = rep.tests.find((t) => t.test_name === "CBC")!;
  assert.deepEqual([cbcRow.result_value, cbcRow.unit, cbcRow.ref_range, cbcRow.flag, cbcRow.sample_type], ["11.2", "g/dL", "13-17", "L", "Whole blood (EDTA)"]);
  assert.equal(cbcRow.verified_by_name, "Dr Path");
  assert.equal(cbcRow.verified_by_license, "PMDC PMDC-555");
  assert.equal(rep.pendingTests.length, 0);
  assert.match(rep.verificationCode, new RegExp(`^${request.lab_no}/[0-9A-Z]{7}$`));
  const p1 = await recordReportPrint(request.id);
  assert.deepEqual(p1, { printCount: 1, reprint: false });
  assert.equal((await searchLabReports(request.lab_no)).rows[0].status, "Printed");
});

// 6
test("6. an unverified report cannot be printed; receptionists cannot enter or release results", async () => {
  const { request, orders } = await order(centerA, "entered");
  as(labDesk);
  const row = (await searchLabReports(request.invoice_no)).rows[0];
  assert.equal(row.status, "Awaiting Verification");
  assert.equal(row.printable, false);
  await assert.rejects(recordReportPrint(request.id), /verified yet, so it cannot be printed/);
  const rep = await getLabReport(request.id, { checked: true });
  assert.equal(rep.tests.length, 0, "no unverified values reach the report");
  assert.deepEqual(rep.pendingTests.map((t) => t.label), ["Awaiting Verification", "Awaiting Verification"]);
  await assert.rejects(verifyLabResult(orders[0].id), /Only a pathologist/);
  await assert.rejects(enterLabResult(orders[0].id, { result_value: "1", unit: null, ref_range: null, flag: "N" }), /Only lab staff/);
  as(tech);
  await assert.rejects(verifyLabResult(orders[0].id), /Only a pathologist/, "the technician cannot release their own result");

  // Partial: one test verified; only it prints, the other is listed as pending.
  as(pathologist);
  await verifyLabResult(orders[0].id);
  as(labDesk);
  const partial = (await searchLabReports(request.invoice_no)).rows[0];
  assert.match(partial.status, /Partially Authorized \(1 of 2\)/);
  const rep2 = await getLabReport(request.id, { checked: true });
  assert.equal(rep2.tests.length, 1);
  assert.equal(rep2.pendingTests.length, 1);

  // A returned (corrected) result is withdrawn from the report again.
  as(pathologist);
  await returnLabResult(orders[0].id, "Haemolysed sample");
  as(labDesk);
  assert.equal((await getLabReport(request.id, { checked: true })).tests.length, 0);
});

// 7
test("7. invalid or unknown numbers give safe, clear messages", async () => {
  await order(centerA, "verified");
  as(labDesk);
  const good = formatLabNumber("LI", 2026, 1);
  const wrongCheck = good.slice(0, -1) + String((Number(good.slice(-1)) + 1) % 10);
  assert.match((await searchLabReports(wrongCheck)).message ?? "", /not a valid Lab Invoice Number/);
  assert.match((await searchLabReports("LN26-12", "lab_no")).message ?? "", /not a valid Unique Lab Number/);
  assert.match((await searchLabReports(formatLabNumber("LN", 2026, 999999))).message ?? "", /No lab order found/);
  assert.match((await searchLabReports("xyz", "invoice")).message ?? "", /not a valid Lab Invoice Number/);
  assert.match((await searchLabReports("  ")).message ?? "", /Enter a Lab Invoice Number/);
  assert.match((await searchLabReports("ab", "name_phone")).message ?? "", /at least 3/);
  // Identifiers must match exactly: a part of a number finds nothing.
  assert.equal((await searchLabReports("LN26", "lab_no")).rows.length, 0);
});

// 8
test("8. duplicate Lab Numbers cannot exist: the database refuses them and concurrent registration retries", async () => {
  const { request } = await order(labDesk, "registered");
  assert.throws(
    () => insert("hospital_lab_requests", { id: "dup", tenant_id: H, lab_no: request.lab_no, invoice_no: "LI-OTHER", patient_id: request.patient_id }),
    /UNIQUE/
  );
  assert.throws(
    () => insert("hospital_lab_requests", { id: "dup2", tenant_id: H, lab_no: "LN-OTHER", invoice_no: request.invoice_no, patient_id: request.patient_id }),
    /UNIQUE/
  );
  // Another counter just took the next number: registration still gets a free one.
  const nextNo = formatLabNumber("LN", new Date().getFullYear(), Number(request.lab_no.slice(5, 11)) + 1);
  insert("hospital_lab_requests", { id: "taken", tenant_id: H, lab_no: nextNo, invoice_no: "LI-TAKEN", patient_id: request.patient_id });
  as(labDesk);
  const fresh = await createLabRequest({ patientId: request.patient_id, episodeId: null });
  assert.notEqual(fresh.lab_no, nextNo);
  const all = sql.prepare(`SELECT lab_no FROM hospital_lab_requests WHERE tenant_id = ?`).all(H) as { lab_no: string }[];
  assert.equal(new Set(all.map((r) => r.lab_no)).size, all.length);
  assert.equal(checkDigit("26-000001"), Number(formatLabNumber("LN", 2026, 1).slice(-1)));
});

// 9
test("9. views, prints and reprints are logged with user, time and location", async () => {
  const { request } = await order(centerA, "verified");
  as(labDesk);
  await getLabReport(request.id, { checked: true, method: "CNIC" });
  await recordReportPrint(request.id);
  as(centerB);
  const again = await recordReportPrint(request.id);
  assert.deepEqual(again, { printCount: 2, reprint: true });
  assert.equal((await searchLabReports(request.lab_no)).rows[0].status, "Reprinted");
  const log = (await listReportLog(request.id)).reverse();
  assert.deepEqual(log.map((l) => [l.action, l.user_name, l.location_id]), [
    ["view", "Lab Desk", null],
    ["print", "Lab Desk", null],
    ["reprint", "Center B Desk", ccB],
  ]);
  assert.match(log[0].details ?? "", /CNIC/);
  assert.ok(log.every((l) => l.created_at));
});

// 10
test("10. existing billing, registration and doctor orders keep working; existing lab orders are carried over", async () => {
  // Billing and the doctor's desk.
  owner();
  const doc = await saveHospitalStaff(null, { name: "Dr Con", staff_category: "consultant", license_no: "PMDC-9", consultation_fee: 1500, basic_pay: 0 });
  const p = await patient("OPD Patient");
  owner();
  const visit = await bookOpdVisit({ patientId: p.id, doctorId: doc.id, pay: { method: "cash" } });
  const a = await orderInvestigation(visit.episode.id, cbc);
  const b = await orderInvestigation(visit.episode.id, sugar);
  const ra = (a.order as { request_id: string }).request_id;
  assert.equal(ra, (b.order as { request_id: string }).request_id, "a doctor's orders in one visit share one Lab Number");
  const req = await labRequestsRepo.get(ra);
  assert.equal(req?.registration_location, "department");
  assert.deepEqual((await listChargesForEpisode(visit.episode.id)).map((c) => c.amount).sort((x, y) => x - y), [300, 800, 1500]);

  // Lab orders made before v42 get their own request; a released result stays released and searchable.
  const old = fullSchemaDb(41);
  setTestDb(old);
  const row = (table: string, v: Record<string, unknown>) => {
    const cols = old.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number; dflt_value: unknown }[];
    const r: Record<string, unknown> = { created_at: TODAY, updated_at: TODAY, ...v };
    for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in r)) r[c.name] = c.name.endsWith("_at") ? TODAY : 0;
    const keys = Object.keys(r).filter((k) => cols.some((c) => c.name === k));
    old.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(keys.map((k) => r[k]) as never[]));
  };
  row("hospital_patients", { id: "p-old", tenant_id: H, mr_no: "MR-OLD", name: "Old Patient", gender: "Male" });
  row("hospital_lab_orders", { id: "o-old", tenant_id: H, order_no: "LAB-20261001-0001", patient_id: "p-old", test_name: "Hb", status: "reported", result_value: "12", ordered_at: TODAY, reported_at: "2026-10-01 10:00" });
  row("hospital_lab_orders", { id: "o-wait", tenant_id: H, order_no: "LAB-20261001-0002", patient_id: "p-old", test_name: "TSH", status: "pending", ordered_at: TODAY });
  applySchema(old, 42);
  const reqs = old.prepare(`SELECT id, lab_no FROM hospital_lab_requests ORDER BY lab_no`).all() as { id: string; lab_no: string }[];
  assert.deepEqual(reqs.map((r) => r.lab_no), ["LN-LAB-20261001-0001", "LN-LAB-20261001-0002"]);
  const migrated = old.prepare(`SELECT status, verified_by_name, verified_at, request_id FROM hospital_lab_orders WHERE id = 'o-old'`).get() as Record<string, unknown>;
  assert.equal(migrated.status, "reported");
  assert.equal(migrated.verified_by_name, "Released before verification was required");
  assert.equal(migrated.request_id, "lr-o-old");
  owner();
  const found = await searchLabReports("LAB-20261001-0001");
  assert.equal(found.rows[0].request.lab_no, "LN-LAB-20261001-0001");
  assert.ok(found.rows[0].printable);
  assert.equal((await searchLabReports("LAB-20261001-0002")).rows[0].status, "Sample Awaited");
});

test("permissions: staff without Lab Reports cannot search; another hospital never sees these reports", async () => {
  const { request } = await order(centerA, "verified");
  as(nurse);
  assert.equal((await labCapabilities()).search, false);
  await assert.rejects(searchLabReports(request.lab_no), /permission to search lab reports/);
  await assert.rejects(getLabReport(request.id, { checked: true }), /permission/);
  await assert.rejects(recordReportPrint(request.id), /permission/);
  session("hosp-b", { id: "b-owner", role: "owner", permissions: null, name: "B Owner" });
  assert.equal((await searchLabReports(request.lab_no)).rows.length, 0);
  await assert.rejects(getLabReport(request.id, { checked: true }), /not found/);
});
