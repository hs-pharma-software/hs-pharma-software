import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateMonthlySalary } from "@/lib/hospitalPayroll";

const full = {
  year: 2026, month: 7, basicPay: 45000, hoursPerDay: 8, sundayOff: true, overtimeMultiplier: 1.5,
  joinedOn: "2026-07-01", overtimeHours: 32, deductions: 5000, shares: 2500,
};

test("monthly salary keeps overtime, deductions and shares separate", () => {
  assert.deepEqual(calculateMonthlySalary(full), {
    calendarDays: 31, employedDays: 31, basic: 45000, overtime: 10000,
    deductions: 5000, shares: 2500, salary: 50000, combined: 52500,
  });
});

test("joining in a month prorates basic pay by calendar days, including leap day", () => {
  const result = calculateMonthlySalary({ ...full, year: 2024, month: 2, joinedOn: "2024-02-15", basicPay: 29000, overtimeHours: 0, deductions: 0, shares: 0 });
  assert.deepEqual([result.calendarDays, result.employedDays, result.basic], [29, 15, 15000]);
  assert.equal(calculateMonthlySalary({ ...full, joinedOn: "2026-08-01", overtimeHours: 0, deductions: 0, shares: 0 }).basic, 0);
});

test("salary calculation rejects invalid dates and negative components", () => {
  assert.throws(() => calculateMonthlySalary({ ...full, joinedOn: "2026-02-29" }), /joining date/);
  assert.throws(() => calculateMonthlySalary({ ...full, overtimeHours: -1 }), /Overtime hours/);
  assert.throws(() => calculateMonthlySalary({ ...full, shares: -1 }), /Shares/);
});
