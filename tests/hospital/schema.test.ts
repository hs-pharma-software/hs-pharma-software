/** Schema versions stay in step (lib.rs, migrate-turso.cjs, the app's check),
 * the schema checker finds exactly what an old database lacks, and the
 * admission link (hospital_episodes.from_episode_id) behaves as designed. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { localDate } from "@/lib/localDate";
import { REQUIRED_SCHEMA_VERSION, sharedSchemaStatus } from "@/lib/schemaVersion";
import { hospitalEpisodesRepo, hospitalPatientsRepo, nextMrNo, nextEpisodeNo, addCharge, addPayment, listChargesForEpisode } from "@/lib/repo/hospital";
import { saveHospitalStaff, bookOpdVisit } from "@/lib/repo/hospitalOpd";
import { admitFromVisit, saveSurgeryType } from "@/lib/repo/hospitalCare";

const require = createRequire(import.meta.url);
const schema = require("../../scripts/lib/turso-schema.cjs") as {
  latestVersion: () => number;
  expectedByVersion: () => { versions: { version: number }[] };
  liveSnapshot: (q: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<unknown>;
  compare: (e: unknown, l: unknown) => { presentUpTo: number; incomplete: { version: number; missing: string[] }[] };
};

function login(tenantId = "hosp-a") {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 10,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

beforeEach(() => {
  setTestDb(fullSchemaDb());
  login();
});

test("the app, lib.rs and migrate-turso.cjs agree on the schema version, and every shared version has a migrate entry", () => {
  const latest = schema.latestVersion();
  assert.equal(REQUIRED_SCHEMA_VERSION, latest, "src/lib/schemaVersion.ts REQUIRED_SCHEMA_VERSION = last migration in lib.rs");
  const rs = readFileSync("src-tauri/src/lib.rs", "utf8");
  assert.match(rs, new RegExp(`version: ${latest},`), "the last schema_sql_vN is registered as a Tauri migration");
  const script = readFileSync("scripts/migrate-turso.cjs", "utf8");
  for (let v = 34; v <= latest; v++) assert.match(script, new RegExp(`\\{ version: ${v}, `), `migrate-turso.cjs has an entry for v${v}`);
});

test("the schema checker: a v42 database lacks exactly v43+ (from_episode_id among them); a current one lacks nothing", async () => {
  const expected = schema.expectedByVersion();
  const asQuery = (db: ReturnType<typeof fullSchemaDb>) => async (sql: string) => db.prepare(sql).all() as Record<string, unknown>[];
  const old = schema.compare(expected, await schema.liveSnapshot(asQuery(fullSchemaDb(42))));
  assert.equal(old.presentUpTo, 42);
  assert.deepEqual(old.incomplete.map((v) => v.version), [43, 44, 45, 46]);
  assert.ok(old.incomplete[0].missing.includes("column hospital_episodes.from_episode_id"));
  const current = schema.compare(expected, await schema.liveSnapshot(asQuery(fullSchemaDb())));
  assert.deepEqual(current.incomplete, []);
  assert.equal(current.presentUpTo, REQUIRED_SCHEMA_VERSION);
});

test("the web app reads the recorded version: none recorded is unknown, older is behind, current is ok", async () => {
  const db = fullSchemaDb();
  setTestDb(db);
  assert.deepEqual(await sharedSchemaStatus(), { state: "unknown" });
  db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, label TEXT, source TEXT NOT NULL, applied_at TEXT NOT NULL, verified_at TEXT)`);
  db.exec(`INSERT INTO schema_migrations VALUES (42, 'x', 'schema-verified', '2026-10-25', NULL)`);
  assert.deepEqual(await sharedSchemaStatus(), { state: "behind", version: 42 });
  db.exec(`INSERT INTO schema_migrations VALUES (${REQUIRED_SCHEMA_VERSION}, 'x', 'applied', '2026-10-25', NULL)`);
  assert.deepEqual(await sharedSchemaStatus(), { state: "ok", version: REQUIRED_SCHEMA_VERSION });
});

test("admission: linked to its visit, one admission per visit, a direct admission has no source, discharge and billing still work", async () => {
  const dr = await saveHospitalStaff(null, { name: "Dr Saima", staff_category: "consultant", license_no: "PMDC-1", consultation_fee: 0, department: "Medicine", basic_pay: 0 });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ahmed Raza", gender: "Male" });
  const { episode: visit } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });

  const { admission } = await admitFromVisit({ fromEpisodeId: visit.id, reason: "Pneumonia", plan: "ipd" });
  assert.equal(admission.from_episode_id, visit.id);

  // Discharged, then the same visit cannot be admitted again: a readmission is a new visit.
  await hospitalEpisodesRepo.update(admission.id, { status: "discharged", discharge_date: localDate() });
  await assert.rejects(admitFromVisit({ fromEpisodeId: visit.id, reason: "Again", plan: "ipd" }), /already admitted as IPD-.*new visit for a readmission/);
  const { episode: visit2 } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });
  const { admission: readmission } = await admitFromVisit({ fromEpisodeId: visit2.id, reason: "Relapse", plan: "ipd" });
  assert.equal(readmission.from_episode_id, visit2.id);
  await hospitalEpisodesRepo.update(readmission.id, { status: "discharged", discharge_date: localDate() });

  // Admitted directly (Episodes > New, IPD): no source visit, still valid.
  const direct = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("ipd"), type: "ipd", patient_id: p.id, doctor_id: dr.id, department: "Medicine", date: localDate(), time: null,
    status: "open", room_ward: "Ward A", bed_no: "4", admission_date: localDate(), discharge_date: null, diagnosis: null, notes: null,
  });
  assert.equal(direct.from_episode_id ?? null, null);
  await addCharge({ tenant_id: "", episode_id: direct.id, service_id: null, description: "Bed charges", department: null, category: "bed", qty: 2, rate: 3000, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: localDate(), notes: null, invoice_id: null });
  await addPayment({ tenant_id: "", episode_id: direct.id, type: "payment", amount: 6000, method: "cash", reference: null, notes: null, received_at: localDate() });
  assert.deepEqual((await listChargesForEpisode(direct.id)).map((c) => c.amount), [6000]);
  const discharged = await hospitalEpisodesRepo.update(direct.id, { status: "discharged", discharge_date: localDate() });
  assert.equal(discharged!.status, "discharged");
});

test("the source visit must be this hospital's own", async () => {
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Patient", gender: "Female" });
  login("hosp-b");
  const other = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Other", gender: "Female" });
  const foreignVisit = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("opd"), type: "opd", patient_id: other.id, doctor_id: null, department: null, date: localDate(), time: null,
    status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null, diagnosis: null, notes: null,
  });
  login("hosp-a");
  await assert.rejects(
    hospitalEpisodesRepo.create({
      episode_no: await nextEpisodeNo("ipd"), type: "ipd", patient_id: p.id, doctor_id: null, department: null, date: localDate(), time: null,
      status: "open", room_ward: null, bed_no: null, admission_date: localDate(), discharge_date: null, diagnosis: null, notes: null, from_episode_id: foreignVisit.id,
    }),
    /Source visit/
  );
  // Surgery admissions keep working through the same link.
  const s = await saveSurgeryType(null, { name: "Hernia repair", rate: 1000 });
  const dr = await saveHospitalStaff(null, { name: "Dr K", staff_category: "consultant", license_no: "PMDC-2", consultation_fee: 0, department: "Surgery", basic_pay: 0 });
  const { episode: v } = await bookOpdVisit({ patientId: p.id, doctorId: dr.id });
  const { admission, booking } = await admitFromVisit({ fromEpisodeId: v.id, reason: "Hernia", plan: "surgery", surgeryTypeId: s.id });
  assert.equal(admission.from_episode_id, v.id);
  assert.ok(booking);
});
