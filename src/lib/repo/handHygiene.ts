/** Hand-hygiene observation audits (MSDS IPC-1 Ind. 84 hand hygiene, 84 ii
 * surveillance of practices, 86 IPC rounds). An IPC auditor observes an area
 * and records each opportunity (WHO "My 5 Moments") and what was done.
 *
 * These are observations by an auditor. A clinician's own "I performed hand
 * hygiene" on the visit checklist is a self-confirmation: it is reported
 * separately (clinicianConfirmations) and never counted as audit compliance. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { localDate } from "../localDate";
import { currentActor, roleAllowed } from "./medicalRecord";
import { IPC_AUDITOR_ROLES } from "../../config/hospitalStaff";
import type { HhObservation, HhSession } from "../types-hospital";

export const hhSessionsRepo = createTenantRepo<HhSession>("hospital_hh_sessions");
export const hhObservationsRepo = createTenantRepo<HhObservation>("hospital_hh_observations", { refs: [["session_id", "hospital_hh_sessions", "Audit session"]] });

export const MOMENTS: Record<number, string> = {
  1: "Before touching a patient",
  2: "Before a clean / aseptic procedure",
  3: "After body fluid exposure risk",
  4: "After touching a patient",
  5: "After touching patient surroundings",
};
export const PROFESSIONS = ["Doctor", "Nurse", "Paramedic / technician", "Support staff", "Student"];
export const HH_ACTIONS: Record<HhObservation["action"], string> = { handrub: "Hand-rub", handwash: "Hand-wash", missed: "Missed" };

const stampOf = (a: { name: string; designation: string | null }) => (a.designation ? `${a.name}, ${a.designation}` : a.name);

export async function startHhSession(input: { area: string; department?: string | null; date?: string; notes?: string | null }): Promise<HhSession> {
  const a = await currentActor();
  if (!roleAllowed(IPC_AUDITOR_ROLES, a)) throw new Error("Hand-hygiene audits are recorded by the Infection Control Nurse, Nursing Superintendent or a Head Nurse.");
  if (!input.area?.trim()) throw new Error("Enter the ward / area observed.");
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : localDate();
  if (date > localDate()) throw new Error("The audit date cannot be in the future.");
  return hhSessionsRepo.create({
    area: input.area.trim(), department: input.department?.trim() || null, session_date: date,
    observer_id: a.userId, observer_name: stampOf(a), observer_role: a.role, status: "open", notes: input.notes?.trim() || null, closed_at: null,
  });
}

async function ownOpenSession(sessionId: string): Promise<HhSession> {
  const s = await hhSessionsRepo.get(sessionId);
  if (!s) throw new Error("Audit session not found.");
  if (s.status !== "open") throw new Error("This audit session is closed.");
  const a = await currentActor();
  if (!a.full && s.observer_id !== a.userId) throw new Error("Only the observer of this session records in it.");
  return s;
}

/** One observed opportunity, recorded by the observer as it happens. */
export async function addHhObservation(sessionId: string, o: { profession: string; moment: number; action: HhObservation["action"]; glovesMisuse?: boolean }): Promise<HhObservation> {
  await ownOpenSession(sessionId);
  if (!PROFESSIONS.includes(o.profession)) throw new Error("Choose who was observed.");
  if (!MOMENTS[o.moment]) throw new Error("Choose the moment (1-5).");
  if (!HH_ACTIONS[o.action]) throw new Error("Choose hand-rub, hand-wash or missed.");
  const a = await currentActor();
  return hhObservationsRepo.create({
    session_id: sessionId, profession: o.profession, moment: o.moment, action: o.action, gloves_misuse: o.glovesMisuse ? 1 : 0,
    observed_at: nowIso(), recorded_by_name: stampOf(a), voided_at: null, void_reason: null,
  });
}

/** An entry made in error stays in the session, struck through with the reason. */
export async function voidHhObservation(id: string, reason: string): Promise<void> {
  if (!reason?.trim()) throw new Error("Give the reason.");
  const o = await hhObservationsRepo.get(id);
  if (!o) throw new Error("Observation not found.");
  await ownOpenSession(o.session_id);
  await hhObservationsRepo.update(id, { voided_at: nowIso(), void_reason: reason.trim() });
}

export async function closeHhSession(sessionId: string): Promise<HhSession> {
  await ownOpenSession(sessionId);
  return (await hhSessionsRepo.update(sessionId, { status: "closed", closed_at: nowIso() }))!;
}

export interface HhSessionRow extends HhSession { opportunities: number; performed: number; }

export async function listHhSessions(range: { from: string; to: string }): Promise<HhSessionRow[]> {
  return dbSelect<HhSessionRow>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM hospital_hh_observations o WHERE o.session_id = s.id AND o.voided_at IS NULL AND o.deleted_at IS NULL) AS opportunities,
       (SELECT COUNT(*) FROM hospital_hh_observations o WHERE o.session_id = s.id AND o.voided_at IS NULL AND o.deleted_at IS NULL AND o.action != 'missed') AS performed
     FROM hospital_hh_sessions s
     WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.session_date BETWEEN ? AND ?
     ORDER BY s.session_date DESC, s.created_at DESC`,
    [requireCurrentTenantId(), range.from, range.to]
  );
}

export async function listHhObservations(sessionId: string): Promise<HhObservation[]> {
  return hhObservationsRepo.list({ where: "session_id = ?", params: [sessionId], orderBy: "observed_at ASC" });
}

export interface Compliance { opportunities: number; performed: number; rate: number | null }
const rate = (opportunities: number, performed: number): Compliance => ({ opportunities, performed, rate: opportunities ? Math.round((performed / opportunities) * 1000) / 10 : null });

/** Observed compliance (performed / opportunities) for a period, overall and by area, profession and moment. */
export async function hhCompliance(range: { from: string; to: string }): Promise<{
  overall: Compliance; byArea: (Compliance & { area: string })[]; byProfession: (Compliance & { profession: string })[]; byMoment: (Compliance & { moment: number })[];
}> {
  const rows = await dbSelect<{ area: string; profession: string; moment: number; action: string }>(
    `SELECT s.area, o.profession, o.moment, o.action FROM hospital_hh_observations o JOIN hospital_hh_sessions s ON s.id = o.session_id
     WHERE o.tenant_id = ? AND o.voided_at IS NULL AND o.deleted_at IS NULL AND s.deleted_at IS NULL AND s.session_date BETWEEN ? AND ?`,
    [requireCurrentTenantId(), range.from, range.to]
  );
  const group = <K extends string | number>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, [number, number]>();
    for (const r of rows) {
      const k = key(r);
      const v = m.get(k) ?? [0, 0];
      v[0]++;
      if (r.action !== "missed") v[1]++;
      m.set(k, v);
    }
    return [...m.entries()];
  };
  return {
    overall: rate(rows.length, rows.filter((r) => r.action !== "missed").length),
    byArea: group((r) => r.area).map(([area, [o, p]]) => ({ area, ...rate(o, p) })),
    byProfession: group((r) => r.profession).map(([profession, [o, p]]) => ({ profession, ...rate(o, p) })),
    byMoment: group((r) => r.moment).map(([moment, [o, p]]) => ({ moment, ...rate(o, p) })).sort((x, y) => x.moment - y.moment),
  };
}

/** Clinicians' own confirmations on the visit checklist: a different record,
 * shown next to the audit but never added to it. */
export async function clinicianConfirmations(range: { from: string; to: string }): Promise<{ completed: number; notCompleted: number; other: number }> {
  const rows = await dbSelect<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n FROM hospital_checklist_entries
     WHERE tenant_id = ? AND item_key = 'hand_hygiene' AND kind = 'self_confirmation' AND superseded_by IS NULL AND deleted_at IS NULL
       AND substr(recorded_at, 1, 10) BETWEEN ? AND ? GROUP BY status`,
    [requireCurrentTenantId(), range.from, range.to]
  );
  const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return { completed: n("completed"), notCompleted: n("not_completed"), other: n("na") + n("pending") };
}
