/** Hospital stage E: Supplier & Vendors, vendor service bills, the Purchase
 * Cell's pending supply, Finance's vendor payments, the pharmacy's bills of
 * the hospital's patients, and insured patients with their claims. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import {
  addServiceType, bankLine, createServiceBill, deleteServiceBill, listServiceBills, listServiceTypes, listVendors, pendingSupply, saveVendor, validIban,
} from "@/lib/repo/vendors";
import { payVendorBill, pendingVendorBills, recentVendorPayments, vendorPaymentSummary } from "@/lib/repo/vendorPayments";
import { addInsuranceCompany } from "@/lib/repo/insurance";
import { companyOverview, insuredEpisodes, setHospitalClaim } from "@/lib/repo/hospitalInsurance";
import { addCharge, hospitalEpisodesRepo, hospitalPatientsRepo, nextEpisodeNo, nextMrNo } from "@/lib/repo/hospital";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { pharmacyCatalogue, type PharmacyHospitalInvoice } from "@/server/pharmacyBrands";
import { designation } from "@/config/hospitalStaff";
import { localDate } from "@/lib/localDate";
import type { Staff } from "@/lib/types";

const H = "hosp-a", P = "pharm-p";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  await staffRepo.update(staff.id, { user_id: `user-${staff.id}` } as Partial<Staff>);
  useAuthStore.setState({ currentUser: { id: `user-${staff.id}`, username: staff.name, displayName: staff.name, role: "staff", tenantId: H, permissions: designation(staff.staff_category)!.pages }, currentTenant: tenant });
}
const run = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as never[]));
const today = localDate();

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  asOwner();
});

test("suppliers & vendors: their own vendor numbers, bank details checked, and what is owed to each", async () => {
  assert.ok(validIban("PK36 SCBL 0000 0011 2345 6702"));
  assert.ok(!validIban("PK36SCBL123"));
  const s1 = await saveVendor(null, { name: "Muller & Phipps", party_kind: "supplier", bank_title: "M&P Pvt Ltd", bank_name: "Meezan Bank", iban: "pk36scbl0000001123456702", cnic: "35202-1234567-1", proprietor: "Ahmad" });
  const v1 = await saveVendor(null, { name: "Al-Noor Tent Service", party_kind: "vendor", opening_balance: 1000 });
  assert.deepEqual([s1.vendor_no, v1.vendor_no, s1.iban], ["V-0001", "V-0002", "PK36SCBL0000001123456702"]);
  await assert.rejects(saveVendor(null, { name: "Bad", iban: "PK12" }), /IBAN is 24 characters/);
  await assert.rejects(saveVendor(null, { name: "Bad", cnic: "123" }), /CNIC as 13 digits/);
  assert.equal(bankLine(s1), "Title: M&P Pvt Ltd · Meezan Bank · IBAN PK36SCBL0000001123456702");
  assert.equal((await saveVendor(s1.id, { name: "Muller and Phipps", iban: s1.iban })).vendor_no, "V-0001", "the number stays");

  run(`INSERT INTO purchases (id, tenant_id, purchase_no, date, supplier_id, payable, paid_amount, balance, is_return, created_at, updated_at) VALUES ('pu1', ?, 1, ?, ?, 50000, 10000, 40000, 0, ?, 'x')`, H, today, s1.id, today);
  await createServiceBill({ vendorId: v1.id, serviceType: "Tenting", amount: 20000, tax: 1600, discount: 600, vendorInvoiceNo: "T-77" });
  const rows = await listVendors();
  assert.deepEqual(rows.map((r) => [r.name, r.balance]), [["Al-Noor Tent Service", 22000], ["Muller and Phipps", 40000]]);
  assert.deepEqual((await listVendors("", "vendor")).map((r) => r.name), ["Al-Noor Tent Service"]);
});

test("service bills and types: total = amount + tax - discount; a bill with payments stays", async () => {
  await addServiceType(" Catering ");
  await addServiceType("catering");
  assert.deepEqual((await listServiceTypes()).map((t) => t.name), ["Catering"]);
  const v = await saveVendor(null, { name: "Royal Caterers", party_kind: "vendor" });
  await assert.rejects(createServiceBill({ vendorId: v.id, amount: 0 }), /bill amount/);
  await assert.rejects(createServiceBill({ vendorId: v.id, amount: 100, discount: 200 }), /discount is more/);
  const b = await createServiceBill({ vendorId: v.id, serviceType: "Catering", amount: 30000, tax: 0, discount: 1000 });
  assert.deepEqual([b.bill_no, b.total, b.balance], ["SB-0001", 29000, 29000]);
  await payVendorBill({ docType: "service_bill", docId: b.id, amount: 9000, method: "cash" });
  await assert.rejects(deleteServiceBill(b.id), /Payments were made/);
  assert.equal((await listServiceBills({ status: "unpaid" }))[0].balance, 20000);
});

test("Finance pays vendors in part or in full by bank, cash or cheque; balances follow", async () => {
  const s = await saveVendor(null, { name: "Getz Pharma", iban: "PK36SCBL0000001123456702", bank_title: "Getz", bank_name: "SCB" });
  run(`INSERT INTO purchases (id, tenant_id, purchase_no, date, supplier_id, payable, paid_amount, balance, is_return, created_at, updated_at) VALUES ('pu1', ?, 7, ?, ?, 60000, 0, 60000, 0, ?, 'x')`, H, today, s.id, today);
  const pending = await pendingVendorBills();
  assert.deepEqual(pending.map((p) => [p.no, p.vendorNo, p.iban, p.balance]), [["Purchase #7", "V-0001", "PK36SCBL0000001123456702", 60000]]);

  const nurse = await saveHospitalStaff(null, { name: "Nurse Rabia", staff_category: "nurse", license_no: "PNC-1", basic_pay: 0 });
  await as(nurse);
  await assert.rejects(payVendorBill({ docType: "purchase", docId: "pu1", full: true, method: "cash" }), /made by Finance/);
  const acc = await saveHospitalStaff(null, { name: "Imran", staff_category: "accountant", basic_pay: 0 });
  await as(acc);
  await assert.rejects(payVendorBill({ docType: "purchase", docId: "pu1", amount: 1000, method: "cheque" }), /cheque number/);
  await assert.rejects(payVendorBill({ docType: "purchase", docId: "pu1", amount: 70000, method: "bank", reference: "TX1" }), /Only Rs 60,000 is left/);
  await payVendorBill({ docType: "purchase", docId: "pu1", amount: 25000, method: "bank", reference: "TX-1001", dated: today });
  await payVendorBill({ docType: "purchase", docId: "pu1", full: true, method: "cheque", reference: "CHQ-55", dated: today });
  assert.equal((await pendingVendorBills()).length, 0);
  assert.equal((await listVendors())[0].balance, 0);
  assert.deepEqual((await recentVendorPayments()).map((p) => [p.amount, p.method, p.reference]).sort(), [[25000, "bank", "TX-1001"], [35000, "cheque", "CHQ-55"]]);
  assert.deepEqual(await vendorPaymentSummary({ from: today, to: today }), { pending: 0, pendingTotal: 0, paidTotal: 60000, paidCount: 2 });
});

test("the Purchase Cell's pending supply: orders with no purchase yet", async () => {
  const s = await saveVendor(null, { name: "Hilton Pharma" });
  run(`INSERT INTO orders (id, tenant_id, order_no, date, supplier_id, estimated_price, created_at, updated_at) VALUES ('o1', ?, 1, '2026-11-01', ?, 5000, 'x', 'x'), ('o2', ?, 2, '2026-11-05', ?, 3000, 'x', 'x')`, H, s.id, H, s.id);
  run(`INSERT INTO purchases (id, tenant_id, purchase_no, date, supplier_id, order_id, payable, balance, is_return, created_at, updated_at) VALUES ('pu', ?, 1, '2026-11-06', ?, 'o2', 3000, 0, 0, 'x', 'x')`, H, s.id);
  assert.deepEqual((await pendingSupply()).map((p) => [p.supplier_name, p.orders, p.estimated, p.oldest]), [["Hilton Pharma", 1, 5000, "2026-11-01"]]);
});

test("the pharmacy's bills of this hospital's patients, paid or unpaid", async () => {
  run(`INSERT INTO clinic_pharmacy_link (id, clinic_tenant_id, pharmacy_tenant_id, is_active, created_at, updated_at) VALUES ('l1', ?, ?, 1, 'x', 'x')`, H, P);
  run(`INSERT INTO invoices (id, tenant_id, invoice_no, date, payable, paid, balance, created_at, updated_at) VALUES ('i1', ?, 501, '2026-11-20', 1800, 1800, 0, 'x', 'x'), ('i2', ?, 502, '2026-11-21', 900, 0, 900, 'x', 'x')`, P, P);
  for (const [id, inv, clinic] of [["n1", "i1", H], ["n2", "i2", H], ["n3", "i2", "other-hospital"]]) {
    run(`INSERT INTO pharmacy_rx_notifications (id, pharmacy_tenant_id, prescription_id, clinic_tenant_id, clinic_name, patient_name, patient_id, doctor_name, rx_date, item_count, status, invoice_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'Ayesha', 'pt1', 'Dr', '2026-11-20', 1, 'done', ?, 'x', 'x')`, id, P, `rx-${id}`, clinic, inv);
  }
  const rows = await pharmacyCatalogue(sqliteSql(db), { userId: "o", role: "owner", tenantId: H }, { action: "invoices" }) as PharmacyHospitalInvoice[];
  assert.deepEqual(rows.map((r) => [r.invoiceNo, r.amount, r.status]), [[502, 900, "unpaid"], [501, 1800, "paid"]]);
});

test("insured patients: the insured amount covers bills in date order, the rest is the patient's; Finance claims them", async () => {
  const jubilee = await addInsuranceCompany("Jubilee Life");
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Ayesha Khan", gender: "Female", insurance_no: "JL-1", insured: 1, insurance_company_id: jubilee.id, insured_amount: 50000, insurance_valid_till: "2027-12-31" });
  const q = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Not insured", gender: "Male" });
  const bill = async (patientId: string, date: string, amount: number) => {
    const e = await hospitalEpisodesRepo.create({ episode_no: await nextEpisodeNo("ipd", date), type: "ipd", patient_id: patientId, doctor_id: null, department: null, date, time: null, status: "open", room_ward: null, bed_no: null, admission_date: date, discharge_date: null, diagnosis: null, notes: null });
    await addCharge({ tenant_id: "", episode_id: e.id, service_id: null, description: "Charges", department: null, category: "misc", qty: 1, rate: amount, discount_pct: 0, amount: 0, doctor_id: null, performed_by: null, charge_date: date, notes: null, invoice_id: null });
    return e;
  };
  const e1 = await bill(p.id, "2026-11-01", 30000);
  const e2 = await bill(p.id, "2026-11-10", 35000);
  await bill(q.id, "2026-11-10", 5000);
  let rows = await insuredEpisodes();
  assert.deepEqual(rows.map((r) => [r.episodeNo, r.total, r.cover, r.patientShare, r.status]).sort(), [
    [e1.episode_no, 30000, 30000, 0, "not_claimed"], [e2.episode_no, 35000, 20000, 15000, "not_claimed"],
  ]);

  const nurse = await saveHospitalStaff(null, { name: "Nurse Rabia", staff_category: "nurse", license_no: "PNC-1", basic_pay: 0 });
  await as(nurse);
  await assert.rejects(setHospitalClaim([e1.id], "sent"), /handled by Finance/);
  asOwner();
  assert.equal(await setHospitalClaim([e1.id, e2.id], "sent", "JL-CLM-9"), 2);
  await setHospitalClaim([e1.id], "paid");
  rows = await insuredEpisodes({ companyId: jubilee.id });
  assert.deepEqual(companyOverview(rows), { cases: 2, totalClaim: 50000, claimedCases: 2, claimedTotal: 50000, paid: 30000, pending: 20000 });
  assert.equal((await insuredEpisodes({ status: "paid" }))[0].claimRef, "JL-CLM-9");
});
