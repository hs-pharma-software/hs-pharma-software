/** Hospital Finance > Reports: profit / loss by OPD, lab, radiology,
 * insurance and episode, and the doctors' shares, for a date range shown day
 * wise, monthly, yearly or as one total (date to date).
 *
 * Revenue is what was charged (after discounts), on the charge date. What is
 * paid out is each charge's doctor and staff share (Service Master and
 * consultation fees) and each surgery's shares and expenses (consultant, MO,
 * nurses, anaesthesia, other, OT / IPD medicine) on the day it was done
 * (planned, if not done yet). Profit = revenue - shares. */
import { dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { parseShares, sharesTotal } from "../../config/surgeryShares";

export type Period = "day" | "month" | "year" | "range";
export const PERIOD_LABEL: Record<Period, string> = { day: "Day wise", month: "Monthly", year: "Yearly", range: "Date to date" };

const round = (n: number) => Math.round(n * 100) / 100;

/** The period a date (yyyy-mm-dd) falls in. */
export function periodOf(date: string, period: Period, range: { from: string; to: string }): string {
  if (period === "day") return date.slice(0, 10);
  if (period === "month") return date.slice(0, 7);
  if (period === "year") return date.slice(0, 4);
  return `${range.from} to ${range.to}`;
}

interface ChargeRow {
  charge_date: string; category: string | null; amount: number; doctor_share: number | null; staff_share: number | null; doctor_id: string | null;
  ordering_doctor_share: number | null;
  performed_by: string | null; performer_name: string | null;
  episode_id: string; episode_no: string; episode_type: string; episode_date: string; patient_name: string | null; mr_no: string | null;
  insurance_company: string | null; doctor_name: string | null;
}
interface SurgeryRow { id: string; episode_id: string; surgeon_id: string | null; surgeon_name: string | null; fee: number; surgery_shares: string | null; day: string; surgery_name: string }

async function charges(range: { from: string; to: string }): Promise<ChargeRow[]> {
  const T = requireCurrentTenantId();
  return dbSelect<ChargeRow>(
    `SELECT substr(c.charge_date, 1, 10) AS charge_date, c.category, c.amount, c.doctor_share, c.staff_share, c.doctor_id, c.ordering_doctor_share,
            c.performed_by, pf.name AS performer_name,
            e.id AS episode_id, e.episode_no, e.type AS episode_type, e.date AS episode_date, p.name AS patient_name, p.mr_no,
            NULLIF(TRIM(p.insurance_company), '') AS insurance_company, s.name AS doctor_name
     FROM hospital_charges c
     JOIN hospital_episodes e ON e.id = c.episode_id AND e.tenant_id = c.tenant_id AND e.deleted_at IS NULL
     LEFT JOIN hospital_patients p ON p.id = e.patient_id
     LEFT JOIN staff s ON s.id = c.doctor_id
     LEFT JOIN staff pf ON pf.id = c.performed_by
     WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND substr(c.charge_date, 1, 10) BETWEEN ? AND ?`,
    [T, range.from, range.to]
  );
}

async function surgeries(range: { from: string; to: string }): Promise<SurgeryRow[]> {
  const T = requireCurrentTenantId();
  return dbSelect<SurgeryRow>(
    `SELECT b.id, b.episode_id, b.surgeon_id, s.name AS surgeon_name, b.fee, b.surgery_shares, b.surgery_name,
            substr(COALESCE(b.performed_at, b.planned_date, b.created_at), 1, 10) AS day
     FROM hospital_surgery_bookings b LEFT JOIN staff s ON s.id = b.surgeon_id
     WHERE b.tenant_id = ? AND b.deleted_at IS NULL AND b.status != 'cancelled'
       AND substr(COALESCE(b.performed_at, b.planned_date, b.created_at), 1, 10) BETWEEN ? AND ?`,
    [T, range.from, range.to]
  ).catch(() => []);
}

export interface PlRow { key: string; label: string; sub?: string | null; count: number; revenue: number; doctorShare: number; staffShare: number; otherCost: number; profit: number }

function add(m: Map<string, PlRow>, key: string, label: string, x: { revenue?: number; doctor?: number; staff?: number; other?: number; count?: number }, sub?: string | null) {
  const r = m.get(key) ?? { key, label, sub: sub ?? null, count: 0, revenue: 0, doctorShare: 0, staffShare: 0, otherCost: 0, profit: 0 };
  r.count += x.count ?? 0;
  r.revenue += x.revenue ?? 0;
  r.doctorShare += x.doctor ?? 0;
  r.staffShare += x.staff ?? 0;
  r.otherCost += x.other ?? 0;
  m.set(key, r);
}
const finish = (m: Map<string, PlRow>, sort: "key" | "revenue" = "key") => {
  const rows = [...m.values()].map((r) => ({ ...r, revenue: round(r.revenue), doctorShare: round(r.doctorShare), staffShare: round(r.staffShare), otherCost: round(r.otherCost), profit: round(r.revenue - r.doctorShare - r.staffShare - r.otherCost) }));
  return sort === "key" ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.revenue - a.revenue);
};

export type DeptReport = "opd" | "lab" | "radiology";

/** OPD (consultations and OPD services, not lab or radiology), lab or radiology: revenue, shares and profit per period. */
export async function departmentPl(kind: DeptReport, range: { from: string; to: string }, period: Period): Promise<PlRow[]> {
  const m = new Map<string, PlRow>();
  for (const c of await charges(range)) {
    const isLab = c.category === "lab", isImg = c.category === "imaging";
    if (kind === "lab" ? !isLab : kind === "radiology" ? !isImg : c.episode_type !== "opd" || isLab || isImg) continue;
    const k = periodOf(c.charge_date, period, range);
    add(m, k, k, { revenue: Number(c.amount) || 0, doctor: (Number(c.doctor_share) || 0) + (Number(c.ordering_doctor_share) || 0), staff: Number(c.staff_share) || 0, count: 1 });
  }
  return finish(m);
}

/** Insured patients' bills by insurance company. */
export async function insurancePl(range: { from: string; to: string }): Promise<PlRow[]> {
  const m = new Map<string, PlRow>();
  const episodes = new Map<string, Set<string>>();
  for (const c of await charges(range)) {
    if (!c.insurance_company) continue;
    const k = c.insurance_company.toLowerCase();
    const seen = episodes.get(k) ?? new Set<string>();
    add(m, k, c.insurance_company, { revenue: Number(c.amount) || 0, doctor: (Number(c.doctor_share) || 0) + (Number(c.ordering_doctor_share) || 0), staff: Number(c.staff_share) || 0, count: seen.has(c.episode_id) ? 0 : 1 });
    seen.add(c.episode_id);
    episodes.set(k, seen);
  }
  return finish(m, "revenue");
}

/** Each episode: its charges, shares, surgery shares and expenses, and profit. */
export async function episodePl(range: { from: string; to: string }): Promise<PlRow[]> {
  const m = new Map<string, PlRow>();
  for (const c of await charges(range)) {
    add(m, c.episode_id, c.episode_no, { revenue: Number(c.amount) || 0, doctor: (Number(c.doctor_share) || 0) + (Number(c.ordering_doctor_share) || 0), staff: Number(c.staff_share) || 0 },
      [c.patient_name, c.mr_no, c.episode_type === "ipd" ? "Admission" : c.episode_type === "emergency" ? "Emergency" : "OPD"].filter(Boolean).join(" · "));
  }
  for (const s of await surgeries(range)) {
    const sh = parseShares(s.surgery_shares);
    const doctor = sh.consultant;
    const other = sharesTotal(sh) - doctor;
    const r = m.get(s.episode_id);
    if (r) { r.doctorShare += doctor; r.otherCost += other; }
    else add(m, s.episode_id, s.surgery_name, { doctor, other });
  }
  for (const r of m.values()) r.count = 1;
  return finish(m, "revenue");
}

const UNASSIGNED = "__not_recorded";

export interface DoctorShareRow { key: string; period: string; doctorId: string; doctor: string; consultation: number; services: number; ordered: number; surgery: number; total: number }

/** What each doctor earned: their share of consultation fees and services, and their surgeries' consultant share, per period. */
export async function doctorShares(range: { from: string; to: string }, period: Period): Promise<DoctorShareRow[]> {
  const m = new Map<string, DoctorShareRow>();
  const put = (day: string, id: string | null, name: string | null, part: "consultation" | "services" | "ordered" | "surgery", amount: number) => {
    if (!id || !(amount > 0)) return;
    const p = periodOf(day, period, range);
    const key = `${p}|${id}`;
    const r = m.get(key) ?? { key, period: p, doctorId: id, doctor: name ?? "Doctor", consultation: 0, services: 0, ordered: 0, surgery: 0, total: 0 };
    r[part] += amount;
    r.total += amount;
    m.set(key, r);
  };
  for (const c of await charges(range)) {
    // A lab test's or scan's share is the doctor's who did it (the pathologist / radiologist), not the one who ordered it.
    const investigation = c.category === "lab" || c.category === "imaging";
    const [id, name] = investigation ? (c.performed_by ? [c.performed_by, c.performer_name] : [UNASSIGNED, "Doctor not recorded (lab / radiology)"]) : [c.doctor_id, c.doctor_name];
    put(c.charge_date, id, name, c.category === "consultation" ? "consultation" : "services", Number(c.doctor_share) || 0);
    // The doctor who ordered the test or scan: their share (Service Master).
    if (investigation) put(c.charge_date, c.doctor_id, c.doctor_name, "ordered", Number(c.ordering_doctor_share) || 0);
  }
  for (const s of await surgeries(range)) put(s.day, s.surgeon_id, s.surgeon_name, "surgery", parseShares(s.surgery_shares).consultant);
  return [...m.values()]
    .map((r) => ({ ...r, consultation: round(r.consultation), services: round(r.services), ordered: round(r.ordered), surgery: round(r.surgery), total: round(r.total) }))
    .sort((a, b) => a.period.localeCompare(b.period) || b.total - a.total);
}
