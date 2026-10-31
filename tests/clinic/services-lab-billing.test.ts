/** Clinic services, lab, radiology and the visit bill: services with fees
 * (standard lab / radiology lists load without fees), a consultation orders
 * from them, lab results get a flag, radiology a report, and billing the
 * visit makes one invoice with the doctor's fee once and every item once. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { savePatient, saveConsultation, doctorsRepo, saveAppointment } from "@/lib/repo/clinic";
import {
  saveClinicService, loadStandardClinicServices, listClinicServices, addClinicOrder, listOrdersForConsultation, cancelClinicOrder,
  listClinicWork, markClinicOrderStarted, enterClinicLabResult, reportClinicRadiology, getClinicReport, getVisitBill, createVisitInvoice,
  getClinicVisitInvoice, listDayBills,
} from "@/lib/repo/clinicServices";

const T = "clinic-a";
const TODAY = "2026-10-31";
const tenant: SessionTenant = {
  id: T, name: "City Clinic", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "clinic",
};

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Dr Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});

async function visit() {
  const p = await savePatient(null, { name: "Ayesha", gender: "Female" });
  const d = await doctorsRepo.create({ name: "Rab Nawaz", consultation_fee: 1000, follow_up_fee: 500 });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: d.id, date: TODAY });
  return { p, d, c };
}

test("services: fees, no duplicate names; standard lists load without fees and not offered", async () => {
  await saveClinicService(null, { name: "Room (General ward)", category: "room", rate: 3000 });
  await assert.rejects(saveClinicService(null, { name: "room (general ward)", category: "room", rate: 1 }), /already in Room charges/);
  const lab = await loadStandardClinicServices("lab");
  assert.ok(lab.added > 20);
  assert.equal((await loadStandardClinicServices("lab")).added, 0);
  assert.equal((await listClinicServices({ category: "lab" })).length, 0, "not offered before a fee");
  const rad = await loadStandardClinicServices("radiology");
  assert.ok(rad.added > 10);
});

test("a consultation orders lab and radiology; results, reports and worklists", async () => {
  const { c } = await visit();
  const cbc = await saveClinicService(null, { name: "Haemoglobin (Hb)", category: "lab", rate: 400, unit: "g/dL", ref_range: "M 13.0-17.0; F 12.0-15.0" });
  const xray = await saveClinicService(null, { name: "X-Ray Chest PA", category: "radiology", rate: 1200 });
  const hb = await addClinicOrder({ consultationId: c.id, serviceId: cbc.id });
  const cx = await addClinicOrder({ consultationId: c.id, serviceId: xray.id, priority: "urgent" });
  assert.match(hb.order_no, /^LAB-\d{8}-001$/);
  assert.equal((await listClinicWork("lab")).length, 1);
  await markClinicOrderStarted(hb.id);
  const res = await enterClinicLabResult(hb.id, { value: "10.5" });
  assert.deepEqual([res.status, res.flag, res.reported_by], ["reported", "L", "Dr Owner"], "low for a woman");
  assert.equal((await listClinicWork("lab")).length, 0);
  assert.equal((await listClinicWork("lab", "reported")).length, 1);
  await assert.rejects(getClinicReport(cx.id), /not reported/);
  await reportClinicRadiology(cx.id, { findings: "Lungs clear.", impression: "Normal chest" });
  assert.equal((await getClinicReport(cx.id)).order.impression, "Normal chest");
  await assert.rejects(cancelClinicOrder(hb.id), /already reported/);
});

test("the visit bill: doctor's fee once, every item once, grouped; partial payment leaves a balance", async () => {
  const { c } = await visit();
  const room = await saveClinicService(null, { name: "Room", category: "room", rate: 3000 });
  const med = await saveClinicService(null, { name: "Indoor medicine", category: "medicine", rate: 1 });
  const lab = await saveClinicService(null, { name: "Blood sugar", category: "lab", rate: 300 });
  await addClinicOrder({ consultationId: c.id, serviceId: room.id, qty: 2 });
  await addClinicOrder({ consultationId: c.id, serviceId: med.id, qty: 850 });
  const sugar = await addClinicOrder({ consultationId: c.id, serviceId: lab.id });
  const extra = await addClinicOrder({ consultationId: c.id, serviceId: lab.id });
  await cancelClinicOrder(extra.id);

  const bill = await getVisitBill(c.id);
  assert.deepEqual(bill.lines.map((l) => [l.kind, l.amount]), [["consultation", 1000], ["lab", 300], ["room", 6000], ["medicine", 850]]);
  assert.equal(bill.total, 8150);
  const inv = await createVisitInvoice(c.id, { discount: 150, paid: 5000 });
  assert.deepEqual([inv.invoice_type, inv.customer_name, inv.payable, inv.paid, inv.balance], ["clinic_visit", "Ayesha", 8000, 5000, 3000]);

  const after = await getVisitBill(c.id);
  assert.deepEqual(after.lines, [], "everything billed, the fee too");
  assert.equal(after.invoices.length, 1);
  await assert.rejects(createVisitInvoice(c.id, {}), /Nothing to bill/);
  await assert.rejects(cancelClinicOrder(sugar.id), /already billed/);

  const printed = await getClinicVisitInvoice(inv.id);
  assert.deepEqual(printed.lines.map((l) => l.kind), ["consultation", "lab", "room", "medicine"]);
  assert.equal(printed.patient?.name, "Ayesha");

  // Later items of the same visit go on a second invoice, without the fee again.
  await addClinicOrder({ consultationId: c.id, serviceId: room.id, qty: 1 });
  assert.deepEqual((await getVisitBill(c.id)).lines.map((l) => [l.kind, l.amount]), [["room", 3000]]);
});

test("a follow-up appointment bills the follow-up fee", async () => {
  const p = await savePatient(null, { name: "Bilal" });
  const d = await doctorsRepo.create({ name: "Rab Nawaz", consultation_fee: 1000, follow_up_fee: 500 });
  const a = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, status: "scheduled", type: "follow_up" });
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: d.id, appointment_id: a.id, date: TODAY });
  assert.deepEqual((await getVisitBill(c.id)).lines.map((l) => l.amount), [500]);
  assert.equal((await listOrdersForConsultation(c.id)).length, 0);
});

test("a test the clinic does not offer is ordered as external: not billed, not on the worklist", async () => {
  const { c } = await visit();
  await loadStandardClinicServices("lab");
  const all = await listClinicServices({ category: "lab", includeInactive: true });
  const notOffered = all.find((s) => !s.is_active)!;
  const ext = await addClinicOrder({ consultationId: c.id, serviceId: notOffered.id });
  assert.deepEqual([ext.status, ext.amount], ["external", 0]);
  assert.equal((await listClinicWork("lab")).length, 0);
  assert.deepEqual((await getVisitBill(c.id)).lines.map((l) => l.kind), ["consultation"], "only the doctor's fee is billed");
  await cancelClinicOrder(ext.id);
});

test("today's bills for reception: fee due before the consultation, then due / billed / paid", async () => {
  const p = await savePatient(null, { name: "Bilal" });
  const d = await doctorsRepo.create({ name: "Rab Nawaz", consultation_fee: 1000, follow_up_fee: 500 });
  const a = await saveAppointment(null, { patient_id: p.id, doctor_id: d.id, date: TODAY, status: "scheduled", type: "routine" });
  let b = (await listDayBills(TODAY)).get(a.id)!;
  assert.deepEqual([b.consultationId, b.due, b.billed], [null, 1000, 0]);
  const c = await saveConsultation(null, { patient_id: p.id, doctor_id: d.id, appointment_id: a.id, date: TODAY });
  const lab = await saveClinicService(null, { name: "Blood sugar", category: "lab", rate: 300 });
  await addClinicOrder({ consultationId: c.id, serviceId: lab.id });
  b = (await listDayBills(TODAY)).get(a.id)!;
  assert.deepEqual([b.consultationId, b.due], [c.id, 1300]);
  await createVisitInvoice(c.id, { paid: 1000 });
  b = (await listDayBills(TODAY)).get(a.id)!;
  assert.deepEqual([b.due, b.billed, b.paid, b.balance], [0, 1300, 1000, 300]);
});
