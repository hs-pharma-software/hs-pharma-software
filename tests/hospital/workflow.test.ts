/** The Hospital module end to end through its real repositories on the complete
 * schema: patients, services, departments, episodes, charges, payments, discharge,
 * lab, radiology, dashboard numbers, validation, and tenant isolation. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { friendlyDbError } from "@/lib/repo/base";
import { localDate, localDateTime } from "@/lib/localDate";
import {
  hospitalPatientsRepo, hospitalServicesRepo, hospitalEpisodesRepo, hospitalDepartmentsRepo, hospitalLabRepo, hospitalImagingRepo,
  nextMrNo, nextEpisodeNo, nextOrderNo, listEpisodes, listChargesForEpisode, listPaymentsForEpisode,
  addCharge, deleteCharge, addPayment, getHospitalStats,
} from "@/lib/repo/hospital";
import type { EpisodeType } from "@/lib/types-hospital";

const A = "hosp-a";
const B = "hosp-b";
const TODAY = localDate();
let sql: DatabaseSync;

function loginAs(tenantId: string) {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: "u", username: "u", displayName: "U", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

const patient = async (name = "Ali Raza") =>
  hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name, gender: "Male", phone: "0300-1", blood_group: "O+", city: "Lahore" });

const episode = async (patientId: string, type: EpisodeType = "opd", department: string | null = "Neuro Department") =>
  hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo(type, TODAY), type, patient_id: patientId, doctor_id: null, department, date: TODAY, time: "10:00",
    status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null, diagnosis: null, notes: null,
  });

const charge = (episodeId: string, over: Record<string, unknown> = {}) =>
  addCharge({
    tenant_id: A, episode_id: episodeId, service_id: null, description: "Consultation", department: "Neuro Department", category: "consultation",
    qty: 1, rate: 1000, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: TODAY, notes: null, invoice_id: null, ...over,
  });

const pay = (episodeId: string, type: "deposit" | "payment" | "refund", amount: number) =>
  addPayment({ tenant_id: A, episode_id: episodeId, type, amount, method: "cash", reference: null, notes: null, received_at: localDateTime() });

beforeEach(() => {
  sql = fullSchemaDb(38);
  setTestDb(sql);
  loginAs(A);
});

test("patients: register with every field, read back, edit, list; MR numbers are unique even after a delete", async () => {
  const p = await hospitalPatientsRepo.create({
    mr_no: await nextMrNo(), name: "Huzaifa Noor", father_name: "Noor", dob: "1990-01-02", age_years: 36, gender: "Male", phone: "0300-5", cnic: "35202-1234567-1",
    blood_group: "A+", allergies: "Penicillin", chronic_conditions: "Asthma", insurance_company: "State Life", insurance_no: "SL-1",
    next_of_kin_name: "Noor", next_of_kin_phone: "0300-6", next_of_kin_relation: "Father", address: "Street 1", city: "Lahore", notes: "n",
  });
  assert.equal(p.mr_no, "MR-000001");
  const back = await hospitalPatientsRepo.get(p.id);
  assert.equal(back?.allergies, "Penicillin");
  assert.equal(back?.next_of_kin_relation, "Father");
  await hospitalPatientsRepo.update(p.id, { phone: "0311-9", city: "Karachi" });
  assert.equal((await hospitalPatientsRepo.get(p.id))?.city, "Karachi");
  assert.equal((await hospitalPatientsRepo.list()).length, 1);

  const second = await patient("Second");
  assert.equal(second.mr_no, "MR-000002");
  await hospitalPatientsRepo.remove(p.id);
  const third = await patient("Third");
  assert.equal(third.mr_no, "MR-000003", "a deleted patient's number is not handed out again");
});

test("a repeated value gives a readable message, not a database error", async () => {
  await hospitalServicesRepo.create({ code: "CONS", name: "Consultation", department: "General", category: "consultation", billing_unit: "visit", rate: 500, is_active: 1, notes: null });
  await assert.rejects(
    hospitalServicesRepo.create({ code: "CONS", name: "Other", department: "General", category: "consultation", billing_unit: "visit", rate: 1, is_active: 1, notes: null }),
    /That code is already in use/
  );
  await hospitalDepartmentsRepo.create({ name: "Neuro", type: "clinical", head: null, phone: null, notes: null, is_active: 1 });
  await assert.rejects(hospitalDepartmentsRepo.create({ name: "Neuro", type: "clinical", head: null, phone: null, notes: null, is_active: 1 }), /That name is already in use/);
  const p = await patient();
  await assert.rejects(hospitalPatientsRepo.create({ mr_no: p.mr_no, name: "Dup", gender: "Male" }), /That mr no is already in use/);
  // Unrelated errors pass through unchanged.
  assert.equal(friendlyDbError(new Error("disk full")).message, "disk full");
});

test("services and departments: create, edit, list active", async () => {
  const s = await hospitalServicesRepo.create({ code: "XR-CH", name: "Chest X-Ray", department: "Radiology", category: "imaging", billing_unit: "test", rate: 1200, is_active: 1, notes: null });
  await hospitalServicesRepo.update(s.id, { rate: 1500, is_active: 0 });
  const back = await hospitalServicesRepo.get(s.id);
  assert.equal(back?.rate, 1500);
  assert.equal(back?.is_active, 0);
  const d = await hospitalDepartmentsRepo.create({ name: "Cardiology", type: "clinical", head: "Dr H", phone: "042", notes: null, is_active: 1 });
  await hospitalDepartmentsRepo.update(d.id, { head: "Dr K" });
  assert.equal((await hospitalDepartmentsRepo.get(d.id))?.head, "Dr K");
});

test("episode: open, charge, receive, balance, discharge; list totals are right", async () => {
  const p = await patient();
  const ep = await episode(p.id);
  assert.match(ep.episode_no, /^OPD-\d{8}-001$/);

  await charge(ep.id, { description: "Consultation", qty: 1, rate: 1000 });
  await charge(ep.id, { description: "ECG", qty: 2, rate: 300, discount_pct: 10 });
  const charges = await listChargesForEpisode(ep.id);
  assert.deepEqual(charges.map((c) => c.amount).sort((a, b) => a - b), [540, 1000]);

  await pay(ep.id, "deposit", 500);
  await pay(ep.id, "payment", 700);
  await pay(ep.id, "refund", 100);

  const [row] = await listEpisodes({ status: "open" });
  assert.equal(row.patient_name, "Ali Raza");
  assert.equal(row.mr_no, p.mr_no);
  assert.equal(row.total_charges, 1540);
  assert.equal(row.total_paid, 1100, "500 + 700 received, 100 refunded");
  assert.equal((await listPaymentsForEpisode(ep.id)).length, 3);

  await hospitalEpisodesRepo.update(ep.id, { status: "discharged", discharge_date: TODAY });
  assert.equal((await listEpisodes({ status: "open" })).length, 0);
  assert.equal((await listEpisodes({ status: "discharged" }))[0].id, ep.id);
  assert.equal((await hospitalEpisodesRepo.get(ep.id))?.discharge_date, TODAY);
});

test("charges and payments are validated and cannot reach a closed or foreign episode", async () => {
  const p = await patient();
  const ep = await episode(p.id);
  await assert.rejects(charge(ep.id, { qty: 0 }), /Quantity must be more than zero/);
  await assert.rejects(charge(ep.id, { rate: -5 }), /Rate cannot be negative/);
  await assert.rejects(charge(ep.id, { discount_pct: 150 }), /Discount must be between/);
  await assert.rejects(charge(ep.id, { description: "  " }), /Enter a description/);
  await assert.rejects(charge("no-such-episode"), /Episode not found/);
  await assert.rejects(pay(ep.id, "payment", 0), /more than zero/);
  await assert.rejects(pay(ep.id, "refund", 50), /cannot be more than the 0 received/);
  assert.equal((await listChargesForEpisode(ep.id)).length, 0, "nothing was saved by the rejected requests");

  const c = await charge(ep.id);
  await pay(ep.id, "payment", 300);
  await assert.rejects(pay(ep.id, "refund", 400), /cannot be more than the 300/);
  await pay(ep.id, "refund", 300);

  await hospitalEpisodesRepo.update(ep.id, { status: "discharged" });
  await assert.rejects(charge(ep.id), /episode is closed/);
  await assert.rejects(deleteCharge(c.id), /episode is closed/);
  await pay(ep.id, "payment", 1000); // settling after discharge is allowed
});

test("removing a charge takes it off the bill", async () => {
  const p = await patient();
  const ep = await episode(p.id);
  const c1 = await charge(ep.id, { description: "A", rate: 100 });
  await charge(ep.id, { description: "B", rate: 200 });
  await deleteCharge(c1.id);
  assert.deepEqual((await listChargesForEpisode(ep.id)).map((c) => c.description), ["B"]);
  assert.equal((await listEpisodes())[0].total_charges, 200);
  await assert.rejects(deleteCharge(c1.id), /Charge not found/);
});

test("OPD, IPD and emergency queues and the dashboard numbers", async () => {
  const p = await patient();
  const opd = await episode(p.id, "opd");
  await episode(p.id, "ipd");
  await episode(p.id, "emergency");
  const closed = await episode(p.id, "opd");
  await hospitalEpisodesRepo.update(closed.id, { status: "discharged" });
  assert.equal((await listEpisodes({ type: "opd", status: "open" })).length, 1);
  assert.equal((await listEpisodes({ type: "ipd" })).length, 1);
  assert.equal((await listEpisodes({ type: "emergency" })).length, 1);

  await pay(opd.id, "payment", 1000);
  await pay(opd.id, "refund", 200);
  const s = await getHospitalStats();
  assert.equal(s.totalPatients, 1);
  assert.equal(s.openOpdToday, 1);
  assert.equal(s.openIpd, 1);
  assert.equal(s.openEmergency, 1);
  assert.equal(s.todayRevenue, 800, "refunds come off the day's total");
});

test("lab and radiology: order, result / report, filter, numbers never repeat", async () => {
  const p = await patient();
  const lab = await hospitalLabRepo.create({
    order_no: await nextOrderNo("hospital_lab_orders"), episode_id: null, patient_id: p.id, test_name: "CBC", priority: "urgent", status: "pending",
    result_value: null, unit: null, ref_range: null, flag: null, ordered_by: "Dr X", ordered_at: localDateTime(), reported_at: null, notes: null,
  });
  const lab2 = await hospitalLabRepo.create({
    order_no: await nextOrderNo("hospital_lab_orders"), episode_id: null, patient_id: p.id, test_name: "LFT", priority: "routine", status: "pending",
    result_value: null, unit: null, ref_range: null, flag: null, ordered_by: null, ordered_at: localDateTime(), reported_at: null, notes: null,
  });
  assert.notEqual(lab.order_no, lab2.order_no);
  await hospitalLabRepo.update(lab.id, { result_value: "13.5", unit: "g/dL", ref_range: "12-16", flag: "N", status: "reported", reported_at: localDateTime() });
  const reported = (await hospitalLabRepo.list()).filter((o) => o.status === "reported");
  assert.equal(reported.length, 1);
  assert.equal(reported[0].result_value, "13.5");
  await hospitalLabRepo.remove(lab2.id);
  const lab3 = await hospitalLabRepo.create({
    order_no: await nextOrderNo("hospital_lab_orders"), episode_id: null, patient_id: p.id, test_name: "Sugar", priority: "routine", status: "pending",
    result_value: null, unit: null, ref_range: null, flag: null, ordered_by: null, ordered_at: localDateTime(), reported_at: null, notes: null,
  });
  assert.notEqual(lab3.order_no, lab.order_no);
  assert.notEqual(lab3.order_no, lab2.order_no);

  const img = await hospitalImagingRepo.create({
    order_no: await nextOrderNo("hospital_imaging_orders"), episode_id: null, patient_id: p.id, modality: "X-Ray", body_part: "Chest PA", priority: "routine",
    status: "pending", findings: null, impression: null, radiologist: null, ordered_by: null, ordered_at: localDateTime(), reported_at: null, notes: null,
  });
  await hospitalImagingRepo.update(img.id, { findings: "Clear", impression: "Normal chest", radiologist: "Dr R", status: "reported", reported_at: localDateTime() });
  const back = await hospitalImagingRepo.get(img.id);
  assert.equal(back?.impression, "Normal chest");
  assert.match(back!.order_no, /^RAD-/);
});

test("lab, radiology and episodes cannot point at another hospital's patient", async () => {
  const mine = await patient("Mine");
  loginAs(B);
  const theirs = await patient("Theirs");
  loginAs(A);
  await assert.rejects(
    hospitalLabRepo.create({
      order_no: "L1", episode_id: null, patient_id: theirs.id, test_name: "CBC", priority: "routine", status: "pending", result_value: null, unit: null, ref_range: null,
      flag: null, ordered_by: null, ordered_at: localDateTime(), reported_at: null, notes: null,
    }),
    /Patient not found in this business/
  );
  await assert.rejects(episode(theirs.id), /Patient not found in this business/);
  assert.ok(await episode(mine.id));
});

test("tenant isolation: another hospital sees and changes nothing here", async () => {
  const p = await patient();
  const ep = await episode(p.id);
  const c = await charge(ep.id);
  await pay(ep.id, "payment", 100);
  await hospitalServicesRepo.create({ code: "S1", name: "Svc", department: "G", category: "misc", billing_unit: "unit", rate: 1, is_active: 1, notes: null });
  await hospitalDepartmentsRepo.create({ name: "Dept", type: "clinical", head: null, phone: null, notes: null, is_active: 1 });

  loginAs(B);
  assert.equal((await hospitalPatientsRepo.list()).length, 0);
  assert.equal((await listEpisodes()).length, 0);
  assert.equal((await hospitalServicesRepo.list()).length, 0);
  assert.equal((await hospitalDepartmentsRepo.list()).length, 0);
  assert.equal(await hospitalEpisodesRepo.get(ep.id), null);
  assert.equal((await getHospitalStats()).totalPatients, 0);
  await assert.rejects(charge(ep.id), /Episode not found/);
  await assert.rejects(pay(ep.id, "payment", 5), /Episode not found/);
  await assert.rejects(deleteCharge(c.id), /Charge not found/);
  await hospitalEpisodesRepo.update(ep.id, { status: "cancelled" });
  assert.equal((sql.prepare(`SELECT status FROM hospital_episodes WHERE id = ?`).get(ep.id) as { status: string }).status, "open");
  // Each hospital numbers from the start.
  assert.equal((await patient("B's first")).mr_no, "MR-000001");

  loginAs(A);
  assert.equal((await listChargesForEpisode(ep.id)).length, 1);
});

test("dates follow the computer's clock, not UTC", () => {
  const d = new Date(2026, 9, 24, 0, 30); // 24 Oct 00:30 local time
  assert.equal(localDate(d), "2026-10-24");
  assert.equal(localDateTime(d), "2026-10-24 00:30");
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("a missing table is explained, using the exact error from the web version", async () => {
  const { explainMissingTable } = await import("@/lib/dbErrors");
  const e = explainMissingTable(new Error("SQLITE_UNKNOWN: SQLite error: no such table: clinic_patients"));
  assert.ok(e);
  assert.match(e!.message, /database is not up to date: table "clinic_patients" is missing/);
  assert.match(e!.message, /migrate-turso\.cjs/);
  assert.equal(explainMissingTable(new Error("NOT NULL constraint failed")), null);
});
