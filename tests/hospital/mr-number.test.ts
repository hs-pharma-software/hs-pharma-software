/** Hospital MR numbers MR-<number>-<registration date>-<year>: a number that
 * never restarts, the year part renewed at the first visit of a new year with
 * the earlier MR kept, old slips still found, and existing patients converted
 * by the v97 database update. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { applySchema, fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hospitalEpisodesRepo, hospitalPatientsRepo, mrHistory, nextEpisodeNo, nextMrNo } from "@/lib/repo/hospital";
import { listOpdQueue } from "@/lib/repo/hospitalOpd";
import { findPatients } from "@/lib/repo/records";
import { formatMr, mrMatches, parseMr } from "@/lib/hospitalMr";

let db: DatabaseSync;
function loginAs(tenantId: string) {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: "u", username: "u", displayName: "U", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}
const visit = async (patientId: string, date: string) => hospitalEpisodesRepo.create({
  episode_no: await nextEpisodeNo("opd", date), type: "opd", patient_id: patientId, doctor_id: null, department: null, date, time: null,
  status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null, diagnosis: null, notes: null,
});

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  loginAs("hosp-a");
});

test("format and matching: MR-0001-23112026-2026, an old slip of another year, and MR-000123 by its number", () => {
  assert.equal(formatMr(1, "2026-11-23", 2026), "MR-0001-23112026-2026");
  assert.equal(formatMr(12345, "2026-11-23", 2027), "MR-12345-23112026-2027");
  assert.deepEqual(parseMr("MR-0001-23112026-2027"), { seq: 1, regDate: "2026-11-23", year: 2027 });
  assert.equal(parseMr("MR-000123"), null);
  const p = { mr_no: "MR-0123-05012025-2027", mr_seq: 123 };
  assert.ok(mrMatches(p, "MR-0123-05012025-2025"), "an old slip");
  assert.ok(mrMatches(p, "mr-000123"), "the number before the new format");
  assert.ok(mrMatches(p, "0123-0501"));
  assert.ok(!mrMatches(p, "MR-0124-05012025-2027"));
  assert.ok(!mrMatches(p, "MR-000124"));
});

test("new patients: the number counts on, with the registration date and year", async () => {
  const a = await hospitalPatientsRepo.create({ mr_no: await nextMrNo("2026-11-23"), name: "Ayesha", gender: "Female" });
  const b = await hospitalPatientsRepo.create({ mr_no: await nextMrNo("2026-12-31"), name: "Bilal", gender: "Male" });
  const c = await hospitalPatientsRepo.create({ mr_no: await nextMrNo("2027-01-02"), name: "Chand", gender: "Male" });
  assert.deepEqual([a.mr_no, b.mr_no, c.mr_no], ["MR-0001-23112026-2026", "MR-0002-31122026-2026", "MR-0003-02012027-2027"]);
  assert.deepEqual([c.mr_seq, c.mr_reg_date, c.mr_year], [3, "2027-01-02", 2027]);
  // Another counter took the number a moment earlier: the next one is given.
  const clash = await nextMrNo("2027-01-02");
  await hospitalPatientsRepo.create({ mr_no: clash, name: "Dua", gender: "Female" });
  const e = await hospitalPatientsRepo.create({ mr_no: clash, name: "Ehsan", gender: "Male" });
  assert.equal(e.mr_no, "MR-0005-02012027-2027");
  loginAs("hosp-b");
  assert.equal(await nextMrNo("2027-01-02"), "MR-0001-02012027-2027", "each hospital counts its own");
});

test("the first visit of a new year renews the year part; the earlier MR stays in the history and still finds the patient", async () => {
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo("2026-11-23"), name: "Ayesha Khan", gender: "Female" });
  await visit(p.id, "2026-12-20");
  assert.equal((await hospitalPatientsRepo.get(p.id))!.mr_no, "MR-0001-23112026-2026", "same year: unchanged");
  await visit(p.id, "2027-01-05");
  await visit(p.id, "2027-03-01");
  const now = (await hospitalPatientsRepo.get(p.id))!;
  assert.deepEqual([now.mr_no, now.mr_year], ["MR-0001-23112026-2027", 2027]);
  assert.deepEqual((await mrHistory(p.id)).map((h) => [h.mr_no, h.replaced_on]), [["MR-0001-23112026-2026", "2027-01-05"]]);
  // The old slip finds her in the OPD queue and in records.
  assert.equal((await listOpdQueue({ date: "2027-03-01", search: "MR-0001-23112026-2026" })).length, 1);
  assert.deepEqual((await findPatients("MR-0001-23112026-2026")).map((x) => x.name), ["Ayesha Khan"]);
});

test("the v97 update converts existing patients, keeping their number and the old MR in the history", () => {
  const old = fullSchemaDb(96);
  const ins = old.prepare(`INSERT INTO hospital_patients (id, tenant_id, mr_no, name, gender, created_at, updated_at) VALUES (?, ?, ?, ?, 'Male', ?, 'x')`);
  ins.run("p1", "h", "MR-000001", "One", "2025-03-04T10:00:00.000Z");
  ins.run("p2", "h", "MR-000007", "Seven", "2025-06-01T10:00:00.000Z");
  ins.run("p3", "h", "PAPER-55", "Paper file", "2025-07-01T10:00:00.000Z");
  ins.run("p4", "h", "MR-0008-01082025-2025", "Already new", "2025-08-01T10:00:00.000Z");
  ins.run("q1", "other", "MR-000001", "Other hospital", "2026-01-09T10:00:00.000Z");
  old.prepare(`INSERT INTO hospital_episodes (id, tenant_id, episode_no, type, patient_id, date, status, created_at, updated_at) VALUES ('e1', 'h', 'OPD-1', 'opd', 'p2', '2026-02-10', 'open', 'x', 'x')`).run();
  applySchema(old, 97);
  const rows = old.prepare(`SELECT id, mr_no, mr_seq FROM hospital_patients ORDER BY tenant_id, id`).all() as { id: string; mr_no: string; mr_seq: number }[];
  assert.deepEqual(rows.map((r) => [r.id, r.mr_no, r.mr_seq]), [
    ["p1", "MR-0001-04032025-2025", 1],
    ["p2", "MR-0007-01062025-2026", 7],         // year of the latest visit
    ["p3", "MR-0009-01072025-2025", 9],         // after the highest number
    ["p4", "MR-0008-01082025-2025", 8],         // untouched
    ["q1", "MR-0001-09012026-2026", 1],
  ]);
  const hist = old.prepare(`SELECT patient_id, mr_no FROM hospital_patient_mr_history ORDER BY tenant_id, patient_id`).all() as { patient_id: string; mr_no: string }[];
  assert.deepEqual(hist.map((h) => [h.patient_id, h.mr_no]), [["p1", "MR-000001"], ["p2", "MR-000007"], ["p3", "PAPER-55"], ["q1", "MR-000001"]]);
});
