/** Medicines management (MSDS MOM): the hospital formulary, the antibiotic
 * stewardship worklist, adverse drug reaction reports (pharmacovigilance),
 * the controlled drug register and the medicine fridge temperature log.
 *
 * The controlled drug register keeps a running balance for each drug at
 * each location. Every dose given or wasted is witnessed by a second nurse,
 * doctor or pharmacist, the balance can never go below zero, and a count
 * that does not match the balance is recorded as a discrepancy, never
 * corrected silently. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { localDate } from "../localDate";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { staffRepo } from "./staff";
import { hospitalEpisodesRepo } from "./hospital";
import { nextSerial, stamp, pct, median } from "./emergency";
import { PHARMACY_ROLES } from "../../config/hospitalStaff";
import {
  ABX_REVIEW_HOURS, RESERVE_APPROVAL_HOURS, ADR_SERIOUSNESS, ADR_CAUSALITY, ADR_SERIOUS_REPORT_DAYS, CD_ENTRY_TYPES, FRIDGE_MIN_C, FRIDGE_MAX_C,
  type CdEntryType,
} from "../../config/medicines";
import type { AdrReport, CdEntry, FormularyItem, FridgeLog, HospitalRxItem } from "../types-hospital";

const P: [string, string, string] = ["patient_id", "hospital_patients", "Patient"];
export const formularyRepo = createTenantRepo<FormularyItem>("hospital_formulary");
export const adrRepo = createTenantRepo<AdrReport>("hospital_adr_reports", { refs: [P] });
export const cdRepo = createTenantRepo<CdEntry>("hospital_cd_register");
export const fridgeRepo = createTenantRepo<FridgeLog>("hospital_fridge_logs");

async function needPharmacist(): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed(PHARMACY_ROLES, a)) throw new Error("Only the pharmacist does this.");
  return a;
}
const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

// ── Formulary ─────────────────────────────────────────────────────────────

export async function saveFormularyItem(id: string | null, f: { genericName: string; strengthForm?: string | null; category?: string | null; restricted?: boolean; approvalRef?: string | null; notes?: string | null }): Promise<FormularyItem> {
  const a = await needPharmacist();
  if (!f.genericName?.trim()) throw new Error("Enter the generic name.");
  const generic = f.genericName.trim();
  const dup = await formularyRepo.list({ where: "LOWER(generic_name) = LOWER(?) AND COALESCE(strength_form, '') = ? AND status = 'active' AND id != ?", params: [generic, f.strengthForm?.trim() ?? "", id ?? ""] });
  if (dup.length) throw new Error(`${generic} ${f.strengthForm ?? ""} is already on the formulary.`.trim());
  const payload = {
    generic_name: generic, strength_form: f.strengthForm?.trim() || null, category: f.category?.trim() || null, restricted: f.restricted ? 1 : 0,
    approval_ref: f.approvalRef?.trim() || null, notes: f.notes?.trim() || null,
  };
  const saved = id ? await formularyRepo.update(id, payload) : await formularyRepo.create({ ...payload, status: "active", added_by_name: stamp(a) });
  if (!saved) throw new Error("Formulary item not found.");
  return saved;
}

/** Taken off the formulary (kept in the history); orders for it then need a reason. */
export async function removeFormularyItem(id: string, reason: string): Promise<FormularyItem> {
  await needPharmacist();
  if (!reason?.trim()) throw new Error("Give the reason (for example the P&T committee decision).");
  const x = await formularyRepo.get(id);
  if (!x) throw new Error("Formulary item not found.");
  return (await formularyRepo.update(id, { status: "removed", notes: [x.notes, `${localDate()} removed: ${reason.trim()}`].filter(Boolean).join("\n") }))!;
}

export async function listFormulary(opts: { includeRemoved?: boolean; search?: string } = {}): Promise<FormularyItem[]> {
  const where: string[] = opts.includeRemoved ? [] : ["status = 'active'"];
  const params: unknown[] = [];
  if (opts.search?.trim()) { where.push("(generic_name LIKE ? OR category LIKE ?)"); params.push(`%${opts.search.trim()}%`, `%${opts.search.trim()}%`); }
  return formularyRepo.list({ where: where.join(" AND "), params, orderBy: "generic_name ASC" });
}

// ── Antibiotic stewardship ────────────────────────────────────────────────

export interface StewardshipRow extends HospitalRxItem {
  patient_name: string;
  mr_no: string | null;
  episode_no: string;
  ward: string | null;
  hours_on: number;
  approval_overdue: boolean;
  review_due: boolean;
}

/** Active Watch / Reserve antibiotic orders, with approvals and reviews outstanding first. */
export async function stewardshipList(now: Date = new Date()): Promise<StewardshipRow[]> {
  const rows = await dbSelect<Omit<StewardshipRow, "hours_on" | "approval_overdue" | "review_due">>(
    `SELECT r.*, p.name AS patient_name, p.mr_no, e.episode_no, TRIM(COALESCE(e.room_ward, '') || ' ' || COALESCE(e.bed_no, '')) AS ward
     FROM hospital_rx_items r JOIN hospital_episodes e ON e.id = r.episode_id JOIN hospital_patients p ON p.id = e.patient_id
     WHERE r.tenant_id = ? AND r.deleted_at IS NULL AND r.order_type = 'inpatient' AND r.order_status = 'active' AND r.abx_class IN ('reserve', 'watch')
     ORDER BY r.ordered_at ASC`,
    [requireCurrentTenantId()]
  );
  const at = now.toISOString();
  return rows.map((r) => {
    const h = r.ordered_at ? hours(r.ordered_at, at) : 0;
    return {
      ...r, ward: r.ward || null, hours_on: Math.floor(h),
      approval_overdue: r.abx_class === "reserve" && !r.abx_approved_at && h > RESERVE_APPROVAL_HOURS,
      review_due: !r.abx_reviewed_at && h >= ABX_REVIEW_HOURS,
    };
  }).sort((x, y) => Number(y.approval_overdue) - Number(x.approval_overdue) || Number(y.review_due) - Number(x.review_due));
}

// ── Adverse drug reactions ────────────────────────────────────────────────

export interface AdrInput {
  episodeId: string; suspectedDrug: string; otherDrugs?: string | null; startedOn?: string | null; onsetAt: string; reaction: string;
  serious: boolean; seriousness?: string | null; actionTaken?: string | null; outcome?: string | null; dechallenge?: string | null; rechallenge?: string | null;
}

/** A nurse, doctor or pharmacist reports a suspected reaction. */
export async function reportAdr(x: AdrInput): Promise<AdrReport> {
  const a = await currentActor();
  if (!roleAllowed(["any_clinical", ...PHARMACY_ROLES], a)) throw new Error("A nurse, doctor or pharmacist reports a suspected adverse drug reaction.");
  const ep = await hospitalEpisodesRepo.get(x.episodeId);
  if (!ep) throw new Error("Visit not found.");
  if (!x.suspectedDrug?.trim()) throw new Error("Enter the suspected medicine.");
  if (!x.reaction?.trim()) throw new Error("Describe the reaction.");
  if (!x.onsetAt) throw new Error("Enter when the reaction started.");
  if (x.startedOn && !isDate(x.startedOn)) throw new Error("Check the date the medicine was started.");
  if (x.serious && !(ADR_SERIOUSNESS as readonly string[]).includes(x.seriousness ?? "")) throw new Error("Say why the reaction is serious.");
  return adrRepo.create({
    report_no: await nextSerial("hospital_adr_reports", "report_no", "ADR"), patient_id: ep.patient_id, episode_id: ep.id,
    suspected_drug: x.suspectedDrug.trim(), other_drugs: x.otherDrugs?.trim() || null, started_on: x.startedOn || null, onset_at: x.onsetAt,
    reaction: x.reaction.trim(), serious: x.serious ? 1 : 0, seriousness: x.serious ? x.seriousness! : null, action_taken: x.actionTaken || null,
    outcome: x.outcome || null, dechallenge: x.dechallenge || null, rechallenge: x.rechallenge || null, reporter_name: stamp(a), status: "reported",
  } as Partial<AdrReport>);
}

/** The pharmacist (or a senior doctor) assesses causality. */
export async function assessAdr(id: string, x: { causality: string; assessment: string; outcome?: string | null }): Promise<AdrReport> {
  const a = await currentActor();
  if (!roleAllowed([...PHARMACY_ROLES, "senior_doctor"], a)) throw new Error("The pharmacist or a senior doctor assesses the reaction.");
  const r = await adrRepo.get(id);
  if (!r) throw new Error("Report not found.");
  if (r.status === "submitted") throw new Error("This report has been sent to DRAP.");
  if (!(ADR_CAUSALITY as readonly string[]).includes(x.causality)) throw new Error("Choose the causality.");
  if (!x.assessment?.trim()) throw new Error("Write the assessment.");
  return (await adrRepo.update(id, { causality: x.causality, assessment: x.assessment.trim(), outcome: x.outcome || r.outcome, assessed_by_name: stamp(a), assessed_at: nowIso(), status: "assessed" }))!;
}

/** Records that the report went to the national pharmacovigilance centre (DRAP), with its reference. */
export async function submitAdrToDrap(id: string, x: { reportedOn: string; ref: string }): Promise<AdrReport> {
  await needPharmacist();
  const r = await adrRepo.get(id);
  if (!r) throw new Error("Report not found.");
  if (r.status !== "assessed") throw new Error(r.status === "submitted" ? "Already sent to DRAP." : "Assess the causality first.");
  if (!isDate(x.reportedOn) || x.reportedOn > localDate()) throw new Error("Enter the date it was sent.");
  if (!x.ref?.trim()) throw new Error("Enter the DRAP / pharmacovigilance reference.");
  return (await adrRepo.update(id, { status: "submitted", drap_reported_on: x.reportedOn, drap_ref: x.ref.trim() }))!;
}

export interface AdrRow extends AdrReport { patient_name: string; mr_no: string | null; report_overdue: boolean }
export async function listAdr(opts: { status?: AdrReport["status"] | "" | "open"; episodeId?: string } = {}, today: string = localDate()): Promise<AdrRow[]> {
  const where = ["a.tenant_id = ?", "a.deleted_at IS NULL"];
  const params: unknown[] = [requireCurrentTenantId()];
  if (opts.status === "open") where.push("a.status != 'submitted'");
  else if (opts.status) { where.push("a.status = ?"); params.push(opts.status); }
  if (opts.episodeId) { where.push("a.episode_id = ?"); params.push(opts.episodeId); }
  const rows = await dbSelect<Omit<AdrRow, "report_overdue">>(
    `SELECT a.*, p.name AS patient_name, p.mr_no FROM hospital_adr_reports a JOIN hospital_patients p ON p.id = a.patient_id WHERE ${where.join(" AND ")} ORDER BY a.onset_at DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    ...r,
    report_overdue: !!r.serious && r.status !== "submitted" && (Date.parse(today) - Date.parse(r.onset_at.slice(0, 10))) / 86_400_000 > ADR_SERIOUS_REPORT_DAYS,
  }));
}

// ── Controlled drug register ──────────────────────────────────────────────

export async function cdBalance(location: string, drug: string): Promise<number> {
  const last = await cdRepo.list({ where: "location = ? AND drug = ?", params: [location, drug], orderBy: "entry_at DESC, created_at DESC" });
  return last[0]?.balance_after ?? 0;
}

export interface CdInput {
  location: string; drug: string; type: CdEntryType; qty: number;
  /** For a stock count: what is physically there. */
  countedQty?: number | null;
  episodeId?: string | null; orderId?: string | null; witnessStaffId?: string | null; reference?: string | null; note?: string | null;
}

/** One line of the register. Receipts and returns by the pharmacist or nurse in charge; doses and wastage witnessed. */
export async function recordCdEntry(x: CdInput): Promise<CdEntry> {
  const a = await currentActor();
  if (!roleAllowed(["nurse", "doctor", ...PHARMACY_ROLES], a)) throw new Error("Controlled drugs are handled by nurses, doctors and the pharmacist.");
  if (!CD_ENTRY_TYPES[x.type]) throw new Error("Choose the entry.");
  if (!x.location?.trim() || !x.drug?.trim()) throw new Error("Choose the location and the drug.");
  const location = x.location.trim();
  const drug = x.drug.trim();
  const balance = await cdBalance(location, drug);
  let change = 0;
  let counted: number | null = null;
  if (x.type === "count") {
    if (x.countedQty == null || !(Number(x.countedQty) >= 0)) throw new Error("Enter the quantity counted.");
    counted = Number(x.countedQty);
    if (counted !== balance && !x.note?.trim()) throw new Error(`The count (${counted}) does not match the register (${balance}). Record what was found and report it as an incident.`);
  } else {
    const q = Number(x.qty);
    if (!(q > 0)) throw new Error("Enter the quantity.");
    change = x.type === "receipt" ? q : -q;
    if (balance + change < 0) throw new Error(`Only ${balance} in the register at ${location}. Check the stock.`);
  }
  if (x.type === "receipt" && !x.reference?.trim()) throw new Error("Enter the pharmacy issue / requisition number.");
  let patientId: string | null = null;
  let episodeId: string | null = null;
  if (x.type === "administered") {
    if (!x.episodeId) throw new Error("Choose the patient the dose was given to.");
    const ep = await hospitalEpisodesRepo.get(x.episodeId);
    if (!ep) throw new Error("Visit not found.");
    patientId = ep.patient_id;
    episodeId = ep.id;
  }
  if ((x.type === "wasted" || x.type === "returned") && !x.note?.trim()) throw new Error("Note why it was wasted or returned.");
  let witness: { id: string; name: string } | null = null;
  if (x.type !== "receipt") {
    const w = x.witnessStaffId ? await staffRepo.get(x.witnessStaffId) : null;
    if (!w) throw new Error("Choose the witness.");
    const me = a.userId ? (await staffRepo.list({ where: "user_id = ?", params: [a.userId] }))[0] ?? null : null;
    if (me && me.id === w.id) throw new Error("The witness must be another person.");
    if (!roleAllowed(["any_clinical", ...PHARMACY_ROLES], { userId: null, name: w.name, role: w.staff_category ?? null, designation: w.designation, full: false })) {
      throw new Error("The witness must be a nurse, doctor or pharmacist.");
    }
    witness = { id: w.id, name: w.designation ? `${w.name}, ${w.designation}` : w.name };
  }
  return cdRepo.create({
    location, drug, entry_type: x.type, qty: change, balance_after: balance + change, counted_qty: counted, patient_id: patientId, episode_id: episodeId,
    order_id: x.orderId ?? null, entry_at: nowIso(), by_name: stamp(a), witness_staff_id: witness?.id ?? null, witness_name: witness?.name ?? null,
    reference: x.reference?.trim() || null, note: x.note?.trim() || null,
  });
}

export async function cdLedger(location: string, drug: string): Promise<CdEntry[]> {
  return cdRepo.list({ where: "location = ? AND drug = ?", params: [location, drug], orderBy: "entry_at DESC, created_at DESC" });
}

/** Each drug at each location: its balance, the last count and whether it matched. */
export async function cdStock(): Promise<{ location: string; drug: string; balance: number; lastCount: CdEntry | null; discrepancy: boolean }[]> {
  const all = await cdRepo.list({ orderBy: "entry_at DESC, created_at DESC" });
  const out = new Map<string, { location: string; drug: string; balance: number; lastCount: CdEntry | null; discrepancy: boolean }>();
  for (const e of all) {
    const k = `${e.location}\u0000${e.drug}`;
    const row = out.get(k) ?? { location: e.location, drug: e.drug, balance: e.balance_after, lastCount: null, discrepancy: false };
    if (!row.lastCount && e.entry_type === "count") { row.lastCount = e; row.discrepancy = e.counted_qty !== e.balance_after; }
    out.set(k, row);
  }
  return [...out.values()].sort((x, y) => x.location.localeCompare(y.location) || x.drug.localeCompare(y.drug));
}

// ── Medicine fridges ──────────────────────────────────────────────────────

export async function recordFridgeReading(x: { fridge: string; tempC: number; minC?: number | null; maxC?: number | null; actionTaken?: string | null }): Promise<FridgeLog> {
  const a = await currentActor();
  if (!roleAllowed(["nurse", "doctor", ...PHARMACY_ROLES, "blood_bank_technologist", "lab_technician"], a)) throw new Error("Fridge readings are recorded by clinical, pharmacy or lab staff.");
  if (!x.fridge?.trim()) throw new Error("Enter which fridge.");
  const t = Number(x.tempC);
  if (!Number.isFinite(t) || t < -40 || t > 40) throw new Error("Check the temperature.");
  const vals = [t, x.minC, x.maxC].filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number);
  const inRange = vals.every((v) => v >= FRIDGE_MIN_C && v <= FRIDGE_MAX_C);
  if (!inRange && !x.actionTaken?.trim()) throw new Error(`Outside ${FRIDGE_MIN_C}-${FRIDGE_MAX_C} °C. Record what was done (medicines moved, quarantined, engineer called).`);
  return fridgeRepo.create({
    fridge: x.fridge.trim(), reading_at: nowIso(), temp_c: t, min_c: x.minC ?? null, max_c: x.maxC ?? null, in_range: inRange ? 1 : 0,
    action_taken: x.actionTaken?.trim() || null, by_name: stamp(a),
  });
}

export async function listFridgeLogs(days = 30): Promise<FridgeLog[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return fridgeRepo.list({ where: "reading_at >= ?", params: [since], orderBy: "reading_at DESC" });
}

// ── Indicators ────────────────────────────────────────────────────────────

export interface MedicineIndicators {
  formularyItems: number;
  nonFormularyOrders: number;
  ordersTotal: number;
  antibioticOrders: number;
  antibioticPct: number | null;
  cultureBeforePct: number | null;
  reserveOrders: number;
  reserveApprovedInTimePct: number | null;
  reviewedBy72hPct: number | null;
  adrReports: number;
  adrSerious: number;
  adrSeriousNotSent: number;
  cdDiscrepancies: number;
  fridgeReadings: number;
  fridgeOutOfRange: number;
  fridgesWithoutReading7d: string[];
  medianHoursToReview: number | null;
}

export async function medicineIndicators(range: { from: string; to: string }, today: string = localDate()): Promise<MedicineIndicators> {
  const tenantId = requireCurrentTenantId();
  const orders = await dbSelect<HospitalRxItem>(
    `SELECT * FROM hospital_rx_items WHERE tenant_id = ? AND deleted_at IS NULL AND order_type = 'inpatient' AND substr(ordered_at, 1, 10) BETWEEN ? AND ?`,
    [tenantId, range.from, range.to]
  );
  const abx = orders.filter((o) => o.abx_class);
  const reserve = abx.filter((o) => o.abx_class === "reserve");
  const reviewable = abx.filter((o) => o.abx_class === "reserve" || o.abx_class === "watch");
  const reviewedHours = reviewable.filter((o) => o.abx_reviewed_at && o.ordered_at).map((o) => hours(o.ordered_at!, o.abx_reviewed_at!));
  const adr = (await listAdr({}, today)).filter((r) => r.onset_at.slice(0, 10) >= range.from && r.onset_at.slice(0, 10) <= range.to);
  const fridge = (await fridgeRepo.list({ where: "substr(reading_at, 1, 10) BETWEEN ? AND ?", params: [range.from, range.to] }));
  const recent = await listFridgeLogs(7);
  const allFridges = [...new Set((await fridgeRepo.list({ orderBy: "fridge ASC" })).map((f) => f.fridge))];
  return {
    formularyItems: (await listFormulary()).length,
    nonFormularyOrders: orders.filter((o) => o.non_formulary_reason).length,
    ordersTotal: orders.length,
    antibioticOrders: abx.length,
    antibioticPct: pct(abx.length, orders.length),
    cultureBeforePct: pct(abx.filter((o) => o.abx_culture_sent).length, abx.length),
    reserveOrders: reserve.length,
    reserveApprovedInTimePct: pct(reserve.filter((o) => o.abx_approved_at && o.ordered_at && hours(o.ordered_at, o.abx_approved_at) <= RESERVE_APPROVAL_HOURS).length, reserve.length),
    reviewedBy72hPct: pct(reviewedHours.filter((h) => h <= ABX_REVIEW_HOURS + 12).length, reviewable.length),
    adrReports: adr.length,
    adrSerious: adr.filter((r) => r.serious).length,
    adrSeriousNotSent: adr.filter((r) => r.report_overdue).length,
    cdDiscrepancies: (await cdStock()).filter((s) => s.discrepancy).length,
    fridgeReadings: fridge.length,
    fridgeOutOfRange: fridge.filter((f) => !f.in_range).length,
    fridgesWithoutReading7d: allFridges.filter((f) => !recent.some((r) => r.fridge === f)),
    medianHoursToReview: median(reviewedHours.map((h) => Math.round(h))),
  };
}
