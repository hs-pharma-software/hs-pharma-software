/** Emergency department (MSDS COP-1 Ind. 6-9, ROM-5 / medico-legal):
 * five-level triage from the vital signs, the time a doctor first sees the
 * patient, the disposition, and the medico-legal case (MLC) register.
 *
 * The software suggests a triage level from the vital signs; the nurse or
 * doctor decides, and recording a less urgent level than the vital signs call
 * for needs a reason. Nothing here is marked done on its own: a patient is
 * "seen" only when a doctor records it, an MLC report is issued only after
 * the police were informed and a doctor examined the patient. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { hospitalEpisodesRepo } from "./hospital";
import { suggestTriage, triageLevel, DISPOSITIONS, MLC_NATURES, TRIAGE_LEVELS, type Disposition } from "../../config/quality";
import type { ErTriage, HospitalEpisode, MlcCase } from "../types-hospital";

const P: [string, string, string] = ["patient_id", "hospital_patients", "Patient"];
const E: [string, string, string] = ["episode_id", "hospital_episodes", "Visit"];
export const erTriageRepo = createTenantRepo<ErTriage>("hospital_er_triage", { refs: [P, E] });
export const mlcCasesRepo = createTenantRepo<MlcCase>("hospital_mlc_cases", { refs: [P, E] });

export const stamp = (a: Actor) => (a.designation ? `${a.name}, ${a.designation}` : a.name);

/** "PREFIX-26-0001": a serial per calendar year. */
export async function nextSerial(table: string, column: string, prefix: string): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(2);
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND ${column} LIKE ?`, [tenantId, `${prefix}-${yy}-%`]);
  let n = (rows[0]?.n ?? 0) + 1;
  for (;;) {
    const no = `${prefix}-${yy}-${String(n).padStart(4, "0")}`;
    if (!(await dbSelect(`SELECT 1 FROM ${table} WHERE tenant_id = ? AND ${column} = ?`, [tenantId, no])).length) return no;
    n++;
  }
}

export const minutesBetween = (a: string | null | undefined, b: string | null | undefined): number | null => {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 60000;
  return Number.isFinite(d) ? Math.round(d) : null;
};
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

async function openEmergency(episodeId: string): Promise<HospitalEpisode> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit not found.");
  if (ep.type !== "emergency") throw new Error("Triage is recorded on emergency visits.");
  if (ep.status !== "open") throw new Error("This emergency visit is closed.");
  return ep;
}

// ── Triage ────────────────────────────────────────────────────────────────

export interface TriageInput {
  chiefComplaint: string;
  pulse: number; sbp: number; dbp?: number | null; rr: number; spo2: number; gcs: number;
  tempC?: number | null; pain?: number | null;
  /** The level the nurse or doctor decides; the suggested level when left out. */
  level?: number | null;
  overrideReason?: string | null;
  notes?: string | null;
}

const RANGES: [keyof TriageInput, string, number, number][] = [
  ["pulse", "Pulse", 0, 300], ["sbp", "Systolic BP", 0, 300], ["rr", "Respiratory rate", 0, 80], ["spo2", "SpO₂", 0, 100], ["gcs", "GCS", 3, 15],
];

/** The triage nurse or doctor records the triage of an emergency visit. */
export async function recordTriage(episodeId: string, t: TriageInput): Promise<ErTriage> {
  const a = await currentActor();
  if (!roleAllowed(["any_clinical"], a)) throw new Error("Triage is done by a nurse or doctor.");
  const ep = await openEmergency(episodeId);
  if (!t.chiefComplaint?.trim()) throw new Error("Enter the presenting complaint.");
  for (const [k, label, lo, hi] of RANGES) {
    const v = t[k];
    if (v === null || v === undefined || (v as unknown) === "" || !Number.isFinite(Number(v))) throw new Error(`Enter the ${label}.`);
    if (Number(v) < lo || Number(v) > hi) throw new Error(`${label} ${v} is outside ${lo}-${hi}. Check the reading.`);
  }
  if (t.pain != null && (t.pain < 0 || t.pain > 10)) throw new Error("Pain is scored 0-10.");
  if (t.tempC != null && (t.tempC < 25 || t.tempC > 45)) throw new Error("Check the temperature (°C).");
  const vitals = { pulse: Number(t.pulse), sbp: Number(t.sbp), rr: Number(t.rr), spo2: Number(t.spo2), gcs: Number(t.gcs), temp_c: t.tempC ?? null, pain: t.pain ?? null };
  const suggested = suggestTriage(vitals);
  const level = t.level ?? suggested.level;
  if (!triageLevel(level)) throw new Error("Choose a triage level from 1 to 5.");
  if (level > suggested.level && suggested.level <= 3 && !t.overrideReason?.trim()) {
    throw new Error(`The vital signs call for level ${suggested.level} (${suggested.reasons.join(", ")}). Give the reason for a less urgent level.`);
  }
  return erTriageRepo.create({
    episode_id: ep.id, patient_id: ep.patient_id, triaged_at: nowIso(), triaged_by_name: stamp(a), chief_complaint: t.chiefComplaint.trim(),
    ...vitals, dbp: t.dbp ?? null, suggested_level: suggested.level, level, override_reason: t.overrideReason?.trim() || null,
    seen_at: null, seen_by_name: null, disposition: null, disposition_at: null, disposition_by_name: null, notes: t.notes?.trim() || null,
  } as Partial<ErTriage>);
}

export async function episodeTriage(episodeId: string): Promise<ErTriage[]> {
  return erTriageRepo.list({ where: "episode_id = ?", params: [episodeId], orderBy: "triaged_at ASC" });
}
async function latestTriage(episodeId: string): Promise<ErTriage> {
  const rows = await episodeTriage(episodeId);
  const t = rows[rows.length - 1];
  if (!t) throw new Error("Triage the patient first.");
  return t;
}

/** A doctor records seeing the patient (door-to-doctor time). */
export async function markSeenByDoctor(episodeId: string): Promise<ErTriage> {
  const a = await currentActor();
  if (!roleAllowed(["doctor"], a)) throw new Error("Only a doctor records seeing the patient.");
  await openEmergency(episodeId);
  const t = await latestTriage(episodeId);
  if ((await episodeTriage(episodeId)).some((x) => x.seen_at)) throw new Error("A doctor has already seen this patient.");
  return (await erTriageRepo.update(t.id, { seen_at: nowIso(), seen_by_name: stamp(a) }))!;
}

/** The doctor records where the patient went from the emergency department. */
export async function recordDisposition(episodeId: string, disposition: Disposition, notes?: string | null): Promise<ErTriage> {
  const a = await currentActor();
  if (!DISPOSITIONS[disposition]) throw new Error("Choose the disposition.");
  const rows = await episodeTriage(episodeId);
  const t = rows[rows.length - 1];
  if (!t) throw new Error("Triage the patient first.");
  // A patient who leaves before a doctor sees them is recorded by the nurse.
  const unseenExit = disposition === "absconded" || disposition === "lama";
  if (!roleAllowed(unseenExit ? ["any_clinical"] : ["doctor"], a)) throw new Error("The doctor records the disposition.");
  if (!unseenExit && !rows.some((x) => x.seen_at)) throw new Error("Record that a doctor has seen the patient first.");
  if (rows.some((x) => x.disposition)) throw new Error("The disposition is already recorded.");
  if ((disposition === "lama" || disposition === "died" || disposition === "referred") && !notes?.trim()) {
    throw new Error(disposition === "lama" ? "Note the risks explained and who signed the LAMA form." : disposition === "died" ? "Note the time and cause of death." : "Note where the patient was referred and why.");
  }
  return (await erTriageRepo.update(t.id, {
    disposition, disposition_at: nowIso(), disposition_by_name: stamp(a),
    notes: [t.notes, notes?.trim()].filter(Boolean).join("\n") || null,
  }))!;
}

export interface ErBoardRow {
  episode_id: string;
  episode_no: string;
  patient_name: string;
  mr_no: string | null;
  arrived_at: string;
  triage: ErTriage | null;
  /** Minutes since the latest triage, while no doctor has seen the patient. */
  waiting_min: number | null;
  overdue: boolean;
  mlc_no: string | null;
}

/** Open emergency visits, most urgent and longest waiting first. */
export async function erBoard(now: Date = new Date()): Promise<ErBoardRow[]> {
  const tenantId = requireCurrentTenantId();
  const eps = await dbSelect<{ id: string; episode_no: string; created_at: string; name: string; mr_no: string | null }>(
    `SELECT e.id, e.episode_no, e.created_at, p.name, p.mr_no FROM hospital_episodes e JOIN hospital_patients p ON p.id = e.patient_id
     WHERE e.tenant_id = ? AND e.type = 'emergency' AND e.status = 'open' AND e.deleted_at IS NULL ORDER BY e.created_at ASC`,
    [tenantId]
  );
  if (!eps.length) return [];
  const ids = eps.map((e) => e.id);
  const marks = ids.map(() => "?").join(",");
  const triage = await erTriageRepo.list({ where: `episode_id IN (${marks})`, params: ids, orderBy: "triaged_at ASC" });
  const mlc = await mlcCasesRepo.list({ where: `episode_id IN (${marks})`, params: ids });
  const rows = eps.map((e): ErBoardRow => {
    const mine = triage.filter((t) => t.episode_id === e.id);
    const t = mine[mine.length - 1] ?? null;
    const seen = mine.some((x) => x.seen_at);
    const waiting = t && !seen ? minutesBetween(t.triaged_at, now.toISOString()) : null;
    const target = triageLevel(t?.level)?.targetMin ?? null;
    return {
      episode_id: e.id, episode_no: e.episode_no, patient_name: e.name, mr_no: e.mr_no, arrived_at: e.created_at, triage: t,
      waiting_min: waiting, overdue: waiting !== null && target !== null && waiting > target, mlc_no: mlc.find((m) => m.episode_id === e.id)?.mlc_no ?? null,
    };
  });
  return rows.filter((r) => !r.triage?.disposition).sort((x, y) =>
    (x.triage ? 0 : -1) - (y.triage ? 0 : -1) || (x.triage?.level ?? 0) - (y.triage?.level ?? 0) || x.arrived_at.localeCompare(y.arrived_at)
  );
}

// ── Medico-legal cases ────────────────────────────────────────────────────

export async function registerMlc(episodeId: string, m: { arrivedAt?: string | null; broughtBy?: string | null; nature: string; history?: string | null }): Promise<MlcCase> {
  const a = await currentActor();
  if (!roleAllowed(["doctor"], a)) throw new Error("A doctor registers a medico-legal case.");
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit not found.");
  if (!(MLC_NATURES as readonly string[]).includes(m.nature)) throw new Error("Choose the nature of the case.");
  const existing = await mlcCasesRepo.list({ where: "episode_id = ?", params: [episodeId] });
  if (existing.length) throw new Error(`This visit is already registered as ${existing[0].mlc_no}.`);
  return mlcCasesRepo.create({
    mlc_no: await nextSerial("hospital_mlc_cases", "mlc_no", "MLC"), episode_id: ep.id, patient_id: ep.patient_id,
    arrived_at: m.arrivedAt || ep.created_at, brought_by: m.broughtBy?.trim() || null, nature: m.nature, history: m.history?.trim() || null,
    registered_by_name: stamp(a), status: "open",
  } as Partial<MlcCase>);
}

async function mlc(id: string): Promise<MlcCase> {
  const c = await mlcCasesRepo.get(id);
  if (!c) throw new Error("Medico-legal case not found.");
  return c;
}

/** The police station informed (rapat / DD number when given). */
export async function recordPoliceIntimation(id: string, p: { station: string; informedAt: string; officer?: string | null; ref?: string | null }): Promise<MlcCase> {
  const a = await currentActor();
  if (!roleAllowed(["any_clinical"], a)) throw new Error("The doctor or nurse on duty records informing the police.");
  const c = await mlc(id);
  if (c.status === "closed") throw new Error("This case is closed.");
  if (!p.station?.trim()) throw new Error("Enter the police station informed.");
  if (!p.informedAt) throw new Error("Enter when the police were informed.");
  return (await mlcCasesRepo.update(id, {
    police_station: p.station.trim(), police_informed_at: p.informedAt, police_informed_by_name: stamp(a), police_officer: p.officer?.trim() || null, police_ref: p.ref?.trim() || null,
  }))!;
}

export async function recordMlcExamination(id: string, x: { injuries: string; opinion?: string | null; samples?: string | null; samplesHandedTo?: string | null }): Promise<MlcCase> {
  const a = await currentActor();
  if (!roleAllowed(["doctor"], a)) throw new Error("Only a doctor records the medico-legal examination.");
  const c = await mlc(id);
  if (c.status !== "open") throw new Error("The report is issued; the examination can no longer be changed.");
  if (!x.injuries?.trim()) throw new Error("Describe the injuries or findings.");
  if (x.samples?.trim() && !x.samplesHandedTo?.trim()) throw new Error("Note who the preserved samples were handed to (chain of custody).");
  return (await mlcCasesRepo.update(id, {
    examined_at: c.examined_at ?? nowIso(), examined_by_name: stamp(a), injuries: x.injuries.trim(), opinion: x.opinion?.trim() || null,
    samples: x.samples?.trim() || null, samples_handed_to: x.samplesHandedTo?.trim() || null,
  }))!;
}

export async function issueMlcReport(id: string, issuedTo: string): Promise<MlcCase> {
  const a = await currentActor();
  if (!roleAllowed(["doctor"], a)) throw new Error("Only a doctor issues the medico-legal report.");
  const c = await mlc(id);
  if (c.status !== "open") throw new Error("The report has already been issued.");
  if (!c.police_informed_at) throw new Error("Record that the police were informed first.");
  if (!c.examined_at || !c.injuries) throw new Error("Record the medico-legal examination first.");
  if (!issuedTo?.trim()) throw new Error("Enter the officer (name, rank, police station) the report is issued to.");
  return (await mlcCasesRepo.update(id, { status: "report_issued", report_issued_at: nowIso(), report_issued_to: issuedTo.trim(), report_issued_by_name: stamp(a) }))!;
}

export async function closeMlc(id: string, note?: string | null): Promise<MlcCase> {
  const a = await currentActor();
  if (!roleAllowed(["doctor"], a)) throw new Error("A doctor closes the medico-legal case.");
  const c = await mlc(id);
  if (c.status !== "report_issued") throw new Error("Issue the medico-legal report before closing the case.");
  return (await mlcCasesRepo.update(id, { status: "closed", notes: [c.notes, note?.trim()].filter(Boolean).join("\n") || null }))!;
}

export interface MlcRow extends MlcCase {
  patient_name: string;
  mr_no: string | null;
  episode_no: string;
}

export async function listMlc(opts: { status?: MlcCase["status"] | ""; search?: string } = {}): Promise<MlcRow[]> {
  const where = ["m.tenant_id = ?", "m.deleted_at IS NULL"];
  const params: unknown[] = [requireCurrentTenantId()];
  if (opts.status) { where.push("m.status = ?"); params.push(opts.status); }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    where.push("(m.mlc_no LIKE ? OR p.name LIKE ? OR p.mr_no LIKE ? OR m.police_station LIKE ?)");
    params.push(q, q, q, q);
  }
  return dbSelect<MlcRow>(
    `SELECT m.*, p.name AS patient_name, p.mr_no, e.episode_no FROM hospital_mlc_cases m
     JOIN hospital_patients p ON p.id = m.patient_id JOIN hospital_episodes e ON e.id = m.episode_id
     WHERE ${where.join(" AND ")} ORDER BY m.arrived_at DESC LIMIT 300`,
    params
  );
}

export async function mlcForEpisode(episodeId: string): Promise<MlcCase | null> {
  return (await mlcCasesRepo.list({ where: "episode_id = ?", params: [episodeId] }))[0] ?? null;
}

// ── Indicators ────────────────────────────────────────────────────────────

export interface ErIndicators {
  visits: number;
  triaged: number;
  byLevel: { level: number; label: string; n: number; seenInTarget: number; seenPct: number | null; medianWait: number | null }[];
  doorToTriageMedian: number | null;
  doorToDoctorMedian: number | null;
  seenInTargetPct: number | null;
  undertriageOverrides: number;
  dispositions: Record<string, number>;
  lamaPct: number | null;
  mlcCases: number;
}

/** Emergency department indicators for visits that arrived between two dates. */
export async function erIndicators(range: { from: string; to: string }): Promise<ErIndicators> {
  const tenantId = requireCurrentTenantId();
  const eps = await dbSelect<{ id: string; created_at: string }>(
    `SELECT id, created_at FROM hospital_episodes WHERE tenant_id = ? AND type = 'emergency' AND deleted_at IS NULL AND date >= ? AND date <= ?`,
    [tenantId, range.from, range.to]
  );
  const ids = new Set(eps.map((e) => e.id));
  // Stored times are UTC: start a day early so visits after local midnight are kept (filtered by visit below).
  const since = new Date(Date.parse(range.from + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  const triage = (await erTriageRepo.list({ where: "triaged_at >= ?", params: [since], orderBy: "triaged_at ASC" })).filter((t) => ids.has(t.episode_id));
  const first = new Map<string, ErTriage>();
  for (const t of triage) if (!first.has(t.episode_id)) first.set(t.episode_id, t);
  const arrived = new Map(eps.map((e) => [e.id, e.created_at]));
  const doorToTriage: number[] = [];
  const doorToDoctor: number[] = [];
  const dispositions: Record<string, number> = {};
  let seenInTarget = 0;
  const byLevel = TRIAGE_LEVELS.map((l) => ({ level: l.level as number, label: l.label, n: 0, seenInTarget: 0, seenPct: null as number | null, medianWait: null as number | null, waits: [] as number[] }));
  for (const [episodeId, t] of first) {
    const mine = triage.filter((x) => x.episode_id === episodeId);
    const seen = mine.find((x) => x.seen_at);
    const d = mine.find((x) => x.disposition);
    if (d?.disposition) dispositions[d.disposition] = (dispositions[d.disposition] ?? 0) + 1;
    const dt = minutesBetween(arrived.get(episodeId), t.triaged_at);
    if (dt !== null) doorToTriage.push(Math.max(0, dt));
    if (seen) { const dd = minutesBetween(arrived.get(episodeId), seen.seen_at); if (dd !== null) doorToDoctor.push(Math.max(0, dd)); }
    const lvl = byLevel.find((b) => b.level === t.level);
    const wait = seen ? minutesBetween(t.triaged_at, seen.seen_at) : null;
    if (lvl) {
      lvl.n++;
      if (wait !== null) lvl.waits.push(Math.max(0, wait));
      if (wait !== null && wait <= (triageLevel(t.level)?.targetMin ?? 0)) { lvl.seenInTarget++; seenInTarget++; }
    }
  }
  const lama = (dispositions.lama ?? 0) + (dispositions.absconded ?? 0);
  const mlcCases = (await mlcCasesRepo.list({ where: "created_at >= ?", params: [since] })).filter((m) => ids.has(m.episode_id)).length;
  return {
    visits: eps.length,
    triaged: first.size,
    byLevel: byLevel.map(({ waits, ...b }) => ({ ...b, seenPct: pct(b.seenInTarget, b.n), medianWait: median(waits) })),
    doorToTriageMedian: median(doorToTriage),
    doorToDoctorMedian: median(doorToDoctor),
    seenInTargetPct: pct(seenInTarget, first.size),
    undertriageOverrides: triage.filter((t) => t.level > t.suggested_level && t.override_reason).length,
    dispositions,
    lamaPct: pct(lama, eps.length),
    mlcCases,
  };
}
