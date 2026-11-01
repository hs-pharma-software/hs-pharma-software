/** Diagnostic lab: reception -> sample -> result -> pathologist -> released,
 * with the bill paid in part and the balance collected later. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { savePatient } from "@/lib/repo/clinic";
import { saveClinicService } from "@/lib/repo/clinicServices";
import {
  createLabVisit, listLabVisits, getLabVisit, collectSamples, enterLabResult, verifyLabResults, returnForRecheck,
  collectLabPayment, listLabBills, labDayStats, labBillLines,
} from "@/lib/repo/lab";
import { localDate } from "@/lib/localDate";

const tenant: SessionTenant = {
  id: "lab-a", name: "City Lab", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "lab",
};
const as = (name: string) =>
  useAuthStore.setState({ currentUser: { id: name, username: name, displayName: name, role: "owner", tenantId: "lab-a", permissions: null }, currentTenant: tenant });

beforeEach(() => {
  setTestDb(fullSchemaDb());
  as("Reception");
});

async function setup() {
  const p = await savePatient(null, { name: "Ayesha", gender: "Female", phone: "03001234567" });
  const cbc = await saveClinicService(null, { name: "Complete Blood Count (CBC)", category: "lab", rate: 800 });
  const sugar = await saveClinicService(null, { name: "Blood Sugar (Fasting)", category: "lab", rate: 300, unit: "mg/dL", ref_range: "70-110" });
  const off = await saveClinicService(null, { name: "Vitamin D", category: "lab", rate: 3000, is_active: false });
  return { p, cbc, sugar, off };
}

test("reception registers and bills; the technologist enters; the pathologist verifies and releases", async () => {
  const { p, cbc, sugar, off } = await setup();
  await assert.rejects(createLabVisit({ patientId: p.id, serviceIds: [] }), /at least one test/);
  await assert.rejects(createLabVisit({ patientId: p.id, serviceIds: [off.id] }), /not offered/);
  await assert.rejects(createLabVisit({ patientId: p.id, serviceIds: [cbc.id], discount: 900 }), /discount is more/);
  const { visit, invoice, orders } = await createLabVisit({ patientId: p.id, serviceIds: [cbc.id, sugar.id, sugar.id], referredBy: "Dr. Rab Nawaz", discount: 100, paid: 500 });
  assert.match(visit.visit_no, /^LV-\d{8}-001$/);
  assert.equal(orders.length, 2, "a test added twice is billed once");
  assert.equal(invoice.payable, 1000);
  assert.equal(invoice.balance, 500);
  assert.equal(invoice.invoice_type, "lab_visit");
  assert.equal((await labBillLines(invoice.id)).length, 2);

  assert.equal((await listLabVisits({ stage: "samples" })).length, 1);
  as("Tech Imran");
  await collectSamples([orders[0].id]);
  const sugarOrder = orders.find((o) => o.name.startsWith("Blood Sugar"))!;
  const entered = await enterLabResult(sugarOrder.id, { value: "130" });
  assert.equal(entered.status, "performed", "waits for the pathologist");
  assert.equal(entered.flag, "H");
  assert.equal(entered.reported_at, null);
  assert.equal((await listLabVisits({ stage: "verify" }))[0].performed, 1);
  assert.equal((await listLabVisits({ stage: "released" })).length, 0, "nothing released before verification");

  as("Dr. Pathologist");
  await returnForRecheck(sugarOrder.id, "Haemolysed sample");
  let v = await getLabVisit(visit.id);
  assert.equal(v.orders.find((o) => o.id === sugarOrder.id)?.status, "collected");
  assert.match(v.orders.find((o) => o.id === sugarOrder.id)!.pathologist_note!, /Recheck: Haemolysed/);
  as("Tech Imran");
  await enterLabResult(sugarOrder.id, { value: "128" });
  as("Dr. Pathologist");
  await assert.rejects(verifyLabResults([orders[0].id]), /no result waiting/);
  await verifyLabResults([sugarOrder.id], "Advise HbA1c");
  v = await getLabVisit(visit.id);
  const done = v.orders.find((o) => o.id === sugarOrder.id)!;
  assert.equal(done.status, "reported");
  assert.equal(done.verified_by, "Dr. Pathologist");
  assert.equal(done.pathologist_note, "Advise HbA1c");
  await assert.rejects(enterLabResult(sugarOrder.id, { value: "1" }), /verified and released/);
  assert.equal((await listLabVisits({ stage: "released" })).length, 1);

  await assert.rejects(collectLabPayment(invoice.id, 600), /Only Rs 500/);
  const paid = await collectLabPayment(invoice.id, 500);
  assert.equal(paid.balance, 0);
  assert.equal(paid.inv_on, "cash");
  assert.equal((await listLabBills({ dueOnly: true })).length, 0);

  const s = await labDayStats(localDate());
  assert.equal(s.visits, 1);
  assert.equal(s.tests, 2);
  assert.equal(s.released, 1);
  assert.equal(s.toEnter, 1, "the CBC sample is collected, result still to enter");
  assert.equal(s.billed, 1000);
  assert.equal(s.collected, 1000);
});

test("panel results (CBC) wait for verification too", async () => {
  const { p, cbc } = await setup();
  const { orders } = await createLabVisit({ patientId: p.id, serviceIds: [cbc.id], paid: 800 });
  const r = await enterLabResult(orders[0].id, { value: "", components: [{ key: "hb", name: "Haemoglobin", group: null, value: "11", unit: "g/dL", ref_range: "12-15", flag: "L" }] });
  assert.equal(r.status, "performed");
  assert.match(r.result_value ?? "", /11/);
});
