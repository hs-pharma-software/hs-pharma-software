/** Patient safety and quality (MSDS COP-6 critical results, PRE-4 complaints,
 * CQI-3 incidents / sentinel events, CQI-4 corrective and preventive action).
 *
 *   Critical result: raised when a verified lab result is outside the
 *     critical limits (or by hand for radiology); stays "pending" until
 *     someone records who they told, how, and that the result was read back.
 *   Complaint: open -> acknowledged -> resolved -> closed (complainant told).
 *   Incident: reported (anyone, may be anonymous) -> under review -> RCA
 *     (always for a sentinel event) -> closed by the quality team. A sentinel
 *     event closes only with a finished RCA and at least one CAPA.
 *   CAPA: open -> done (by the owner) -> verified effective by someone else,
 *     or back to open when it did not work.
 *
 * None of these steps completes on its own; each is a person's record. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { localDate } from "../localDate";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { hospitalEpisodesRepo, hospitalLabRepo } from "./hospital";
import { nextSerial, stamp, minutesBetween, median, pct } from "./emergency";
import { LAB_PROCESS_ROLES, QUALITY_ROLES } from "../../config/hospitalStaff";
import {
  criticalFindings, CRITICAL_NOTIFY_MINUTES, NOTIFY_METHODS, COMPLAINT_CHANNELS, COMPLAINT_CATEGORIES, COMPLAINT_SEVERITY,
  COMPLAINT_ACK_DAYS, COMPLAINT_RESOLVE_DAYS, INCIDENT_TYPES, OUTCOME_CLASSES, HARM_LEVELS, SENTINEL_RCA_DAYS, minimumClass, CAPA_SOURCES,
  type OutcomeClass,
} from "../../config/quality";
import type { Capa, Complaint, CriticalAlert, Incident, LabComponent } from "../types-hospital";

const P: [string, string, string] = ["patient_id", "hospital_patients", "Patient"];
export const criticalAlertsRepo = createTenantRepo<CriticalAlert>("hospital_critical_alerts", { refs: [P] });
export const complaintsRepo = createTenantRepo<Complaint>("hospital_complaints");
export const incidentsRepo = createTenantRepo<Incident>("hospital_incidents");
export const capaRepo = createTenantRepo<Capa>("hospital_capa");

async function needQuality(): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed(QUALITY_ROLES, a)) throw new Error("Only the quality team (Quality Manager, Nursing Superintendent, HoD) does this.");
  return a;
}
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

// ── Critical results ──────────────────────────────────────────────────────

/** Raises a pending alert for each critical value of a verified lab result.
 * Called when a pathologist releases the result; never marks it notified. */
export async function raiseCriticalForLabOrder(orderId: string, verifiedBy: string): Promise<CriticalAlert[]> {
  const o = await hospitalLabRepo.get(orderId);
  if (!o) return [];
  let components: LabComponent[] | null = null;
  try { components = o.components ? (JSON.parse(String(o.components)) as LabComponent[]) : null; } catch { components = null; }
  const found = criticalFindings(o.test_name, o.result_value ?? null, components);
  const existing = await criticalAlertsRepo.list({ where: "source = 'lab' AND order_id = ?", params: [orderId] });
  const out: CriticalAlert[] = [];
  for (const f of found) {
    if (existing.some((x) => x.test_name === f.test && x.value === f.value)) continue;
    out.push(await criticalAlertsRepo.create({
      source: "lab", order_id: orderId, patient_id: o.patient_id, episode_id: o.episode_id ?? null, test_name: f.test, value: `${f.value} (${f.why})`,
      detected_at: nowIso(), detected_by_name: verifiedBy, status: "pending", notified_to: null, notified_at: null, notified_by_name: null,
      method: null, read_back: 0, action_taken: null,
    } as Partial<CriticalAlert>));
  }
  return out;
}

/** A radiologist, lab or clinical staff member raises a critical finding by hand. */
export async function raiseCriticalAlert(input: { source: "radiology" | "lab" | "other"; episodeId: string; testName: string; value: string; orderId?: string | null }): Promise<CriticalAlert> {
  const a = await currentActor();
  if (!roleAllowed(["any_clinical", "radiographer", ...LAB_PROCESS_ROLES], a)) throw new Error("Lab, radiology or clinical staff raise a critical result.");
  const ep = await hospitalEpisodesRepo.get(input.episodeId);
  if (!ep) throw new Error("Visit not found.");
  if (!input.testName?.trim() || !input.value?.trim()) throw new Error("Enter the test or study and the critical finding.");
  return criticalAlertsRepo.create({
    source: input.source, order_id: input.orderId ?? null, patient_id: ep.patient_id, episode_id: ep.id, test_name: input.testName.trim(), value: input.value.trim(),
    detected_at: nowIso(), detected_by_name: stamp(a), status: "pending", read_back: 0,
  } as Partial<CriticalAlert>);
}

/** Records telling the responsible clinician. The read-back is required. */
export async function notifyCritical(id: string, n: { notifiedTo: string; method: string; readBack: boolean; actionTaken?: string | null }): Promise<CriticalAlert> {
  const a = await currentActor();
  if (!roleAllowed(["any_clinical", "radiographer", ...LAB_PROCESS_ROLES], a)) throw new Error("Lab, radiology or clinical staff record the notification.");
  const c = await criticalAlertsRepo.get(id);
  if (!c) throw new Error("Critical result not found.");
  if (c.status === "notified") throw new Error("This critical result is already notified.");
  if (!n.notifiedTo?.trim()) throw new Error("Enter the doctor or nurse told (name and designation).");
  if (!(NOTIFY_METHODS as readonly string[]).includes(n.method)) throw new Error("Choose how they were told.");
  if (!n.readBack) throw new Error("The person told must read the result back before the notification is recorded.");
  return (await criticalAlertsRepo.update(id, {
    status: "notified", notified_to: n.notifiedTo.trim(), notified_at: nowIso(), notified_by_name: stamp(a), method: n.method, read_back: 1, action_taken: n.actionTaken?.trim() || null,
  }))!;
}

export interface CriticalRow extends CriticalAlert {
  patient_name: string;
  mr_no: string | null;
  episode_no: string | null;
  location: string | null;
  minutes_open: number | null;
}

export async function listCriticalAlerts(opts: { status?: CriticalAlert["status"] | ""; episodeId?: string } = {}, now: Date = new Date()): Promise<CriticalRow[]> {
  const where = ["c.tenant_id = ?", "c.deleted_at IS NULL"];
  const params: unknown[] = [requireCurrentTenantId()];
  if (opts.status) { where.push("c.status = ?"); params.push(opts.status); }
  if (opts.episodeId) { where.push("c.episode_id = ?"); params.push(opts.episodeId); }
  const rows = await dbSelect<Omit<CriticalRow, "minutes_open">>(
    `SELECT c.*, p.name AS patient_name, p.mr_no, e.episode_no,
            TRIM(COALESCE(e.room_ward, '') || ' ' || COALESCE(e.bed_no, '')) AS location
     FROM hospital_critical_alerts c JOIN hospital_patients p ON p.id = c.patient_id LEFT JOIN hospital_episodes e ON e.id = c.episode_id
     WHERE ${where.join(" AND ")} ORDER BY c.status = 'pending' DESC, c.detected_at DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({ ...r, location: r.location || null, minutes_open: r.status === "pending" ? minutesBetween(r.detected_at, now.toISOString()) : minutesBetween(r.detected_at, r.notified_at) }));
}

// ── Complaints ────────────────────────────────────────────────────────────

export interface ComplaintInput {
  channel: string; complainantName: string; complainantPhone?: string | null; relation?: string | null;
  episodeId?: string | null; department?: string | null; category: string; description: string; severity: string;
}

/** Anyone on duty records a complaint as it is received. */
export async function recordComplaint(c: ComplaintInput): Promise<Complaint> {
  const a = await currentActor();
  if (!(COMPLAINT_CHANNELS as readonly string[]).includes(c.channel)) throw new Error("Choose how the complaint was received.");
  if (!(COMPLAINT_CATEGORIES as readonly string[]).includes(c.category)) throw new Error("Choose what the complaint is about.");
  if (!(COMPLAINT_SEVERITY as readonly string[]).includes(c.severity)) throw new Error("Choose the severity.");
  if (!c.complainantName?.trim()) throw new Error("Enter the complainant's name.");
  if (!c.description?.trim()) throw new Error("Write down the complaint.");
  const ep = c.episodeId ? await hospitalEpisodesRepo.get(c.episodeId) : null;
  if (c.episodeId && !ep) throw new Error("Visit not found.");
  return complaintsRepo.create({
    complaint_no: await nextSerial("hospital_complaints", "complaint_no", "CMP"), received_at: nowIso(), channel: c.channel,
    complainant_name: c.complainantName.trim(), complainant_phone: c.complainantPhone?.trim() || null, relation: c.relation?.trim() || null,
    patient_id: ep?.patient_id ?? null, episode_id: ep?.id ?? null, department: c.department?.trim() || ep?.department || null,
    category: c.category, description: c.description.trim(), severity: c.severity, received_by_name: stamp(a), status: "open", complainant_informed: 0,
  } as Partial<Complaint>);
}

async function complaint(id: string): Promise<Complaint> {
  const c = await complaintsRepo.get(id);
  if (!c) throw new Error("Complaint not found.");
  return c;
}

export async function acknowledgeComplaint(id: string, assignedTo: string): Promise<Complaint> {
  const a = await needQuality();
  const c = await complaint(id);
  if (c.status !== "open") throw new Error("This complaint is already acknowledged.");
  if (!assignedTo?.trim()) throw new Error("Enter who will investigate it.");
  return (await complaintsRepo.update(id, { status: "acknowledged", acknowledged_at: nowIso(), acknowledged_by_name: stamp(a), assigned_to: assignedTo.trim() }))!;
}

export async function resolveComplaint(id: string, r: { investigation: string; resolution: string }): Promise<Complaint> {
  const a = await needQuality();
  const c = await complaint(id);
  if (c.status === "open") throw new Error("Acknowledge the complaint first.");
  if (c.status === "closed") throw new Error("This complaint is closed.");
  if (!r.investigation?.trim()) throw new Error("Record what the investigation found.");
  if (!r.resolution?.trim()) throw new Error("Record the resolution.");
  return (await complaintsRepo.update(id, { status: "resolved", investigation: r.investigation.trim(), resolution: r.resolution.trim(), resolved_at: nowIso(), resolved_by_name: stamp(a) }))!;
}

/** Closed only once the complainant was told the outcome. */
export async function closeComplaint(id: string, complainantInformed: boolean): Promise<Complaint> {
  const a = await needQuality();
  const c = await complaint(id);
  if (c.status !== "resolved") throw new Error("Resolve the complaint before closing it.");
  if (!complainantInformed) throw new Error("Tell the complainant the outcome before closing the complaint.");
  return (await complaintsRepo.update(id, { status: "closed", complainant_informed: 1, closed_at: nowIso(), closed_by_name: stamp(a) }))!;
}

export interface ComplaintRow extends Complaint {
  ack_overdue: boolean;
  resolve_overdue: boolean;
}
export async function listComplaints(opts: { status?: Complaint["status"] | "" | "active" } = {}, today: string = localDate()): Promise<ComplaintRow[]> {
  const rows = await complaintsRepo.list(
    opts.status === "active" ? { where: "status != 'closed'", orderBy: "received_at DESC" }
      : opts.status ? { where: "status = ?", params: [opts.status], orderBy: "received_at DESC" } : { orderBy: "received_at DESC" }
  );
  return rows.map((c) => ({
    ...c,
    ack_overdue: c.status === "open" && daysBetween(c.received_at, today) > COMPLAINT_ACK_DAYS,
    resolve_overdue: (c.status === "open" || c.status === "acknowledged") && daysBetween(c.received_at, today) > COMPLAINT_RESOLVE_DAYS,
  }));
}

// ── Incidents ─────────────────────────────────────────────────────────────

export interface IncidentInput {
  occurredAt: string; location: string; department?: string | null; episodeId?: string | null;
  incidentType: string; outcomeClass: OutcomeClass; harm: string; description: string; immediateAction?: string | null;
  /** Non-punitive reporting: the reporter's name is not stored. */
  anonymous?: boolean;
}

function checkClass(type: string, harm: string, cls: OutcomeClass) {
  const order: OutcomeClass[] = ["near_miss", "no_harm", "adverse_event", "sentinel"];
  const min = minimumClass(type, harm);
  if (min && order.indexOf(cls) < order.indexOf(min)) {
    throw new Error(min === "sentinel" ? `${harm === "Death" || harm === "Severe" ? `${harm} harm` : type} is a sentinel event.` : `${harm} harm is an adverse event, not a near miss or no-harm incident.`);
  }
  if ((cls === "near_miss" || cls === "no_harm") && harm !== "None") throw new Error("A near miss or no-harm incident has harm: None.");
}

/** Any staff member reports an incident, near miss or sentinel event. */
export async function reportIncident(i: IncidentInput): Promise<Incident> {
  const a = await currentActor();
  if (!(INCIDENT_TYPES as readonly string[]).includes(i.incidentType)) throw new Error("Choose the type of incident.");
  if (!OUTCOME_CLASSES[i.outcomeClass]) throw new Error("Choose whether it was a near miss, no harm, adverse event or sentinel event.");
  if (!(HARM_LEVELS as readonly string[]).includes(i.harm)) throw new Error("Choose the harm to the patient.");
  if (!i.occurredAt) throw new Error("Enter when it happened.");
  if (!i.location?.trim()) throw new Error("Enter where it happened.");
  if (!i.description?.trim()) throw new Error("Describe what happened.");
  checkClass(i.incidentType, i.harm, i.outcomeClass);
  const ep = i.episodeId ? await hospitalEpisodesRepo.get(i.episodeId) : null;
  if (i.episodeId && !ep) throw new Error("Visit not found.");
  const sentinel = i.outcomeClass === "sentinel";
  return incidentsRepo.create({
    incident_no: await nextSerial("hospital_incidents", "incident_no", "INC"), occurred_at: i.occurredAt, reported_at: nowIso(),
    reporter_name: i.anonymous ? null : stamp(a), location: i.location.trim(), department: i.department?.trim() || ep?.department || null,
    patient_id: ep?.patient_id ?? null, episode_id: ep?.id ?? null, incident_type: i.incidentType, outcome_class: i.outcomeClass, harm: i.harm,
    description: i.description.trim(), immediate_action: i.immediateAction?.trim() || null,
    status: sentinel ? "rca" : "reported", rca_due_on: sentinel ? addDays(localDate(), SENTINEL_RCA_DAYS) : null,
  } as Partial<Incident>);
}

async function incident(id: string): Promise<Incident> {
  const x = await incidentsRepo.get(id);
  if (!x) throw new Error("Incident not found.");
  return x;
}

/** The quality team reviews and may reclassify; an RCA can be called for any
 * incident and is always required for a sentinel event. */
export async function reviewIncident(id: string, r: { outcomeClass: OutcomeClass; harm: string; notes: string; requireRca?: boolean }): Promise<Incident> {
  const a = await needQuality();
  const x = await incident(id);
  if (x.status === "closed") throw new Error("This incident is closed.");
  if (!OUTCOME_CLASSES[r.outcomeClass] || !(HARM_LEVELS as readonly string[]).includes(r.harm)) throw new Error("Choose the class and the harm.");
  if (!r.notes?.trim()) throw new Error("Write the review findings.");
  checkClass(x.incident_type, r.harm, r.outcomeClass);
  const rca = r.outcomeClass === "sentinel" || !!r.requireRca || x.status === "rca";
  return (await incidentsRepo.update(id, {
    outcome_class: r.outcomeClass, harm: r.harm, review_notes: r.notes.trim(), reviewed_by_name: stamp(a), reviewed_at: nowIso(),
    status: rca ? "rca" : "under_review", rca_due_on: rca ? x.rca_due_on ?? addDays(localDate(), SENTINEL_RCA_DAYS) : null,
  }))!;
}

export async function recordRca(id: string, r: { team: string; rootCauses: string; summary: string }): Promise<Incident> {
  const a = await needQuality();
  const x = await incident(id);
  if (x.status !== "rca") throw new Error("A root cause analysis is not open on this incident.");
  if (!r.team?.trim()) throw new Error("List the RCA team.");
  if (!r.rootCauses?.trim()) throw new Error("Record the root causes found.");
  if (!r.summary?.trim()) throw new Error("Write the RCA summary.");
  return (await incidentsRepo.update(id, { rca_team: r.team.trim(), root_causes: r.rootCauses.trim(), rca_summary: r.summary.trim(), rca_completed_at: nowIso(), reviewed_by_name: x.reviewed_by_name ?? stamp(a) }))!;
}

export async function closeIncident(id: string): Promise<Incident> {
  const a = await needQuality();
  const x = await incident(id);
  if (x.status === "closed") throw new Error("This incident is already closed.");
  if (x.status === "reported") throw new Error("Review the incident before closing it.");
  if (x.status === "rca") {
    if (!x.rca_completed_at) throw new Error("Finish the root cause analysis before closing.");
    const capas = await capaRepo.list({ where: "source = 'incident' AND source_id = ?", params: [id] });
    if (!capas.length) throw new Error("Raise at least one corrective or preventive action from the RCA before closing.");
  }
  return (await incidentsRepo.update(id, { status: "closed", closed_at: nowIso(), closed_by_name: stamp(a) }))!;
}

export interface IncidentRow extends Incident {
  rca_overdue: boolean;
  capa_count: number;
  capa_open: number;
}
export async function listIncidents(opts: { status?: Incident["status"] | "" | "active"; outcomeClass?: OutcomeClass | "" } = {}, today: string = localDate()): Promise<IncidentRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status === "active") where.push("status != 'closed'");
  else if (opts.status) { where.push("status = ?"); params.push(opts.status); }
  if (opts.outcomeClass) { where.push("outcome_class = ?"); params.push(opts.outcomeClass); }
  const rows = await incidentsRepo.list({ where: where.join(" AND "), params, orderBy: "occurred_at DESC" });
  const capas = await capaRepo.list({ where: "source = 'incident'" });
  return rows.map((x) => {
    const mine = capas.filter((c) => c.source_id === x.id);
    return {
      ...x,
      rca_overdue: x.status === "rca" && !x.rca_completed_at && !!x.rca_due_on && x.rca_due_on < today,
      capa_count: mine.length,
      capa_open: mine.filter((c) => c.status !== "verified").length,
    };
  });
}

// ── CAPA ──────────────────────────────────────────────────────────────────

export interface CapaInput {
  source: Capa["source"]; sourceId?: string | null; problem: string; actionType: Capa["action_type"]; action: string; ownerName: string; dueOn: string;
}

export async function raiseCapa(c: CapaInput): Promise<Capa> {
  const a = await needQuality();
  if (!CAPA_SOURCES[c.source]) throw new Error("Choose where the action comes from.");
  if (c.actionType !== "corrective" && c.actionType !== "preventive") throw new Error("Choose corrective or preventive.");
  if (!c.problem?.trim() || !c.action?.trim()) throw new Error("Describe the problem and the action.");
  if (!c.ownerName?.trim()) throw new Error("Enter who owns the action.");
  if (!isDate(c.dueOn)) throw new Error("Enter the due date.");
  if (c.source === "incident" || c.source === "complaint") {
    if (!c.sourceId) throw new Error(`Choose the ${c.source}.`);
    const src = c.source === "incident" ? await incidentsRepo.get(c.sourceId) : await complaintsRepo.get(c.sourceId);
    if (!src) throw new Error(`The ${c.source} was not found.`);
  }
  return capaRepo.create({
    capa_no: await nextSerial("hospital_capa", "capa_no", "CAPA"), source: c.source, source_id: c.sourceId ?? null, problem: c.problem.trim(),
    action_type: c.actionType, action: c.action.trim(), owner_name: c.ownerName.trim(), due_on: c.dueOn, status: "open", raised_by_name: stamp(a),
  } as Partial<Capa>);
}

/** The owner (or the quality team for them) records the action as done, with the evidence. */
export async function markCapaDone(id: string, note: string): Promise<Capa> {
  const a = await currentActor();
  const c = await capaRepo.get(id);
  if (!c) throw new Error("Action not found.");
  if (c.status !== "open") throw new Error("This action is not open.");
  if (!note?.trim()) throw new Error("Record what was done (the evidence).");
  return (await capaRepo.update(id, { status: "done", done_at: nowIso(), done_by_name: stamp(a), done_note: note.trim() }))!;
}

/** The quality team checks that the action worked. Not by the person who did it. */
export async function verifyCapa(id: string, v: { effective: boolean; note: string }): Promise<Capa> {
  const a = await needQuality();
  const c = await capaRepo.get(id);
  if (!c) throw new Error("Action not found.");
  if (c.status !== "done") throw new Error("Only an action recorded as done is verified.");
  if (c.done_by_name === stamp(a)) throw new Error("The action is verified by someone other than the person who did it.");
  if (!v.note?.trim()) throw new Error("Record how effectiveness was checked.");
  const line = `${localDate()} ${v.effective ? "Effective" : "Not effective"}: ${v.note.trim()} (${stamp(a)})`;
  const effectiveness = [c.effectiveness, line].filter(Boolean).join("\n");
  return (await capaRepo.update(id, v.effective
    ? { status: "verified", verified_at: nowIso(), verified_by_name: stamp(a), effectiveness }
    : { status: "open", done_at: null, done_by_name: null, effectiveness }))!;
}

export interface CapaRow extends Capa {
  overdue: boolean;
  source_ref: string | null;
}
export async function listCapa(opts: { status?: Capa["status"] | "" | "active"; source?: Capa["source"]; sourceId?: string } = {}, today: string = localDate()): Promise<CapaRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status === "active") where.push("status != 'verified'");
  else if (opts.status) { where.push("status = ?"); params.push(opts.status); }
  if (opts.source) { where.push("source = ?"); params.push(opts.source); }
  if (opts.sourceId) { where.push("source_id = ?"); params.push(opts.sourceId); }
  const rows = await capaRepo.list({ where: where.join(" AND "), params, orderBy: "due_on ASC" });
  const inc = new Map((await incidentsRepo.list()).map((x) => [x.id, x.incident_no]));
  const cmp = new Map((await complaintsRepo.list()).map((x) => [x.id, x.complaint_no]));
  return rows.map((c) => ({
    ...c,
    overdue: c.status === "open" && c.due_on < today,
    source_ref: c.source_id ? inc.get(c.source_id) ?? cmp.get(c.source_id) ?? null : null,
  }));
}

// ── Indicators ────────────────────────────────────────────────────────────

export interface QualityIndicators {
  incidents: number;
  byClass: Record<OutcomeClass, number>;
  sentinel: number;
  rcaOverdue: number;
  rcaOnTimePct: number | null;
  complaints: number;
  complaintsAckInTargetPct: number | null;
  complaintsResolvedInTargetPct: number | null;
  complaintsOpen: number;
  byCategory: { category: string; n: number }[];
  capaOpen: number;
  capaOverdue: number;
  capaEffectivePct: number | null;
  critical: number;
  criticalPending: number;
  criticalInTargetPct: number | null;
  criticalMedianMin: number | null;
}

export async function qualityIndicators(range: { from: string; to: string }, today: string = localDate()): Promise<QualityIndicators> {
  const end = `${range.to}~`;
  const incidents = await incidentsRepo.list({ where: "occurred_at >= ? AND occurred_at <= ?", params: [range.from, end] });
  const byClass = { near_miss: 0, no_harm: 0, adverse_event: 0, sentinel: 0 } as Record<OutcomeClass, number>;
  for (const x of incidents) byClass[x.outcome_class] = (byClass[x.outcome_class] ?? 0) + 1;
  const rcas = incidents.filter((x) => x.rca_due_on);
  const rcaDone = rcas.filter((x) => x.rca_completed_at);
  const complaints = await complaintsRepo.list({ where: "received_at >= ? AND received_at <= ?", params: [range.from, end] });
  const ackIn = complaints.filter((c) => c.acknowledged_at && daysBetween(c.received_at, c.acknowledged_at) <= COMPLAINT_ACK_DAYS).length;
  const resIn = complaints.filter((c) => c.resolved_at && daysBetween(c.received_at, c.resolved_at) <= COMPLAINT_RESOLVE_DAYS).length;
  const cats = new Map<string, number>();
  for (const c of complaints) cats.set(c.category, (cats.get(c.category) ?? 0) + 1);
  const capas = await capaRepo.list();
  const checked = capas.filter((c) => c.effectiveness);
  const firstTimeEffective = checked.filter((c) => c.status === "verified" && !/Not effective/.test(c.effectiveness ?? "")).length;
  const critical = await criticalAlertsRepo.list({ where: "detected_at >= ? AND detected_at <= ?", params: [range.from, end] });
  const times = critical.filter((c) => c.notified_at).map((c) => Math.max(0, minutesBetween(c.detected_at, c.notified_at) ?? 0));
  return {
    incidents: incidents.length,
    byClass,
    sentinel: byClass.sentinel,
    rcaOverdue: rcas.filter((x) => !x.rca_completed_at && x.rca_due_on! < today).length,
    rcaOnTimePct: pct(rcaDone.filter((x) => x.rca_completed_at!.slice(0, 10) <= x.rca_due_on!).length, rcas.length),
    complaints: complaints.length,
    complaintsAckInTargetPct: pct(ackIn, complaints.length),
    complaintsResolvedInTargetPct: pct(resIn, complaints.length),
    complaintsOpen: complaints.filter((c) => c.status !== "closed").length,
    byCategory: [...cats].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n),
    capaOpen: capas.filter((c) => c.status !== "verified").length,
    capaOverdue: capas.filter((c) => c.status === "open" && c.due_on < today).length,
    capaEffectivePct: pct(firstTimeEffective, checked.length),
    critical: critical.length,
    criticalPending: critical.filter((c) => c.status === "pending").length,
    criticalInTargetPct: pct(times.filter((t) => t <= CRITICAL_NOTIFY_MINUTES).length, critical.length),
    criticalMedianMin: median(times),
  };
}
