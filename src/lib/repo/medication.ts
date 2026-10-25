/** Inpatient medication orders and the medication administration record
 * (MSDS MOM-1 Ind. 51-57, MOM-3 Ind. 62-71). Orders are rows of
 * hospital_rx_items with order_type 'inpatient'; they are stopped, never
 * replaced. Every administration is written by the person who gave (or did
 * not give) the dose, after they confirm the patient's identity and the
 * medicine, dose, route and time against the order. Nothing is ticked for them. */
import { dbSelect, dbExecute } from "../db";
import { createTenantRepo, friendlyDbError, requireCurrentTenantId } from "./base";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { staffRepo } from "./staff";
import { hospitalEpisodesRepo } from "./hospital";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { DOCTOR_CATEGORIES } from "../../config/hospitalStaff";
import { highRiskGroup, PATIENT_IDENTIFIERS } from "../../config/highRiskMedicines";
import type { HospitalEpisode, HospitalRxItem, MarEntry } from "../types-hospital";

export const marRepo = createTenantRepo<MarEntry>("hospital_mar_entries", {
  refs: [["patient_id", "hospital_patients", "Patient"], ["episode_id", "hospital_episodes", "Admission"]],
});

const stamp = (a: Actor) => (a.designation ? `${a.name}, ${a.designation}` : a.name);
/** Who may give medicines (MOM-3 Ind. 62): nursing staff and doctors. */
const ADMINISTER = ["nurse", "doctor"];
/** Who verifies a high-risk order before the first dose (MOM-1 Ind. 57). */
const VERIFY = ["pharmacist", "senior_doctor"];

async function inpatientEpisode(episodeId: string): Promise<HospitalEpisode> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Admission not found.");
  if (ep.type === "opd") throw new Error("Medication orders here are for admitted and emergency patients; OPD prescriptions are written on the Doctor Desk.");
  if (ep.status !== "open") throw new Error("This admission is closed.");
  return ep;
}

async function getOrder(orderId: string): Promise<HospitalRxItem> {
  const rows = await dbSelect<HospitalRxItem>(
    `SELECT * FROM hospital_rx_items WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND order_type = 'inpatient'`,
    [orderId, requireCurrentTenantId()]
  );
  if (!rows[0]) throw new Error("Medication order not found.");
  return rows[0];
}

async function patch(orderId: string, fields: Partial<HospitalRxItem>): Promise<HospitalRxItem> {
  const keys = Object.keys(fields);
  const ts = nowIso();
  await dbExecute(
    `UPDATE hospital_rx_items SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    [...keys.map((k) => (fields as Record<string, unknown>)[k] ?? null), ts, orderId, requireCurrentTenantId()]
  );
  const saved = await getOrder(orderId);
  await recordOutbox("hospital_rx_items", orderId, "update", saved as unknown as Record<string, unknown>);
  return saved;
}

export interface MedicationOrderInput {
  product_id?: string | null;
  product_name: string;
  generic_name?: string | null;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  qty?: number;
  instructions?: string | null;
  /** written by the doctor; verbal / telephone orders are taken down by a nurse and countersigned later. */
  source?: "written" | "verbal" | "telephone";
  /** Ordering doctor's staff id, for a verbal / telephone order. */
  prescriberId?: string | null;
  /** The patient's own medicine brought from outside (MOM-3 Ind. 71). */
  ownSupply?: boolean;
  /** Mark high-risk even if the medicine is not on the list. */
  highRisk?: boolean;
}

/** Writes an inpatient medication order: medicine, dose, route, frequency and
 * duration are all required (MOM-1 Ind. 54), with prescriber, date and time. */
export async function addMedicationOrder(episodeId: string, o: MedicationOrderInput): Promise<HospitalRxItem> {
  const ep = await inpatientEpisode(episodeId);
  const a = await currentActor();
  const source = o.source ?? "written";
  for (const [k, label] of [["product_name", "Medicine"], ["dose", "Dose"], ["route", "Route"], ["frequency", "Frequency"], ["duration", "Duration"]] as const) {
    if (!String(o[k] ?? "").trim()) throw new Error(`${label} is required on a medication order.`);
  }
  let prescriberId = a.userId ? (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0]?.id ?? null : null;
  let prescriberName = stamp(a);
  let receivedBy: string | null = null;
  if (source === "written") {
    if (!roleAllowed(["doctor"], a)) throw new Error("Only a doctor writes medication orders. A nurse records a verbal or telephone order for the doctor to countersign.");
  } else {
    if (!roleAllowed(["nurse", "doctor"], a)) throw new Error("Only nursing staff or doctors take verbal / telephone orders.");
    const doc = o.prescriberId ? await staffRepo.get(o.prescriberId) : null;
    if (!doc || !DOCTOR_CATEGORIES.includes(doc.staff_category ?? "")) throw new Error("Choose the doctor who gave the verbal / telephone order.");
    prescriberId = doc.id;
    prescriberName = doc.designation ? `${doc.name}, ${doc.designation}` : doc.name;
    receivedBy = stamp(a);
  }
  const group = highRiskGroup(o.product_name, o.generic_name);
  const ts = nowIso();
  const row: HospitalRxItem = {
    id: newId(), tenant_id: requireCurrentTenantId(), episode_id: ep.id, product_id: o.product_id ?? null, product_name: o.product_name.trim(),
    generic_name: o.generic_name?.trim() || null, dose: o.dose.trim(), route: o.route.trim(), frequency: o.frequency.trim(), duration: o.duration.trim(),
    qty: Number(o.qty) > 0 ? Number(o.qty) : 1, instructions: o.instructions?.trim() || null, sent_at: null,
    order_type: "inpatient", ordered_by: prescriberId, ordered_by_name: prescriberName, ordered_at: ts, order_status: "active",
    stopped_at: null, stopped_by_name: null, stop_reason: null, high_risk: group || o.highRisk ? 1 : 0, order_source: source,
    received_by_name: receivedBy, countersigned_by_name: null, countersigned_at: null, verified_by_name: null, verified_at: null,
    own_supply: o.ownSupply ? 1 : 0, created_at: ts, updated_at: ts, deleted_at: null,
  };
  const cols = Object.keys(row);
  try {
    await dbExecute(`INSERT INTO hospital_rx_items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => (row as unknown as Record<string, unknown>)[c] ?? null));
  } catch (e) {
    throw friendlyDbError(e);
  }
  await recordOutbox("hospital_rx_items", row.id, "insert", row as unknown as Record<string, unknown>);
  return row;
}

export async function listMedicationOrders(episodeId: string): Promise<HospitalRxItem[]> {
  return dbSelect<HospitalRxItem>(
    `SELECT * FROM hospital_rx_items WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL AND order_type = 'inpatient' ORDER BY ordered_at`,
    [requireCurrentTenantId(), episodeId]
  );
}

/** The ordering doctor (or a senior doctor) signs a verbal / telephone order. */
export async function countersignOrder(orderId: string): Promise<HospitalRxItem> {
  const o = await getOrder(orderId);
  if (o.order_source === "written" || !o.order_source) throw new Error("This order was written by the doctor; there is nothing to countersign.");
  if (o.countersigned_at) throw new Error("This order is already countersigned.");
  const a = await currentActor();
  const me = a.userId ? (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0] ?? null : null;
  if (!(a.full || (me && me.id === o.ordered_by) || roleAllowed(["senior_doctor"], a))) throw new Error("The doctor who gave the order, or a senior doctor, countersigns it.");
  return patch(orderId, { countersigned_by_name: stamp(a), countersigned_at: nowIso() });
}

/** A pharmacist or senior doctor, other than the prescriber, verifies a high-risk order before the first dose (MOM-1 Ind. 57). */
export async function verifyHighRiskOrder(orderId: string): Promise<HospitalRxItem> {
  const o = await getOrder(orderId);
  if (!o.high_risk) throw new Error("This order is not high-risk.");
  if (o.verified_at) throw new Error("This order is already verified.");
  if (o.order_status !== "active") throw new Error("This order is stopped.");
  const a = await currentActor();
  if (!roleAllowed(VERIFY, a)) throw new Error("A pharmacist or a senior doctor verifies high-risk orders.");
  const me = a.userId ? (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0] ?? null : null;
  if (me && me.id === o.ordered_by) throw new Error("The prescriber cannot verify their own high-risk order; a second person does.");
  return patch(orderId, { verified_by_name: stamp(a), verified_at: nowIso() });
}

export async function stopMedicationOrder(orderId: string, reason: string): Promise<HospitalRxItem> {
  if (!reason?.trim()) throw new Error("Give the reason for stopping the medicine.");
  const o = await getOrder(orderId);
  if (o.order_status !== "active") throw new Error("This order is already stopped.");
  const a = await currentActor();
  if (!roleAllowed(["doctor"], a)) throw new Error("Only a doctor stops a medication order.");
  return patch(orderId, { order_status: "stopped", stopped_at: nowIso(), stopped_by_name: stamp(a), stop_reason: reason.trim() });
}

export interface AdministrationInput {
  status: MarEntry["status"];
  /** Two different identifiers checked at the bedside (MOM-3 Ind. 64). */
  identifiers?: [string, string];
  /** Each check is confirmed by the nurse; none is assumed (MOM-3 Ind. 65-68). */
  checks?: { medicine: boolean; dose: boolean; route: boolean; time: boolean };
  doseGiven?: string | null;
  routeGiven?: string | null;
  givenAt?: string | null;
  /** Second person's staff id: required for a high-risk medicine. */
  secondCheckerId?: string | null;
  reason?: string | null;
  notes?: string | null;
}

/** Records one dose. "Given" needs two identifiers and all four checks; held,
 * refused and missed need the reason. A high-risk medicine needs a verified
 * order and a second person's check. */
export async function recordAdministration(orderId: string, x: AdministrationInput): Promise<MarEntry> {
  const o = await getOrder(orderId);
  const ep = await inpatientEpisode(o.episode_id);
  if (o.order_status !== "active") throw new Error("This medicine has been stopped.");
  const a = await currentActor();
  if (!roleAllowed(ADMINISTER, a)) throw new Error("Only nursing staff and doctors may administer medicines.");
  const at = x.givenAt?.trim() ? new Date(x.givenAt.trim()) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("Enter a valid time.");
  if (at.getTime() > Date.now() + 5 * 60_000) throw new Error("The time cannot be in the future.");
  if (!["given", "held", "refused", "missed"].includes(x.status)) throw new Error("Choose given, held, refused or missed.");

  let second: { id: string; name: string } | null = null;
  if (x.status === "given") {
    const [i1, i2] = x.identifiers ?? ["", ""];
    if (!PATIENT_IDENTIFIERS.includes(i1) || !PATIENT_IDENTIFIERS.includes(i2) || i1 === i2) {
      throw new Error("Confirm the patient's identity with two different identifiers before giving the medicine.");
    }
    const c = x.checks;
    const missing = [!c?.medicine && "medicine", !c?.dose && "dose", !c?.route && "route", !c?.time && "time"].filter(Boolean);
    if (missing.length) throw new Error(`Check the ${missing.join(", ")} against the order before giving it.`);
    if (o.high_risk) {
      if (!o.verified_at) throw new Error("This high-risk medicine must be verified by a pharmacist or senior doctor before the first dose.");
      const me = a.userId ? (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0] ?? null : null;
      const checker = x.secondCheckerId ? await staffRepo.get(x.secondCheckerId) : null;
      if (!checker) throw new Error("A high-risk medicine needs a second person to check it. Choose who checked.");
      if (me && checker.id === me.id) throw new Error("The second check must be done by another person.");
      if (!roleAllowed(["any_clinical", "pharmacist"], { userId: null, name: checker.name, role: checker.staff_category ?? null, designation: checker.designation, full: false })) {
        throw new Error("The second checker must be a nurse, doctor or pharmacist.");
      }
      second = { id: checker.id, name: checker.designation ? `${checker.name}, ${checker.designation}` : checker.name };
    }
  } else if (!x.reason?.trim()) {
    throw new Error(`Give the reason the dose was ${x.status}.`);
  }

  return marRepo.create({
    patient_id: ep.patient_id, episode_id: ep.id, order_id: o.id, status: x.status, given_at: at.toISOString(),
    dose_given: x.status === "given" ? x.doseGiven?.trim() || o.dose : null, route_given: x.status === "given" ? x.routeGiven?.trim() || o.route : null,
    identifier_1: x.status === "given" ? x.identifiers![0] : null, identifier_2: x.status === "given" ? x.identifiers![1] : null,
    checked_medicine: x.status === "given" ? 1 : 0, checked_dose: x.status === "given" ? 1 : 0,
    checked_route: x.status === "given" ? 1 : 0, checked_time: x.status === "given" ? 1 : 0,
    second_checker_id: second?.id ?? null, second_checker_name: second?.name ?? null,
    reason: x.reason?.trim() || null, notes: x.notes?.trim() || null, given_by: a.userId, given_by_name: stamp(a),
    voided_at: null, voided_by_name: null, void_reason: null,
  } as Partial<MarEntry>);
}

/** Marks an entry made in error (wrong patient / order). It stays visible, struck through, with the reason. */
export async function voidAdministration(entryId: string, reason: string): Promise<MarEntry> {
  if (!reason?.trim()) throw new Error("Give the reason for voiding the entry.");
  const e = await marRepo.get(entryId);
  if (!e) throw new Error("Entry not found.");
  if (e.voided_at) throw new Error("This entry is already void.");
  const a = await currentActor();
  if (!(a.full || e.given_by === a.userId)) throw new Error("Only the person who recorded it can void it.");
  return (await marRepo.update(entryId, { voided_at: nowIso(), voided_by_name: stamp(a), void_reason: reason.trim() }))!;
}

export async function listAdministrations(episodeId: string): Promise<MarEntry[]> {
  return marRepo.list({ where: "episode_id = ?", params: [episodeId], orderBy: "given_at DESC" });
}
