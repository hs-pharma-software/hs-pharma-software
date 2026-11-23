/** Pharmacy insurance (stage 3): companies, a customer's policy, claims per
 * whole invoice with their status, the Insured list and the four reports. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import {
  addInsuranceCompany, claimTotals, deleteInsuranceCompany, groupInsurance, insuranceInvoices, insuredCustomers, listInsuranceCompanies, setClaimStatus,
} from "@/lib/repo/insurance";

const T = "pharm-a";
let db: DatabaseSync;
const tenant = (id: string): SessionTenant => ({
  id, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
});
const loginAs = (id: string) => useAuthStore.setState({ currentUser: { id: "u-" + id, username: "ali", displayName: "Ali", role: "owner", tenantId: id, permissions: null }, currentTenant: tenant(id) });
const run = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as never[]));

function customer(id: string, name: string, company: string | null, policy: string | null, expiry: string | null = null) {
  run(`INSERT INTO customers (id, tenant_id, name, insurance_company_id, insurance_policy_no, insurance_expiry, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 'x')`, id, T, name, company, policy, expiry);
}
function invoice(id: string, no: number, date: string, customerId: string | null, payable: number, flags: { isReturn?: number; memorized?: number } = {}) {
  run(`INSERT INTO invoices (id, tenant_id, invoice_no, date, customer_id, total, payable, is_return, is_memorized, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'x')`,
    id, T, no, date, customerId, payable, payable, flags.isReturn ?? 0, flags.memorized ?? 0, date);
}

let jubilee: string, efu: string;
beforeEach(async () => {
  db = fullSchemaDb();
  setTestDb(db);
  loginAs(T);
  jubilee = (await addInsuranceCompany("  Jubilee   Life Insurance ")).id;
  efu = (await addInsuranceCompany("EFU Life Assurance")).id;
  customer("c1", "Ayesha Khan", jubilee, "JL-1001", "2026-12-31");
  customer("c2", "Bilal Ahmed", efu, "EFU-77");
  customer("c3", "Walk-in Saleem", null, null);
  customer("c4", "Old Policy Rehan", jubilee, "JL-0099", "2026-10-31");
  invoice("i1", 101, "2026-10-05", "c1", 4000);
  invoice("i2", 102, "2026-11-02", "c1", 6000);
  invoice("i3", 103, "2026-11-10", "c2", 250000);
  invoice("i4", 104, "2026-11-11", "c3", 900);            // not insured
  invoice("i5", 105, "2026-11-12", "c4", 1200);           // after the policy expired
  invoice("i6", 106, "2026-10-20", "c4", 800);            // before it expired
  invoice("i7", 107, "2026-11-13", "c1", 500, { isReturn: 1 });
  invoice("i8", 108, "2026-11-14", "c1", 700, { memorized: 1 });
});

test("companies: added once per name (spacing and case ignored), and kept per business", async () => {
  assert.equal((await addInsuranceCompany("jubilee life insurance")).id, jubilee);
  await assert.rejects(addInsuranceCompany(" "), /name/);
  assert.deepEqual((await listInsuranceCompanies()).map((c) => c.name), ["EFU Life Assurance", "Jubilee Life Insurance"]);
  await assert.rejects(deleteInsuranceCompany(jubilee), /can't be deleted/);
  const spare = await addInsuranceCompany("TPL Insurance");
  await deleteInsuranceCompany(spare.id);
  loginAs("pharm-b");
  assert.deepEqual(await listInsuranceCompanies(), []);
});

test("insurance invoices: sales to insured customers within the policy, not returns, drafts or uninsured sales", async () => {
  const rows = await insuranceInvoices();
  assert.deepEqual(rows.map((r) => r.invoiceNo), [103, 102, 106, 101]);
  assert.ok(rows.every((r) => r.status === "not_claimed"));
  assert.deepEqual((await insuredCustomers(jubilee)).map((c) => [c.name, c.policyNo]), [["Ayesha Khan", "JL-1001"], ["Old Policy Rehan", "JL-0099"]]);
  assert.equal((await insuredCustomers()).length, 3);
  assert.deepEqual((await insuranceInvoices({ customerId: "c1" })).map((r) => r.amount), [6000, 4000]);
});

test("claims: the whole invoice is sent, moves through its statuses, can be withdrawn, and keeps its company", async () => {
  assert.equal(await setClaimStatus(["i1", "i2"], "sent", "JL-CLM-1"), 2);
  assert.equal(await setClaimStatus(["i1"], "sent"), 0, "unchanged");
  await setClaimStatus(["i2"], "in_process");
  await setClaimStatus(["i1"], "paid");
  await setClaimStatus(["i3"], "unpaid");
  await assert.rejects(setClaimStatus(["i4"], "sent"), /no insurance company/);
  const byNo = new Map((await insuranceInvoices()).map((r) => [r.invoiceNo, r]));
  assert.deepEqual([byNo.get(101)!.status, byNo.get(101)!.claimRef, Boolean(byNo.get(101)!.settledOn)], ["paid", "JL-CLM-1", true]);
  assert.equal(byNo.get(102)!.status, "in_process");
  assert.equal(byNo.get(102)!.settledOn, null);

  // The customer changes company: the claim stays with the company it went to.
  run(`UPDATE customers SET insurance_company_id = ? WHERE id = 'c1'`, efu);
  assert.equal((await insuranceInvoices({ companyId: jubilee })).map((r) => r.invoiceNo).join(), "102,106,101");
  assert.equal((await insuranceInvoices({ companyId: efu })).map((r) => r.invoiceNo).join(), "103");

  await setClaimStatus(["i2"], "not_claimed");
  assert.equal((await insuranceInvoices({ status: "not_claimed" })).some((r) => r.invoiceNo === 102), true);
});

test("reports: company wise, patient wise, monthly and invoice wise for a period", async () => {
  await setClaimStatus(["i1"], "paid");
  await setClaimStatus(["i3"], "sent");
  const nov = await insuranceInvoices({ from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(nov.map((r) => r.invoiceNo), [103, 102]);
  assert.equal(claimTotals(nov).total, 256000);

  const all = await insuranceInvoices();
  const company = groupInsurance(all, "company");
  assert.deepEqual(company.map((g) => [g.label, g.total, g.invoices]), [["EFU Life Assurance", 250000, 1], ["Jubilee Life Insurance", 10800, 3]]);
  assert.equal(company[1].byStatus.paid, 4000);
  assert.equal(company[1].byStatus.not_claimed, 6800);

  const patients = groupInsurance(all, "patient");
  assert.deepEqual(patients.map((g) => [g.label, g.total]), [["Bilal Ahmed", 250000], ["Ayesha Khan", 10000], ["Old Policy Rehan", 800]]);
  assert.equal(patients[1].sub, "Jubilee Life Insurance · Policy JL-1001");

  assert.deepEqual(groupInsurance(all, "month").map((g) => [g.label, g.total]), [["2026-11", 256000], ["2026-10", 4800]]);
});

test("menus: Pre Invoices, Narcotics, Insured and the Insurance report are for pharmacies (hospital pharmacy too), not other shops", async () => {
  const { visibleNavFor } = await import("@/config/navFilter");
  const hrefs = (type: string) => visibleNavFor(type, null, null).flatMap((i) => [i.href, ...(i.children ?? []).flatMap((c) => [c.href, ...(c.children ?? []).map((g) => g.href)])]);
  const pages = ["/invoices/pre", "/customers/narcotics", "/customers/insured", "/reports/insurance"];
  for (const t of ["retail_pharmacy", "hospital_pharmacy", "medical_store"]) assert.deepEqual(pages.filter((p) => hrefs(t).includes(p)), pages, t);
  for (const t of ["general_store", "hospital"]) assert.deepEqual(pages.filter((p) => hrefs(t).includes(p)), [], t);
});
