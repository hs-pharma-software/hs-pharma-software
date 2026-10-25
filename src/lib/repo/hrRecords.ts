/** Human resource records (MSDS HRM): training and orientation, credentials
 * checked at the source, yearly appraisals and the duty roster.
 *
 * A credential counts as verified only when someone other than the staff
 * member records how it was checked. An appraisal is written by the
 * appraiser, finalized, then acknowledged by the staff member themself. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { localDate } from "../localDate";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { staffRepo } from "./staff";
import { stamp } from "./emergency";
import { addDays } from "./facility";
import { HR_ROLES, TRAINING_ROLES, ROSTER_ROLES, APPRAISER_ROLES, DOCTOR_CATEGORIES, designation } from "../../config/hospitalStaff";
import {
  TRAINING_KINDS, trainingKind, CREDENTIAL_KINDS, VERIFICATION_METHODS, APPRAISAL_CRITERIA, APPRAISAL_EVERY_MONTHS, ROSTER_SHIFTS, type RosterShift,
} from "../../config/facility";
import type { Staff } from "../types";
import type { Appraisal, RosterEntry, StaffCredential, StaffTraining } from "../types-hospital";

const S: [string, string, string] = ["staff_id", "staff", "Staff member"];
export const trainingRepo = createTenantRepo<StaffTraining>("hospital_staff_training", { refs: [S] });
export const credentialsRepo = createTenantRepo<StaffCredential>("hospital_staff_credentials", { refs: [S] });
export const appraisalsRepo = createTenantRepo<Appraisal>("hospital_appraisals", { refs: [S] });
export const rosterRepo = createTenantRepo<RosterEntry>("hospital_duty_roster", { refs: [S] });

const NURSES = ["nurse", "head_nurse", "nursing_superintendent", "infection_control_nurse"];
export const isClinical = (s: Pick<Staff, "staff_category">) => DOCTOR_CATEGORIES.includes(s.staff_category ?? "") || NURSES.includes(s.staff_category ?? "");
const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

async function need(roles: string[], message: string): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed(roles, a)) throw new Error(message);
  return a;
}
async function staffMember(id: string): Promise<Staff> {
  const s = await staffRepo.get(id);
  if (!s) throw new Error("Staff member not found.");
  return s;
}
const isSelf = (a: Actor, s: Staff) => !!a.userId && s.user_id === a.userId;

/** The hospital's staff (everyone with a designation). */
export async function hospitalStaffList(): Promise<Staff[]> {
  return staffRepo.list({ where: "staff_category IS NOT NULL AND staff_category != ''", orderBy: "name ASC" });
}

// ── Training ──────────────────────────────────────────────────────────────

export interface TrainingInput {
  kind: string; title?: string | null; heldOn: string; validUntil?: string | null; hours?: number | null; provider?: string | null; certificateRef?: string | null;
}

export async function recordTraining(staffId: string, t: TrainingInput): Promise<StaffTraining> {
  const a = await need(TRAINING_ROLES, "Training is recorded by HR, the Nursing Superintendent, the quality team or the infection control nurse.");
  await staffMember(staffId);
  const kind = trainingKind(t.kind);
  if (!kind) throw new Error("Choose the training.");
  if ((t.kind === "other" || t.kind === "cme") && !t.title?.trim()) throw new Error("Enter the title of the training.");
  if (!isDate(t.heldOn) || t.heldOn > localDate()) throw new Error("Enter the date it was completed (not in the future).");
  if (t.validUntil && (!isDate(t.validUntil) || t.validUntil <= t.heldOn)) throw new Error("The certificate must be valid until a date after the training.");
  if (t.hours != null && !(Number(t.hours) > 0)) throw new Error("Check the hours.");
  return trainingRepo.create({
    staff_id: staffId, kind: t.kind, title: t.title?.trim() || null, held_on: t.heldOn,
    valid_until: t.validUntil || (kind.validMonths ? addMonths(t.heldOn, kind.validMonths) : null),
    hours: t.hours ?? null, provider: t.provider?.trim() || null, certificate_ref: t.certificateRef?.trim() || null, recorded_by_name: stamp(a),
  });
}

export async function listTraining(staffId?: string): Promise<StaffTraining[]> {
  return trainingRepo.list(staffId ? { where: "staff_id = ?", params: [staffId], orderBy: "held_on DESC" } : { orderBy: "held_on DESC" });
}

// ── Credentials ───────────────────────────────────────────────────────────

export interface CredentialInput {
  kind: string; number?: string | null; issuedBy?: string | null; validUntil?: string | null; documentRef?: string | null; notes?: string | null;
}

export async function recordCredential(staffId: string, c: CredentialInput): Promise<StaffCredential> {
  await need(HR_ROLES, "Credentials are recorded by HR.");
  await staffMember(staffId);
  if (!(CREDENTIAL_KINDS as readonly string[]).includes(c.kind)) throw new Error("Choose the credential.");
  if (c.validUntil && !isDate(c.validUntil)) throw new Error("Check the expiry date.");
  if (c.kind.startsWith("Professional registration") && !c.number?.trim()) throw new Error("Enter the registration number.");
  return credentialsRepo.create({
    staff_id: staffId, kind: c.kind, number: c.number?.trim() || null, issued_by: c.issuedBy?.trim() || null, valid_until: c.validUntil || null,
    verified_on: null, verified_by_name: null, verification_method: null, document_ref: c.documentRef?.trim() || null, notes: c.notes?.trim() || null,
  });
}

/** Records how the credential was checked with the source. Not by the staff member. */
export async function verifyCredential(id: string, v: { method: string; verifiedOn?: string | null; notes?: string | null }): Promise<StaffCredential> {
  const a = await need(HR_ROLES, "Credentials are verified by HR.");
  const c = await credentialsRepo.get(id);
  if (!c) throw new Error("Credential not found.");
  if (c.verified_on) throw new Error("This credential is already verified.");
  if (isSelf(a, await staffMember(c.staff_id))) throw new Error("Your own credentials are verified by someone else.");
  if (!(VERIFICATION_METHODS as readonly string[]).includes(v.method)) throw new Error("Choose how it was verified.");
  const on = v.verifiedOn || localDate();
  if (!isDate(on) || on > localDate()) throw new Error("Check the verification date.");
  return (await credentialsRepo.update(id, {
    verified_on: on, verified_by_name: stamp(a), verification_method: v.method, notes: [c.notes, v.notes?.trim()].filter(Boolean).join("\n") || null,
  }))!;
}

export async function listCredentials(staffId?: string): Promise<StaffCredential[]> {
  return credentialsRepo.list(staffId ? { where: "staff_id = ?", params: [staffId], orderBy: "created_at ASC" } : { orderBy: "created_at ASC" });
}

// ── Appraisals ────────────────────────────────────────────────────────────

export interface AppraisalInput {
  periodFrom: string; periodTo: string; ratings: Record<string, number>; strengths?: string | null; improvements?: string | null; goals?: string | null;
}

export async function saveAppraisal(id: string | null, staffId: string, x: AppraisalInput): Promise<Appraisal> {
  const a = await need(APPRAISER_ROLES, "Appraisals are written by the HoD, Nursing Superintendent, Head Nurse or HR.");
  const s = await staffMember(staffId);
  if (isSelf(a, s)) throw new Error("You cannot appraise yourself.");
  if (!isDate(x.periodFrom) || !isDate(x.periodTo) || x.periodTo <= x.periodFrom) throw new Error("Check the appraisal period.");
  for (const [k, v] of Object.entries(x.ratings ?? {})) {
    if (!APPRAISAL_CRITERIA.some(([c]) => c === k)) throw new Error("Unknown criterion.");
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error("Scores are 1 to 5.");
  }
  const payload = {
    period_from: x.periodFrom, period_to: x.periodTo, ratings: JSON.stringify(x.ratings ?? {}), strengths: x.strengths?.trim() || null,
    improvements: x.improvements?.trim() || null, goals: x.goals?.trim() || null, appraiser_name: stamp(a),
  };
  if (id) {
    const old = await appraisalsRepo.get(id);
    if (!old) throw new Error("Appraisal not found.");
    if (old.status !== "draft") throw new Error("A finalized appraisal cannot be changed.");
    return (await appraisalsRepo.update(id, payload))!;
  }
  return appraisalsRepo.create({ ...payload, staff_id: staffId, status: "draft", overall: null });
}

export async function finalizeAppraisal(id: string): Promise<Appraisal> {
  const a = await need(APPRAISER_ROLES, "Appraisals are finalized by the appraiser.");
  const x = await appraisalsRepo.get(id);
  if (!x) throw new Error("Appraisal not found.");
  if (x.status !== "draft") throw new Error("Already finalized.");
  if (isSelf(a, await staffMember(x.staff_id))) throw new Error("You cannot appraise yourself.");
  const ratings = JSON.parse(x.ratings ?? "{}") as Record<string, number>;
  const missing = APPRAISAL_CRITERIA.filter(([k]) => !ratings[k]).map(([, l]) => l);
  if (missing.length) throw new Error(`Score every criterion first: ${missing.join(", ")}.`);
  if (!x.goals) throw new Error("Agree goals for the next period first.");
  const values = Object.values(ratings);
  const overall = Math.round((values.reduce((t, v) => t + v, 0) / values.length) * 10) / 10;
  return (await appraisalsRepo.update(id, { status: "final", overall, finalized_at: nowIso(), appraiser_name: stamp(a) }))!;
}

/** Only the staff member acknowledges their own appraisal, with their comments. */
export async function acknowledgeAppraisal(id: string, comments?: string | null): Promise<Appraisal> {
  const a = await currentActor();
  const x = await appraisalsRepo.get(id);
  if (!x) throw new Error("Appraisal not found.");
  if (x.status !== "final") throw new Error(x.status === "draft" ? "The appraisal is not finalized yet." : "Already acknowledged.");
  if (!isSelf(a, await staffMember(x.staff_id))) throw new Error("Only the staff member acknowledges their own appraisal.");
  return (await appraisalsRepo.update(id, { status: "acknowledged", acknowledged_at: nowIso(), staff_comments: comments?.trim() || null }))!;
}

export async function listAppraisals(staffId?: string): Promise<Appraisal[]> {
  return appraisalsRepo.list(staffId ? { where: "staff_id = ?", params: [staffId], orderBy: "period_to DESC" } : { orderBy: "period_to DESC" });
}

/** Appraisals of the signed-in staff member, for them to read and acknowledge. */
export async function myAppraisals(): Promise<Appraisal[]> {
  const a = await currentActor();
  if (!a.userId) return [];
  const me = (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0];
  return me ? (await listAppraisals(me.id)).filter((x) => x.status !== "draft") : [];
}

// ── Staff summary ─────────────────────────────────────────────────────────

export interface StaffHrStatus {
  staff: Staff;
  missingTraining: string[];
  expiredTraining: string[];
  registrationVerified: boolean | null;
  unverifiedCredentials: number;
  lastAppraisal: string | null;
  appraisalDue: boolean;
}

/** What each staff member's file is missing. Registration is null when the designation needs none. */
export async function staffHrStatus(today: string = localDate()): Promise<StaffHrStatus[]> {
  const [staff, training, creds, appraisals] = await Promise.all([hospitalStaffList(), listTraining(), listCredentials(), listAppraisals()]);
  return staff.map((s) => {
    const mine = training.filter((t) => t.staff_id === s.id);
    const required = TRAINING_KINDS.filter((k) => k.requiredFor === "all" || (k.requiredFor === "clinical" && isClinical(s)));
    const current = (key: string) => mine.some((t) => t.kind === key && (!t.valid_until || t.valid_until >= today));
    const missingTraining = required.filter((k) => !mine.some((t) => t.kind === k.key)).map((k) => k.label);
    const expiredTraining = required.filter((k) => mine.some((t) => t.kind === k.key) && !current(k.key)).map((k) => k.label);
    const myCreds = creds.filter((c) => c.staff_id === s.id);
    const needsReg = !!designation(s.staff_category)?.license;
    const reg = myCreds.filter((c) => c.kind.startsWith("Professional registration"));
    const last = appraisals.filter((x) => x.staff_id === s.id && x.status !== "draft").map((x) => x.period_to).sort().pop() ?? null;
    const anchor = last ?? s.date_of_joining ?? null;
    return {
      staff: s, missingTraining, expiredTraining,
      registrationVerified: needsReg ? reg.some((c) => c.verified_on && (!c.valid_until || c.valid_until >= today)) : null,
      unverifiedCredentials: myCreds.filter((c) => !c.verified_on).length,
      lastAppraisal: last,
      appraisalDue: anchor ? addMonths(anchor, APPRAISAL_EVERY_MONTHS) < today : true,
    };
  });
}

// ── Duty roster ───────────────────────────────────────────────────────────

const prevDay = (d: string) => addDays(d, -1);
const nextDay = (d: string) => addDays(d, 1);
const STARTS_MORNING: RosterShift[] = ["M", "L"];

/** Sets one staff member's shift on one day; an empty shift clears it. */
export async function setRosterShift(staffId: string, dutyDate: string, shift: RosterShift | "", opts: { department?: string | null; notes?: string | null } = {}): Promise<RosterEntry | null> {
  const a = await need(ROSTER_ROLES, "The roster is made by HR, the Nursing Superintendent, Head Nurse or HoD.");
  const s = await staffMember(staffId);
  if (!isDate(dutyDate)) throw new Error("Check the date.");
  if (shift && !ROSTER_SHIFTS[shift]) throw new Error("Unknown shift.");
  const existing = (await rosterRepo.list({ where: "staff_id = ? AND duty_date = ?", params: [staffId, dutyDate] }))[0] ?? null;
  if (!shift) {
    if (existing) await rosterRepo.remove(existing.id);
    return null;
  }
  // A night ends at 08:00, so no morning or long-day shift on the day after a night.
  const around = await rosterRepo.list({ where: "staff_id = ? AND duty_date IN (?, ?)", params: [staffId, prevDay(dutyDate), nextDay(dutyDate)] });
  const before = around.find((r) => r.duty_date === prevDay(dutyDate))?.shift;
  const after = around.find((r) => r.duty_date === nextDay(dutyDate))?.shift;
  if (before === "N" && STARTS_MORNING.includes(shift)) throw new Error(`${s.name} is on night duty the night before. A morning or long-day shift leaves no rest.`);
  if (shift === "N" && after && STARTS_MORNING.includes(after as RosterShift)) throw new Error(`${s.name} has a morning or long-day shift the next day. Night duty would leave no rest.`);
  const payload = { shift, department: opts.department?.trim() || s.department || null, notes: opts.notes?.trim() || null, created_by_name: stamp(a) };
  return existing ? (await rosterRepo.update(existing.id, payload))! : rosterRepo.create({ ...payload, staff_id: staffId, duty_date: dutyDate });
}

export async function rosterRange(from: string, to: string, department?: string | null): Promise<RosterEntry[]> {
  const where = ["duty_date >= ?", "duty_date <= ?"];
  const params: unknown[] = [from, to];
  if (department) { where.push("department = ?"); params.push(department); }
  return rosterRepo.list({ where: where.join(" AND "), params, orderBy: "duty_date ASC" });
}

/** Staff on duty per department and shift on one day. */
export async function rosterCoverage(day: string): Promise<{ department: string; shift: string; n: number }[]> {
  return dbSelect<{ department: string; shift: string; n: number }>(
    `SELECT COALESCE(department, '—') AS department, shift, COUNT(*) AS n FROM hospital_duty_roster
     WHERE tenant_id = ? AND deleted_at IS NULL AND duty_date = ? AND shift IN ('M','E','N','L','C') GROUP BY department, shift ORDER BY department, shift`,
    [requireCurrentTenantId(), day]
  );
}
