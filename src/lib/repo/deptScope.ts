/** Department access by duty roster: medical officers (MO / WMO), nurses,
 * head nurses and paramedics see the admissions, emergency patients and ER
 * board of the department they are on duty in (today's roster, and last
 * night's night shift), else of their own department. Owners, admins,
 * consultants, HoDs and the Nursing Superintendent see every department. */
import { dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { localDate } from "../localDate";
import { useAuthStore } from "../../store/authStore";
import { ON_DUTY_SHIFTS } from "../../config/facility";

/** Designations limited to their department. */
export const DEPARTMENT_SCOPED_ROLES = ["medical_officer", "nurse", "head_nurse", "paramedic"];

const EMERGENCY_NAMES = new Set(["er", "emergency", "emergency department", "casualty", "a&e", "accident & emergency", "accident and emergency"]);

/** A department name compared case-free; the emergency department's names are one. */
export function normDept(d: string | null | undefined): string {
  const x = (d ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return EMERGENCY_NAMES.has(x) ? "emergency" : x;
}

/** The department of an episode: its own, or Emergency for an emergency visit without one. */
export function episodeDept(e: { department?: string | null; type?: string | null }): string {
  const d = normDept(e.department);
  return d || (e.type === "emergency" ? "emergency" : "");
}

const prevDay = (d: string) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

/** The departments the signed-in login may see, or null for all. */
export async function departmentScope(today: string = localDate()): Promise<string[] | null> {
  const u = useAuthStore.getState().currentUser;
  if (!u || u.role !== "staff") return null;
  const T = requireCurrentTenantId();
  const me = (await dbSelect<{ id: string; staff_category: string | null; department: string | null }>(
    `SELECT id, staff_category, department FROM staff WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [T, u.id]
  ).catch(() => []))[0];
  if (!me || !DEPARTMENT_SCOPED_ROLES.includes(me.staff_category ?? "")) return null;
  const duty = await dbSelect<{ department: string | null; duty_date: string; shift: string }>(
    `SELECT department, duty_date, shift FROM hospital_duty_roster WHERE tenant_id = ? AND staff_id = ? AND deleted_at IS NULL AND duty_date IN (?, ?)`,
    [T, me.id, today, prevDay(today)]
  ).catch(() => []);
  const onDuty = duty.filter((r) => (r.duty_date === today ? (ON_DUTY_SHIFTS as string[]).includes(r.shift) : r.shift === "N")).map((r) => normDept(r.department)).filter(Boolean);
  const depts = onDuty.length ? onDuty : [normDept(me.department)].filter(Boolean);
  return [...new Set(depts)];
}

/** SQL limiting episodes (alias) to these departments. */
export function deptScopeSql(alias: string, depts: string[]): { sql: string; params: unknown[] } {
  if (!depts.length) return { sql: "0 = 1", params: [] };
  const dept = `LOWER(TRIM(COALESCE(NULLIF(TRIM(${alias}.department), ''), CASE WHEN ${alias}.type = 'emergency' THEN 'emergency' ELSE '' END)))`;
  // The emergency department's other names count as Emergency.
  const expr = `CASE WHEN ${dept} IN ('er', 'casualty', 'emergency department', 'a&e', 'accident & emergency', 'accident and emergency') THEN 'emergency' ELSE ${dept} END`;
  return { sql: `${expr} IN (${depts.map(() => "?").join(", ")})`, params: depts };
}

/** Whether the signed-in login may open this episode. */
export async function canSeeEpisode(e: { department?: string | null; type?: string | null }): Promise<boolean> {
  const depts = await departmentScope();
  return !depts || depts.includes(episodeDept(e));
}
