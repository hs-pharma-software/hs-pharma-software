/** Hospital stage A: the day closing by department and method, vital signs
 * with normal ranges, a doctor seeing only their own patients, episode bills
 * with discount edits, and doctor / staff shares on services and fees. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { applySchema, fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { addCharge, addPayment, hospitalPatientsRepo, hospitalServicesRepo, listChargesForEpisode, nextMrNo } from "@/lib/repo/hospital";
import { bookOpdVisit, listOpdQueue, orderInvestigation, ownDoctorScope, payOrderFee, saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { collectionsByDepartment, myOpenCollections } from "@/lib/repo/cashClosing";
import { listEpisodeBills, pctForAmount, setBillDiscounts } from "@/lib/repo/episodeBills";
import { fToC, cToF, vitalFlag, vitalsSummary } from "@/config/vitalNorms";
import { designation } from "@/config/hospitalStaff";
import { localDate, localDateTime } from "@/lib/localDate";
import type { Staff } from "@/lib/types";
import { monthlyWorkRates } from "@/lib/hospitalPayroll";

const H = "hosp-a";
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  await staffRepo.update(staff.id, { user_id: `user-${staff.id}` } as Partial<Staff>);
  useAuthStore.setState({ currentUser: { id: `user-${staff.id}`, username: staff.name, displayName: staff.name, role: "staff", tenantId: H, permissions: designation(staff.staff_category)!.pages }, currentTenant: tenant });
}
const today = localDate();

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

test("staff schedules calculate full-month hours and overtime using each month's Sundays", () => {
  const input = { year: 2024, month: 2, basicPay: 45000, hoursPerDay: 8, sundayOff: true, overtimeMultiplier: 1.5 };
  assert.deepEqual(monthlyWorkRates(input), { workingDays: 25, monthlyHours: 200, hourlyRate: 225, overtimeRate: 337.5 });
  assert.deepEqual(monthlyWorkRates({ ...input, sundayOff: false }), { workingDays: 29, monthlyHours: 232, hourlyRate: 193.97, overtimeRate: 290.95 });
  assert.equal(monthlyWorkRates({ ...input, year: 2026, month: 7 }).workingDays, 27);
  assert.throws(() => monthlyWorkRates({ ...input, hoursPerDay: 0 }), /Working hours/);
  assert.throws(() => monthlyWorkRates({ ...input, overtimeMultiplier: -1 }), /multiplier/);
});

test("existing staff can be upgraded without a schedule; configured schedules persist and reject invalid changes", async () => {
  const old = fullSchemaDb(104);
  setTestDb(old);
  const member = await saveHospitalStaff(null, { name: "Schedule Test", staff_category: "receptionist", basic_pay: 45000 });
  applySchema(old, 105);
  assert.equal((await staffRepo.get(member.id))?.working_hours_per_day, null);
  const saved = await saveHospitalStaff(member.id, {
    name: member.name, staff_category: "receptionist", basic_pay: 45000,
    working_hours_per_day: 8, sunday_off: 1, overtime_multiplier: 1.5,
  });
  assert.deepEqual([saved.working_hours_per_day, saved.sunday_off, saved.overtime_multiplier], [8, 1, 1.5]);
  await assert.rejects(saveHospitalStaff(member.id, { name: member.name, staff_category: "receptionist", working_hours_per_day: 25 }), /Working hours/);
  await assert.rejects(saveHospitalStaff(member.id, { name: member.name, staff_category: "receptionist", sunday_off: 2 }), /Sunday/);
  await assert.rejects(saveHospitalStaff(member.id, { name: member.name, staff_category: "receptionist", overtime_multiplier: 0 }), /multiplier/);
  assert.equal((await staffRepo.get(member.id))?.working_hours_per_day, 8);
});

async function setup() {
  const doctor = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: "PMDC-1", consultation_fee: 2000, consultation_doctor_share: 1500, department: "Medicine", basic_pay: 0 });
  const doctor2 = await saveHospitalStaff(null, { name: "Dr Hina", staff_category: "medical_officer", license_no: "PMDC-2", consultation_fee: 500, department: "Gynae", basic_pay: 0 });
  const rec = await saveHospitalStaff(null, { name: "Bilal", staff_category: "receptionist", basic_pay: 0 });
  const p1 = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const p2 = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Aqsa Bibi", gender: "Female" });
  const cbc = await hospitalServicesRepo.create({ code: "CBC", name: "CBC", department: "Laboratory", category: "lab", billing_unit: "test", rate: 800, is_active: 1, notes: null });
  const xray = await hospitalServicesRepo.create({ code: "XR", name: "X-Ray Chest", department: "Radiology", category: "imaging", billing_unit: "test", rate: 1200, is_active: 1, notes: null });
  const dressing = await hospitalServicesRepo.create({ code: "DRS", name: "Dressing", department: "OPD", category: "procedure", billing_unit: "procedure", rate: 600, is_active: 1, notes: null, doctor_share: 200, staff_share: 100 });
  return { doctor, doctor2, rec, p1, p2, cbc, xray, dressing };
}

test("day closing: OPD, consultation, emergency, lab and radiology collections, and cash / bank transfer / QR", async () => {
  const s = await setup();
  await as(s.rec);
  const { episode: v1 } = await bookOpdVisit({ patientId: s.p1.id, doctorId: s.doctor.id, pay: { method: "cash" } });   // consultation 2000 cash
  const lab = (await orderInvestigation(v1.id, s.cbc.id)).order;
  await payOrderFee("lab", lab.id, "online");                                                                          // lab 800 QR
  const scan = (await orderInvestigation(v1.id, s.xray.id)).order;
  await payOrderFee("imaging", scan.id, "bank");                                                                       // radiology 1200 bank
  const { episode: v2 } = await bookOpdVisit({ patientId: s.p2.id, doctorId: s.doctor2.id });                         // consultation 500, unpaid
  await addCharge({ tenant_id: "", episode_id: v2.id, service_id: s.dressing.id, description: "Dressing", department: "OPD", category: "procedure", qty: 1, rate: 600, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: today, notes: null, invoice_id: null });
  await addPayment({ tenant_id: "", episode_id: v2.id, type: "payment", amount: 1100, method: "cash", reference: null, notes: "Balance paid at reception", received_at: localDateTime() }); // 500 consultation + 600 OPD
  const open = await myOpenCollections();
  assert.deepEqual([open.totals.cash, open.totals.bank, open.totals.online, open.totals.net], [3100, 1200, 800, 5100]);
  const d = await collectionsByDepartment(open.rows);
  assert.deepEqual([d.consultation, d.lab, d.radiology, d.opd, d.emergency], [2500, 800, 1200, 600, 0]);
});

test("vital signs: normal ranges, °F to °C, and the one-line summary", () => {
  assert.equal(vitalFlag("bp_systolic", "145"), "high");
  assert.equal(vitalFlag("pulse", "55"), "low");
  assert.equal(vitalFlag("spo2", "98"), null);
  assert.equal(vitalFlag("weight_kg", "120"), null, "weight has no normal range");
  assert.equal(fToC(98.6), 37);
  assert.equal(cToF(37), 98.6);
  assert.equal(vitalsSummary({ bp_systolic: "130", bp_diastolic: "85", pulse: "72", temperature_f: "100.2", weight_kg: "70" }),
    "BP 130/85 mmHg (high) · Pulse 72/min · Temp 100.2 °F (high) · Weight 70 kg");
});

test("a doctor's login sees only their own patients, whatever doctor is asked for", async () => {
  const s = await setup();
  await bookOpdVisit({ patientId: s.p1.id, doctorId: s.doctor.id });
  await bookOpdVisit({ patientId: s.p2.id, doctorId: s.doctor2.id });
  assert.equal((await listOpdQueue({ date: today })).length, 2, "the owner sees everyone");
  await as(s.doctor2);
  assert.equal(await ownDoctorScope(), s.doctor2.id);
  assert.deepEqual((await listOpdQueue({ date: today })).map((q) => q.patient_name), ["Aqsa Bibi"]);
  assert.deepEqual((await listOpdQueue({ date: today, doctorId: s.doctor.id })).map((q) => q.patient_name), ["Aqsa Bibi"]);
  await as(s.rec);
  assert.equal(await ownDoctorScope(), null);
  assert.equal((await listOpdQueue({ date: today })).length, 2, "reception sees every doctor's queue");
});

test("episode bills: totals, a discount over the whole bill with a reason, only by those allowed", async () => {
  const s = await setup();
  const { episode } = await bookOpdVisit({ patientId: s.p1.id, doctorId: s.doctor.id });
  await addCharge({ tenant_id: "", episode_id: episode.id, service_id: s.dressing.id, description: "Dressing", department: "OPD", category: "procedure", qty: 1, rate: 600, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: today, notes: null, invoice_id: null });
  await addPayment({ tenant_id: "", episode_id: episode.id, type: "payment", amount: 1000, method: "cash", reference: null, notes: null, received_at: localDateTime() });
  let [bill] = await listEpisodeBills({ from: today, to: today });
  assert.deepEqual([bill.total, bill.discount, bill.paid, bill.balance], [2600, 0, 1000, 1600]);

  const lines = await listChargesForEpisode(episode.id);
  const pct = pctForAmount(lines, 260);
  assert.equal(pct, 10);
  await assert.rejects(setBillDiscounts(episode.id, Object.fromEntries(lines.map((l) => [l.id, pct])), " "), /why the discount/);
  const nurse = await saveHospitalStaff(null, { name: "Nurse Rabia", staff_category: "nurse", license_no: "PNC-9", basic_pay: 0 });
  await as(nurse);
  await assert.rejects(setBillDiscounts(episode.id, { [lines[0].id]: 10 }, "x"), /Only the accountant, reception or an administrator/);
  await as(s.rec);
  assert.equal(await setBillDiscounts(episode.id, Object.fromEntries(lines.map((l) => [l.id, pct])), "Poor patient, approved by MS"), 2);
  [bill] = await listEpisodeBills({ from: today, to: today, status: "unpaid" });
  assert.deepEqual([bill.total, bill.discount, bill.balance], [2340, 260, 1340]);
  assert.match(String((await listChargesForEpisode(episode.id))[0].notes), /Discount 10% by Bilal: Poor patient/);
  assert.equal((await listEpisodeBills({ from: today, to: today, status: "paid" })).length, 0);
});

test("shares: a service's doctor / staff share and the doctor's share of the consultation fee are kept on each charge", async () => {
  const s = await setup();
  const { episode } = await bookOpdVisit({ patientId: s.p1.id, doctorId: s.doctor.id });
  await addCharge({ tenant_id: "", episode_id: episode.id, service_id: s.dressing.id, description: "Dressing", department: "OPD", category: "procedure", qty: 2, rate: 600, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: today, notes: null, invoice_id: null });
  const lines = await listChargesForEpisode(episode.id);
  assert.deepEqual(lines.map((l) => [l.description, l.amount, l.doctor_share, l.staff_share]), [
    ["Consultation: Dr Saeed", 2000, 1500, null],
    ["Dressing", 1200, 400, 200],
  ]);
  // A doctor's share can't be more than the fee.
  const d3 = await saveHospitalStaff(null, { name: "Dr Over", staff_category: "consultant", license_no: "PMDC-3", consultation_fee: 1000, consultation_doctor_share: 5000, basic_pay: 0 });
  assert.equal(d3.consultation_doctor_share, 1000);
});
