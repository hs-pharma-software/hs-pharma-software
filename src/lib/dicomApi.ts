/** The DICOM machine API: what a radiology machine (or the Orthanc gateway in
 * front of it) exchanges with the hospital system over HTTPS.
 *
 * - Worklist: the machine's waiting patients as DICOM Modality Worklist items
 *   (DICOM JSON, PS3.18 F.2), so the technologist picks the patient on the
 *   console instead of typing the name. Accession Number = the order number
 *   without "RAD-" and dashes (RAD-20261030-0001 -> 202610300001: DICOM
 *   allows 16 characters), Patient ID = the MR number.
 * - Procedure step (MPPS): the machine reports an examination started,
 *   completed or discontinued. A completed acquisition is recorded; the
 *   examination itself is completed by the technologist in the portal, after
 *   the safety checks, never by the machine.
 * - Study received: the PACS reports the images it stored (Study Instance
 *   UID, series and image counts), so the portal can open them.
 *
 * Each machine has its own key; only its SHA-256 hash is stored. Runs with any
 * database connection (DicomDb), so the server routes and the tests share it. */
import { newId, nowIso } from "./id";
import { standardModalityFor } from "../config/radiologyPortal";

export interface DicomDb {
  select: <T>(sql: string, params: unknown[]) => Promise<T[]>;
  execute: (sql: string, params: unknown[]) => Promise<unknown>;
}

export class DicomApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface MachineRow {
  id: string;
  tenant_id: string;
  machine_code: string;
  name: string;
  modality_code: string;
  ae_title: string | null;
  status: string;
}

export interface ModalityRef {
  code: string;
  name: string;
  universal_name?: string | null;
  dicom_code?: string | null;
}

// ── Keys and identifiers ──────────────────────────────────────────────────

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new machine key: "hmsk_" and 43 random characters (256 bits). */
export function newMachineKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `hmsk_${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** The key's visible start, to tell keys apart on screen ("hmsk_Ab3d…"). */
export const keyHint = (key: string) => `${key.slice(0, 9)}…`;

/** A DICOM UID for an order: "2.25." and the order's UUID as one number
 * (the UUID-derived root of PS3.5 B.2), so it is the same every time. */
export async function studyUidFor(orderId: string): Promise<string> {
  const hex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)
    ? orderId.replace(/-/g, "")
    : (await sha256Hex(orderId)).slice(0, 32);
  return `2.25.${BigInt(`0x${hex}`).toString()}`;
}

/** The Accession Number of an order: RAD-20261030-0001 -> 202610300001. */
export function accessionFor(orderNo: string): string {
  return /^RAD-\d{8}-\d+$/.test(orderNo) ? orderNo.slice(4).replace("-", "") : orderNo;
}

/** The order number an Accession Number stands for (either form is accepted). */
export function orderNoFor(accession: string): string {
  const a = accession.trim();
  return /^\d{9,16}$/.test(a) ? `RAD-${a.slice(0, 8)}-${a.slice(8)}` : a;
}

// ── Modalities ────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The modality code of a study's modality text: the hospital's own
 * modalities first (code, name or universal name), then the standard list. */
export function modalityCodeFor(text: string | null | undefined, modalities: ModalityRef[]): string | null {
  const t = norm(text);
  if (!t) return null;
  const own = modalities.find((m) => norm(m.code) === t || norm(m.name) === t || norm(m.universal_name) === t);
  if (own) return own.code;
  const std = standardModalityFor(t);
  if (!std) return null;
  return modalities.find((m) => norm(m.code) === norm(std.code))?.code ?? std.code;
}

/** DICOM Modality (0008,0060) of a modality code. */
export function dicomModalityOf(code: string, modalities: ModalityRef[]): string {
  const own = modalities.find((m) => norm(m.code) === norm(code));
  return (own?.dicom_code || standardModalityFor(code)?.dicom || standardModalityFor(own?.name)?.dicom || "OT").toUpperCase();
}

// ── Worklist ──────────────────────────────────────────────────────────────

export interface WorklistOrder {
  id: string;
  order_no: string;
  patient_id: string;
  study: string;
  body_part: string | null;
  priority: string;
  status: string;
  ordered_at: string;
  ordered_by: string | null;
  fee: number | null;
  paid: number | null;
  machine_id: string | null;
  modality_code: string | null;
  service_modality: string | null;
  study_uid: string | null;
  clinical_history: string | null;
  exam_started_at: string | null;
  patient_name: string;
  mr_no: string;
  dob: string | null;
  gender: string | null;
  age_years: number | null;
  phone: string | null;
  cnic: string | null;
}

const PRIORITY_RANK: Record<string, number> = { stat: 0, urgent: 1, routine: 2 };
const isPaid = (o: { fee?: number | null; paid?: number | null }) => !(Number(o.fee) > 0) || Number(o.paid) === 1;

/** The orders waiting for (or on) a machine, in queue order: the patient
 * being examined first, then STAT, urgent, routine, oldest first. An order
 * joins the queue of its modality's machines once its fee is paid; once a
 * technologist starts it on a machine it stays with that machine. */
export async function machineWorklist(io: DicomDb, tenantId: string, machine: MachineRow, modalities: ModalityRef[]): Promise<WorklistOrder[]> {
  const rows = await io.select<WorklistOrder>(
    `SELECT o.id, o.order_no, o.patient_id, o.modality AS study, o.body_part, o.priority, o.status, o.ordered_at, o.ordered_by, o.fee, o.paid,
            o.machine_id, o.modality_code, s.modality AS service_modality, o.study_uid, o.clinical_history, o.exam_started_at,
            p.name AS patient_name, p.mr_no, p.dob, p.gender, p.age_years, p.phone, p.cnic
     FROM hospital_imaging_orders o
     JOIN hospital_patients p ON p.id = o.patient_id
     LEFT JOIN hospital_services s ON s.id = o.service_id
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND o.status IN ('pending', 'in_progress') AND (o.machine_id IS NULL OR o.machine_id = ?)`,
    [tenantId, machine.id]
  );
  return rows
    .filter((o) => isPaid(o))
    .filter((o) => o.machine_id === machine.id || (o.modality_code ?? modalityCodeFor(o.service_modality, modalities)) === machine.modality_code)
    .sort((a, b) =>
      Number(b.status === "in_progress") - Number(a.status === "in_progress")
      || (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
      || a.ordered_at.localeCompare(b.ordered_at));
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** DICOM text: no backslash (the value separator), no control characters, within the length limit. */
const text = (s: string | null | undefined, max = 64) => (s ?? "").replace(/[\\\x00-\x1f]/g, " ").trim().slice(0, max);
const SEX: Record<string, string> = { Male: "M", Female: "F", Other: "O" };
const DICOM_PRIORITY: Record<string, string> = { stat: "STAT", urgent: "HIGH", routine: "ROUTINE" };

/** One worklist item with DICOM keywords as keys (Orthanc's format). */
export async function worklistItem(o: WorklistOrder, machine: MachineRow, modalities: ModalityRef[]): Promise<Record<string, unknown>> {
  const date = digits(o.ordered_at.slice(0, 10));
  const time = digits(o.ordered_at.slice(11)).padEnd(6, "0").slice(0, 6);
  const description = text(o.body_part ? `${o.study} - ${o.body_part}` : o.study);
  return {
    SpecificCharacterSet: "ISO_IR 192",
    AccessionNumber: accessionFor(o.order_no),
    PatientName: text(o.patient_name).replace(/[\^=]/g, " "),
    PatientID: text(o.mr_no),
    PatientBirthDate: o.dob && /^\d{4}-\d{2}-\d{2}/.test(o.dob) ? digits(o.dob.slice(0, 10)) : "",
    PatientSex: SEX[o.gender ?? ""] ?? "",
    OtherPatientIDs: text(o.cnic),
    StudyInstanceUID: o.study_uid || (await studyUidFor(o.id)),
    ReferringPhysicianName: text(o.ordered_by).replace(/[\^=]/g, " "),
    RequestedProcedureDescription: description,
    RequestedProcedureID: accessionFor(o.order_no),
    RequestedProcedurePriority: DICOM_PRIORITY[o.priority] ?? "ROUTINE",
    ScheduledProcedureStepSequence: [{
      Modality: dicomModalityOf(machine.modality_code, modalities),
      ScheduledStationAETitle: text(machine.ae_title, 16),
      ScheduledStationName: text(machine.name, 16),
      ScheduledProcedureStepStartDate: date,
      ScheduledProcedureStepStartTime: time,
      ScheduledProcedureStepDescription: description,
      ScheduledProcedureStepID: accessionFor(o.order_no),
    }],
  };
}

/** Keyword -> [tag, VR] for the attributes the worklist uses. */
const TAGS: Record<string, [string, string]> = {
  SpecificCharacterSet: ["00080005", "CS"],
  AccessionNumber: ["00080050", "SH"],
  Modality: ["00080060", "CS"],
  ReferringPhysicianName: ["00080090", "PN"],
  PatientName: ["00100010", "PN"],
  PatientID: ["00100020", "LO"],
  PatientBirthDate: ["00100030", "DA"],
  PatientSex: ["00100040", "CS"],
  OtherPatientIDs: ["00101000", "LO"],
  StudyInstanceUID: ["0020000D", "UI"],
  RequestedProcedureDescription: ["00321060", "LO"],
  ScheduledStationAETitle: ["00400001", "AE"],
  ScheduledProcedureStepStartDate: ["00400002", "DA"],
  ScheduledProcedureStepStartTime: ["00400003", "TM"],
  ScheduledProcedureStepDescription: ["00400007", "LO"],
  ScheduledProcedureStepID: ["00400009", "SH"],
  ScheduledStationName: ["00400010", "SH"],
  ScheduledProcedureStepSequence: ["00400100", "SQ"],
  RequestedProcedureID: ["00401001", "SH"],
  RequestedProcedurePriority: ["00401003", "SH"],
};

/** Keywords to DICOM JSON ({"00100010": {"vr": "PN", "Value": [{"Alphabetic": ...}]}}). */
export function toDicomJson(item: Record<string, unknown>): Record<string, { vr: string; Value?: unknown[] }> {
  const out: Record<string, { vr: string; Value?: unknown[] }> = {};
  for (const [k, v] of Object.entries(item)) {
    const t = TAGS[k];
    if (!t) continue;
    const [tag, vr] = t;
    if (vr === "SQ") out[tag] = { vr, Value: (v as Record<string, unknown>[]).map(toDicomJson) };
    else if (v === "" || v == null) out[tag] = { vr };
    else out[tag] = { vr, Value: [vr === "PN" ? { Alphabetic: String(v) } : String(v)] };
  }
  return out;
}

// ── Requests from a machine ───────────────────────────────────────────────

export async function authenticateMachine(io: DicomDb, key: string | null | undefined): Promise<MachineRow> {
  const k = (key ?? "").trim();
  if (!/^hmsk_[A-Za-z0-9_-]{40,}$/.test(k)) throw new DicomApiError(401, "Send the machine key as 'Authorization: Bearer hmsk_...'.");
  const m = (await io.select<MachineRow>(
    `SELECT id, tenant_id, machine_code, name, modality_code, ae_title, status FROM radiology_machines WHERE api_key_hash = ? AND deleted_at IS NULL`,
    [await sha256Hex(k)]
  ))[0];
  if (!m) throw new DicomApiError(401, "This machine key is not valid. Create a new key on Radiology > Machines.");
  if (m.status !== "active") throw new DicomApiError(403, `Machine ${m.machine_code} is set to "${m.status}" in the portal.`);
  return m;
}

/** Records that the machine connected. */
export async function touchMachine(io: DicomDb, m: MachineRow): Promise<void> {
  const ts = nowIso();
  await io.execute(`UPDATE radiology_machines SET last_seen_at = ? WHERE id = ? AND tenant_id = ?`, [ts, m.id, m.tenant_id]);
}

async function logEvent(io: DicomDb, m: MachineRow, orderId: string | null, kind: string, detail: string): Promise<void> {
  const ts = nowIso();
  await io.execute(
    `INSERT INTO radiology_dicom_events (id, tenant_id, machine_id, order_id, kind, detail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), m.tenant_id, m.id, orderId, kind, detail.slice(0, 500), ts, ts]
  );
}

async function tenantModalities(io: DicomDb, tenantId: string): Promise<ModalityRef[]> {
  return io.select<ModalityRef>(`SELECT code, name, universal_name, dicom_code FROM radiology_modalities WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId]);
}

/** GET worklist: the machine's queue, as DICOM JSON or with keywords. */
export async function getWorklist(io: DicomDb, m: MachineRow, format: "dicom" | "keywords" = "dicom"): Promise<unknown[]> {
  const modalities = await tenantModalities(io, m.tenant_id);
  const orders = await machineWorklist(io, m.tenant_id, m, modalities);
  const items: Record<string, unknown>[] = [];
  for (const o of orders) {
    const item = await worklistItem(o, m, modalities);
    if (!o.study_uid) {
      await io.execute(`UPDATE hospital_imaging_orders SET study_uid = ? WHERE id = ? AND tenant_id = ? AND study_uid IS NULL`, [item.StudyInstanceUID, o.id, m.tenant_id]);
    }
    items.push(item);
  }
  return format === "keywords" ? items : items.map(toDicomJson);
}

interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  fee: number | null;
  paid: number | null;
  machine_id: string | null;
  study_uid: string | null;
}

async function findOrder(io: DicomDb, m: MachineRow, accession: string | null | undefined, studyUid?: string | null): Promise<OrderRow | null> {
  const cols = `id, order_no, status, fee, paid, machine_id, study_uid`;
  const acc = (accession ?? "").trim();
  if (acc) {
    const r = (await io.select<OrderRow>(`SELECT ${cols} FROM hospital_imaging_orders WHERE tenant_id = ? AND order_no IN (?, ?) AND deleted_at IS NULL`, [m.tenant_id, acc, orderNoFor(acc)]))[0];
    if (r) return r;
  }
  const uid = (studyUid ?? "").trim();
  if (uid) return (await io.select<OrderRow>(`SELECT ${cols} FROM hospital_imaging_orders WHERE tenant_id = ? AND study_uid = ? AND deleted_at IS NULL`, [m.tenant_id, uid]))[0] ?? null;
  return null;
}

const count = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n : null;
};
const UID_RE = /^[0-9]+(\.[0-9]+)*$/;

export type MppsStatus = "in_progress" | "completed" | "discontinued";

export function mppsStatusOf(v: unknown): MppsStatus | null {
  const s = String(v ?? "").trim().toUpperCase().replace(/[\s_-]+/g, " ");
  return s === "IN PROGRESS" ? "in_progress" : s === "COMPLETED" ? "completed" : s === "DISCONTINUED" ? "discontinued" : null;
}

/** POST procedure step (MPPS). Body: { accessionNumber, status: "IN PROGRESS" |
 * "COMPLETED" | "DISCONTINUED", studyInstanceUid?, seriesCount?, imagesCount? }. */
export async function postProcedureStep(io: DicomDb, m: MachineRow, body: Record<string, unknown>): Promise<{ accessionNumber: string; status: string; acquisition: MppsStatus }> {
  const step = mppsStatusOf(body.status);
  if (!step) throw new DicomApiError(400, "status must be IN PROGRESS, COMPLETED or DISCONTINUED.");
  const uid = typeof body.studyInstanceUid === "string" && UID_RE.test(body.studyInstanceUid) && body.studyInstanceUid.length <= 64 ? body.studyInstanceUid : null;
  const o = await findOrder(io, m, typeof body.accessionNumber === "string" ? body.accessionNumber : null, uid);
  if (!o) throw new DicomApiError(404, "No radiology order has this Accession Number.");
  if (o.status === "cancelled" || o.status === "reported") throw new DicomApiError(409, `Order ${o.order_no} is ${o.status}.`);
  if (!isPaid(o)) throw new DicomApiError(409, `The fee of order ${o.order_no} is not paid yet.`);
  if (o.status === "in_progress" && o.machine_id && o.machine_id !== m.id) throw new DicomApiError(409, `Order ${o.order_no} is being examined on another machine.`);
  const ts = nowIso();
  const sets: string[] = ["acquisition_status = ?", "updated_at = ?"];
  const args: unknown[] = [step, ts];
  if (uid && !o.study_uid) { sets.push("study_uid = ?"); args.push(uid); }
  const series = count(body.seriesCount);
  const images = count(body.imagesCount);
  if (series != null) { sets.push("series_count = ?"); args.push(series); }
  if (images != null) { sets.push("images_count = ?"); args.push(images); }
  let status = o.status;
  if (step === "in_progress" && o.status === "pending") {
    status = "in_progress";
    sets.push("status = 'in_progress'", "machine_id = ?", "exam_started_at = COALESCE(exam_started_at, ?)", "exam_started_by_name = COALESCE(exam_started_by_name, ?)");
    args.push(m.id, ts.slice(0, 16).replace("T", " "), `${m.name} (machine)`);
  }
  await io.execute(`UPDATE hospital_imaging_orders SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, [...args, o.id, m.tenant_id]);
  await logEvent(io, m, o.id, "mpps", `${o.order_no}: ${step}${images != null ? `, ${images} images` : ""}`);
  return { accessionNumber: o.order_no, status, acquisition: step };
}

/** POST study received. Body: { accessionNumber?, studyInstanceUid, seriesCount?, imagesCount? }. */
export async function postStudyReceived(io: DicomDb, m: MachineRow, body: Record<string, unknown>): Promise<{ accessionNumber: string; studyInstanceUid: string }> {
  const uid = typeof body.studyInstanceUid === "string" ? body.studyInstanceUid.trim() : "";
  if (!UID_RE.test(uid) || uid.length > 64) throw new DicomApiError(400, "studyInstanceUid must be a DICOM UID (digits and dots, at most 64).");
  const o = await findOrder(io, m, typeof body.accessionNumber === "string" ? body.accessionNumber : null, uid);
  if (!o) {
    await logEvent(io, m, null, "study_unmatched", `Study ${uid} has no matching order (accession ${String(body.accessionNumber ?? "-")}).`);
    throw new DicomApiError(404, "No radiology order matches this study's Accession Number or Study Instance UID.");
  }
  if (o.status === "cancelled") throw new DicomApiError(409, `Order ${o.order_no} is cancelled.`);
  const ts = nowIso();
  await io.execute(
    `UPDATE hospital_imaging_orders SET study_uid = ?, series_count = COALESCE(?, series_count), images_count = COALESCE(?, images_count),
            images_received_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    [uid, count(body.seriesCount), count(body.imagesCount), ts, ts, o.id, m.tenant_id]
  );
  await logEvent(io, m, o.id, "study", `${o.order_no}: study received${count(body.imagesCount) != null ? `, ${count(body.imagesCount)} images` : ""}`);
  return { accessionNumber: o.order_no, studyInstanceUid: uid };
}
