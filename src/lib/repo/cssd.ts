/** Sterilization (MSDS IPC-2 Ind. 90-92): autoclaves, cycles (loads) with
 * their physical, chemical and biological indicator results, release by an
 * authorized verifier who did not run the cycle, failure, recall, and the
 * instrument sets of each load traced to the surgeries they were used in.
 *
 * A load is usable only when it is released, not expired and not recalled.
 * A failed or unverified cycle is never shown as ready: it stays "awaiting
 * release" or "failed" until the release process is followed. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { localDate } from "../localDate";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { staffRepo } from "./staff";
import { surgeryBookingsRepo } from "./hospitalCare";
import { CSSD_OPERATOR_ROLES, CSSD_RELEASE_ROLES } from "../../config/hospitalStaff";
import type { SterilCycle, SterilEquipment, SterilItem, SterilUsage } from "../types-hospital";

export const sterilEquipmentRepo = createTenantRepo<SterilEquipment>("hospital_steril_equipment");
export const sterilCyclesRepo = createTenantRepo<SterilCycle>("hospital_steril_cycles", { refs: [["equipment_id", "hospital_steril_equipment", "Steriliser"]] });
export const sterilItemsRepo = createTenantRepo<SterilItem>("hospital_steril_items", { refs: [["cycle_id", "hospital_steril_cycles", "Cycle"]] });
export const sterilUsageRepo = createTenantRepo<SterilUsage>("hospital_steril_usage", {
  refs: [["item_id", "hospital_steril_items", "Instrument set"], ["cycle_id", "hospital_steril_cycles", "Cycle"], ["booking_id", "hospital_surgery_bookings", "Surgery"], ["patient_id", "hospital_patients", "Patient"]],
});

export const STERILISER_KINDS: Record<SterilEquipment["kind"], string> = {
  steam_autoclave: "Steam autoclave", eto: "Ethylene oxide (ETO)", plasma: "Hydrogen peroxide plasma", dry_heat: "Dry heat", other: "Other",
};
export const CYCLE_STATUS: Record<SterilCycle["status"], string> = {
  awaiting_release: "Awaiting release", released: "Released", failed: "Failed", recalled: "Recalled",
};

const stamp = (a: Actor) => (a.designation ? `${a.name}, ${a.designation}` : a.name);
async function myStaffId(a: Actor): Promise<string | null> {
  return a.userId ? (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0]?.id ?? null : null;
}
const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

// ── Sterilisers ───────────────────────────────────────────────────────────

export async function saveSteriliser(id: string | null, e: { code: string; name: string; kind: SterilEquipment["kind"]; location?: string | null; is_active?: number; notes?: string | null }): Promise<SterilEquipment> {
  const a = await currentActor();
  if (!roleAllowed([...CSSD_RELEASE_ROLES], a)) throw new Error("The CSSD supervisor or infection control nurse manages sterilisers.");
  if (!e.code?.trim() || !e.name?.trim()) throw new Error("Enter the steriliser's code and name.");
  if (!STERILISER_KINDS[e.kind]) throw new Error("Choose the type of steriliser.");
  const payload = { code: e.code.trim().toUpperCase(), name: e.name.trim(), kind: e.kind, location: e.location?.trim() || null, is_active: e.is_active ?? 1, notes: e.notes?.trim() || null };
  try {
    const saved = id ? await sterilEquipmentRepo.update(id, payload) : await sterilEquipmentRepo.create(payload);
    if (!saved) throw new Error("Steriliser not found.");
    return saved;
  } catch (err) {
    if (/UNIQUE/i.test(String(err instanceof Error ? err.message : err))) throw new Error(`Code ${payload.code} is already used by another steriliser.`);
    throw err;
  }
}

export async function listSterilisers(): Promise<SterilEquipment[]> {
  return sterilEquipmentRepo.list({ orderBy: "code ASC" });
}

// ── Cycles ────────────────────────────────────────────────────────────────

async function nextCycleNo(equipmentId: string, day: string): Promise<string> {
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) AS n FROM hospital_steril_cycles WHERE tenant_id = ? AND equipment_id = ? AND substr(started_at, 1, 10) = ?`,
    [requireCurrentTenantId(), equipmentId, day]
  );
  return `${day.replace(/-/g, "")}-${String((rows[0]?.n ?? 0) + 1).padStart(2, "0")}`;
}

export interface StartCycleInput {
  equipmentId: string;
  program?: string | null;
  loadDescription?: string | null;
  /** An implant load is released only after a passed biological indicator. */
  implantLoad?: boolean;
  items: { set_name: string; set_code?: string | null; quantity?: number }[];
  /** A failed or recalled cycle whose items are being sterilized again. */
  reprocessOf?: string | null;
}

export async function startCycle(input: StartCycleInput): Promise<SterilCycle> {
  const a = await currentActor();
  if (!roleAllowed(CSSD_OPERATOR_ROLES, a)) throw new Error("Only CSSD staff run sterilization cycles.");
  const eq = await sterilEquipmentRepo.get(input.equipmentId);
  if (!eq || !eq.is_active) throw new Error("Choose an active steriliser.");
  const items = input.items.filter((i) => i.set_name?.trim());
  if (!items.length) throw new Error("List the instrument sets in the load.");
  if (input.reprocessOf) {
    const old = await sterilCyclesRepo.get(input.reprocessOf);
    if (!old || (old.status !== "failed" && old.status !== "recalled")) throw new Error("Only a failed or recalled load is reprocessed.");
  }
  const today = localDate();
  const cycle = await sterilCyclesRepo.create({
    equipment_id: eq.id, cycle_no: await nextCycleNo(eq.id, today), started_at: nowIso(), ended_at: null,
    operator_id: await myStaffId(a), operator_name: stamp(a), program: input.program?.trim() || null,
    temperature_c: null, pressure_kpa: null, exposure_min: null, load_description: input.loadDescription?.trim() || null,
    implant_load: input.implantLoad ? 1 : 0, physical_result: null, chemical_result: null, biological_result: null,
    status: "awaiting_release", sterilized_on: null, expires_on: null, released_by_id: null, released_by_name: null, released_at: null,
    failure_reason: null, corrective_action: null, failed_by_name: null, failed_at: null,
    recall_reason: null, recalled_by_name: null, recalled_at: null, reprocessed_in_cycle_id: null,
  } as Partial<SterilCycle>);
  for (const i of items) await sterilItemsRepo.create({ cycle_id: cycle.id, set_name: i.set_name.trim(), set_code: i.set_code?.trim() || null, quantity: Math.max(1, Number(i.quantity) || 1) });
  if (input.reprocessOf) await sterilCyclesRepo.update(input.reprocessOf, { reprocessed_in_cycle_id: cycle.id });
  return cycle;
}

export interface CycleResults {
  temperature_c?: number | null;
  pressure_kpa?: number | null;
  exposure_min?: number | null;
  physical_result?: "pass" | "fail" | null;
  chemical_result?: "pass" | "fail" | null;
  biological_result?: "pending" | "pass" | "fail" | "na" | null;
  sterilized_on?: string | null;
  expires_on?: string | null;
}

/** The operator records what the cycle showed. Results are only changed before release. */
export async function recordCycleResults(cycleId: string, r: CycleResults): Promise<SterilCycle> {
  const c = await sterilCyclesRepo.get(cycleId);
  if (!c) throw new Error("Cycle not found.");
  if (c.status !== "awaiting_release") throw new Error("This load is no longer awaiting release; its results cannot be changed.");
  const a = await currentActor();
  if (!roleAllowed(CSSD_OPERATOR_ROLES, a)) throw new Error("Only CSSD staff record cycle results.");
  for (const [k, v] of [["sterilized_on", r.sterilized_on], ["expires_on", r.expires_on]] as const) if (v && !isDate(v)) throw new Error(`${k === "expires_on" ? "Expiry" : "Sterilization"} date must be a date.`);
  const sterilizedOn = r.sterilized_on ?? c.sterilized_on;
  const expiresOn = r.expires_on ?? c.expires_on;
  if (sterilizedOn && expiresOn && expiresOn <= sterilizedOn) throw new Error("The expiry date must be after the sterilization date.");
  const num = (v: number | null | undefined, lo: number, hi: number, label: string) => {
    if (v == null || (v as unknown) === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`);
    return n;
  };
  return (await sterilCyclesRepo.update(cycleId, {
    ended_at: c.ended_at ?? nowIso(),
    temperature_c: num(r.temperature_c, 20, 250, "Temperature"), pressure_kpa: num(r.pressure_kpa, 0, 600, "Pressure"), exposure_min: num(r.exposure_min, 0, 600, "Exposure time"),
    physical_result: r.physical_result ?? c.physical_result, chemical_result: r.chemical_result ?? c.chemical_result,
    biological_result: r.biological_result ?? c.biological_result, sterilized_on: r.sterilized_on ?? c.sterilized_on, expires_on: r.expires_on ?? c.expires_on,
  }))!;
}

/** A verifier who did not run the cycle releases the load after checking every result. */
export async function releaseCycle(cycleId: string): Promise<SterilCycle> {
  const c = await sterilCyclesRepo.get(cycleId);
  if (!c) throw new Error("Cycle not found.");
  if (c.status !== "awaiting_release") throw new Error(`This load is ${CYCLE_STATUS[c.status].toLowerCase()}; it cannot be released.`);
  const a = await currentActor();
  if (!roleAllowed(CSSD_RELEASE_ROLES, a)) throw new Error("Only the CSSD supervisor, infection control nurse or nursing superintendent releases loads.");
  const me = await myStaffId(a);
  if (me && c.operator_id === me) throw new Error("The person who ran the cycle cannot release it; another authorized person verifies it.");
  if (c.physical_result !== "pass") throw new Error("The physical monitoring (time, temperature, pressure) has not passed.");
  if (c.chemical_result !== "pass") throw new Error("The chemical indicator has not passed.");
  if (c.biological_result === "fail") throw new Error("The biological indicator failed. Mark the cycle as failed.");
  if (c.implant_load && c.biological_result !== "pass") throw new Error("An implant load is released only after the biological indicator has passed.");
  if (!c.sterilized_on || !c.expires_on) throw new Error("Enter the sterilization and expiry dates marked on the packs.");
  return (await sterilCyclesRepo.update(cycleId, { status: "released", released_by_id: me, released_by_name: stamp(a), released_at: nowIso() }))!;
}

export async function failCycle(cycleId: string, reason: string, correctiveAction: string): Promise<SterilCycle> {
  if (!reason?.trim() || !correctiveAction?.trim()) throw new Error("Record what failed and the corrective action.");
  const c = await sterilCyclesRepo.get(cycleId);
  if (!c) throw new Error("Cycle not found.");
  if (c.status !== "awaiting_release") throw new Error("Only a load awaiting release is failed; recall a released load instead.");
  const a = await currentActor();
  if (!roleAllowed([...CSSD_OPERATOR_ROLES, ...CSSD_RELEASE_ROLES], a)) throw new Error("Only CSSD staff record a failed cycle.");
  return (await sterilCyclesRepo.update(cycleId, { status: "failed", failure_reason: reason.trim(), corrective_action: correctiveAction.trim(), failed_by_name: stamp(a), failed_at: nowIso() }))!;
}

/** Recalls a released load (IPC-2 Ind. 92). Its sets can no longer be used;
 * the surgeries they were already used in are listed by recallImpact. */
export async function recallCycle(cycleId: string, reason: string): Promise<SterilCycle> {
  if (!reason?.trim()) throw new Error("Give the reason for the recall.");
  const c = await sterilCyclesRepo.get(cycleId);
  if (!c) throw new Error("Cycle not found.");
  if (c.status !== "released") throw new Error("Only a released load is recalled.");
  const a = await currentActor();
  if (!roleAllowed(CSSD_RELEASE_ROLES, a)) throw new Error("Only the CSSD supervisor, infection control nurse or nursing superintendent recalls loads.");
  return (await sterilCyclesRepo.update(cycleId, { status: "recalled", recall_reason: reason.trim(), recalled_by_name: stamp(a), recalled_at: nowIso() }))!;
}

/** The biological indicator is read after incubation, possibly after release.
 * A failed result on a released load recalls it at once. */
export async function recordBiologicalResult(cycleId: string, result: "pass" | "fail"): Promise<SterilCycle> {
  const c = await sterilCyclesRepo.get(cycleId);
  if (!c) throw new Error("Cycle not found.");
  if (c.biological_result !== "pending" && c.biological_result !== null) throw new Error("The biological indicator result is already recorded.");
  const a = await currentActor();
  if (!roleAllowed([...CSSD_OPERATOR_ROLES, ...CSSD_RELEASE_ROLES], a)) throw new Error("Only CSSD staff record indicator results.");
  if (c.status === "released" && result === "fail") {
    return (await sterilCyclesRepo.update(cycleId, {
      biological_result: "fail", status: "recalled", recall_reason: "Biological indicator failed after release", recalled_by_name: stamp(a), recalled_at: nowIso(),
    }))!;
  }
  return (await sterilCyclesRepo.update(cycleId, { biological_result: result }))!;
}

export interface CycleRow extends SterilCycle { equipment_code: string; equipment_name: string; sets: number; used: number }

export async function listCycles(filter: { status?: SterilCycle["status"]; limit?: number } = {}): Promise<CycleRow[]> {
  const params: unknown[] = [requireCurrentTenantId()];
  if (filter.status) params.push(filter.status);
  params.push(filter.limit ?? 200);
  return dbSelect<CycleRow>(
    `SELECT c.*, e.code AS equipment_code, e.name AS equipment_name,
       (SELECT COUNT(*) FROM hospital_steril_items i WHERE i.cycle_id = c.id AND i.deleted_at IS NULL) AS sets,
       (SELECT COUNT(*) FROM hospital_steril_usage u WHERE u.cycle_id = c.id AND u.deleted_at IS NULL) AS used
     FROM hospital_steril_cycles c JOIN hospital_steril_equipment e ON e.id = c.equipment_id
     WHERE c.tenant_id = ? AND c.deleted_at IS NULL ${filter.status ? "AND c.status = ?" : ""}
     ORDER BY c.started_at DESC LIMIT ?`,
    params
  );
}

export async function listCycleItems(cycleId: string): Promise<SterilItem[]> {
  return sterilItemsRepo.list({ where: "cycle_id = ?", params: [cycleId], orderBy: "created_at ASC" });
}

// ── Traceability ──────────────────────────────────────────────────────────

export interface AvailableSet extends SterilItem { cycle_no: string; equipment_code: string; sterilized_on: string; expires_on: string }

/** Sets that may be used now: released, not expired, not recalled. */
export async function availableSets(): Promise<AvailableSet[]> {
  return dbSelect<AvailableSet>(
    `SELECT i.*, c.cycle_no, c.sterilized_on, c.expires_on, e.code AS equipment_code
     FROM hospital_steril_items i JOIN hospital_steril_cycles c ON c.id = i.cycle_id JOIN hospital_steril_equipment e ON e.id = c.equipment_id
     WHERE i.tenant_id = ? AND i.deleted_at IS NULL AND c.status = 'released' AND c.expires_on >= ?
     ORDER BY i.set_name, c.expires_on`,
    [requireCurrentTenantId(), localDate()]
  );
}

/** Records that a set from a load was used in a surgery: the only way a load is linked to a patient. */
export async function recordSetUsage(bookingId: string, itemId: string): Promise<SterilUsage> {
  const a = await currentActor();
  if (!roleAllowed(["any_clinical", ...CSSD_OPERATOR_ROLES], a)) throw new Error("Only theatre or CSSD staff record the sets used.");
  const b = await surgeryBookingsRepo.get(bookingId);
  if (!b || b.status === "cancelled") throw new Error("Surgery not found.");
  const item = await sterilItemsRepo.get(itemId);
  if (!item) throw new Error("Instrument set not found.");
  const c = await sterilCyclesRepo.get(item.cycle_id);
  if (!c || c.status !== "released") throw new Error(`This set's load is ${c ? CYCLE_STATUS[c.status].toLowerCase() : "unknown"}; it must not be used.`);
  if (!c.expires_on || c.expires_on < localDate()) throw new Error("This set has passed its sterility expiry date; it must not be used.");
  if ((await sterilUsageRepo.list({ where: "item_id = ? AND booking_id = ?", params: [item.id, b.id] })).length) throw new Error("This set is already recorded for this surgery.");
  return sterilUsageRepo.create({ item_id: item.id, cycle_id: c.id, booking_id: b.id, patient_id: b.patient_id, episode_id: b.episode_id, used_at: nowIso(), recorded_by_name: stamp(a) });
}

export interface UsageRow extends SterilUsage { set_name: string; set_code: string | null; cycle_no: string; equipment_code: string; cycle_status: string }

export async function usageForSurgery(bookingId: string): Promise<UsageRow[]> {
  return dbSelect<UsageRow>(
    `SELECT u.*, i.set_name, i.set_code, c.cycle_no, c.status AS cycle_status, e.code AS equipment_code
     FROM hospital_steril_usage u JOIN hospital_steril_items i ON i.id = u.item_id JOIN hospital_steril_cycles c ON c.id = u.cycle_id
     JOIN hospital_steril_equipment e ON e.id = c.equipment_id
     WHERE u.tenant_id = ? AND u.booking_id = ? AND u.deleted_at IS NULL ORDER BY u.used_at`,
    [requireCurrentTenantId(), bookingId]
  );
}

export interface RecallImpact { set_name: string; used_at: string; surgery_name: string; patient_name: string; mr_no: string; episode_no: string }

/** The patients and surgeries a recalled load's sets were actually used in. */
export async function recallImpact(cycleId: string): Promise<RecallImpact[]> {
  return dbSelect<RecallImpact>(
    `SELECT i.set_name, u.used_at, b.surgery_name, p.name AS patient_name, p.mr_no, e.episode_no
     FROM hospital_steril_usage u JOIN hospital_steril_items i ON i.id = u.item_id
     JOIN hospital_surgery_bookings b ON b.id = u.booking_id JOIN hospital_patients p ON p.id = u.patient_id
     JOIN hospital_episodes e ON e.id = u.episode_id
     WHERE u.tenant_id = ? AND u.cycle_id = ? AND u.deleted_at IS NULL ORDER BY u.used_at`,
    [requireCurrentTenantId(), cycleId]
  );
}
