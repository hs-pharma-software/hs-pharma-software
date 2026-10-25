/** Medical records (MSDS IMS): how complete each discharged admission's record
 * is, worked out from the forms in the software, and the register of copies
 * of records released to patients and third parties.
 *
 * Completeness is reported, never filled in: a missing or unsigned form
 * shows as missing until the person responsible signs it. A record is
 * released only on the patient's own request (identity checked), their
 * written consent, a legal order, or for the patient's continuing care, and
 * only after the records officer or an HoD approves. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";

import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { hospitalEpisodesRepo } from "./hospital";
import { nextSerial, stamp, pct } from "./emergency";
import { RECORDS_ROLES, RECORDS_APPROVER_ROLES } from "../../config/hospitalStaff";
import type { RecordRelease } from "../types-hospital";

export const releasesRepo = createTenantRepo<RecordRelease>("hospital_record_releases", { refs: [["patient_id", "hospital_patients", "Patient"]] });

// ── Completeness ──────────────────────────────────────────────────────────

/** What a discharged admission's record must contain (signed). */
export const RECORD_ITEMS = [
  ["general_consent", "General consent"],
  ["admission_note", "Admission note"],
  ["nursing_assessment", "Nursing assessment"],
  ["exit", "Discharge summary / transfer / LAMA / death record"],
  ["surgery", "Surgical consent and operative note for each surgery"],
  ["transfusion", "Transfusion consent when blood was given"],
  ["verbal_orders", "Verbal / telephone orders countersigned"],
] as const;
export type RecordItem = (typeof RECORD_ITEMS)[number][0];
const EXIT_FORMS = ["discharge_summary", "transfer_referral", "lama_dor", "death_record"];

export interface CompletenessRow {
  episode_id: string;
  episode_no: string;
  patient_name: string;
  mr_no: string | null;
  department: string | null;
  discharge_date: string | null;
  missing: string[];
  /** Items that apply to this admission. */
  applicable: RecordItem[];
}

/** Each admission discharged in the period, with what its record is missing. */
export async function recordCompleteness(range: { from: string; to: string }): Promise<{ rows: CompletenessRow[]; completePct: number | null; byItem: { key: RecordItem; label: string; applicable: number; complete: number; pct: number | null }[] }> {
  const tenantId = requireCurrentTenantId();
  const eps = await dbSelect<{ id: string; episode_no: string; department: string | null; discharge_date: string | null; name: string; mr_no: string | null }>(
    `SELECT e.id, e.episode_no, e.department, e.discharge_date, p.name, p.mr_no FROM hospital_episodes e JOIN hospital_patients p ON p.id = e.patient_id
     WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.type = 'ipd' AND e.status = 'discharged' AND e.discharge_date BETWEEN ? AND ? ORDER BY e.discharge_date DESC`,
    [tenantId, range.from, range.to]
  );
  if (!eps.length) return { rows: [], completePct: null, byItem: RECORD_ITEMS.map(([key, label]) => ({ key, label, applicable: 0, complete: 0, pct: null })) };
  const ids = eps.map((e) => e.id);
  const marks = ids.map(() => "?").join(",");
  const forms = await dbSelect<{ episode_id: string; form_key: string; subject_id: string | null }>(
    `SELECT episode_id, form_key, subject_id FROM hospital_form_records WHERE tenant_id = ? AND deleted_at IS NULL AND status IN ('final', 'amended') AND episode_id IN (${marks})`,
    [tenantId, ...ids]
  );
  const surgeries = await dbSelect<{ id: string; episode_id: string }>(
    `SELECT id, episode_id FROM hospital_surgery_bookings WHERE tenant_id = ? AND deleted_at IS NULL AND status = 'done' AND episode_id IN (${marks})`,
    [tenantId, ...ids]
  );
  const transfused = new Set((await dbSelect<{ episode_id: string }>(
    `SELECT DISTINCT episode_id FROM hospital_bb_issues WHERE tenant_id = ? AND deleted_at IS NULL AND started_at IS NOT NULL AND episode_id IN (${marks})`,
    [tenantId, ...ids]
  ).catch(() => [])).map((r) => r.episode_id));
  const unsigned = new Set((await dbSelect<{ episode_id: string }>(
    `SELECT DISTINCT episode_id FROM hospital_rx_items WHERE tenant_id = ? AND deleted_at IS NULL AND order_type = 'inpatient'
       AND order_source IN ('verbal', 'telephone') AND countersigned_at IS NULL AND episode_id IN (${marks})`,
    [tenantId, ...ids]
  )).map((r) => r.episode_id));

  const label = Object.fromEntries(RECORD_ITEMS) as Record<RecordItem, string>;
  const rows = eps.map((e): CompletenessRow => {
    const mine = forms.filter((f) => f.episode_id === e.id);
    const has = (key: string, subject?: string) => mine.some((f) => f.form_key === key && (!subject || f.subject_id === subject));
    const ops = surgeries.filter((s) => s.episode_id === e.id);
    const applicable: RecordItem[] = ["general_consent", "admission_note", "nursing_assessment", "exit", "verbal_orders"];
    if (ops.length) applicable.push("surgery");
    if (transfused.has(e.id)) applicable.push("transfusion");
    const ok: Record<RecordItem, boolean> = {
      general_consent: has("general_consent"), admission_note: has("admission_note"), nursing_assessment: has("nursing_assessment"),
      exit: EXIT_FORMS.some((k) => has(k)),
      surgery: ops.every((s) => has("surgical_consent", s.id) && has("operative_note", s.id)),
      transfusion: has("transfusion_consent"),
      verbal_orders: !unsigned.has(e.id),
    };
    return {
      episode_id: e.id, episode_no: e.episode_no, patient_name: e.name, mr_no: e.mr_no, department: e.department, discharge_date: e.discharge_date,
      applicable, missing: applicable.filter((k) => !ok[k]).map((k) => label[k]),
    };
  });
  return {
    rows,
    completePct: pct(rows.filter((r) => !r.missing.length).length, rows.length),
    byItem: RECORD_ITEMS.map(([key, l]) => {
      const app = rows.filter((r) => r.applicable.includes(key));
      const complete = app.filter((r) => !r.missing.includes(l)).length;
      return { key, label: l, applicable: app.length, complete, pct: pct(complete, app.length) };
    }),
  };
}

// ── Release of information ────────────────────────────────────────────────

export const REQUESTER_TYPES = ["Patient", "Parent / guardian / next of kin", "Police", "Court", "Insurance / employer", "Another hospital or doctor", "Lawyer", "Other"] as const;
export const AUTHORITY: Record<RecordRelease["authority"], string> = {
  patient: "The patient themself (identity checked)",
  patient_consent: "The patient's written consent",
  legal_order: "Court order / legal requirement (police in an MLC)",
  clinical_care: "Continuing care at another hospital",
};

export interface ReleaseRequestInput {
  patientId: string; episodeId?: string | null; requesterName: string; requesterType: string; relation?: string | null; requesterIdNo?: string | null;
  purpose: string; recordsRequested: string; authority: RecordRelease["authority"]; authorityRef?: string | null;
}

async function needRecords(roles: string[], message: string): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed(roles, a)) throw new Error(message);
  return a;
}

export async function requestRelease(x: ReleaseRequestInput): Promise<RecordRelease> {
  const a = await needRecords(RECORDS_ROLES, "Requests for copies of records go to the Medical Records Officer.");
  if (!x.patientId) throw new Error("Choose the patient.");
  if (x.episodeId && !(await hospitalEpisodesRepo.get(x.episodeId))) throw new Error("Visit not found.");
  if (!x.requesterName?.trim()) throw new Error("Enter who is asking.");
  if (!(REQUESTER_TYPES as readonly string[]).includes(x.requesterType)) throw new Error("Choose who the requester is.");
  if (!x.purpose?.trim() || !x.recordsRequested?.trim()) throw new Error("Enter the purpose and which records are asked for.");
  if (!AUTHORITY[x.authority]) throw new Error("Choose on what authority the record may be released.");
  if (x.authority === "patient" && x.requesterType !== "Patient") throw new Error("Only the patient can ask for their own record without written consent or a legal order.");
  if ((x.authority === "patient_consent" || x.authority === "legal_order") && !x.authorityRef?.trim()) {
    throw new Error(x.authority === "legal_order" ? "Enter the court order / letter number." : "Enter where the patient's signed consent is kept.");
  }
  if (!x.requesterIdNo?.trim()) throw new Error("Enter the requester's CNIC or official ID number.");
  return releasesRepo.create({
    release_no: await nextSerial("hospital_record_releases", "release_no", "ROI"), patient_id: x.patientId, episode_id: x.episodeId ?? null,
    requested_at: nowIso(), requester_name: x.requesterName.trim(), requester_type: x.requesterType, relation: x.relation?.trim() || null,
    requester_id_no: x.requesterIdNo.trim(), purpose: x.purpose.trim(), records_requested: x.recordsRequested.trim(), authority: x.authority,
    authority_ref: x.authorityRef?.trim() || null, received_by_name: stamp(a), status: "requested", id_checked: 0,
  } as Partial<RecordRelease>);
}

export async function decideRelease(id: string, approve: boolean, note: string): Promise<RecordRelease> {
  const a = await needRecords(RECORDS_APPROVER_ROLES, "The Medical Records Officer or an HoD decides on a release.");
  const r = await releasesRepo.get(id);
  if (!r) throw new Error("Request not found.");
  if (r.status !== "requested") throw new Error("This request is already decided.");
  if (!approve && !note?.trim()) throw new Error("Give the reason for refusing.");
  return (await releasesRepo.update(id, { status: approve ? "approved" : "refused", decided_by_name: stamp(a), decided_at: nowIso(), decision_note: note?.trim() || null }))!;
}

/** Records handing over the copies, after the requester's identity was checked again at collection. */
export async function recordRelease(id: string, x: { recordsReleased: string; copies: number; idChecked: boolean }): Promise<RecordRelease> {
  const a = await needRecords(RECORDS_ROLES, "The Medical Records Officer releases the copies.");
  const r = await releasesRepo.get(id);
  if (!r) throw new Error("Request not found.");
  if (r.status !== "approved") throw new Error(r.status === "released" ? "Already released." : "The request has not been approved.");
  if (!x.idChecked) throw new Error("Check the identity of the person collecting the copies.");
  if (!x.recordsReleased?.trim()) throw new Error("List what was released.");
  if (!(Number(x.copies) >= 1)) throw new Error("Enter the number of copies.");
  return (await releasesRepo.update(id, { status: "released", released_at: nowIso(), released_by_name: stamp(a), records_released: x.recordsReleased.trim(), copies: Number(x.copies), id_checked: 1 }))!;
}

export interface ReleaseRow extends RecordRelease { patient_name: string; mr_no: string | null }
export async function listReleases(opts: { status?: RecordRelease["status"] | "" | "open"; patientId?: string } = {}): Promise<ReleaseRow[]> {
  const where = ["r.tenant_id = ?", "r.deleted_at IS NULL"];
  const params: unknown[] = [requireCurrentTenantId()];
  if (opts.status === "open") where.push("r.status IN ('requested', 'approved')");
  else if (opts.status) { where.push("r.status = ?"); params.push(opts.status); }
  if (opts.patientId) { where.push("r.patient_id = ?"); params.push(opts.patientId); }
  return dbSelect<ReleaseRow>(
    `SELECT r.*, p.name AS patient_name, p.mr_no FROM hospital_record_releases r JOIN hospital_patients p ON p.id = r.patient_id WHERE ${where.join(" AND ")} ORDER BY r.requested_at DESC LIMIT 300`,
    params
  );
}

/** Patients matching a name, MR number or phone, for choosing the record. */
export async function findPatients(q: string): Promise<{ id: string; name: string; mr_no: string | null; phone: string | null }[]> {
  if (!q.trim()) return [];
  const like = `%${q.trim()}%`;
  return dbSelect(
    `SELECT id, name, mr_no, phone FROM hospital_patients WHERE tenant_id = ? AND deleted_at IS NULL AND (name LIKE ? OR mr_no LIKE ? OR phone LIKE ?) ORDER BY name LIMIT 20`,
    [requireCurrentTenantId(), like, like, like]
  );
}

