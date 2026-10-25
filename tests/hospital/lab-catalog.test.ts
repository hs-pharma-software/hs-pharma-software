/** The standard lab test list: loading it, fees, and that tests without a fee
 * cannot be ordered until the lab sets one. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hospitalPatientsRepo, nextMrNo, listChargesForEpisode } from "@/lib/repo/hospital";
import { importStandardLabTests, listLabTests, saveLabTest, setLabTestFee, setLabTestActive, orderLabTests } from "@/lib/repo/hospitalOpd";
import { STANDARD_LAB_TESTS, SAMPLE_TYPES, LAB_SECTIONS } from "@/config/labTestCatalog";

function login() {
  const tenant: SessionTenant = {
    id: "hosp-a", name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 3,
    maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: "hosp-a", permissions: null }, currentTenant: tenant });
}

beforeEach(() => {
  setTestDb(fullSchemaDb());
  login();
});

test("the standard list is well formed: unique names, known samples, units / ranges and turnaround", () => {
  const names = STANDARD_LAB_TESTS.map((t) => t.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, "no test twice");
  assert.ok(STANDARD_LAB_TESTS.length >= 100, "covers the major tests");
  for (const t of STANDARD_LAB_TESTS) {
    assert.ok(SAMPLE_TYPES.includes(t.sample), `${t.name}: sample "${t.sample}" is in the sample list`);
    assert.ok(t.tat > 0, `${t.name}: turnaround set`);
    assert.ok(LAB_SECTIONS.includes(t.section));
  }
  for (const s of ["Haematology", "Diabetes", "Liver", "Lipids", "Thyroid & Hormones", "Serology & Infectious", "Urine", "Microbiology"]) assert.ok(LAB_SECTIONS.includes(s), s);
  const hb = STANDARD_LAB_TESTS.find((t) => t.name === "Haemoglobin (Hb)")!;
  assert.deepEqual([hb.sample, hb.unit, hb.range], ["Whole blood (EDTA)", "g/dL", "M 13.0-17.0; F 12.0-15.0"]);
});

test("loading the list adds every test without a fee and not performing; existing tests are kept", async () => {
  await saveLabTest(null, { name: "CBC", rate: 900 });
  await saveLabTest(null, { name: "Complete Blood Count (CBC)", rate: 1000, sample_type: "Whole blood (EDTA)" });
  const progress: number[] = [];
  const r = await importStandardLabTests((done) => progress.push(done));
  assert.equal(r.skipped, 1, "the lab's own CBC entry is kept");
  assert.equal(r.added, STANDARD_LAB_TESTS.length - 1);
  assert.equal(progress.at(-1), r.added);

  const all = await listLabTests({ includeInactive: true });
  assert.equal(all.length, STANDARD_LAB_TESTS.length + 1);
  const mine = all.find((t) => t.name === "Complete Blood Count (CBC)")!;
  assert.equal(mine.rate, 1000, "not overwritten");
  const tsh = all.find((t) => t.name === "TSH")!;
  assert.deepEqual([tsh.department, tsh.sample_type, tsh.unit, tsh.ref_range, tsh.turnaround_hours, tsh.rate, tsh.is_active], ["Thyroid & Hormones", "Serum", "uIU/mL", "0.4-4.0", 24, 0, 0]);
  const codes = all.map((t) => t.code);
  assert.equal(new Set(codes).size, codes.length, "every test has its own code");

  // Only the lab's two own (priced) tests are orderable.
  assert.deepEqual((await listLabTests()).map((t) => t.name).sort(), ["CBC", "Complete Blood Count (CBC)"]);
  const again = await importStandardLabTests();
  assert.deepEqual(again, { added: 0, skipped: STANDARD_LAB_TESTS.length });
});

test("entering a fee starts performing the test, and it is then ordered and billed at that fee", async () => {
  await importStandardLabTests();
  const all = await listLabTests({ includeInactive: true });
  const fbs = all.find((t) => t.name === "Blood Sugar Fasting (FBS)")!;
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Patient", gender: "Male" });
  await assert.rejects(orderLabTests({ patientId: p.id, serviceIds: [fbs.id] }), /not in the lab's list/, "not orderable before its fee is set");

  const priced = await setLabTestFee(fbs.id, 250);
  assert.equal(priced.rate, 250);
  assert.equal(priced.is_active, 1);
  const { episode } = await orderLabTests({ patientId: p.id, serviceIds: [fbs.id] });
  assert.deepEqual((await listChargesForEpisode(episode.id)).map((c) => c.amount), [250]);

  // Every value stays editable, including the fee.
  const edited = await saveLabTest(fbs.id, { name: fbs.name, department: fbs.department, sample_type: "Plasma (Fluoride)", unit: "mg/dL", ref_range: "70-100", turnaround_hours: 2, rate: 300, is_active: 1 });
  assert.deepEqual([edited.ref_range, edited.turnaround_hours, edited.rate, edited.code], ["70-100", 2, 300, fbs.code]);

  await setLabTestActive(fbs.id, false);
  assert.ok(!(await listLabTests()).some((t) => t.id === fbs.id));
  await assert.rejects(setLabTestFee(fbs.id, -5), /cannot be negative/);
});
