/** Scheduled hours and rates for a complete calendar month, before any partial-month proration. */
export function monthlyWorkRates(input: {
  year: number;
  month: number;
  basicPay: number;
  hoursPerDay: number;
  sundayOff: boolean;
  overtimeMultiplier: number;
}) {
  const { year, month, basicPay, hoursPerDay, sundayOff, overtimeMultiplier } = input;
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Choose a valid month.");
  if (!Number.isFinite(basicPay) || basicPay < 0) throw new Error("Basic pay cannot be negative.");
  if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 24) throw new Error("Working hours per day must be more than zero and at most 24.");
  if (!Number.isFinite(overtimeMultiplier) || overtimeMultiplier <= 0) throw new Error("The overtime multiplier must be more than zero.");
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let workingDays = days;
  if (sundayOff) {
    for (let day = 1; day <= days; day++) {
      if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0) workingDays--;
    }
  }
  const monthlyHours = workingDays * hoursPerDay;
  const hourlyRate = basicPay / monthlyHours;
  return {
    workingDays,
    monthlyHours,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    overtimeRate: Math.round(hourlyRate * overtimeMultiplier * 100) / 100,
  };
}

export function isPayrollDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return false;
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

/** Calendar-day salary proration and the separate overtime, deduction and share components. */
export function calculateMonthlySalary(input: Parameters<typeof monthlyWorkRates>[0] & {
  joinedOn: string;
  overtimeHours: number;
  deductions: number;
  shares: number;
}) {
  const rates = monthlyWorkRates(input);
  if (!isPayrollDate(input.joinedOn)) throw new Error("Enter a valid joining date.");
  for (const [label, value] of [["Overtime hours", input.overtimeHours], ["Deductions", input.deductions], ["Shares", input.shares]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} cannot be negative.`);
  }
  const calendarDays = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const monthStart = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
  const monthEnd = `${input.year}-${String(input.month).padStart(2, "0")}-${calendarDays}`;
  const employedDays = input.joinedOn > monthEnd ? 0
    : input.joinedOn <= monthStart ? calendarDays : calendarDays - Number(input.joinedOn.slice(8, 10)) + 1;
  if (employedDays === 0 && input.overtimeHours > 0) throw new Error("Overtime cannot be recorded before the joining date.");
  const round = (amount: number) => Math.round(amount * 100) / 100;
  const basic = round(input.basicPay * employedDays / calendarDays);
  const overtime = round(input.basicPay / rates.monthlyHours * input.overtimeMultiplier * input.overtimeHours);
  const deductions = round(input.deductions);
  const shares = round(input.shares);
  const salary = round(basic + overtime - deductions);
  const combined = round(salary + shares);
  if (![basic, overtime, deductions, shares, salary, combined].every(Number.isFinite)) throw new Error("The calculated amount is too large.");
  return { calendarDays, employedDays, basic, overtime, deductions, shares, salary, combined };
}
