import { FINANCE_ROLES, HR_ROLES } from "@/config/hospitalStaff";
import { useAuthStore } from "@/store/authStore";
import { hospitalStaffList } from "./hrRecords";
import { currentActor, roleAllowed } from "./medicalRecord";
import { salariesRepo } from "./salaries";
import type { Salary } from "../types2";

/** Current staff settings for payroll estimates, not a payroll or payment ledger. */
export async function listPayrollStaff() {
  const { currentUser, currentTenant } = useAuthStore.getState();
  if (!currentUser || !currentTenant || (currentUser.role !== "super_admin" && currentUser.tenantId !== currentTenant.id)) {
    throw new Error("Sign in to this hospital to view payroll estimates.");
  }
  const actor = await currentActor();
  if (!roleAllowed([...FINANCE_ROLES, ...HR_ROLES], actor)) {
    throw new Error("Payroll estimates are available to HR, Finance and administrators.");
  }
  const staff = await hospitalStaffList();
  const session = useAuthStore.getState();
  if (session.currentUser !== currentUser || session.currentTenant !== currentTenant) {
    throw new Error("The session changed while loading payroll estimates. Please try again.");
  }
  return staff;
}

async function requirePayrollWriter() {
  const { currentUser, currentTenant } = useAuthStore.getState();
  if (!currentUser || !currentTenant || (currentUser.role !== "super_admin" && currentUser.tenantId !== currentTenant.id)) {
    throw new Error("Sign in to this hospital to manage payroll.");
  }
  const actor = await currentActor();
  if (!roleAllowed([...FINANCE_ROLES, ...HR_ROLES], actor)) {
    throw new Error("Payroll records are available to HR, Finance and administrators.");
  }
}

export async function listPayrollRecords(month?: string, year?: number): Promise<Salary[]> {
  await requirePayrollWriter();
  const where: string[] = [];
  const params: unknown[] = [];
  if (month) { where.push("salary_month = ?"); params.push(month); }
  if (year) { where.push("salary_year = ?"); params.push(year); }
  return salariesRepo.list({
    ...(where.length ? { where: where.join(" AND "), params } : {}),
    orderBy: "salary_year DESC, salary_month DESC, date DESC",
  });
}

export async function savePayrollRecord(input: {
  staffId: string;
  month: string;
  year: number;
  basic: number;
  overtimeHours: number;
  overtimePay: number;
  deductions: number;
  shares: number;
  payable: number;
  paid: number;
  paymentMethod: string;
}) {
  await requirePayrollWriter();
  if (!input.staffId) throw new Error("Choose an employee.");
  if (!input.month.trim()) throw new Error("Choose a salary month.");
  if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 9999) throw new Error("Choose a valid salary year.");
  for (const [label, value] of [
    ["Basic pay", input.basic], ["Overtime pay", input.overtimePay], ["Deductions", input.deductions],
    ["Shares", input.shares], ["Payable salary", input.payable], ["Paid salary", input.paid],
  ] as const) if (!Number.isFinite(value) || value < 0) throw new Error(`${label} cannot be negative.`);
  if (input.paid > input.payable) throw new Error("Paid salary cannot be more than payable salary.");
  const existing = (await salariesRepo.list({
    where: "staff_id = ? AND salary_month = ? AND salary_year = ?",
    params: [input.staffId, input.month, input.year],
  }))[0];
  const balance = Math.round((input.payable - input.paid) * 100) / 100;
  const payStatus = input.paid <= 0 ? "unpaid" : balance <= 0.004 ? "paid" : "partial";
  const actor = useAuthStore.getState().currentUser;
  const data: Partial<Salary> = {
    date: new Date().toISOString().slice(0, 10),
    salary_month: input.month,
    salary_year: input.year,
    staff_id: input.staffId,
    basic_pay: input.basic,
    payment_method: input.paymentMethod,
    incentive: input.shares,
    deduction: input.deductions,
    tax_rs: 0,
    payable_salary: input.payable,
    paid_salary: input.paid,
    balance_salary: balance,
    overtime_hours: input.overtimeHours,
    overtime_pay: input.overtimePay,
    shares: input.shares,
    pay_status: payStatus,
    paid_at: input.paid > 0 ? new Date().toISOString() : null,
    slip_no: existing?.slip_no ?? `SL-${input.year}-${input.month.slice(0, 3).toUpperCase()}-${input.staffId.toUpperCase()}`,
    created_by_name: existing?.created_by_name ?? actor?.displayName ?? actor?.username ?? null,
  };
  return existing ? (await salariesRepo.update(existing.id, data))! : salariesRepo.create(data);
}
