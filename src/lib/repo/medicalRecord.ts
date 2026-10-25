/** The patient's medical record: forms (consents, admission note, nursing
 * assessment, progress notes, discharge ...), their audited corrections,
 * safety checklists and vital signs, all tied to the patient and to the
 * visit / admission they belong to. A finalized record is never changed in
 * place: corrections are amendments that keep the earlier values. */
import { dbBatch, dbSelect } from "../db";
import { createTenantRepo, friendlyDbError, requireCurrentTenantId } from "./base";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";
import { staffRepo } from "./staff";
import { hospitalEpisodesRepo, hospitalPatientsRepo } from "./hospital";
import { DOCTOR_CATEGORIES } from "../../config/hospitalStaff";
import { formDef, validateForm, cleanData, type FormDef, type FormData, type RoleRef } from "../../config/forms";
import { applicableItems, checklistDef, validateChecklist, type ChecklistAnswer, type ChecklistContext } from "../../config/forms/checklists";
import type { ChecklistEntry, FormRecord, FormRevision, HospitalEpisode, VitalSigns } from "../types-hospital";

const PATIENT_REF: [string, string, string] = ["patient_id", "hospital_patients", "Patient"];
const EPISODE_REF: [string, string, string] = ["episode_id", "hospital_episodes", "Visit / admission"];
export const formRecordsRepo = createTenantRepo<FormRecord>("hospital_form_records", { refs: [PATIENT_REF, EPISODE_REF] });
export const formRevisionsRepo = createTenantRepo<FormRevision>("hospital_form_revisions");
export const checklistRepo = createTenantRepo<ChecklistEntry>("hospital_checklist_entries", { refs: [PATIENT_REF, EPISODE_REF] });
export const vitalsRepo = createTenantRepo<VitalSigns>("hospital_vitals", { refs: [PATIENT_REF, EPISODE_REF] });

// ── Who is acting ─────────────────────────────────────────────────────────

export interface Actor {
  userId: string | null;
  name: string;
  /** HR designation key of the user's staff record (consultant, nurse ...). */
  role: string | null;
  designation: string | null;
  /** Owner / full-access user: may do everything. */
  full: boolean;
}

const SENIOR_DOCTORS = ["hod", "consultant", "medical_specialist"];
const NURSES = ["nurse", "head_nurse", "nursing_superintendent"];

export async function currentActor(): Promise<Actor> {
  const u = useAuthStore.getState().currentUser;
  const staff = u ? (await staffRepo.list({ where: "user_id = ?", params: [u.id] }))[0] ?? null : null;
  return {
    userId: u?.id ?? null,
    name: staff?.name ?? u?.displayName ?? u?.username ?? "User",
    role: staff?.staff_category ?? null,
    designation: staff?.designation ?? null,
    full: !u || u.role !== "staff" || u.permissions === null,
  };
}

export function roleAllowed(roles: RoleRef[], a: Actor): boolean {
  if (a.full) return true;
  const r = a.role ?? "";
  return roles.some((x) =>
    x === r
    || (x === "doctor" && DOCTOR_CATEGORIES.includes(r))
    || (x === "senior_doctor" && SENIOR_DOCTORS.includes(r))
    || (x === "nurse" && NURSES.includes(r))
    || (x === "any_clinical" && (DOCTOR_CATEGORIES.includes(r) || NURSES.includes(r) || r === "paramedic"))
  );
}

/** "Dr Ayesha Khan, Consultant": the digital stamp printed on an entry (IMS-1 Ind. 147). */
const stamp = (a: Actor) => (a.designation ? `${a.name}, ${a.designation}` : a.name);

// ── Forms ─────────────────────────────────────────────────────────────────

function requireDef(key: string): FormDef {
  const def = formDef(key);
  if (!def) throw new Error("Unknown form.");
  return def;
}

const summaryOf = (def: FormDef, data: FormData) => (def.summaryField ? (data[def.summaryField] ?? "").slice(0, 140) || null : null);

async function episodeOf(patientId: string, episodeId: string | null, def: FormDef): Promise<HospitalEpisode | null> {
  if (!(await hospitalPatientsRepo.get(patientId))) throw new Error("Patient not found in this hospital.");
  if (!episodeId) {
    if (def.episodeTypes?.length) throw new Error(`${def.title} belongs to a visit or admission.`);
    return null;
  }
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep || ep.patient_id !== patientId) throw new Error("That visit / admission is not this patient's.");
  if (def.episodeTypes?.length && !def.episodeTypes.includes(ep.type)) {
    throw new Error(`${def.title} is not used for ${ep.type === "opd" ? "OPD visits" : ep.type === "emergency" ? "emergency visits" : "admissions"}.`);
  }
  return ep;
}

export interface SaveFormInput {
  formKey: string;
  patientId: string;
  episodeId?: string | null;
  data: FormData;
  /** Continue an existing draft. */
  recordId?: string | null;
}

/** Saves a draft (or, for final-on-save forms such as progress notes, a
 * finalized entry). A single-instance form (one per admission) refuses a
 * second record: open the existing one instead. */
export async function saveForm(input: SaveFormInput): Promise<FormRecord> {
  const def = requireDef(input.formKey);
  const a = await currentActor();
  if (!roleAllowed(def.createRoles, a)) throw new Error(`Your designation cannot write the ${def.title}.`);
  const ep = await episodeOf(input.patientId, input.episodeId ?? null, def);
  const data = cleanData(def, input.data);
  const t = requireCurrentTenantId();
  const now = nowIso();

  if (input.recordId) {
    const rec = await formRecordsRepo.get(input.recordId);
    if (!rec || rec.form_key !== def.key || rec.patient_id !== input.patientId) throw new Error("Form not found.");
    if (rec.status !== "draft") throw new Error("This form is finalized. Use Correct to change it; the earlier values are kept.");
    if (!a.full && rec.created_by !== a.userId) throw new Error("Only the author can edit this draft.");
    return (await formRecordsRepo.update(rec.id, { data: JSON.stringify(data), summary: summaryOf(def, data), updated_by: a.userId, updated_by_name: stamp(a) }))!;
  }

  if (def.finalOnSave) {
    const errors = validateForm(def, data);
    if (errors.length) throw new Error(errors.join(" "));
  }
  const id = newId();
  const record: FormRecord = {
    id, tenant_id: t, form_key: def.key, form_version: def.version, scope: def.scope,
    patient_id: input.patientId, episode_id: ep?.id ?? null, department: ep?.department ?? def.department,
    status: def.finalOnSave ? "final" : "draft", data: JSON.stringify(data), summary: summaryOf(def, data),
    unique_key: def.onePerEpisode && ep ? `${def.key}:${ep.id}` : null,
    created_by: a.userId, created_by_name: stamp(a), updated_by: a.userId, updated_by_name: stamp(a),
    finalized_by: def.finalOnSave ? a.userId : null, finalized_by_name: def.finalOnSave ? stamp(a) : null,
    finalized_at: def.finalOnSave ? now : null, revision_no: def.finalOnSave ? 1 : 0,
    created_at: now, updated_at: now, deleted_at: null,
  };
  const statements = [insert("hospital_form_records", record as unknown as Record<string, unknown>)];
  let revision: FormRevision | null = null;
  if (def.finalOnSave) {
    revision = newRevision(record, 1, "finalize", "draft", null, null, a, now);
    statements.push(insert("hospital_form_revisions", revision as unknown as Record<string, unknown>));
  }
  try {
    await dbBatch(statements);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String(e instanceof Error ? e.message : e)) && record.unique_key) {
      throw new Error(`This ${ep?.type === "ipd" ? "admission" : "visit"} already has its ${def.title}. Open it instead of starting another.`);
    }
    throw friendlyDbError(e);
  }
  await recordOutbox("hospital_form_records", id, "insert", record as unknown as Record<string, unknown>);
  if (revision) await recordOutbox("hospital_form_revisions", revision.id, "insert", revision as unknown as Record<string, unknown>);
  return record;
}

function insert(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  return { sql: `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, params: keys.map((k) => row[k] ?? null) };
}

function newRevision(rec: FormRecord, no: number, action: FormRevision["action"], before: FormRecord["status"], dataBefore: string | null, reason: string | null, a: Actor, now: string): FormRevision {
  return {
    id: newId(), tenant_id: rec.tenant_id, record_id: rec.id, revision_no: no, action, status_before: before, data_before: dataBefore,
    reason, user_id: a.userId, user_name: stamp(a), created_at: now, updated_at: now, deleted_at: null,
  };
}

/** Writes a record change and its revision together. */
async function commitChange(rec: FormRecord, patch: Partial<FormRecord>, revision: FormRevision): Promise<FormRecord> {
  const now = revision.created_at;
  const keys = Object.keys(patch);
  await dbBatch([
    {
      sql: `UPDATE hospital_form_records SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND tenant_id = ? AND revision_no = ?`,
      params: [...keys.map((k) => (patch as Record<string, unknown>)[k] ?? null), now, rec.id, rec.tenant_id, rec.revision_no],
    },
    insert("hospital_form_revisions", revision as unknown as Record<string, unknown>),
  ]).catch((e) => {
    // The revision number is unique per record: two people saving at once cannot both win.
    if (/UNIQUE constraint failed/i.test(String(e instanceof Error ? e.message : e))) throw new Error("Someone changed this form at the same time. Reopen it and try again.");
    throw friendlyDbError(e);
  });
  const saved = (await formRecordsRepo.get(rec.id))!;
  await recordOutbox("hospital_form_records", rec.id, "update", saved as unknown as Record<string, unknown>);
  await recordOutbox("hospital_form_revisions", revision.id, "insert", revision as unknown as Record<string, unknown>);
  return saved;
}

/** Signs a draft: every required field must be filled. */
export async function finalizeForm(recordId: string): Promise<FormRecord> {
  const rec = await formRecordsRepo.get(recordId);
  if (!rec) throw new Error("Form not found.");
  const def = requireDef(rec.form_key);
  if (rec.status !== "draft") throw new Error("This form is already finalized.");
  const a = await currentActor();
  if (!roleAllowed(def.finalizeRoles, a)) {
    throw new Error(def.finalizeRoles.includes("senior_doctor")
      ? "This form must be countersigned by the responsible consultant / HoD / medical specialist."
      : `Your designation cannot sign the ${def.title}.`);
  }
  const errors = validateForm(def, JSON.parse(rec.data));
  if (errors.length) throw new Error(errors.join(" "));
  const now = nowIso();
  const no = rec.revision_no + 1;
  return commitChange(rec, { status: "final", finalized_by: a.userId, finalized_by_name: stamp(a), finalized_at: now, revision_no: no }, newRevision(rec, no, "finalize", "draft", null, null, a, now));
}

/** Corrects a finalized record. The values before and the reason are kept. */
export async function amendForm(recordId: string, data: FormData, reason: string): Promise<FormRecord> {
  if (!reason?.trim()) throw new Error("Give the reason for the correction.");
  const rec = await formRecordsRepo.get(recordId);
  if (!rec) throw new Error("Form not found.");
  if (rec.status !== "final" && rec.status !== "amended") throw new Error("Only a finalized form is corrected; edit the draft instead.");
  const def = requireDef(rec.form_key);
  const a = await currentActor();
  if (!(a.full || rec.created_by === a.userId || roleAllowed(def.finalizeRoles, a))) throw new Error("Only the author or a person who can sign this form can correct it.");
  const clean = cleanData(def, data);
  const errors = validateForm(def, clean);
  if (errors.length) throw new Error(errors.join(" "));
  if (JSON.stringify(clean) === rec.data) throw new Error("Nothing was changed.");
  const now = nowIso();
  const no = rec.revision_no + 1;
  return commitChange(
    rec,
    { status: "amended", data: JSON.stringify(clean), summary: summaryOf(def, clean), updated_by: a.userId, updated_by_name: stamp(a), revision_no: no },
    newRevision(rec, no, "amend", rec.status, rec.data, reason.trim(), a, now)
  );
}

/** Withdraws a record entered in error (it stays in the history, marked void). */
export async function voidForm(recordId: string, reason: string): Promise<FormRecord> {
  if (!reason?.trim()) throw new Error("Give the reason for voiding.");
  const rec = await formRecordsRepo.get(recordId);
  if (!rec) throw new Error("Form not found.");
  if (rec.status === "voided") throw new Error("This form is already void.");
  const def = requireDef(rec.form_key);
  const a = await currentActor();
  const allowed = rec.status === "draft" ? a.full || rec.created_by === a.userId : a.full || roleAllowed(def.finalizeRoles, a);
  if (!allowed) throw new Error("You cannot void this form.");
  const now = nowIso();
  const no = rec.revision_no + 1;
  // unique_key is cleared so a single-instance form can be filled again.
  return commitChange(rec, { status: "voided", unique_key: null, revision_no: no }, newRevision(rec, no, "void", rec.status, rec.data, reason.trim(), a, now));
}

export async function listForms(filter: { patientId?: string; episodeId?: string; formKey?: string; includeVoided?: boolean }): Promise<FormRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.patientId) { where.push("patient_id = ?"); params.push(filter.patientId); }
  if (filter.episodeId) { where.push("episode_id = ?"); params.push(filter.episodeId); }
  if (filter.formKey) { where.push("form_key = ?"); params.push(filter.formKey); }
  if (!filter.includeVoided) where.push("status != 'voided'");
  return formRecordsRepo.list({ where: where.join(" AND "), params, orderBy: "created_at ASC" });
}

export async function listRevisions(recordId: string): Promise<FormRevision[]> {
  return formRevisionsRepo.list({ where: "record_id = ?", params: [recordId], orderBy: "revision_no ASC" });
}

/** The forms of a visit / admission: every form that applies, with its records. */
export async function episodeForms(episodeId: string): Promise<{ def: FormDef; records: FormRecord[]; canCreate: boolean; canFinalize: boolean }[]> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit / admission not found.");
  const [records, a] = await Promise.all([listForms({ episodeId }), currentActor()]);
  const { FORMS } = await import("../../config/forms");
  return FORMS.filter((d) => d.scope === "patient" && (!d.episodeTypes?.length || d.episodeTypes.includes(ep.type))).map((def) => ({
    def,
    records: records.filter((r) => r.form_key === def.key),
    canCreate: roleAllowed(def.createRoles, a),
    canFinalize: roleAllowed(def.finalizeRoles, a),
  }));
}

// ── Checklists ────────────────────────────────────────────────────────────

/** What the checklist depends on for a visit / admission. */
export async function checklistContext(episodeId: string): Promise<ChecklistContext> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit / admission not found.");
  const planned = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) AS n FROM hospital_surgery_bookings WHERE tenant_id = ? AND episode_id = ? AND status = 'planned' AND deleted_at IS NULL`,
    [requireCurrentTenantId(), episodeId]
  );
  return { episodeType: ep.type, admitted: ep.type === "ipd" && ep.status === "open", procedurePlanned: (planned[0]?.n ?? 0) > 0 };
}

/** Saves one set of answers (a session) chosen by the user. Nothing is filled in for them. */
export async function saveChecklist(key: string, episodeId: string, answers: ChecklistAnswer[]): Promise<ChecklistEntry[]> {
  const def = checklistDef(key);
  if (!def) throw new Error("Unknown checklist.");
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit / admission not found.");
  const a = await currentActor();
  if (!roleAllowed(["any_clinical"], a)) throw new Error("Only clinical staff record these checks.");
  const ctx = await checklistContext(episodeId);
  const errors = validateChecklist(def, ctx, answers);
  if (errors.length) throw new Error(errors.join(" "));
  const items = applicableItems(def, ctx);
  const t = requireCurrentTenantId();
  const now = nowIso();
  const session = newId();
  const rows: ChecklistEntry[] = answers.filter((x) => x.status).map((x) => ({
    id: newId(), tenant_id: t, session_id: session, checklist_key: def.key, item_key: x.item,
    kind: items.find((i) => i.key === x.item)!.kind, status: x.status as ChecklistEntry["status"], reason: x.reason?.trim() || null,
    patient_id: ep.patient_id, episode_id: ep.id, record_id: null, department: ep.department,
    user_id: a.userId, user_name: stamp(a), user_role: a.role, recorded_at: now, superseded_by: null,
    created_at: now, updated_at: now, deleted_at: null,
  }));
  await dbBatch(rows.map((r) => insert("hospital_checklist_entries", r as unknown as Record<string, unknown>)));
  for (const r of rows) await recordOutbox("hospital_checklist_entries", r.id, "insert", r as unknown as Record<string, unknown>);
  return rows;
}

/** Changes one recorded answer: a new entry is written and the earlier one points to it. */
export async function correctChecklistEntry(entryId: string, status: ChecklistEntry["status"], reason: string): Promise<ChecklistEntry> {
  if (!reason?.trim()) throw new Error("Give the reason for the correction.");
  const old = await checklistRepo.get(entryId);
  if (!old) throw new Error("Entry not found.");
  if (old.superseded_by) throw new Error("This answer was already corrected.");
  const a = await currentActor();
  if (!a.full && old.user_id !== a.userId) throw new Error("Only the person who recorded it can correct it.");
  const now = nowIso();
  const row: ChecklistEntry = { ...old, id: newId(), session_id: old.session_id, status, reason: reason.trim(), user_id: a.userId, user_name: stamp(a), user_role: a.role, recorded_at: now, superseded_by: null, created_at: now, updated_at: now };
  await dbBatch([
    insert("hospital_checklist_entries", row as unknown as Record<string, unknown>),
    { sql: `UPDATE hospital_checklist_entries SET superseded_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND superseded_by IS NULL`, params: [row.id, now, old.id, old.tenant_id] },
  ]);
  await recordOutbox("hospital_checklist_entries", row.id, "insert", row as unknown as Record<string, unknown>);
  return row;
}

export async function listChecklistEntries(episodeId: string): Promise<ChecklistEntry[]> {
  return checklistRepo.list({ where: "episode_id = ?", params: [episodeId], orderBy: "recorded_at DESC" });
}

// ── Vital signs ───────────────────────────────────────────────────────────

const RANGES: Record<string, [number, number, string]> = {
  bp_systolic: [40, 300, "Systolic BP"], bp_diastolic: [20, 200, "Diastolic BP"], pulse: [20, 250, "Pulse"], resp_rate: [4, 80, "Respiratory rate"],
  temperature_c: [30, 45, "Temperature"], spo2: [40, 100, "SpO2"], pain_score: [0, 10, "Pain score"], blood_sugar: [10, 1000, "Blood sugar"], weight_kg: [0.3, 400, "Weight"],
};

export type VitalsInput = Partial<Pick<VitalSigns, "bp_systolic" | "bp_diastolic" | "pulse" | "resp_rate" | "temperature_c" | "spo2" | "pain_score" | "blood_sugar" | "weight_kg" | "consciousness" | "notes">> & { recorded_at?: string };

export async function recordVitals(episodeId: string, v: VitalsInput): Promise<VitalSigns> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit / admission not found.");
  const a = await currentActor();
  if (!roleAllowed(["any_clinical"], a)) throw new Error("Only clinical staff record vital signs.");
  const values: Record<string, number | null> = {};
  for (const [k, [lo, hi, label]] of Object.entries(RANGES)) {
    const raw = (v as Record<string, unknown>)[k];
    if (raw === undefined || raw === null || raw === "") { values[k] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`);
    values[k] = n;
  }
  if (Object.values(values).every((x) => x === null) && !v.consciousness) throw new Error("Enter at least one vital sign.");
  if ((values.bp_systolic === null) !== (values.bp_diastolic === null)) throw new Error("Enter both systolic and diastolic blood pressure.");
  // Stored as UTC like every other timestamp; a local "2026-10-25T10:30" from the form is converted.
  const at = v.recorded_at?.trim() ? new Date(v.recorded_at.trim()) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("Enter a valid date and time.");
  if (at.getTime() > Date.now() + 5 * 60_000) throw new Error("The time recorded cannot be in the future.");
  const when = at.toISOString();
  return vitalsRepo.create({
    patient_id: ep.patient_id, episode_id: ep.id, recorded_at: when, ...values,
    consciousness: v.consciousness?.trim() || null, notes: v.notes?.trim() || null, recorded_by: a.userId, recorded_by_name: stamp(a),
  } as Partial<VitalSigns>);
}

export async function listVitals(episodeId: string): Promise<VitalSigns[]> {
  return vitalsRepo.list({ where: "episode_id = ?", params: [episodeId], orderBy: "recorded_at ASC" });
}
