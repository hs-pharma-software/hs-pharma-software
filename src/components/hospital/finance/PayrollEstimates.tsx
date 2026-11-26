"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { designation, staffGroup, staffRoles } from "@/config/hospitalStaff";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { calculateMonthlySalary, isPayrollDate, monthlyWorkRates } from "@/lib/hospitalPayroll";
import { localDate } from "@/lib/localDate";
import { isTauri } from "@/lib/platform";
import {
  doctorPayrollSummary, listPayrollPayments, listPayrollRecords, listPayrollStaff, recordPayrollPayment, savePayrollRecord,
  type DoctorPayrollSummary,
} from "@/lib/repo/hospitalPayroll";
import type { Staff } from "@/lib/types";
import type { HospitalSalaryPayment, Salary } from "@/lib/types2";
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
  const [result, setResult] = useState<{ user: SessionUser | null; tenant: SessionTenant | null; rows: Staff[]; records: Salary[]; error: string | null } | null>(null);
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Staff | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (!isTauri()) throw new Error("The database is not available.");
        const [rows, records] = await Promise.all([
          listPayrollStaff(),
          listPayrollRecords(new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(`${month}-01T12:00:00`)), Number(month.slice(0, 4))),
        ]);
        if (active) setResult({ user, tenant, rows, records, error: null });
      } catch (e) {
        if (active) setResult({ user, tenant, rows: [], records: [], error: e instanceof Error ? e.message : String(e) });
      }
    };
    void load();
    return () => { active = false; };
  }, [user, tenant, month]);

  const current = result?.user === user && result?.tenant === tenant ? result : null;
  const query = search.trim().toLowerCase();
  const shown = current?.rows.filter((s) => isDoctor(s) === (kind === "doctors")
    && `${s.name} ${s.employee_id ?? ""} ${s.department ?? ""}`.toLowerCase().includes(query)) ?? [];
  const validMonth = isPayrollDate(`${month}-01`);
  return (
    <div>
      <PageHeader title={kind === "doctors" ? "Doctors Payments" : "Salaries"} />
      <div className="flex flex-col gap-4">
        <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          Estimates use the staff record&apos;s current basic pay and schedule. Select an employee to review performance, save payroll, record payments, or print a salary slip.
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
              <thead><tr className="text-xs text-neutral-500"><th className="pb-2">Name</th><th className="pb-2">Designation</th><th className="pb-2 text-right">Basic</th><th className="pb-2 text-right">Payable</th><th className="pb-2 text-right">Status</th></tr></thead>
              <tbody>{shown.map((s) => {
                const row = validMonth ? estimate(s, month) : null;
                const monthName = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(`${month}-01T12:00:00`));
                const payroll = current?.records.find((r) => r.staff_id === s.id && r.salary_month === monthName);
                return <tr key={s.id} className="border-t border-neutral-100">
                  <td className="py-2"><button type="button" className="font-medium text-sky-700 hover:underline" onClick={() => setSelected(s)}>{s.name}</button><span className="block text-xs text-neutral-500">{s.employee_id ?? ""}</span></td>
                  <td className="py-2">{designation(s.staff_category)?.label ?? s.designation ?? "—"}</td>
                  <td className="py-2 text-right">{row?.salary ? money(row.salary.basic) : <span className="text-xs text-amber-700">{row?.error ?? "Choose a month"}</span>}</td>
                  <td className="py-2 text-right">{payroll ? money(payroll.payable_salary) : "—"}</td>
                  <td className="py-2 text-right capitalize">{payroll?.pay_status ?? (payroll ? "unpaid" : "—")}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
      </div>
      {current && !current.error && selected && current.rows.includes(selected) && validMonth && (
        <SalaryEstimateModal key={`${selected.id}-${month}`} staff={selected} month={month} kind={kind}
          onSaved={() => {
            const [yearText, monthText] = month.split("-");
            const monthName = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(Number(yearText), Number(monthText) - 1, 1));
            void listPayrollRecords(monthName, Number(yearText))
              .then((records) => setResult((old) => old && old.user === user && old.tenant === tenant ? { ...old, records } : old))
              .catch((e) => notify(e instanceof Error ? e.message : String(e)));
          }}
          onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function SalaryEstimateModal({ staff, month, kind, onSaved, onClose }: { staff: Staff; month: string; kind: "staff" | "doctors"; onSaved: () => void; onClose: () => void }) {
  const [hours, setHours] = useState("0");
  const [deductions, setDeductions] = useState("0");
  const [shares, setShares] = useState("0");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(localDate());
  const [reference, setReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<Salary | null>(null);
  const [payments, setPayments] = useState<HospitalSalaryPayment[]>([]);
  const [doctorSummary, setDoctorSummary] = useState<DoctorPayrollSummary | null>(null);
  const [sharePeriod, setSharePeriod] = useState<"month" | "year" | "lifetime" | "custom">("month");
  const [shareFrom, setShareFrom] = useState(`${month}-01`);
  const [shareTo, setShareTo] = useState(localDate());
  const [printMode, setPrintMode] = useState<"salary" | "shares" | null>(null);
  const result = estimate(staff, month, hours.trim() ? Number(hours) : NaN, deductions.trim() ? Number(deductions) : NaN);
  const rates = result.input ? monthlyWorkRates(result.input) : null;

  useEffect(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const monthName = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(year, monthNumber - 1, 1));
    let active = true;
    void listPayrollRecords(monthName, year).then(async (rows) => {
      const found = rows.find((r) => r.staff_id === staff.id) ?? null;
      const history = found ? await listPayrollPayments(found.id) : [];
      if (!active) return;
      setRecord(found);
      setPayments(history);
      setHours(String(found?.overtime_hours ?? 0));
      setDeductions(String(found?.deduction ?? 0));
      setShares(String(found?.shares ?? found?.incentive ?? 0));
      setPaymentAmount("");
      setPaymentMethod(found?.payment_method ?? "Cash");
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [staff.id, month]);

  useEffect(() => {
    if (sharePeriod !== "month") return;
    const [year, monthNumber] = month.split("-").map(Number);
    setShareFrom(`${month}-01`);
    setShareTo(`${year}-${String(monthNumber).padStart(2, "0")}-${new Date(year, monthNumber, 0).getDate()}`);
  }, [month, sharePeriod]);

  useEffect(() => {
    if (kind !== "doctors") return;
    if (!isPayrollDate(shareFrom) || !isPayrollDate(shareTo) || shareFrom > shareTo) {
      setDoctorSummary(null);
      return;
    }
    let active = true;
    setDoctorSummary(null);
    void doctorPayrollSummary(staff.id, { from: shareFrom, to: shareTo }).then((summary) => {
      if (!active) return;
      setDoctorSummary(summary);
      if (!record && sharePeriod === "month") setShares(String(summary.total));
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [kind, staff.id, shareFrom, shareTo, record, sharePeriod]);

  useEffect(() => {
    if (!printMode) return;
    const reset = () => setPrintMode(null);
    window.addEventListener("afterprint", reset);
    const timer = window.setTimeout(() => window.print(), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", reset);
    };
  }, [printMode]);

  function chooseSharePeriod(period: "month" | "year" | "lifetime" | "custom") {
    setSharePeriod(period);
    if (period === "custom") return;
    const [year, monthNumber] = month.split("-").map(Number);
    if (period === "month") {
      setShareFrom(`${month}-01`);
      setShareTo(`${year}-${String(monthNumber).padStart(2, "0")}-${new Date(year, monthNumber, 0).getDate()}`);
    } else if (period === "year") {
      setShareFrom(`${year}-01-01`);
      setShareTo(`${year}-12-31`);
    } else {
      setShareFrom(staff.date_of_joining && isPayrollDate(staff.date_of_joining) ? staff.date_of_joining : `${year}-01-01`);
      setShareTo(localDate());
    }
  }

  async function saveRecord() {
    if (!result.salary) return;
    setSaving(true);
    setError(null);
    try {
      const [year, monthNumber] = month.split("-").map(Number);
      const monthName = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(year, monthNumber - 1, 1));
      const shareAmount = shares.trim() ? Number(shares) : NaN;
      const payable = Math.round((result.salary.basic + result.salary.overtime - result.salary.deductions + (Number.isFinite(shareAmount) ? shareAmount : 0)) * 100) / 100;
      const saved = await savePayrollRecord({
        staffId: staff.id, month: monthName, year,
        basic: result.salary.basic, overtimeHours: Number(hours) || 0, overtimePay: result.salary.overtime,
        deductions: result.salary.deductions, shares: Number.isFinite(shareAmount) ? shareAmount : 0,
        payable, paid: record?.paid_salary ?? 0, paymentMethod,
      });
      setRecord(saved);
      onSaved();
      notify(`Salary slip ${saved.slip_no ?? ""} saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function addPayment() {
    if (!record) {
      setError("Save the payroll record before recording a payment.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordPayrollPayment({
        salaryId: record.id, amount: paymentAmount.trim() ? Number(paymentAmount) : NaN,
        method: paymentMethod, date: paymentDate, reference, notes: paymentNotes,
      });
      const [year, monthNumber] = month.split("-").map(Number);
      const monthName = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(year, monthNumber - 1, 1));
      const [updated, history] = await Promise.all([
        listPayrollRecords(monthName, year).then((rows) => rows.find((r) => r.staff_id === staff.id) ?? null),
        listPayrollPayments(record.id),
      ]);
      setRecord(updated);
      setPayments(history);
      setPaymentAmount("");
      setReference("");
      setPaymentNotes("");
      onSaved();
      notify("Salary payment recorded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const payable = result.salary
    ? Math.round((result.salary.basic + result.salary.overtime - result.salary.deductions + (Number(shares) || 0)) * 100) / 100
    : 0;
  const canPrintShare = kind === "doctors" && doctorSummary !== null;

  return (
    <Modal title={`${kind === "doctors" ? "Doctor payment" : "Salary"} - ${staff.name}`} onClose={onClose} width="max-w-3xl">
      <div className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto text-sm">
        <p>Month: {month} · Joining date: {staff.date_of_joining ?? "Not set"}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Overtime hours"><Input type="number" min="0" step="any" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          <Field label="Deductions"><Input type="number" min="0" step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} /></Field>
          <Field label={kind === "doctors" ? "Doctor shares (monthly)" : "Shares"}><Input type="number" min="0" step="0.01" value={shares} onChange={(e) => setShares(e.target.value)} /></Field>
          <Field label="Payment method"><select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm"><option value="Cash">Cash</option><option value="Bank">Bank</option></select></Field>
        </div>
        {result.error ? <p role="alert" className="text-rose-700">{result.error}</p> : result.salary && rates && <>
          <p>Full-month schedule: {rates.workingDays} working days, {rates.monthlyHours} hours. Hourly rate {money(rates.hourlyRate)}, overtime rate {money(rates.overtimeRate)}.</p>
          <p>Basic ({result.salary.employedDays} of {result.salary.calendarDays} calendar days): {money(result.salary.basic)}</p>
          <p>Overtime: {money(result.salary.overtime)} · Deductions: {money(result.salary.deductions)} · Shares: {money(Number(shares) || 0)}</p>
          <p className="font-semibold">Payable salary: {money(payable)}</p>
        </>}
        {record && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900">Saved slip: <b>{record.slip_no}</b> · Status: <b>{record.pay_status ?? "unpaid"}</b> · Paid: {money(record.paid_salary)} · Balance: {money(record.balance_salary)}</p>}
        <FormError message={error} />
        <div className="flex flex-wrap justify-end gap-2 print:hidden">
          {record && <Button onClick={() => setPrintMode("salary")}><Printer size={14} className="mr-1" />Print salary slip</Button>}
          <Button variant="primary" loading={saving} disabled={saving || Boolean(result.error)} onClick={() => void saveRecord()}>{saving ? "Saving..." : record ? "Update payroll record" : "Save payroll record"}</Button>
        </div>
        {record && <>
          <section className="rounded-xl border border-neutral-200 p-3">
            <h3 className="font-semibold">Record a payment</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label={`Amount (balance ${money(record.balance_salary)})`}><Input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></Field>
              <Field label="Payment date"><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field>
              <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt or bank reference" /></Field>
              <Field label="Notes"><Input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} /></Field>
            </div>
            <div className="mt-2 flex justify-end"><Button variant="primary" loading={saving} disabled={saving || record.balance_salary <= 0} onClick={() => void addPayment()}>Record payment</Button></div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-neutral-500"><th className="pb-1">Date</th><th className="pb-1">Method / reference</th><th className="pb-1">Recorded by</th><th className="pb-1 text-right">Amount</th></tr></thead>
                <tbody>{payments.map((p) => <tr key={p.id} className="border-t border-neutral-100">
                  <td className="py-1">{p.paid_at.slice(0, 10)}</td><td className="py-1">{p.method}{p.reference ? ` · ${p.reference}` : ""}{p.notes ? <span className="block text-neutral-500">{p.notes}</span> : null}</td><td className="py-1">{p.paid_by_name ?? "—"}</td><td className="py-1 text-right">{money(p.amount)}</td>
                </tr>)}
                {!payments.length && <tr><td className="py-2 text-neutral-400" colSpan={4}>No individual payments recorded.</td></tr>}</tbody>
              </table>
            </div>
          </section>
          <div className={`rounded-xl border border-neutral-200 p-4 ${printMode === "salary" ? "print-area" : "print:hidden"}`}>
            <h2 className="text-center text-xl font-bold">Salary Slip</h2>
            <p className="mt-1 text-center text-sm">{staff.name} · {designation(staff.staff_category)?.label ?? staff.designation ?? "Staff"}</p>
            <p className="text-center text-xs text-neutral-500">{staff.department ?? ""} · Employee ID: {staff.employee_id ?? "—"}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 border-y border-neutral-200 py-3 text-sm">
              <p>Slip No: <b>{record.slip_no}</b></p><p>Salary period: <b>{record.salary_month} {record.salary_year}</b></p>
              <p>Basic pay: {money(record.basic_pay)}</p><p>Overtime ({record.overtime_hours ?? 0} hrs): {money(record.overtime_pay ?? 0)}</p>
              <p>Deductions: {money(record.deduction)}</p><p>Shares: {money(record.shares ?? record.incentive)}</p>
              <p className="font-semibold">Payable: {money(record.payable_salary)}</p><p>Paid: {money(record.paid_salary)}</p>
              <p>Balance: {money(record.balance_salary)}</p><p>Status: {(record.pay_status ?? "unpaid").toUpperCase()}</p>
            </div>
            <h3 className="mt-3 font-semibold">Payment history</h3>
            <table className="mt-1 w-full text-left text-xs">
              <thead><tr><th className="pb-1">Date</th><th className="pb-1">Method</th><th className="pb-1">Reference</th><th className="pb-1 text-right">Amount</th></tr></thead>
              <tbody>{payments.map((p) => <tr key={p.id} className="border-t border-neutral-200"><td className="py-1">{p.paid_at.slice(0, 10)}</td><td>{p.method}</td><td>{p.reference ?? "—"}</td><td className="text-right">{money(p.amount)}</td></tr>)}</tbody>
            </table>
            <p className="mt-4 text-xs text-neutral-500">Generated {localDate()} · Prepared by {record.created_by_name ?? "—"}</p>
          </div>
        </>}
        {kind === "doctors" && <>
          <section className="rounded-xl border border-neutral-200 p-3 print:hidden">
            <h3 className="font-semibold">Doctor performance and shares</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {([["month", "Monthly"], ["year", "Yearly"], ["lifetime", "Whole time"], ["custom", "Date to date"]] as const).map(([period, label]) => (
                <button key={period} type="button" onClick={() => chooseSharePeriod(period)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${sharePeriod === period ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"}`}>{label}</button>
              ))}
            </div>
            {sharePeriod === "custom" && <div className="mt-2 flex flex-wrap gap-3">
              <Field label="From"><Input type="date" value={shareFrom} onChange={(e) => setShareFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" value={shareTo} onChange={(e) => setShareTo(e.target.value)} /></Field>
            </div>}
            {!doctorSummary ? <p className="mt-2 text-neutral-500">Loading doctor performance…</p> : <>
              <p className="mt-2">Tests ordered: <b>{doctorSummary.testsOrdered}</b> · Doctor shares: <b>{money(doctorSummary.total)}</b></p>
              <p className="text-xs text-neutral-600">Consultations {money(doctorSummary.consultation)} · Services {money(doctorSummary.services)} · Tests ordered share {money(doctorSummary.ordered)} · Surgeries {money(doctorSummary.surgery)}</p>
              <p className="text-xs text-neutral-500">{shareFrom} to {shareTo}</p>
              <div className="mt-2 flex justify-end"><Button disabled={!canPrintShare} onClick={() => setPrintMode("shares")}><Printer size={14} className="mr-1" />Print shares slip</Button></div>
            </>}
          </section>
          {doctorSummary && <div className={`rounded-xl border border-neutral-200 p-4 ${printMode === "shares" ? "print-area" : "print:hidden"}`}>
            <h2 className="text-center text-xl font-bold">Doctor Shares Slip</h2>
            <p className="mt-1 text-center">{staff.name} · {staff.department ?? "Hospital"}</p>
            <p className="text-center text-xs text-neutral-500">{shareFrom} to {shareTo} · Tests ordered: {doctorSummary.testsOrdered}</p>
            <table className="mt-4 w-full text-sm">
              <tbody>
                <tr className="border-t border-neutral-200"><td className="py-2">Consultation shares</td><td className="py-2 text-right">{money(doctorSummary.consultation)}</td></tr>
                <tr className="border-t border-neutral-200"><td className="py-2">Service / performed-test shares</td><td className="py-2 text-right">{money(doctorSummary.services)}</td></tr>
                <tr className="border-t border-neutral-200"><td className="py-2">Tests ordered shares</td><td className="py-2 text-right">{money(doctorSummary.ordered)}</td></tr>
                <tr className="border-t border-neutral-200"><td className="py-2">Surgery shares</td><td className="py-2 text-right">{money(doctorSummary.surgery)}</td></tr>
                <tr className="border-t-2 border-neutral-400 font-bold"><td className="py-2">Total shares</td><td className="py-2 text-right">{money(doctorSummary.total)}</td></tr>
              </tbody>
            </table>
            <p className="mt-4 text-xs text-neutral-500">Printed {localDate()}</p>
          </div>}
        </>}
      </div>
    </Modal>
  );
}
