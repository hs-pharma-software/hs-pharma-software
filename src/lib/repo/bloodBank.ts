/** Hospital blood bank (MSDS COP-2 Ind. 21-25, CQI-2 Ind. 104). Every unit is
 * traceable from the donor (or the licensed blood centre it came from) to the
 * patient it was transfused to, or to its disposal:
 *
 *   quarantine -> available (every infection screen non-reactive)
 *   -> reserved (compatible test for a request) -> issued -> transfused,
 *   or discarded with the reason at any point before transfusion.
 *
 * Expired units are never issued. A transfusion starts only with consent (or
 * the emergency doctor's note on the consent form) and a two-person bedside
 * check. Reactions are recorded against the issued unit; serious ones carry
 * the report to the Punjab Blood Transfusion Authority. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { localDate } from "../localDate";
import { currentActor, roleAllowed, listForms, type Actor } from "./medicalRecord";
import { staffRepo } from "./staff";
import { hospitalEpisodesRepo, hospitalPatientsRepo } from "./hospital";
import { BLOOD_BANK_ROLES } from "../../config/hospitalStaff";
import { aboRhCompatible, COMPONENTS, ABO, RH, TTI_TESTS, DONOR_MIN_HB, DONOR_MIN_WEIGHT_KG, REACTION_TYPES, SEVERITIES, SERIOUS } from "../../config/bloodBank";
import type { BbCrossmatch, BbDonation, BbDonor, BbIssue, BbReaction, BbRequest, BbUnit } from "../types-hospital";

const P: [string, string, string] = ["patient_id", "hospital_patients", "Patient"];
const E: [string, string, string] = ["episode_id", "hospital_episodes", "Admission"];
export const bbDonorsRepo = createTenantRepo<BbDonor>("hospital_bb_donors");
export const bbDonationsRepo = createTenantRepo<BbDonation>("hospital_bb_donations", { refs: [["donor_id", "hospital_bb_donors", "Donor"]] });
export const bbUnitsRepo = createTenantRepo<BbUnit>("hospital_bb_units");
export const bbRequestsRepo = createTenantRepo<BbRequest>("hospital_bb_requests", { refs: [P, E] });
export const bbCrossmatchesRepo = createTenantRepo<BbCrossmatch>("hospital_bb_crossmatches", { refs: [["request_id", "hospital_bb_requests", "Request"], ["unit_id", "hospital_bb_units", "Unit"]] });
export const bbIssuesRepo = createTenantRepo<BbIssue>("hospital_bb_issues", { refs: [P, E, ["unit_id", "hospital_bb_units", "Unit"]] });
export const bbReactionsRepo = createTenantRepo<BbReaction>("hospital_bb_reactions", { refs: [P, E, ["issue_id", "hospital_bb_issues", "Transfusion"]] });

const stamp = (a: Actor) => (a.designation ? `${a.name}, ${a.designation}` : a.name);
async function needBloodBank(): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed(BLOOD_BANK_ROLES, a)) throw new Error("Only blood bank staff (technologist, pathologist) do this.");
  return a;
}
const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const groupOf = (abo: string | null, rh: string | null) => (abo && rh ? `${abo} ${rh === "Positive" ? "+" : "−"}` : "—");
export { groupOf };

async function nextNo(table: string, column: string, prefix: string): Promise<string> {
  const day = localDate().replace(/-/g, "").slice(2);
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND ${column} LIKE ?`, [requireCurrentTenantId(), `${prefix}-${day}-%`]);
  let n = (rows[0]?.n ?? 0) + 1;
  for (;;) {
    const no = `${prefix}-${day}-${String(n).padStart(3, "0")}`;
    if (!(await dbSelect(`SELECT 1 FROM ${table} WHERE tenant_id = ? AND ${column} = ?`, [requireCurrentTenantId(), no])).length) return no;
    n++;
  }
}

// ── Donors and donations ──────────────────────────────────────────────────

export async function saveDonor(id: string | null, d: { name: string; cnic?: string | null; phone?: string | null; gender?: string | null; dob?: string | null; abo?: string | null; rh?: string | null }): Promise<BbDonor> {
  await needBloodBank();
  if (!d.name?.trim()) throw new Error("Enter the donor's name.");
  if (d.abo && !(ABO as readonly string[]).includes(d.abo)) throw new Error("Unknown blood group.");
  if (d.rh && !(RH as readonly string[]).includes(d.rh)) throw new Error("Unknown Rh type.");
  const cnic = d.cnic?.trim() || null;
  if (cnic) {
    const dup = await bbDonorsRepo.list({ where: "cnic = ? AND id != ?", params: [cnic, id ?? ""] });
    if (dup.length) throw new Error(`A donor with CNIC ${cnic} is already registered (${dup[0].donor_no}).`);
  }
  const payload = { name: d.name.trim(), cnic, phone: d.phone?.trim() || null, gender: d.gender || null, dob: d.dob || null, abo: d.abo || null, rh: d.rh || null };
  const saved = id ? await bbDonorsRepo.update(id, payload) : await bbDonorsRepo.create({ ...payload, donor_no: await nextNo("hospital_bb_donors", "donor_no", "DN"), notes: null });
  if (!saved) throw new Error("Donor not found.");
  return saved;
}

export interface DonationInput {
  donationType: BbDonation["donation_type"];
  hb: number; weightKg: number; bp: string; pulse?: number | null; temperatureC?: number | null;
  questionnaireOk: boolean; consentSigned: boolean; forPatientId?: string | null;
  /** When the donor is eligible and blood is collected: the unit created in quarantine. */
  collect?: { component: string; volumeMl: number; expiresOn: string } | null;
  deferralReason?: string | null;
}

/** Screens a donor; an eligible donor who gives blood produces a unit in quarantine. */
export async function recordDonation(donorId: string, x: DonationInput): Promise<{ donation: BbDonation; unit: BbUnit | null }> {
  const a = await needBloodBank();
  const donor = await bbDonorsRepo.get(donorId);
  if (!donor) throw new Error("Donor not found.");
  if (!["Voluntary", "Replacement", "Autologous"].includes(x.donationType)) throw new Error("Choose the donation type.");
  const fit = x.questionnaireOk && Number(x.hb) >= DONOR_MIN_HB && Number(x.weightKg) >= DONOR_MIN_WEIGHT_KG;
  if (!fit && !x.deferralReason?.trim()) throw new Error(`The donor does not meet the criteria (Hb ≥ ${DONOR_MIN_HB} g/dL, weight ≥ ${DONOR_MIN_WEIGHT_KG} kg, questionnaire). Record the deferral reason.`);
  if (x.collect && !fit) throw new Error("Blood is not collected from a deferred donor.");
  if (x.collect && !x.consentSigned) throw new Error("The donor's signed consent is needed before collection (COP-2 Ind. 23).");
  const donation = await bbDonationsRepo.create({
    donor_id: donor.id, donated_at: nowIso(), donation_type: x.donationType, hb: Number(x.hb), weight_kg: Number(x.weightKg), bp: x.bp?.trim() || null,
    pulse: x.pulse ?? null, temperature_c: x.temperatureC ?? null, questionnaire_ok: x.questionnaireOk ? 1 : 0, eligible: fit ? 1 : 0,
    deferral_reason: fit ? null : x.deferralReason!.trim(), consent_signed: x.consentSigned ? 1 : 0, for_patient_id: x.forPatientId ?? null,
    screened_by_name: stamp(a), unit_id: null,
  });
  if (!x.collect) return { donation, unit: null };
  const unit = await createUnit({
    source: "donation", donationId: donation.id, component: x.collect.component, volumeMl: x.collect.volumeMl,
    collectedOn: localDate(), expiresOn: x.collect.expiresOn, abo: donor.abo, rh: donor.rh,
  });
  await bbDonationsRepo.update(donation.id, { unit_id: unit.id });
  return { donation: { ...donation, unit_id: unit.id }, unit };
}

// ── Units ─────────────────────────────────────────────────────────────────

export interface UnitInput {
  source: BbUnit["source"];
  donationId?: string | null;
  supplierName?: string | null;
  supplierUnitNo?: string | null;
  supplierLicence?: string | null;
  component: string;
  volumeMl?: number | null;
  collectedOn: string;
  expiresOn: string;
  abo?: string | null;
  rh?: string | null;
  storage?: string | null;
}

/** A unit enters in quarantine: collected here, or received from a licensed blood centre. */
export async function createUnit(u: UnitInput): Promise<BbUnit> {
  await needBloodBank();
  if (!(COMPONENTS as readonly string[]).includes(u.component)) throw new Error("Choose the component.");
  if (!isDate(u.collectedOn) || !isDate(u.expiresOn) || u.expiresOn <= u.collectedOn) throw new Error("Enter the collection and expiry dates (expiry after collection).");
  if (u.source === "received" && (!u.supplierName?.trim() || !u.supplierLicence?.trim() || !u.supplierUnitNo?.trim())) {
    throw new Error("A received unit needs the blood centre's name, PBTA licence / MOU reference and its own unit number.");
  }
  if (u.source === "donation" && !u.donationId) throw new Error("A collected unit comes from a recorded donation.");
  return bbUnitsRepo.create({
    unit_no: await nextNo("hospital_bb_units", "unit_no", "BU"), source: u.source, donation_id: u.donationId ?? null,
    supplier_name: u.supplierName?.trim() || null, supplier_unit_no: u.supplierUnitNo?.trim() || null, supplier_licence: u.supplierLicence?.trim() || null,
    component: u.component, abo: u.abo || null, rh: u.rh || null, volume_ml: u.volumeMl ?? null, collected_on: u.collectedOn, expires_on: u.expiresOn,
    tti_hbv: null, tti_hcv: null, tti_hiv: null, tti_syphilis: null, tti_malaria: null, screened_by_name: null, storage: u.storage?.trim() || null,
    status: "quarantine", released_by_name: null, released_at: null, discard_reason: null, discarded_at: null, discarded_by_name: null,
  } as Partial<BbUnit>);
}

/** Grouping and infection screening results (for a received unit: as certified by the blood centre). */
export async function recordUnitTesting(unitId: string, t: { abo: string; rh: string } & Partial<Record<(typeof TTI_TESTS)[number][0], "nonreactive" | "reactive">>): Promise<BbUnit> {
  const a = await needBloodBank();
  const u = await bbUnitsRepo.get(unitId);
  if (!u) throw new Error("Unit not found.");
  if (u.status !== "quarantine") throw new Error("Results are recorded while the unit is in quarantine.");
  if (!(ABO as readonly string[]).includes(t.abo) || !(RH as readonly string[]).includes(t.rh)) throw new Error("Enter the unit's ABO group and Rh type.");
  const patch: Partial<BbUnit> = { abo: t.abo, rh: t.rh, screened_by_name: stamp(a) };
  for (const [k] of TTI_TESTS) {
    const v = t[k];
    if (v !== undefined && v !== "nonreactive" && v !== "reactive") throw new Error("Each screen is reactive or non-reactive.");
    if (v) (patch as Record<string, unknown>)[k] = v;
  }
  return (await bbUnitsRepo.update(unitId, patch))!;
}

/** Releases a quarantined unit to stock: every screen non-reactive, grouped, not expired. */
export async function releaseUnit(unitId: string): Promise<BbUnit> {
  const a = await needBloodBank();
  const u = await bbUnitsRepo.get(unitId);
  if (!u) throw new Error("Unit not found.");
  if (u.status !== "quarantine") throw new Error("Only a unit in quarantine is released to stock.");
  const reactive = TTI_TESTS.filter(([k]) => u[k] === "reactive").map(([, l]) => l);
  if (reactive.length) throw new Error(`The unit is reactive for ${reactive.join(", ")}. It must be discarded, never released.`);
  const missing = TTI_TESTS.filter(([k]) => u[k] !== "nonreactive").map(([, l]) => l);
  if (missing.length) throw new Error(`Screening not recorded: ${missing.join(", ")}.`);
  if (!u.abo || !u.rh) throw new Error("The unit is not grouped.");
  if (u.expires_on < localDate()) throw new Error("The unit has expired.");
  return (await bbUnitsRepo.update(unitId, { status: "available", released_by_name: stamp(a), released_at: nowIso() }))!;
}

/** Discards a unit not yet transfused (reactive, expired, damaged, returned unfit). */
export async function discardUnit(unitId: string, reason: string): Promise<BbUnit> {
  const a = await needBloodBank();
  if (!reason?.trim()) throw new Error("Give the reason for discarding.");
  const u = await bbUnitsRepo.get(unitId);
  if (!u) throw new Error("Unit not found.");
  if (u.status === "transfused" || u.status === "discarded") throw new Error(`This unit is already ${u.status}.`);
  if (u.status === "issued") throw new Error("The unit is with the ward; record its return first.");
  return (await bbUnitsRepo.update(unitId, { status: "discarded", discard_reason: reason.trim(), discarded_at: nowIso(), discarded_by_name: stamp(a) }))!;
}

export async function listUnits(filter: { status?: BbUnit["status"]; component?: string } = {}): Promise<BbUnit[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) { where.push("status = ?"); params.push(filter.status); }
  if (filter.component) { where.push("component = ?"); params.push(filter.component); }
  return bbUnitsRepo.list({ where: where.join(" AND "), params, orderBy: "expires_on ASC" });
}

/** Stock that can be crossmatched now: available and not expired. */
export async function availableUnits(component: string): Promise<BbUnit[]> {
  return bbUnitsRepo.list({ where: "status = 'available' AND component = ? AND expires_on >= ?", params: [component, localDate()], orderBy: "expires_on ASC" });
}

// ── Requests, compatibility, issue ────────────────────────────────────────

export async function requestBlood(episodeId: string, r: { component: string; units: number; urgency: BbRequest["urgency"]; indication: string; patientAbo?: string | null; patientRh?: string | null }): Promise<BbRequest> {
  const a = await currentActor();
  if (!roleAllowed(["doctor"], a)) throw new Error("A doctor requests blood.");
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep || ep.type === "opd" || ep.status !== "open") throw new Error("Blood is requested for an admitted or emergency patient.");
  if (!(COMPONENTS as readonly string[]).includes(r.component)) throw new Error("Choose the component.");
  if (!(Number(r.units) >= 1 && Number(r.units) <= 20)) throw new Error("Units must be between 1 and 20.");
  if (!["Routine", "Urgent", "Emergency"].includes(r.urgency)) throw new Error("Choose the urgency.");
  if (!r.indication?.trim()) throw new Error("Give the indication (MSDS COP-2 Ind. 21: rational use of blood).");
  return bbRequestsRepo.create({
    patient_id: ep.patient_id, episode_id: ep.id, component: r.component, units_requested: Number(r.units), urgency: r.urgency, indication: r.indication.trim(),
    patient_abo: r.patientAbo || null, patient_rh: r.patientRh || null, requested_by: a.userId, requested_by_name: stamp(a), requested_at: nowIso(),
    status: "open", closed_at: null, notes: null,
  });
}

/** The blood bank's grouping of the patient's sample. */
export async function recordPatientGroup(requestId: string, abo: string, rh: string): Promise<BbRequest> {
  await needBloodBank();
  if (!(ABO as readonly string[]).includes(abo) || !(RH as readonly string[]).includes(rh)) throw new Error("Enter the patient's ABO group and Rh type.");
  const r = await bbRequestsRepo.get(requestId);
  if (!r || r.status !== "open") throw new Error("Open request not found.");
  return (await bbRequestsRepo.update(requestId, { patient_abo: abo, patient_rh: rh }))!;
}

/** Records a compatibility test. "Compatible" is refused when ABO/Rh do not allow it; a compatible unit is reserved for the request. */
export async function recordCrossmatch(requestId: string, unitId: string, result: BbCrossmatch["result"], method = "Saline / AHG crossmatch"): Promise<BbCrossmatch> {
  const a = await needBloodBank();
  const r = await bbRequestsRepo.get(requestId);
  if (!r || r.status !== "open") throw new Error("Open request not found.");
  const u = await bbUnitsRepo.get(unitId);
  if (!u || u.status !== "available") throw new Error("The unit is not available in stock.");
  if (u.component !== r.component) throw new Error(`The request is for ${r.component}.`);
  if (u.expires_on < localDate()) throw new Error("The unit has expired.");
  if (!r.patient_abo || !r.patient_rh) throw new Error("Group the patient's sample first.");
  if (result === "compatible") {
    const c = aboRhCompatible(u.component, { abo: u.abo!, rh: u.rh! }, { abo: r.patient_abo, rh: r.patient_rh });
    if (!c.ok) throw new Error(c.reason);
  }
  const x = await bbCrossmatchesRepo.create({ request_id: r.id, unit_id: u.id, result, method, tested_by_name: stamp(a), tested_at: nowIso() });
  if (result === "compatible") await bbUnitsRepo.update(u.id, { status: "reserved" });
  return x;
}

/** Issues a reserved (compatible) unit to the ward, or in an emergency an uncrossmatched unit on a named doctor's authority. */
export async function issueUnit(requestId: string, unitId: string, opts: { receivedBy: string; emergencyAuthorizedBy?: string | null }): Promise<BbIssue> {
  const a = await needBloodBank();
  const r = await bbRequestsRepo.get(requestId);
  if (!r || r.status !== "open") throw new Error("Open request not found.");
  const u = await bbUnitsRepo.get(unitId);
  if (!u) throw new Error("Unit not found.");
  if (u.expires_on < localDate()) throw new Error("The unit has expired; it must not be issued.");
  if (!opts.receivedBy?.trim()) throw new Error("Enter who collected the unit from the blood bank.");
  const compatible = (await bbCrossmatchesRepo.list({ where: "request_id = ? AND unit_id = ? AND result = 'compatible'", params: [r.id, u.id] })).length > 0;
  let emergency = false;
  if (!compatible) {
    if (r.urgency !== "Emergency" || !opts.emergencyAuthorizedBy?.trim()) throw new Error("Only a unit with a compatible test is issued; an uncrossmatched unit needs an emergency request and the authorizing doctor's name.");
    if (u.status !== "available") throw new Error("The unit is not available in stock.");
    if (u.component === "Whole blood" || u.component === "Packed red cells") {
      if (u.abo !== "O" || u.rh !== "Negative") throw new Error("Uncrossmatched red cells in an emergency are group O Rh-negative.");
    }
    emergency = true;
  } else if (u.status !== "reserved") {
    throw new Error("The unit is not reserved for this request.");
  }
  const issue = await bbIssuesRepo.create({
    request_id: r.id, unit_id: u.id, patient_id: r.patient_id, episode_id: r.episode_id, emergency_release: emergency ? 1 : 0,
    authorized_by: emergency ? opts.emergencyAuthorizedBy!.trim() : null, issued_at: nowIso(), issued_by_name: stamp(a), received_by: opts.receivedBy.trim(),
    started_at: null, check_by_1: null, check_by_2: null, vitals_pre: null, vitals_15min: null, vitals_end: null, ended_at: null,
    volume_ml: null, outcome: null, returned_at: null, return_reason: null, recorded_by_name: null,
  });
  await bbUnitsRepo.update(u.id, { status: "issued" });
  const issued = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_bb_issues WHERE tenant_id = ? AND request_id = ? AND returned_at IS NULL AND deleted_at IS NULL`, [requireCurrentTenantId(), r.id]);
  if ((issued[0]?.n ?? 0) >= r.units_requested) await bbRequestsRepo.update(r.id, { status: "fulfilled", closed_at: nowIso() });
  return issue;
}

/** An issued unit that was not used comes back: to stock (re-test before reuse) or discarded. */
export async function returnUnit(issueId: string, reason: string, fitForReuse: boolean): Promise<BbIssue> {
  const a = await needBloodBank();
  if (!reason?.trim()) throw new Error("Give the reason for the return.");
  const i = await bbIssuesRepo.get(issueId);
  if (!i) throw new Error("Issue not found.");
  if (i.started_at) throw new Error("The transfusion was started; it cannot be returned.");
  if (i.returned_at) throw new Error("Already returned.");
  await bbIssuesRepo.update(issueId, { returned_at: nowIso(), return_reason: reason.trim(), recorded_by_name: stamp(a) });
  await bbUnitsRepo.update(i.unit_id, fitForReuse
    ? { status: "available" }
    : { status: "discarded", discard_reason: `Returned unfit: ${reason.trim()}`, discarded_at: nowIso(), discarded_by_name: stamp(a) });
  return (await bbIssuesRepo.get(issueId))!;
}

// ── Bedside transfusion ───────────────────────────────────────────────────

/** Starts the transfusion: consent on the episode (or its emergency note), and two clinical staff check patient and unit at the bedside. */
export async function startTransfusion(issueId: string, x: { checkBy1: string; checkBy2: string; vitalsPre: string }): Promise<BbIssue> {
  const a = await currentActor();
  if (!roleAllowed(["nurse", "doctor"], a)) throw new Error("Nursing staff or doctors start a transfusion.");
  const i = await bbIssuesRepo.get(issueId);
  if (!i) throw new Error("Issued unit not found.");
  if (i.returned_at) throw new Error("This unit was returned to the blood bank.");
  if (i.started_at) throw new Error("The transfusion is already started.");
  const consent = (await listForms({ episodeId: i.episode_id, formKey: "transfusion_consent" })).filter((f) => f.status === "final" || f.status === "amended");
  if (!consent.length) throw new Error("Sign the Consent for Blood Transfusion first (or its emergency doctor's note) — MSDS COP-2 Ind. 23.");
  const ids = [x.checkBy1, x.checkBy2];
  if (!ids[0] || !ids[1] || ids[0] === ids[1]) throw new Error("Two different staff members check the patient and the unit at the bedside.");
  const names: string[] = [];
  for (const id of ids) {
    const s = await staffRepo.get(id);
    if (!s || !roleAllowed(["nurse", "doctor"], { userId: null, name: s.name, role: s.staff_category ?? null, designation: s.designation, full: false })) {
      throw new Error("The bedside checkers must be nurses or doctors.");
    }
    names.push(s.designation ? `${s.name}, ${s.designation}` : s.name);
  }
  if (!x.vitalsPre?.trim()) throw new Error("Record the vital signs before starting.");
  return (await bbIssuesRepo.update(issueId, { started_at: nowIso(), check_by_1: names[0], check_by_2: names[1], vitals_pre: x.vitalsPre.trim(), recorded_by_name: stamp(a) }))!;
}

/** Nurses and doctors who can do the two-person bedside check. */
export async function bedsideCheckers(): Promise<{ id: string; label: string }[]> {
  const staff = await staffRepo.list({ orderBy: "name ASC" });
  return staff
    .filter((s) => roleAllowed(["nurse", "doctor"], { userId: null, name: s.name, role: s.staff_category ?? null, designation: s.designation, full: false }))
    .map((s) => ({ id: s.id, label: s.designation ? `${s.name}, ${s.designation}` : s.name }));
}

export async function finishTransfusion(issueId: string, x: { vitals15: string; vitalsEnd: string; volumeMl: number; outcome: NonNullable<BbIssue["outcome"]> }): Promise<BbIssue> {
  const a = await currentActor();
  if (!roleAllowed(["nurse", "doctor"], a)) throw new Error("Nursing staff or doctors record the transfusion.");
  const i = await bbIssuesRepo.get(issueId);
  if (!i || !i.started_at) throw new Error("The transfusion has not been started.");
  if (i.ended_at) throw new Error("The transfusion is already finished.");
  if (!x.vitals15?.trim() || !x.vitalsEnd?.trim()) throw new Error("Record the vital signs at 15 minutes and at the end.");
  if (!["Completed", "Stopped (reaction)", "Stopped (other)"].includes(x.outcome)) throw new Error("Choose the outcome.");
  if (!(Number(x.volumeMl) >= 0 && Number(x.volumeMl) <= 2000)) throw new Error("Enter the volume transfused (mL).");
  const saved = await bbIssuesRepo.update(issueId, { vitals_15min: x.vitals15.trim(), vitals_end: x.vitalsEnd.trim(), volume_ml: Number(x.volumeMl), outcome: x.outcome, ended_at: nowIso(), recorded_by_name: stamp(a) });
  await bbUnitsRepo.update(i.unit_id, { status: "transfused" });
  return saved!;
}

export interface EpisodeTransfusion extends BbIssue { unit_no: string; component: string; abo: string | null; rh: string | null; expires_on: string }

export async function episodeTransfusions(episodeId: string): Promise<{ requests: BbRequest[]; issues: EpisodeTransfusion[]; reactions: BbReaction[] }> {
  const t = requireCurrentTenantId();
  const [requests, issues, reactions] = await Promise.all([
    bbRequestsRepo.list({ where: "episode_id = ?", params: [episodeId], orderBy: "requested_at DESC" }),
    dbSelect<EpisodeTransfusion>(
      `SELECT i.*, u.unit_no, u.component, u.abo, u.rh, u.expires_on FROM hospital_bb_issues i JOIN hospital_bb_units u ON u.id = i.unit_id
       WHERE i.tenant_id = ? AND i.episode_id = ? AND i.deleted_at IS NULL ORDER BY i.issued_at DESC`, [t, episodeId]),
    bbReactionsRepo.list({ where: "episode_id = ?", params: [episodeId], orderBy: "onset_at DESC" }),
  ]);
  return { requests, issues, reactions };
}

// ── Reactions ─────────────────────────────────────────────────────────────

export async function recordReaction(issueId: string, x: { reactionType: string; severity: string; symptoms: string; actions: string; onsetAt?: string | null }): Promise<BbReaction> {
  const a = await currentActor();
  if (!roleAllowed(["nurse", "doctor", ...BLOOD_BANK_ROLES], a)) throw new Error("Clinical or blood bank staff report a reaction.");
  const i = await bbIssuesRepo.get(issueId);
  if (!i || !i.started_at) throw new Error("A reaction is recorded against a started transfusion.");
  if (!REACTION_TYPES.includes(x.reactionType)) throw new Error("Choose the type of reaction.");
  if (!(SEVERITIES as readonly string[]).includes(x.severity)) throw new Error("Choose the severity.");
  if (!x.symptoms?.trim() || !x.actions?.trim()) throw new Error("Record the signs / symptoms and the actions taken.");
  const at = x.onsetAt ? new Date(x.onsetAt) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("Enter a valid onset time.");
  return bbReactionsRepo.create({
    issue_id: i.id, patient_id: i.patient_id, episode_id: i.episode_id, onset_at: at.toISOString(), reaction_type: x.reactionType, severity: x.severity,
    symptoms: x.symptoms.trim(), actions: x.actions.trim(), investigation: null, analysis: null, outcome: null,
    reported_to_authority: 0, authority_reported_at: null, authority_ref: null, recorded_by_name: stamp(a),
  });
}

/** The blood bank's investigation and analysis, with preventive and corrective action (COP-2 Ind. 25). */
export async function analyseReaction(reactionId: string, x: { investigation: string; analysis: string; outcome: string }): Promise<BbReaction> {
  await needBloodBank();
  if (!x.investigation?.trim() || !x.analysis?.trim() || !x.outcome?.trim()) throw new Error("Record the investigation, the analysis with preventive / corrective action, and the outcome.");
  const r = await bbReactionsRepo.get(reactionId);
  if (!r) throw new Error("Reaction not found.");
  return (await bbReactionsRepo.update(reactionId, { investigation: x.investigation.trim(), analysis: x.analysis.trim(), outcome: x.outcome.trim() }))!;
}

/** Records that the Authority was informed of a serious reaction (Act, Section 13). */
export async function reportReactionToAuthority(reactionId: string, reportedOn: string, reference: string): Promise<BbReaction> {
  await needBloodBank();
  if (!isDate(reportedOn) || !reference?.trim()) throw new Error("Enter the date reported and the reference (letter / e-mail / portal number).");
  const r = await bbReactionsRepo.get(reactionId);
  if (!r) throw new Error("Reaction not found.");
  return (await bbReactionsRepo.update(reactionId, { reported_to_authority: 1, authority_reported_at: reportedOn, authority_ref: reference.trim() }))!;
}

export async function listReactions(): Promise<(BbReaction & { patient_name: string; mr_no: string; unit_no: string })[]> {
  return dbSelect(
    `SELECT r.*, p.name AS patient_name, p.mr_no, u.unit_no FROM hospital_bb_reactions r
     JOIN hospital_patients p ON p.id = r.patient_id JOIN hospital_bb_issues i ON i.id = r.issue_id JOIN hospital_bb_units u ON u.id = i.unit_id
     WHERE r.tenant_id = ? AND r.deleted_at IS NULL ORDER BY r.onset_at DESC`,
    [requireCurrentTenantId()]
  );
}

export async function listOpenRequests(): Promise<(BbRequest & { patient_name: string; mr_no: string; episode_no: string; issued: number })[]> {
  return dbSelect(
    `SELECT r.*, p.name AS patient_name, p.mr_no, e.episode_no,
       (SELECT COUNT(*) FROM hospital_bb_issues i WHERE i.request_id = r.id AND i.returned_at IS NULL AND i.deleted_at IS NULL) AS issued
     FROM hospital_bb_requests r JOIN hospital_patients p ON p.id = r.patient_id JOIN hospital_episodes e ON e.id = r.episode_id
     WHERE r.tenant_id = ? AND r.deleted_at IS NULL AND r.status = 'open'
     ORDER BY CASE r.urgency WHEN 'Emergency' THEN 0 WHEN 'Urgent' THEN 1 ELSE 2 END, r.requested_at`,
    [requireCurrentTenantId()]
  );
}

export interface CrossmatchRow extends BbCrossmatch { unit_no: string; component: string; abo: string | null; rh: string | null; expires_on: string; unit_status: BbUnit["status"] }

export async function requestCrossmatches(requestId: string): Promise<CrossmatchRow[]> {
  return dbSelect(
    `SELECT x.*, u.unit_no, u.component, u.abo, u.rh, u.expires_on, u.status AS unit_status FROM hospital_bb_crossmatches x JOIN hospital_bb_units u ON u.id = x.unit_id
     WHERE x.tenant_id = ? AND x.request_id = ? AND x.deleted_at IS NULL ORDER BY x.tested_at DESC`,
    [requireCurrentTenantId(), requestId]
  );
}

/** Units issued to the wards and not yet started or returned. */
export async function listWithWards(): Promise<(EpisodeTransfusion & { patient_name: string; mr_no: string; episode_no: string })[]> {
  return dbSelect(
    `SELECT i.*, u.unit_no, u.component, u.abo, u.rh, u.expires_on, p.name AS patient_name, p.mr_no, e.episode_no
     FROM hospital_bb_issues i JOIN hospital_bb_units u ON u.id = i.unit_id JOIN hospital_patients p ON p.id = i.patient_id JOIN hospital_episodes e ON e.id = i.episode_id
     WHERE i.tenant_id = ? AND i.deleted_at IS NULL AND i.started_at IS NULL AND i.returned_at IS NULL ORDER BY i.issued_at`,
    [requireCurrentTenantId()]
  );
}

export async function listDonors(): Promise<BbDonor[]> {
  return bbDonorsRepo.list({ orderBy: "created_at DESC" });
}
export async function listDonations(donorId: string): Promise<BbDonation[]> {
  return bbDonationsRepo.list({ where: "donor_id = ?", params: [donorId], orderBy: "donated_at DESC" });
}

// ── Indicators (CQI-2 Ind. 104) ───────────────────────────────────────────

export interface BloodIndicators {
  transfused: number;
  reactions: number;
  reactionRate: number | null;
  discarded: number;
  wastageRate: number | null;
  byComponent: { component: string; transfused: number; share: number | null }[];
  /** Minutes from request to first issue. */
  issueTatMedian: number | null;
  seriousNotReported: number;
}

export async function bloodIndicators(range: { from: string; to: string }): Promise<BloodIndicators> {
  const t = requireCurrentTenantId();
  const between = [range.from, `${range.to}T23:59:59.999Z`];
  const transfusedRows = await dbSelect<{ component: string; n: number }>(
    `SELECT u.component, COUNT(*) AS n FROM hospital_bb_issues i JOIN hospital_bb_units u ON u.id = i.unit_id
     WHERE i.tenant_id = ? AND i.started_at IS NOT NULL AND i.deleted_at IS NULL AND i.started_at BETWEEN ? AND ? GROUP BY u.component`, [t, ...between]);
  const transfused = transfusedRows.reduce((s, r) => s + r.n, 0);
  const reactions = (await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_bb_reactions WHERE tenant_id = ? AND deleted_at IS NULL AND onset_at BETWEEN ? AND ?`, [t, ...between]))[0]?.n ?? 0;
  const discarded = (await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_bb_units WHERE tenant_id = ? AND deleted_at IS NULL AND status = 'discarded' AND discarded_at BETWEEN ? AND ?`, [t, ...between]))[0]?.n ?? 0;
  const tats = (await dbSelect<{ m: number }>(
    `SELECT (julianday(MIN(i.issued_at)) - julianday(r.requested_at)) * 1440 AS m FROM hospital_bb_requests r JOIN hospital_bb_issues i ON i.request_id = r.id
     WHERE r.tenant_id = ? AND r.deleted_at IS NULL AND r.requested_at BETWEEN ? AND ? GROUP BY r.id`, [t, ...between])).map((r) => r.m).sort((a, b) => a - b);
  const serious = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) AS n FROM hospital_bb_reactions WHERE tenant_id = ? AND deleted_at IS NULL AND reported_to_authority = 0 AND severity IN (${[...SERIOUS].map(() => "?").join(", ")})`,
    [t, ...SERIOUS]
  );
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    transfused, reactions, reactionRate: pct(reactions, transfused), discarded, wastageRate: pct(discarded, transfused + discarded),
    byComponent: transfusedRows.map((r) => ({ component: r.component, transfused: r.n, share: pct(r.n, transfused) })),
    issueTatMedian: tats.length ? Math.round(tats[Math.floor(tats.length / 2)]) : null,
    seriousNotReported: serious[0]?.n ?? 0,
  };
}

export { hospitalPatientsRepo };
