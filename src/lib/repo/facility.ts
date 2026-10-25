/** Facility management and safety (MSDS FMS, ROM): the equipment register
 * with preventive maintenance, calibration and breakdowns; the hospital's
 * licences and certificates with their expiry; and mock drills.
 *
 * A failed check or a breakdown takes the equipment out of service. It goes
 * back into service only when a person records it, and only when no
 * breakdown is open and the latest maintenance and calibration passed. */
import { createTenantRepo } from "./base";
import { localDate } from "../localDate";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { nextSerial, stamp } from "./emergency";
import { FACILITY_ROLES, DRILL_ROLES, QUALITY_ROLES } from "../../config/hospitalStaff";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_LOG_KINDS, DUE_SOON_DAYS, LICENCE_KINDS, LICENCE_WARN_DAYS, DRILL_KINDS, SHIFTS, type EquipmentLogKind } from "../../config/facility";
import type { Drill, Equipment, EquipmentLog, Licence } from "../types-hospital";

export const equipmentRepo = createTenantRepo<Equipment>("hospital_equipment");
export const equipmentLogsRepo = createTenantRepo<EquipmentLog>("hospital_equipment_logs", { refs: [["equipment_id", "hospital_equipment", "Equipment"]] });
export const licencesRepo = createTenantRepo<Licence>("hospital_licences");
export const drillsRepo = createTenantRepo<Drill>("hospital_drills");

async function needFacility(extra: string[] = []): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed([...FACILITY_ROLES, ...extra], a)) throw new Error("Only the facility manager / biomedical engineer does this.");
  return a;
}
const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const daysUntil = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
const posInt = (n: number | null | undefined, label: string) => {
  if (n === null || n === undefined || (n as unknown) === "") return null;
  if (!Number.isInteger(Number(n)) || Number(n) <= 0) throw new Error(`${label} must be a whole number of days.`);
  return Number(n);
};

export type DueState = "ok" | "soon" | "overdue" | "never" | "na";
/** When a periodic check is next due, and whether it is late. */
export function dueState(lastDone: string | null, intervalDays: number | null, today: string): { due: string | null; state: DueState } {
  if (!intervalDays) return { due: null, state: "na" };
  if (!lastDone) return { due: null, state: "never" };
  const due = addDays(lastDone, intervalDays);
  const left = daysUntil(due, today);
  return { due, state: left < 0 ? "overdue" : left <= DUE_SOON_DAYS ? "soon" : "ok" };
}

// ── Equipment ─────────────────────────────────────────────────────────────

export interface EquipmentInput {
  assetNo?: string | null; name: string; category: string; make?: string | null; model?: string | null; serialNo?: string | null;
  department?: string | null; location?: string | null; supplier?: string | null; purchasedOn?: string | null; cost?: number | null;
  warrantyUntil?: string | null; amcVendor?: string | null; amcUntil?: string | null; isCritical?: boolean;
  ppmIntervalDays?: number | null; calibrationIntervalDays?: number | null; notes?: string | null;
}

export async function saveEquipment(id: string | null, e: EquipmentInput): Promise<Equipment> {
  await needFacility();
  if (!e.name?.trim()) throw new Error("Enter the equipment name.");
  if (!(EQUIPMENT_CATEGORIES as readonly string[]).includes(e.category)) throw new Error("Choose the category.");
  for (const [d, l] of [[e.purchasedOn, "purchase date"], [e.warrantyUntil, "warranty date"], [e.amcUntil, "maintenance contract date"]] as const) {
    if (d && !isDate(d)) throw new Error(`Check the ${l}.`);
  }
  const ppm = posInt(e.ppmIntervalDays, "Preventive maintenance interval");
  const cal = posInt(e.calibrationIntervalDays, "Calibration interval");
  if (e.isCritical && !ppm) throw new Error("Critical equipment needs a preventive maintenance interval.");
  const assetNo = e.assetNo?.trim().toUpperCase() || (id ? null : await nextSerial("hospital_equipment", "asset_no", "EQ"));
  const payload: Partial<Equipment> = {
    name: e.name.trim(), category: e.category, make: e.make?.trim() || null, model: e.model?.trim() || null, serial_no: e.serialNo?.trim() || null,
    department: e.department?.trim() || null, location: e.location?.trim() || null, supplier: e.supplier?.trim() || null,
    purchased_on: e.purchasedOn || null, cost: e.cost ?? null, warranty_until: e.warrantyUntil || null, amc_vendor: e.amcVendor?.trim() || null,
    amc_until: e.amcUntil || null, is_critical: e.isCritical ? 1 : 0, ppm_interval_days: ppm, calibration_interval_days: cal, notes: e.notes?.trim() || null,
  };
  if (assetNo) payload.asset_no = assetNo;
  try {
    const saved = id ? await equipmentRepo.update(id, payload) : await equipmentRepo.create({ ...payload, status: "in_service" });
    if (!saved) throw new Error("Equipment not found.");
    return saved;
  } catch (err) {
    if (/UNIQUE/i.test(String(err instanceof Error ? err.message : err))) throw new Error(`Asset number ${assetNo} is already used.`);
    throw err;
  }
}

async function equipment(id: string): Promise<Equipment> {
  const e = await equipmentRepo.get(id);
  if (!e) throw new Error("Equipment not found.");
  return e;
}

export interface LogInput {
  kind: EquipmentLogKind; performedOn: string; performedBy?: string | null; result?: "pass" | "fail" | null;
  certificateRef?: string | null; description?: string | null;
}

/** Preventive maintenance, calibration, a breakdown, or a repair. */
export async function recordEquipmentLog(equipmentId: string, l: LogInput): Promise<EquipmentLog> {
  const a = await needFacility();
  const e = await equipment(equipmentId);
  if (e.status === "condemned") throw new Error("This equipment is condemned.");
  if (!EQUIPMENT_LOG_KINDS[l.kind]) throw new Error("Choose what is being recorded.");
  if (!isDate(l.performedOn)) throw new Error("Enter the date.");
  if (l.performedOn > localDate()) throw new Error("The date cannot be in the future.");
  const periodic = l.kind === "ppm" || l.kind === "calibration";
  if (periodic && l.result !== "pass" && l.result !== "fail") throw new Error("Record whether it passed or failed.");
  if (periodic && !l.performedBy?.trim()) throw new Error("Enter who did it (engineer or company).");
  if (l.kind === "calibration" && l.result === "pass" && !l.certificateRef?.trim()) throw new Error("Enter the calibration certificate number.");
  if ((l.kind === "breakdown" || l.kind === "repair" || l.result === "fail") && !l.description?.trim()) throw new Error("Describe the fault or the work done.");
  if (l.kind === "breakdown" && (await openBreakdown(equipmentId))) throw new Error("A breakdown is already open on this equipment.");
  const log = await equipmentLogsRepo.create({
    equipment_id: equipmentId, kind: l.kind, performed_on: l.performedOn, performed_by: l.performedBy?.trim() || null, result: periodic ? l.result! : null,
    certificate_ref: l.certificateRef?.trim() || null, description: l.description?.trim() || null, restored_on: null, recorded_by_name: stamp(a),
  } as Partial<EquipmentLog>);
  if (l.kind === "breakdown" || l.result === "fail") await equipmentRepo.update(equipmentId, { status: "out_of_service" });
  if (l.kind === "repair") {
    const open = await openBreakdown(equipmentId);
    if (open) await equipmentLogsRepo.update(open.id, { restored_on: l.performedOn });
  }
  return log;
}

async function openBreakdown(equipmentId: string): Promise<EquipmentLog | null> {
  return (await equipmentLogsRepo.list({ where: "equipment_id = ? AND kind = 'breakdown' AND restored_on IS NULL", params: [equipmentId] }))[0] ?? null;
}
const latest = (logs: EquipmentLog[], kind: EquipmentLogKind) => logs.filter((x) => x.kind === kind).sort((x, y) => y.performed_on.localeCompare(x.performed_on) || y.created_at.localeCompare(x.created_at))[0] ?? null;

/** A person puts the equipment back into service once it is safe to use. */
export async function returnToService(equipmentId: string): Promise<Equipment> {
  await needFacility();
  const e = await equipment(equipmentId);
  if (e.status !== "out_of_service") throw new Error("This equipment is not out of service.");
  if (await openBreakdown(equipmentId)) throw new Error("Record the repair of the open breakdown first.");
  const logs = await equipmentLogs(equipmentId);
  for (const kind of ["ppm", "calibration"] as const) {
    const last = latest(logs, kind);
    if (last?.result === "fail") throw new Error(`The last ${EQUIPMENT_LOG_KINDS[kind].toLowerCase()} failed. Record a passing one first.`);
  }
  return (await equipmentRepo.update(equipmentId, { status: "in_service" }))!;
}

export async function condemnEquipment(equipmentId: string, reason: string): Promise<Equipment> {
  await needFacility();
  const e = await equipment(equipmentId);
  if (e.status === "condemned") throw new Error("Already condemned.");
  if (!reason?.trim()) throw new Error("Give the reason (beyond economical repair, obsolete…).");
  return (await equipmentRepo.update(equipmentId, { status: "condemned", condemned_on: localDate(), condemned_reason: reason.trim() }))!;
}

export async function equipmentLogs(equipmentId: string): Promise<EquipmentLog[]> {
  return equipmentLogsRepo.list({ where: "equipment_id = ?", params: [equipmentId], orderBy: "performed_on DESC, created_at DESC" });
}

export interface EquipmentRow extends Equipment {
  ppm: { last: string | null; due: string | null; state: DueState };
  calibration: { last: string | null; due: string | null; state: DueState };
  breakdown_open: boolean;
}

export async function listEquipment(opts: { status?: Equipment["status"] | "" | "active"; search?: string } = {}, today: string = localDate()): Promise<EquipmentRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status === "active") where.push("status != 'condemned'");
  else if (opts.status) { where.push("status = ?"); params.push(opts.status); }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    where.push("(asset_no LIKE ? OR name LIKE ? OR serial_no LIKE ? OR department LIKE ? OR location LIKE ?)");
    params.push(q, q, q, q, q);
  }
  const rows = await equipmentRepo.list({ where: where.join(" AND "), params, orderBy: "asset_no ASC" });
  const logs = await equipmentLogsRepo.list({ orderBy: "performed_on DESC" });
  return rows.map((e) => {
    const mine = logs.filter((l) => l.equipment_id === e.id);
    // The clock restarts only on a passing check.
    const lastPass = (kind: EquipmentLogKind) => mine.filter((l) => l.kind === kind && l.result === "pass").sort((x, y) => y.performed_on.localeCompare(x.performed_on))[0]?.performed_on ?? null;
    const ppmLast = lastPass("ppm");
    const calLast = lastPass("calibration");
    const condemned = e.status === "condemned";
    return {
      ...e,
      ppm: { last: ppmLast, ...(condemned ? { due: null, state: "na" as DueState } : dueState(ppmLast, e.ppm_interval_days, today)) },
      calibration: { last: calLast, ...(condemned ? { due: null, state: "na" as DueState } : dueState(calLast, e.calibration_interval_days, today)) },
      breakdown_open: mine.some((l) => l.kind === "breakdown" && !l.restored_on),
    };
  });
}

// ── Licences ──────────────────────────────────────────────────────────────

export interface LicenceInput {
  kind: string; number?: string | null; issuedBy?: string | null; issuedOn?: string | null; expiresOn?: string | null;
  responsible?: string | null; documentRef?: string | null; notes?: string | null;
}

function licencePayload(l: LicenceInput): Partial<Licence> {
  if (!LICENCE_KINDS.some((k) => k.key === l.kind)) throw new Error("Choose the licence or certificate.");
  if (!l.number?.trim()) throw new Error("Enter the licence / certificate number.");
  if (l.issuedOn && !isDate(l.issuedOn)) throw new Error("Check the issue date.");
  if (l.expiresOn && !isDate(l.expiresOn)) throw new Error("Check the expiry date.");
  if (l.issuedOn && l.expiresOn && l.expiresOn <= l.issuedOn) throw new Error("The expiry date must be after the issue date.");
  return {
    kind: l.kind, number: l.number.trim(), issued_by: l.issuedBy?.trim() || null, issued_on: l.issuedOn || null, expires_on: l.expiresOn || null,
    responsible: l.responsible?.trim() || null, document_ref: l.documentRef?.trim() || null, notes: l.notes?.trim() || null,
  };
}

export async function saveLicence(id: string | null, l: LicenceInput): Promise<Licence> {
  const a = await needFacility(QUALITY_ROLES);
  const payload = licencePayload(l);
  if (id) {
    const old = await licencesRepo.get(id);
    if (!old) throw new Error("Licence not found.");
    if (old.superseded_by) throw new Error("This licence was renewed; edit the renewal.");
    return (await licencesRepo.update(id, payload))!;
  }
  return licencesRepo.create({ ...payload, superseded_by: null, recorded_by_name: stamp(a) });
}

/** A renewal keeps the old licence in the history and replaces it. */
export async function renewLicence(id: string, l: LicenceInput): Promise<Licence> {
  const a = await needFacility(QUALITY_ROLES);
  const old = await licencesRepo.get(id);
  if (!old) throw new Error("Licence not found.");
  if (old.superseded_by) throw new Error("This licence is already renewed.");
  const payload = licencePayload({ ...l, kind: old.kind });
  if (old.expires_on && payload.expires_on && payload.expires_on <= old.expires_on) throw new Error("The renewal must expire after the current licence.");
  const renewed = await licencesRepo.create({ ...payload, superseded_by: null, recorded_by_name: stamp(a) });
  await licencesRepo.update(id, { superseded_by: renewed.id });
  return renewed;
}

export type LicenceState = "valid" | "expiring" | "expired" | "no_expiry";
export interface LicenceRow extends Licence { state: LicenceState; days_left: number | null; label: string }

export async function listLicences(today: string = localDate()): Promise<{ current: LicenceRow[]; missing: string[]; history: Licence[] }> {
  const all = await licencesRepo.list({ orderBy: "expires_on ASC" });
  const current = all.filter((l) => !l.superseded_by).map((l): LicenceRow => {
    const days = l.expires_on ? daysUntil(l.expires_on, today) : null;
    return {
      ...l, label: LICENCE_KINDS.find((k) => k.key === l.kind)?.label ?? l.kind, days_left: days,
      state: days === null ? "no_expiry" : days < 0 ? "expired" : days <= LICENCE_WARN_DAYS ? "expiring" : "valid",
    };
  });
  const missing = LICENCE_KINDS.filter((k) => k.required && !current.some((l) => l.kind === k.key)).map((k) => k.label);
  return { current, missing, history: all.filter((l) => l.superseded_by) };
}

// ── Drills ────────────────────────────────────────────────────────────────

export interface DrillInput {
  kind: string; heldOn: string; shift?: string | null; location: string; scenario?: string | null; participants?: number | null;
  responseMin?: number | null; observations?: string | null; gaps?: string | null; conductedBy?: string | null;
}

export async function recordDrill(d: DrillInput): Promise<Drill> {
  const a = await currentActor();
  if (!roleAllowed(DRILL_ROLES, a)) throw new Error("Drills are recorded by the facility manager, quality team or Nursing Superintendent.");
  if (!DRILL_KINDS.some((k) => k.key === d.kind)) throw new Error("Choose the drill.");
  if (!isDate(d.heldOn) || d.heldOn > localDate()) throw new Error("Enter the date the drill was held (not in the future).");
  if (!d.location?.trim()) throw new Error("Enter where it was held.");
  if (d.shift && !(SHIFTS as readonly string[]).includes(d.shift)) throw new Error("Choose the shift.");
  if (!d.observations?.trim()) throw new Error("Record what was observed.");
  if (d.participants != null && (!Number.isInteger(Number(d.participants)) || Number(d.participants) < 1)) throw new Error("Check the number of participants.");
  return drillsRepo.create({
    kind: d.kind, held_on: d.heldOn, shift: d.shift || null, location: d.location.trim(), scenario: d.scenario?.trim() || null,
    participants: d.participants ?? null, response_min: d.responseMin ?? null, observations: d.observations.trim(), gaps: d.gaps?.trim() || null,
    conducted_by: d.conductedBy?.trim() || null, recorded_by_name: stamp(a),
  });
}

export async function listDrills(): Promise<Drill[]> {
  return drillsRepo.list({ orderBy: "held_on DESC" });
}

/** Each drill: when it was last held and when the next is due. */
export async function drillSchedule(today: string = localDate()): Promise<{ key: string; label: string; everyDays: number; last: string | null; due: string | null; state: DueState }[]> {
  const drills = await listDrills();
  return DRILL_KINDS.map((k) => {
    const last = drills.find((d) => d.kind === k.key)?.held_on ?? null;
    return { ...k, last, ...dueState(last, k.everyDays, today) };
  });
}
