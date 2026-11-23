/** Hospital stage D: surgery shares and expenses (with OT / IPD medicine from
 * the linked pharmacy's Pre Invoices) and the profit / loss reports. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { addCharge, hospitalPatientsRepo, hospitalServicesRepo, nextMrNo } from "@/lib/repo/hospital";
import { bookOpdVisit, orderInvestigation, saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { admitFromVisit, listSurgeryBookings, saveSurgeryType } from "@/lib/repo/hospitalCare";
import { cleanShares, parseShares, sharesTotal, surgeryProfit } from "@/config/surgeryShares";
import { pharmacyCatalogue, type PharmacyPreInvoice } from "@/server/pharmacyBrands";
import { departmentPl, doctorShares, episodePl, insurancePl, periodOf } from "@/lib/repo/hospitalReports";
import { visibleNavFor } from "@/config/navFilter";
import { localDate } from "@/lib/localDate";

const H = "hosp-a", P = "pharm-p";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
const today = localDate();
const run = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as never[]));

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  asOwner();
});

test("shares: validated, totalled with the medicine, and taken off the charges", () => {
  const s = cleanShares({ consultant: 25000, mo: 3000, nurses: 2000, anesthesia: 8000, other: [{ label: "Sutures", amount: 1500 }, { label: "", amount: 0 }],
    ot_medicine: { id: "t1", name: "Gynae case (C-Section)", total: 6200 }, ipd_medicine: null });
  assert.equal(s.other.length, 1);
  assert.equal(sharesTotal(s), 45700);
  assert.equal(surgeryProfit(80000, s), 34300);
  assert.throws(() => cleanShares({ mo: -1 }), /MO share cannot be negative/);
  assert.throws(() => cleanShares({ other: [{ label: "", amount: 500 }] }), /Name each other expense/);
  assert.deepEqual(parseShares("not json"), cleanShares(null));
});

test("the linked pharmacy's Pre Invoices with today's totals", async () => {
  run(`INSERT INTO clinic_pharmacy_link (id, clinic_tenant_id, pharmacy_tenant_id, is_active, created_at, updated_at) VALUES ('l1', ?, ?, 1, 'x', 'x')`, H, P);
  run(`INSERT INTO products (id, tenant_id, name, packing, created_at, updated_at) VALUES ('oxy', ?, 'Oxytocin Inj', 1, 'x', 'x'), ('pcm', NULL, 'Panadol 500', 10, 'x', 'x')`, P);
  run(`INSERT INTO price_list (id, tenant_id, product_id, sale_price, created_at, updated_at) VALUES ('a', ?, 'oxy', 300, '2026-01-01', 'x'), ('b', ?, 'pcm', 50, '2026-01-01', 'x')`, P, P);
  run(`INSERT INTO invoice_templates (id, tenant_id, name, lines, created_at, updated_at) VALUES ('t1', ?, 'Gynae case (C-Section)', ?, 'x', 'x'), ('t2', 'other-pharmacy', 'Not ours', '[]', 'x', 'x')`,
    P, JSON.stringify([{ productId: "oxy", name: "Oxytocin", qty: 3, unit: "base" }, { productId: "pcm", name: "Panadol", qty: 20, unit: "secondary" }]));
  const list = await pharmacyCatalogue(sqliteSql(db), { userId: "o", role: "owner", tenantId: H }, { action: "preInvoices" }) as PharmacyPreInvoice[];
  assert.deepEqual(list, [{ id: "t1", name: "Gynae case (C-Section)", description: null, items: 2, total: 1000 }]);
});

test("a surgery type keeps its shares; each booking keeps them as they were", async () => {
  const surgeon = await saveHospitalStaff(null, { name: "Dr Saima", staff_category: "consultant", license_no: "PMDC-1", department: "Gynae", basic_pay: 0 });
  const t = await saveSurgeryType(null, { name: "C-Section", department: "Gynae", breakdown: { operation_fee: 50000, ot_charges: 20000, anesthesia_charges: 10000 },
    shares: { consultant: 25000, anesthesia: 8000, ot_medicine: { id: "t1", name: "Gynae case", total: 6000 } } });
  assert.equal(sharesTotal(parseShares(t.surgery_shares)), 39000);
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ayesha", gender: "Female" });
  const { episode: visit } = await bookOpdVisit({ patientId: p.id, doctorId: surgeon.id });
  await admitFromVisit({ fromEpisodeId: visit.id, reason: "Term pregnancy", plan: "surgery", surgeryTypeId: t.id, surgeonId: surgeon.id, plannedDate: today });
  await saveSurgeryType(t.id, { name: "C-Section", department: "Gynae", breakdown: { operation_fee: 50000, ot_charges: 20000, anesthesia_charges: 10000 }, shares: { consultant: 30000 } });
  const [b] = await listSurgeryBookings();
  assert.equal(parseShares(b.surgery_shares).consultant, 25000, "the booking keeps the shares it was booked with");
  assert.equal(surgeryProfit(b.fee, parseShares(b.surgery_shares)), 41000);
});

test("reports: OPD, lab, radiology, insurance, episode and doctor share, by period", async () => {
  const doc = await saveHospitalStaff(null, { name: "Dr Saeed", staff_category: "consultant", license_no: "PMDC-2", consultation_fee: 2000, consultation_doctor_share: 1500, basic_pay: 0 });
  const cbc = await hospitalServicesRepo.create({ code: "CBC", name: "CBC", department: "Lab", category: "lab", billing_unit: "test", rate: 800, is_active: 1, notes: null, staff_share: 100 });
  const xr = await hospitalServicesRepo.create({ code: "XR", name: "X-Ray", department: "Radiology", category: "imaging", billing_unit: "test", rate: 1200, is_active: 1, notes: null, doctor_share: 300 });
  const dress = await hospitalServicesRepo.create({ code: "DRS", name: "Dressing", department: "OPD", category: "procedure", billing_unit: "procedure", rate: 600, is_active: 1, notes: null, doctor_share: 200 });
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid", gender: "Male", insurance_company: "Jubilee" });
  const { episode } = await bookOpdVisit({ patientId: p.id, doctorId: doc.id });
  await orderInvestigation(episode.id, cbc.id);
  await orderInvestigation(episode.id, xr.id);
  await addCharge({ tenant_id: "", episode_id: episode.id, service_id: dress.id, description: "Dressing", department: "OPD", category: "procedure", qty: 1, rate: 600, discount_pct: 0, amount: 0, doctor_id: doc.id, performed_by: null, charge_date: today, notes: null, invoice_id: null });
  const range = { from: today, to: today };

  const [opd] = await departmentPl("opd", range, "day");
  assert.deepEqual([opd.label, opd.count, opd.revenue, opd.doctorShare, opd.profit], [today, 2, 2600, 1700, 900]);
  const [lab] = await departmentPl("lab", range, "month");
  assert.deepEqual([lab.label, lab.revenue, lab.staffShare, lab.profit], [today.slice(0, 7), 800, 100, 700]);
  const [rad] = await departmentPl("radiology", range, "range");
  assert.deepEqual([rad.label, rad.revenue, rad.doctorShare, rad.profit], [`${today} to ${today}`, 1200, 300, 900]);
  const [ins] = await insurancePl(range);
  assert.deepEqual([ins.label, ins.count, ins.revenue], ["Jubilee", 1, 4600]);
  const [ep] = await episodePl(range);
  assert.deepEqual([ep.label, ep.revenue, ep.profit], [episode.episode_no, 4600, 2500]);
  const shares = await doctorShares(range, "year");
  assert.deepEqual(shares.map((r) => [r.period, r.doctor, r.consultation, r.services, r.total]), [
    [today.slice(0, 4), "Dr Saeed", 1500, 200, 1700],
    [today.slice(0, 4), "Doctor not recorded (lab / radiology)", 0, 300, 300],
  ]);
  assert.equal(periodOf("2026-11-23", "month", range), "2026-11");
});

test("Finance > Reports is in the hospital menu, and Overview / Reports can be given on their own", () => {
  const fin = (perms: string[] | null) => visibleNavFor("hospital", null, perms).find((i) => i.label === "Finance");
  assert.deepEqual(fin(null)?.children?.map((c) => c.href), ["/hospital/finance", "/hospital/finance/reports", "/hospital/finance/collections", "/hospital/finance/closings", "/hospital/finance/vendor-payments", "/hospital/finance/pharmacy-payments", "/hospital/finance/insurance"]);
  assert.deepEqual(fin(["hospital_finance_reports"])?.children?.map((c) => c.href), ["/hospital/finance/reports"]);
});
