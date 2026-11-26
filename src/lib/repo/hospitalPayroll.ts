import { FINANCE_ROLES, HR_ROLES } from "@/config/hospitalStaff";
import { useAuthStore } from "@/store/authStore";
import { hospitalStaffList } from "./hrRecords";
import { currentActor, roleAllowed } from "./medicalRecord";
import { salariesRepo } from "./salaries";
import { createTenantRepo } from "./base";
import { dbSelect } from "../db";
import { recordOutbox } from "../sync/outbox";
import { doctorShares, type DoctorShareRow } from "./hospitalReports";
import type { HospitalSalaryPayment, Salary } from "../types2";
import { isPayrollDate } from "../hospitalPayroll";

export const salaryPaymentsRepo = createTenantRepo<HospitalSalaryPayment>("hospital_salary_payments");

/** Current hospital staff settings used to estimate monthly payroll. */
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

export async function listPayrollPayments(salaryId: string): Promise<HospitalSalaryPayment[]> {
  await requirePayrollWriter();
  if (!(await salariesRepo.get(salaryId))) throw new Error("Salary record not found in this hospital.");
  return salaryPaymentsRepo.list({ where: "salary_id = ?", params: [salaryId], orderBy: "paid_at DESC, created_at DESC" });
}

export async function recordPayrollPayment(input: {
  salaryId: string;
  amount: number;
  method: string;
  date: string;
  reference?: string | null;
  notes?: string | null;
}) {
  await requirePayrollWriter();
  if (!(await salariesRepo.get(input.salaryId))) throw new Error("Salary record not found in this hospital.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a payment amount greater than zero.");
  if (!isPayrollDate(input.date)) throw new Error("Choose a valid payment date.");
  if (!["Cash", "Bank"].includes(input.method)) throw new Error("Choose Cash or Bank as the payment method.");
  const actor = useAuthStore.getState().currentUser;
  try {
    const payment = await salaryPaymentsRepo.create({
      salary_id: input.salaryId,
      amount: Math.round(input.amount * 100) / 100,
      method: input.method,
      paid_at: `${input.date}T12:00:00.000Z`,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      paid_by_name: actor?.displayName ?? actor?.username ?? null,
    });
    const salary = await salariesRepo.get(input.salaryId);
    if (salary) await recordOutbox("salaries", salary.id, "update", salary as unknown as Record<string, unknown>);
    return payment;
  } catch (e) {
    if (e instanceof Error && /Payment exceeds the remaining salary balance/i.test(e.message)) {
      throw new Error("Payment exceeds the remaining salary balance.");
    }
    throw e;
  }
}

export interface DoctorPayrollSummary {
  testsOrdered: number;
  total: number;
  consultation: number;
  services: number;
  ordered: number;
  surgery: number;
  shares: DoctorShareRow | null;
}

export async function doctorPayrollSummary(staffId: string, range: { from: string; to: string }): Promise<DoctorPayrollSummary> {
  await requirePayrollWriter();
  if (!isPayrollDate(range.from) || !isPayrollDate(range.to) || range.from > range.to) {
    throw new Error("Choose a valid date range.");
  }
  const tenantId = useAuthStore.getState().currentTenant!.id;
  const [counts, shareRows] = await Promise.all([
    dbSelect<{ count: number | null }>(
      `SELECT COUNT(*) AS count FROM hospital_charges
       WHERE tenant_id = ? AND deleted_at IS NULL AND doctor_id = ? AND category IN ('lab', 'imaging')
         AND substr(charge_date, 1, 10) BETWEEN ? AND ?`,
      [tenantId, staffId, range.from, range.to]
    ),
    doctorShares(range, "range"),
  ]);
  const shares = shareRows.find((row) => row.doctorId === staffId) ?? null;
  return {
    testsOrdered: Number(counts[0]?.count) || 0,
    total: shares?.total ?? 0,
    consultation: shares?.consultation ?? 0,
    services: shares?.services ?? 0,
    ordered: shares?.ordered ?? 0,
    surgery: shares?.surgery ?? 0,
    shares,
  };
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
  const paid = existing ? Number(existing.paid_salary) || 0 : input.paid;
  if (!Number.isFinite(paid) || paid < 0 || paid > input.payable) throw new Error("Paid salary cannot be more than payable salary.");
  const balance = Math.round((input.payable - paid) * 100) / 100;
  const payStatus = paid <= 0 ? "unpaid" : balance <= 0.004 ? "paid" : "partial";
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
    paid_salary: paid,
    balance_salary: balance,
    overtime_hours: input.overtimeHours,
    overtime_pay: input.overtimePay,
    shares: input.shares,
    pay_status: payStatus,
    paid_at: existing?.paid_at ?? (paid > 0 ? new Date().toISOString() : null),
    slip_no: existing?.slip_no ?? `SL-${input.year}-${input.month.slice(0, 3).toUpperCase()}-${input.staffId.toUpperCase()}`,
    created_by_name: existing?.created_by_name ?? actor?.displayName ?? actor?.username ?? null,
  };
  return existing ? (await salariesRepo.update(existing.id, data))! : salariesRepo.create(data);
}
