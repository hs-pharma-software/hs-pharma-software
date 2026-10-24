/** Episode numbers are assigned automatically: per type and day, in sequence,
 * never reusing a number, and a new patient can be registered and opened an
 * episode straight away. Real repositories on the complete schema. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hospitalPatientsRepo, hospitalEpisodesRepo, hospitalDepartmentsRepo, nextEpisodeNo, nextMrNo } from "@/lib/repo/hospital";
import type { EpisodeType } from "@/lib/types-hospital";

function loginAs(tenantId: string) {
  const tenant: SessionTenant = {
    id: tenantId, name: tenantId, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: "u", username: "u", displayName: "U", role: "owner", tenantId, permissions: null }, currentTenant: tenant });
}

async function openEpisode(type: EpisodeType, date: string, patientId: string) {
  return hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo(type, date), type, patient_id: patientId, doctor_id: null, department: null, date, time: null,
    status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null, diagnosis: null, notes: null,
  });
}

beforeEach(() => {
  setTestDb(fullSchemaDb(39));
  loginAs("hosp-a");
});

test("numbers run in sequence per type and day, with the right prefix and the chosen date", async () => {
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "A", gender: "Male" });
  assert.equal(await nextEpisodeNo("opd", "2026-10-24"), "OPD-20261024-001");
  assert.equal((await openEpisode("opd", "2026-10-24", p.id)).episode_no, "OPD-20261024-001");
  assert.equal((await openEpisode("opd", "2026-10-24", p.id)).episode_no, "OPD-20261024-002");
  assert.equal(await nextEpisodeNo("ipd", "2026-10-24"), "IPD-20261024-001");
  assert.equal(await nextEpisodeNo("emergency", "2026-10-24"), "ER-20261024-001");
  assert.equal(await nextEpisodeNo("opd", "2026-10-25"), "OPD-20261025-001", "a new day starts again");
  assert.equal(await nextEpisodeNo("opd", "2026-10-24"), "OPD-20261024-003");
});

test("a number is never reused, even when an episode was deleted or the count is out of step", async () => {
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "B", gender: "Female" });
  const e1 = await openEpisode("opd", "2026-10-24", p.id);
  await openEpisode("opd", "2026-10-24", p.id);
  await hospitalEpisodesRepo.remove(e1.id);
  const next = await nextEpisodeNo("opd", "2026-10-24");
  assert.equal(next, "OPD-20261024-003");
  // Skips a number that already exists even if the day's count would suggest it.
  await hospitalEpisodesRepo.create({
    episode_no: "OPD-20261024-003", type: "opd", patient_id: p.id, doctor_id: null, department: null, date: "2026-10-25", time: null,
    status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null, diagnosis: null, notes: null,
  });
  assert.equal(await nextEpisodeNo("opd", "2026-10-24"), "OPD-20261024-004");
});

test("numbers are per hospital: another hospital starts at 001", async () => {
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "C", gender: "Male" });
  await openEpisode("opd", "2026-10-24", p.id);
  loginAs("hosp-b");
  assert.equal(await nextEpisodeNo("opd", "2026-10-24"), "OPD-20261024-001");
});

test("register a patient that was not found, then open the episode for them", async () => {
  assert.equal((await hospitalPatientsRepo.list()).filter((x) => x.name.includes("Huzaifa")).length, 0);
  const created = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Huzaifa Noor", gender: "Male", phone: "0300-1" });
  const ep = await openEpisode("opd", "2026-10-24", created.id);
  const back = await hospitalEpisodesRepo.get(ep.id);
  assert.equal(back?.patient_id, created.id);
  assert.equal((await hospitalPatientsRepo.get(created.id))?.name, "Huzaifa Noor");
});

test("departments for the dropdown: only active ones, by name", async () => {
  await hospitalDepartmentsRepo.create({ name: "Neuro Department", type: "clinical", head: null, phone: null, notes: null, is_active: 1 });
  await hospitalDepartmentsRepo.create({ name: "Closed Ward", type: "clinical", head: null, phone: null, notes: null, is_active: 0 });
  await hospitalDepartmentsRepo.create({ name: "Cardiology", type: "clinical", head: null, phone: null, notes: null, is_active: 1 });
  const active = (await hospitalDepartmentsRepo.list({ orderBy: "name ASC" })).filter((d) => d.is_active).map((d) => d.name);
  assert.deepEqual(active, ["Cardiology", "Neuro Department"]);
});
