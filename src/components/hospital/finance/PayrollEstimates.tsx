"use client";

import { useEffect, useState } from "react";
import { designation, staffGroup, staffRoles } from "@/config/hospitalStaff";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { calculateMonthlySalary, isPayrollDate, monthlyWorkRates } from "@/lib/hospitalPayroll";
import { localDate } from "@/lib/localDate";
import { isTauri } from "@/lib/platform";
import { listPayrollRecords, listPayrollStaff, savePayrollRecord } from "@/lib/repo/hospitalPayroll";
import type { Staff } from "@/lib/types";
import type { Salary } from "@/lib/types2";
import { useAuthStore, type SessionTenant, type SessionUser } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";

type EstimateInput = Parameters<typeof calculateMonthlySalary>[0];

function estimateInput(staff: Staff, month: string): EstimateInput {
  if (!isPayrollDate(`${month}-01`)) throw new Error("Choose a valid month.");
  if (!staff.date_of_joining || !isPayrollDate(staff.date_of_joining)) throw new Error("A valid joining date is required.");
  if (staff.working_hours_per_day == null || staff.sunday_off == null || staff.overtime_multiplier == null) {
    throw new Error("The working schedule and overtime multiplier are required.");
  }
  if (staff.sunday_off !== 0 && staff.sunday_off !== 1) throw new Error("Check the Sunday-off setting.");
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    year, month: monthNumber, basicPay: staff.basic_pay,
    hoursPerDay: staff.working_hours_per_day, sundayOff: staff.sunday_off === 1,
    overtimeMultiplier: staff.overtime_multiplier, joinedOn: staff.date_of_joining,
    overtimeHours: 0, deductions: 0, shares: 0,
  };
}

function estimate(staff: Staff, month: string, overtimeHours = 0, deductions = 0) {
  try {
    const input = { ...estimateInput(staff, month), overtimeHours, deductions };
    return { input, salary: calculateMonthlySalary(input), error: null };
  } catch (e) {
    return { input: null, salary: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const money = (amount: number) => `Rs ${amount.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isDoctor = (s: Staff) => staffRoles(s).some((role) => staffGroup(role) === "doctors");

export function PayrollEstimates({ kind }: { kind: "staff" | "doctors" }) {
  const user = useAuthStore((s) => s.currentUser);
  const tenant = useAuthStore((s) => s.currentTenant);
  const [result, setResult] = useState<{ user: SessionUser | null; tenant: SessionTenant | null; rows: Staff[]; error: string | null } | null>(null);
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Staff | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (!isTauri()) throw new Error("The database is not available.");
        const rows = await listPayrollStaff();
        if (active) setResult({ user, tenant, rows, error: null });
      } catch (e) {
        if (active) setResult({ user, tenant, rows: [], error: e instanceof Error ? e.message : String(e) });
      }
    };
    void load();
    return () => { active = false; };
  }, [user, tenant]);

  const current = result?.user === user && result?.tenant === tenant ? result : null;
  const query = search.trim().toLowerCase();
  const shown = current?.rows.filter((s) => isDoctor(s) === (kind === "doctors")
    && `${s.name} ${s.employee_id ?? ""} ${s.department ?? ""}`.toLowerCase().includes(query)) ?? [];
  const validMonth = isPayrollDate(`${month}-01`);
  return (
    <div>
      <PageHeader title={kind === "doctors" ? "Doctors Payments - Estimate" : "Salaries - Estimate"} />
      <div className="flex flex-col gap-4">
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Estimates only, using the staff record&apos;s current basic pay and schedule, even for past months.
          No overtime, deductions or shares are included in the list. Payments, payment status, slips and test-share eligibility are not yet recorded here.
        </p>
        <div className="flex flex-wrap gap-3">
          <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          <Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, employee ID or department" /></Field>
        </div>
        {!validMonth && <p role="alert" className="text-sm text-rose-700">Choose a valid month.</p>}
        {!current ? <p className="text-sm text-neutral-500">Loading payroll estimates...</p>
          : current.error ? <p role="alert" className="text-sm text-rose-700">{current.error}</p>
          : !shown.length ? <p className="text-sm text-neutral-500">No matching staff.</p>
          : <div className="overflow-x-auto rounded-xl bg-white p-4 shadow-sm">
            <table className="w-full text-left text-sm">
              <thead><tr className="text-xs text-neutral-500"><th className="pb-2">Name</th><th className="pb-2">Designation</th><th className="pb-2 text-right">Estimated basic</th></tr></thead>
              <tbody>{shown.map((s) => {
                const row = validMonth ? estimate(s, month) : null;
                return <tr key={s.id} className="border-t border-neutral-100">
                  <td className="py-2"><button type="button" className="font-medium text-sky-700 hover:underline" onClick={() => setSelected(s)}>{s.name}</button><span className="block text-xs text-neutral-500">{s.employee_id ?? ""}</span></td>
                  <td className="py-2">{designation(s.staff_category)?.label ?? s.designation ?? "—"}</td>
                  <td className="py-2 text-right">{row?.salary ? money(row.salary.basic) : <span className="text-xs text-amber-700">{row?.error ?? "Choose a month"}</span>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
      </div>
      {current && !current.error && selected && current.rows.includes(selected) && validMonth && (
        <SalaryEstimateModal key={`${selected.id}-${month}`} staff={selected} month={month} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function SalaryEstimateModal({ staff, month, onClose }: { staff: Staff; month: string; onClose: () => void }) {
  const [hours, setHours] = useState("0");
  const [deductions, setDeductions] = useState("0");
  const [shares, setShares] = useState("0");
  const [paid, setPaid] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<Salary | null>(null);
  const result = estimate(staff, month, hours.trim() ? Number(hours) : NaN, deductions.trim() ? Number(deductions) : NaN);
  const rates = result.input ? monthlyWorkRates(result.input) : null;

  useEffect(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const monthName = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(year, monthNumber - 1, 1));
    void listPayrollRecords(monthName, year).then((rows) => {
      const found = rows.find((r) => r.staff_id === staff.id);
      if (found) {
        setRecord(found);
        setHours(String(found.overtime_hours ?? 0));
        setDeductions(String(found.deduction ?? 0));
        setShares(String(found.shares ?? found.incentive ?? 0));
        setPaid(String(found.paid_salary ?? 0));
        setPaymentMethod(found.payment_method ?? "Cash");
      }
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [staff.id, month]);

  async function saveRecord() {
    if (!result.salary) return;
    setSaving(true);
    setError(null);
    try {
      const [year, monthNumber] = month.split("-").map(Number);
      const monthName = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(year, monthNumber - 1, 1));
      const shareAmount = shares.trim() ? Number(shares) : NaN;
      const paidAmount = paid.trim() ? Number(paid) : NaN;
      const payable = Math.round((result.salary.basic + result.salary.overtime - result.salary.deductions + (Number.isFinite(shareAmount) ? shareAmount : 0)) * 100) / 100;
      const saved = await savePayrollRecord({
        staffId: staff.id, month: monthName, year,
        basic: result.salary.basic, overtimeHours: Number(hours) || 0, overtimePay: result.salary.overtime,
        deductions: result.salary.deductions, shares: Number.isFinite(shareAmount) ? shareAmount : 0,
        payable, paid: Number.isFinite(paidAmount) ? paidAmount : 0, paymentMethod,
      });
      setRecord(saved);
      notify(`Salary slip ${saved.slip_no ?? ""} saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Salary estimate - ${staff.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-amber-800">Enter overtime, deductions and shares. Saving creates a monthly payroll record and salary slip.</p>
        <p>Month: {month} · Joining date: {staff.date_of_joining ?? "Not set"}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Overtime hours"><Input type="number" min="0" step="any" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          <Field label="Deductions"><Input type="number" min="0" step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} /></Field>
          <Field label="Shares"><Input type="number" min="0" step="0.01" value={shares} onChange={(e) => setShares(e.target.value)} /></Field>
          <Field label="Paid salary"><Input type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
          <Field label="Payment method"><select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm"><option value="Cash">Cash</option><option value="Bank">Bank</option></select></Field>
        </div>
        {result.error ? <p role="alert" className="text-rose-700">{result.error}</p> : result.salary && rates && <>
          <p>Full-month schedule: {rates.workingDays} working days, {rates.monthlyHours} hours. Hourly rate {money(rates.hourlyRate)}, overtime rate {money(rates.overtimeRate)}.</p>
          <p>Basic ({result.salary.employedDays} of {result.salary.calendarDays} calendar days): {money(result.salary.basic)}</p>
          <p>Overtime: {money(result.salary.overtime)} · Deductions: {money(result.salary.deductions)} · Shares: {money(Number(shares) || 0)}</p>
          <p className="font-semibold">Payable salary: {money(Math.round((result.salary.basic + result.salary.overtime - result.salary.deductions + (Number(shares) || 0)) * 100) / 100)}</p>
        </>}
        {record && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900">Saved slip: <b>{record.slip_no}</b> · Status: <b>{record.pay_status ?? "unpaid"}</b> · Paid: {money(record.paid_salary)}</p>}
        <FormError message={error} />
        <div className="flex justify-end"><Button variant="primary" loading={saving} disabled={saving || Boolean(result.error)} onClick={() => void saveRecord()}>{saving ? "Saving..." : record ? "Update payroll record" : "Save payroll record"}</Button></div>
      </div>
    </Modal>
  );
}
