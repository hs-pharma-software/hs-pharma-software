import { test } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant, type SessionUser } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import {
  listPayrollPayments, listPayrollRecords, listPayrollStaff, recordPayrollPayment, savePayrollRecord,
} from "@/lib/repo/hospitalPayroll";

test("payroll estimates require HR, Finance or full access and stay within the tenant", async () => {
  setTestDb(fullSchemaDb());
  const tenant: SessionTenant = {
    id: "payroll-a", name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [],
    maxStaffLogins: 10, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  const owner: SessionUser = { id: "owner", username: "owner", displayName: "Owner", role: "owner", tenantId: tenant.id, permissions: null };
  useAuthStore.setState({ currentUser: owner, currentTenant: tenant });
  await staffRepo.create({ name: "HR", staff_category: "hr_officer", user_id: "hr" });
  await staffRepo.create({ name: "Finance", staff_category: "accountant", user_id: "finance" });
  await staffRepo.create({ name: "Nurse", staff_category: "nurse", user_id: "nurse" });
  useAuthStore.setState({ currentUser: { ...owner, tenantId: "payroll-b" }, currentTenant: { ...tenant, id: "payroll-b" } });
  await staffRepo.create({ name: "Other hospital", staff_category: "nurse" });
  useAuthStore.setState({ currentUser: owner, currentTenant: tenant });
  assert.deepEqual((await listPayrollStaff()).map((s) => s.name), ["Finance", "HR", "Nurse"]);
  const staffUser = (id: string, permissions: string[]): SessionUser => ({ id, username: id, displayName: id, role: "staff", tenantId: tenant.id, permissions });
  useAuthStore.setState({ currentUser: staffUser("hr", ["hospital_hr"]) });
  assert.equal((await listPayrollStaff()).length, 3);
  useAuthStore.setState({ currentUser: staffUser("finance", ["hospital_finance"]) });
  assert.equal((await listPayrollStaff()).length, 3);
  useAuthStore.setState({ currentUser: staffUser("nurse", ["hospital_patients"]) });
  await assert.rejects(listPayrollStaff(), /HR, Finance/);
  useAuthStore.setState({ currentUser: null });
  await assert.rejects(listPayrollStaff(), /Sign in/);
  useAuthStore.setState({ currentUser: { ...owner, tenantId: "payroll-b" } });
  await assert.rejects(listPayrollStaff(), /Sign in/);
});

test("payroll records save once per employee and month and calculate balances", async () => {
  setTestDb(fullSchemaDb());
  const tenant: SessionTenant = {
    id: "payroll-record", name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [],
    maxStaffLogins: 10, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
  };
  const owner: SessionUser = { id: "owner", username: "owner", displayName: "Owner", role: "owner", tenantId: tenant.id, permissions: null };
  useAuthStore.setState({ currentUser: owner, currentTenant: tenant });
  const staff = await staffRepo.create({ name: "Dr A", staff_category: "consultant", basic_pay: 45000 });
  const first = await savePayrollRecord({
    staffId: staff.id, month: "July", year: 2026, basic: 45000, overtimeHours: 32,
    overtimePay: 10000, deductions: 5000, shares: 2500, payable: 52500, paid: 0, paymentMethod: "Bank",
  });
  assert.equal(first.pay_status, "unpaid");
  assert.equal(first.balance_salary, 52500);
  assert.ok(first.slip_no?.startsWith("SL-2026-JUL"));
  await recordPayrollPayment({ salaryId: first.id, amount: 30000, method: "Bank", date: "2026-07-20", reference: "TR-1" });
  const partial = (await listPayrollRecords("July", 2026))[0];
  assert.equal(partial.pay_status, "partial");
  assert.equal(partial.balance_salary, 22500);
  assert.equal(partial.paid_salary, 30000);
  assert.equal((await listPayrollPayments(first.id))[0].reference, "TR-1");
  await recordPayrollPayment({ salaryId: first.id, amount: 22500, method: "Cash", date: "2026-07-21" });
  const updated = await savePayrollRecord({
    staffId: staff.id, month: "July", year: 2026, basic: 45000, overtimeHours: 32,
    overtimePay: 10000, deductions: 5000, shares: 2500, payable: 52500, paid: 52500, paymentMethod: "Bank",
  });
  assert.equal(updated.id, first.id);
  assert.equal(updated.pay_status, "paid");
  assert.equal(updated.balance_salary, 0);
  assert.equal((await listPayrollRecords("July", 2026)).length, 1);
  assert.equal((await listPayrollPayments(first.id)).length, 2);
  await assert.rejects(recordPayrollPayment({ salaryId: first.id, amount: 1, method: "Cash", date: "2026-07-22" }), /remaining salary balance/i);
  await assert.rejects(recordPayrollPayment({ salaryId: first.id, amount: -1, method: "Cash", date: "2026-07-22" }), /greater than zero/i);
  await assert.rejects(savePayrollRecord({
    staffId: staff.id, month: "July", year: 2026, basic: 45000, overtimeHours: 0,
    overtimePay: 0, deductions: 0, shares: 0, payable: 100, paid: 101, paymentMethod: "Cash",
  }), /paid salary cannot/i);
});
