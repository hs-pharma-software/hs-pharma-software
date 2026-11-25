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
