/** Radiology portal: modalities, machines (and their DICOM API keys), report
 * templates, the PACS link, the reception dashboard and order list, the
 * technologist's examination, and the radiologist's reporting worklist. */
import { dbExecute, dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { localDate, localDateTime } from "../localDate";
import { currentActor, roleAllowed } from "./medicalRecord";
import { hospitalImagingRepo, hospitalPatientsRepo } from "./hospital";
import { canProcess, reportImaging } from "./hospitalOpd";
import { machineWorklist, modalityCodeFor, newMachineKey, sha256Hex, keyHint, type MachineRow, type ModalityRef, type WorklistOrder } from "../dicomApi";
import { STANDARD_MODALITIES, DICOM_MODALITY_CODES, parseExam, validateExam, type ExamData } from "../../config/radiologyPortal";
import { RADIOLOGY_ADMIN_ROLES, TECHNOLOGIST_ROLES, TECHNOLOGIST_ASSIGN_ROLES } from "../../config/hospitalStaff";
import type { HospitalImagingOrder, HospitalPatient } from "../types-hospital";

export interface RadiologyModality extends TenantRow {
  code: string;
  name: string;
  dicom_code: string | null;
  universal_name: string | null;
  outsourced: number;
  is_active: number;
  notes: string | null;
}

export type MachineStatus = "active" | "maintenance" | "retired";

export interface RadiologyMachine extends TenantRow {
  machine_code: string;
  name: string;
  modality_code: string;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  location: string | null;
  status: MachineStatus;
  ae_title: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  /** Never sent to the browser in the web version (server HIDDEN_COLUMNS). */
  api_key_hash?: string | null;
  api_key_hint: string | null;
  last_seen_at: string | null;
  notes: string | null;
}

export interface RadiologyTemplate extends TenantRow {
  name: string;
  modality_code: string | null;
  service_id: string | null;
  findings: string | null;
  impression: string | null;
  is_active: number;
}

export interface RadiologyPacs extends TenantRow {
  name: string;
  orthanc_url: string | null;
  viewer_url: string | null;
  ae_title: string | null;
  dicom_host: string | null;
  dicom_port: number | null;
  is_active: number;
  notes: string | null;
}

export interface DicomEvent extends TenantRow {
  machine_id: string | null;
  order_id: string | null;
  kind: string;
  detail: string | null;
}

export const modalitiesRepo = createTenantRepo<RadiologyModality>("radiology_modalities");
export const machinesRepo = createTenantRepo<RadiologyMachine>("radiology_machines");
export const templatesRepo = createTenantRepo<RadiologyTemplate>("radiology_templates");
export const pacsRepo = createTenantRepo<RadiologyPacs>("radiology_pacs");
export const dicomEventsRepo = createTenantRepo<DicomEvent>("radiology_dicom_events");

const io = { select: dbSelect, execute: dbExecute };
const clean = (s: string | null | undefined) => (s ?? "").trim() || null;

async function requireRole(roles: string[], what: string) {
  const a = await currentActor();
  if (!roleAllowed(roles as never, a)) throw new Error(`Your login cannot ${what}.`);
  return a;
}

// ── Modalities ────────────────────────────────────────────────────────────

export async function listModalities(opts: { includeInactive?: boolean } = {}): Promise<RadiologyModality[]> {
  const all = await modalitiesRepo.list({ orderBy: "name ASC" });
  return opts.includeInactive ? all : all.filter((m) => m.is_active);
}

export interface ModalityInput {
  code: string;
  name: string;
  dicom_code?: string | null;
  universal_name?: string | null;
  outsourced?: boolean;
  is_active?: boolean;
  notes?: string | null;
}

export async function saveModality(id: string | null, m: ModalityInput): Promise<RadiologyModality> {
  await requireRole(RADIOLOGY_ADMIN_ROLES, "set up modalities");
  const code = m.code.trim().toUpperCase();
  const name = m.name.trim();
  if (!/^[A-Z0-9_-]{1,16}$/.test(code)) throw new Error("The code is 1 to 16 letters or digits, e.g. CT, US, XRAY.");
  if (!name) throw new Error("Enter the modality name.");
  const dicom = (m.dicom_code ?? "").trim().toUpperCase() || null;
  if (dicom && !DICOM_MODALITY_CODES.includes(dicom)) throw new Error(`DICOM modality must be one of ${DICOM_MODALITY_CODES.join(", ")}.`);
  const clash = (await listModalities({ includeInactive: true })).find((x) => x.code === code && x.id !== id);
  if (clash) throw new Error(`Modality ${code} already exists.`);
  const existing = id ? await modalitiesRepo.get(id) : null;
  if (id && !existing) throw new Error("Modality not found.");
  if (existing && existing.code !== code && (await machinesRepo.list({ where: "modality_code = ?", params: [existing.code] })).length) {
    throw new Error(`Machines use ${existing.code}; its code cannot change.`);
  }
  const payload: Partial<RadiologyModality> = {
    code, name, dicom_code: dicom, universal_name: clean(m.universal_name), outsourced: m.outsourced ? 1 : 0,
    is_active: m.is_active === false ? 0 : 1, notes: clean(m.notes),
  };
  return id ? (await modalitiesRepo.update(id, payload))! : modalitiesRepo.create(payload);
}

export async function deleteModality(id: string): Promise<void> {
  await requireRole(RADIOLOGY_ADMIN_ROLES, "set up modalities");
  const m = await modalitiesRepo.get(id);
  if (!m) throw new Error("Modality not found.");
  if ((await machinesRepo.list({ where: "modality_code = ?", params: [m.code] })).length) throw new Error(`Machines use ${m.code}. Delete or change them first.`);
  await modalitiesRepo.remove(id);
}

/** Adds the standard modalities this hospital does not have yet. */
export async function loadStandardModalities(): Promise<number> {
  await requireRole(RADIOLOGY_ADMIN_ROLES, "set up modalities");
  const have = new Set((await listModalities({ includeInactive: true })).map((m) => m.code));
  let added = 0;
  for (const s of STANDARD_MODALITIES) {
    if (have.has(s.code)) continue;
    await modalitiesRepo.create({ code: s.code, name: s.name, dicom_code: s.dicom, universal_name: s.name, outsourced: 0, is_active: 1, notes: null });
    added++;
  }
  return added;
}

const modalityRefs = async (): Promise<ModalityRef[]> => (await listModalities({ includeInactive: true })).map((m) => ({ code: m.code, name: m.name, universal_name: m.universal_name, dicom_code: m.dicom_code }));

/** The modality code of a radiology study (Performing Images). */
export async function modalityCodeOfStudy(studyModality: string | null | undefined): Promise<string | null> {
  return modalityCodeFor(studyModality, await modalityRefs());
}

// ── Machines ──────────────────────────────────────────────────────────────

export interface MachineInput {
  name: string;
  modality_code: string;
  machine_code?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_no?: string | null;
  location?: string | null;
  status?: MachineStatus;
  ae_title?: string | null;
  notes?: string | null;
}

export async function listMachines(): Promise<RadiologyMachine[]> {
  return machinesRepo.list({ orderBy: "machine_code ASC" });
}

async function nextMachineCode(): Promise<string> {
  const taken = new Set((await dbSelect<{ c: string }>(`SELECT machine_code AS c FROM radiology_machines WHERE tenant_id = ?`, [requireCurrentTenantId()])).map((r) => r.c));
  let n = taken.size + 1;
  while (taken.has(`MACH-${String(n).padStart(3, "0")}`)) n++;
  return `MACH-${String(n).padStart(3, "0")}`;
}

export async function saveMachine(id: string | null, m: MachineInput): Promise<RadiologyMachine> {
  await requireRole(RADIOLOGY_ADMIN_ROLES, "set up machines");
  const name = m.name.trim();
  if (!name) throw new Error("Enter the machine name.");
  const modality = (await listModalities({ includeInactive: true })).find((x) => x.code === m.modality_code);
  if (!modality) throw new Error("Choose the machine's modality (add it on Modalities first).");
  const ae = (m.ae_title ?? "").trim().toUpperCase() || null;
  if (ae && !/^[A-Z0-9_ -]{1,16}$/.test(ae)) throw new Error("The AE Title is up to 16 letters, digits, spaces, - or _ (as set on the machine).");
  const all = await listMachines();
  if (ae && all.some((x) => x.ae_title === ae && x.id !== id)) throw new Error(`Another machine already uses AE Title ${ae}.`);
  const code = (m.machine_code ?? "").trim().toUpperCase();
  if (code && all.some((x) => x.machine_code === code && x.id !== id)) throw new Error(`Machine code ${code} is taken.`);
  const existing = id ? await machinesRepo.get(id) : null;
  if (id && !existing) throw new Error("Machine not found.");
  const payload: Partial<RadiologyMachine> = {
    name, modality_code: modality.code, machine_code: code || existing?.machine_code || (await nextMachineCode()),
    manufacturer: clean(m.manufacturer), model: clean(m.model), serial_no: clean(m.serial_no), location: clean(m.location),
    status: m.status ?? existing?.status ?? "active", ae_title: ae, notes: clean(m.notes),
  };
  return id ? (await machinesRepo.update(id, payload))! : machinesRepo.create(payload);
}

export async function deleteMachine(id: string): Promise<void> {
  await requireRole(RADIOLOGY_ADMIN_ROLES, "set up machines");
  const busy = await hospitalImagingRepo.list({ where: "machine_id = ? AND status = 'in_progress'", params: [id] });
  if (busy.length) throw new Error("An examination is in progress on this machine.");
  await machinesRepo.update(id, { api_key_hash: null, api_key_hint: null });
  await machinesRepo.remove(id);
}

/** A new API key for the machine; the old one stops working. The key is
 * returned once to show the user: only its hash is stored. */
export async function createMachineKey(id: string): Promise<string> {
  await requireRole(RADIOLOGY_ADMIN_ROLES, "create machine keys");
  if (!(await machinesRepo.get(id))) throw new Error("Machine not found.");
  const key = newMachineKey();
  await machinesRepo.update(id, { api_key_hash: await sha256Hex(key), api_key_hint: keyHint(key) });
  return key;
}

export async function revokeMachineKey(id: string): Promise<void> {
  await requireRole(RADIOLOGY_ADMIN_ROLES, "revoke machine keys");
  if (!(await machinesRepo.get(id))) throw new Error("Machine not found.");
  await machinesRepo.update(id, { api_key_hash: null, api_key_hint: null });
}

export interface Technologist {
  user_id: string;
  name: string;
}

/** Logins of the radiology technologists (radiographers) and administrators. */
export async function listTechnologists(): Promise<Technologist[]> {
  return dbSelect<Technologist>(
    `SELECT user_id, name FROM staff WHERE tenant_id = ? AND deleted_at IS NULL AND user_id IS NOT NULL AND staff_category IN (${TECHNOLOGIST_ROLES.map(() => "?").join(",")}) ORDER BY name`,
    [requireCurrentTenantId(), ...TECHNOLOGIST_ROLES]
  );
}

/** Assigns a machine to a technologist (null unassigns). */
export async function assignMachine(machineId: string, userId: string | null): Promise<RadiologyMachine> {
  await requireRole(TECHNOLOGIST_ASSIGN_ROLES, "assign machines");
  if (!(await machinesRepo.get(machineId))) throw new Error("Machine not found.");
  if (!userId) return (await machinesRepo.update(machineId, { assigned_user_id: null, assigned_user_name: null }))!;
  const t = (await listTechnologists()).find((x) => x.user_id === userId);
  if (!t) throw new Error("Choose a technologist login.");
  return (await machinesRepo.update(machineId, { assigned_user_id: t.user_id, assigned_user_name: t.name }))!;
}

/** Online = the machine (or its gateway) called the API in the last 15 minutes. */
export function machineConnection(m: { last_seen_at: string | null }, now = Date.now()): "online" | "offline" | "never" {
  if (!m.last_seen_at) return "never";
  return now - Date.parse(m.last_seen_at) <= 15 * 60_000 ? "online" : "offline";
}

function asMachineRow(m: RadiologyMachine): MachineRow {
  return { id: m.id, tenant_id: m.tenant_id, machine_code: m.machine_code, name: m.name, modality_code: m.modality_code, ae_title: m.ae_title, status: m.status };
}

/** The machine's queue (the same list its DICOM worklist sends). */
export async function machineQueue(machine: RadiologyMachine): Promise<WorklistOrder[]> {
  return machineWorklist(io, requireCurrentTenantId(), asMachineRow(machine), await modalityRefs());
}

export interface MachineWithQueue extends RadiologyMachine {
  queue: number;
  connection: "online" | "offline" | "never";
}

export async function listMachinesWithQueue(): Promise<MachineWithQueue[]> {
  const refs = await modalityRefs();
  const out: MachineWithQueue[] = [];
  for (const m of await listMachines()) {
    const q = m.status === "active" ? await machineWorklist(io, requireCurrentTenantId(), asMachineRow(m), refs) : [];
    out.push({ ...m, queue: q.length, connection: machineConnection(m) });
  }
  return out;
}

export async function recentDicomEvents(machineId: string, limit = 20): Promise<DicomEvent[]> {
  return dbSelect<DicomEvent>(
    `SELECT * FROM radiology_dicom_events WHERE tenant_id = ? AND machine_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
    [requireCurrentTenantId(), machineId, limit]
  );
}

// ── Templates ─────────────────────────────────────────────────────────────

export interface TemplateInput {
  name: string;
  modality_code?: string | null;
  service_id?: string | null;
  findings?: string | null;
  impression?: string | null;
  is_active?: boolean;
}

export async function listTemplates(opts: { includeInactive?: boolean } = {}): Promise<RadiologyTemplate[]> {
  const all = await templatesRepo.list({ orderBy: "name ASC" });
  return opts.includeInactive ? all : all.filter((t) => t.is_active);
}

export async function saveTemplate(id: string | null, t: TemplateInput): Promise<RadiologyTemplate> {
  await requireRole([...RADIOLOGY_ADMIN_ROLES, "radiologist"], "edit report templates");
  const name = t.name.trim();
  if (!name) throw new Error("Enter the template name.");
  if (!clean(t.findings) && !clean(t.impression)) throw new Error("Enter the findings or the impression.");
  const payload: Partial<RadiologyTemplate> = {
    name, modality_code: clean(t.modality_code), service_id: clean(t.service_id), findings: clean(t.findings), impression: clean(t.impression),
    is_active: t.is_active === false ? 0 : 1,
  };
  if (id && !(await templatesRepo.get(id))) throw new Error("Template not found.");
  return id ? (await templatesRepo.update(id, payload))! : templatesRepo.create(payload);
}

export async function deleteTemplate(id: string): Promise<void> {
  await requireRole([...RADIOLOGY_ADMIN_ROLES, "radiologist"], "edit report templates");
  await templatesRepo.remove(id);
}

/** Templates for an order: those of its study first, then its modality, then general ones. */
export async function templatesFor(order: Pick<HospitalImagingOrder, "service_id" | "modality_code">, studyModality?: string | null): Promise<RadiologyTemplate[]> {
  const code = order.modality_code ?? (await modalityCodeOfStudy(studyModality));
  const rank = (t: RadiologyTemplate) => (t.service_id && t.service_id === order.service_id ? 0 : t.modality_code && t.modality_code === code ? 1 : !t.service_id && !t.modality_code ? 2 : 9);
  return (await listTemplates()).filter((t) => rank(t) < 9).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ── PACS (Orthanc) ────────────────────────────────────────────────────────

export interface PacsInput {
  name: string;
  orthanc_url?: string | null;
  viewer_url?: string | null;
  ae_title?: string | null;
  dicom_host?: string | null;
  dicom_port?: number | null;
  notes?: string | null;
}

export async function getPacs(): Promise<RadiologyPacs | null> {
  return (await pacsRepo.list({ orderBy: "created_at ASC" })).find((p) => p.is_active) ?? null;
}

const httpUrl = (s: string | null | undefined) => {
  const v = clean(s);
  if (v && !/^https?:\/\/[^\s]+$/i.test(v)) throw new Error("A web address starts with http:// or https://.");
  return v ? v.replace(/\/+$/, "") : null;
};

export async function savePacs(p: PacsInput): Promise<RadiologyPacs> {
  await requireRole(RADIOLOGY_ADMIN_ROLES, "configure the PACS");
  const name = p.name.trim() || "Orthanc PACS";
  const viewer = httpUrl(p.viewer_url);
  if (viewer && !/\{(StudyInstanceUID|AccessionNumber|PatientID)\}/.test(viewer)) {
    throw new Error("The viewer address needs {StudyInstanceUID} or {AccessionNumber} where the study goes.");
  }
  const port = p.dicom_port == null || String(p.dicom_port) === "" ? null : Number(p.dicom_port);
  if (port != null && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error("The DICOM port is a number from 1 to 65535 (usually 4242 or 104).");
  const ae = (p.ae_title ?? "").trim().toUpperCase() || null;
  if (ae && !/^[A-Z0-9_ -]{1,16}$/.test(ae)) throw new Error("The AE Title is up to 16 letters, digits, spaces, - or _.");
  const payload: Partial<RadiologyPacs> = {
    name, orthanc_url: httpUrl(p.orthanc_url), viewer_url: viewer, ae_title: ae, dicom_host: clean(p.dicom_host), dicom_port: port, is_active: 1, notes: clean(p.notes),
  };
  const current = await getPacs();
  return current ? (await pacsRepo.update(current.id, payload))! : pacsRepo.create(payload);
}

/** Where to open an order's images: the viewer address with the study filled
 * in, or Orthanc's Stone viewer; null when the PACS has no images for it yet. */
export function imagesUrl(order: Pick<HospitalImagingOrder, "study_uid" | "order_no" | "images_received_at">, pacs: RadiologyPacs | null, mrNo = ""): string | null {
  if (!pacs || !order.study_uid || !order.images_received_at) return null;
  const fill = (s: string) => s
    .replace(/\{StudyInstanceUID\}/g, encodeURIComponent(order.study_uid!))
    .replace(/\{AccessionNumber\}/g, encodeURIComponent(order.order_no))
    .replace(/\{PatientID\}/g, encodeURIComponent(mrNo));
  if (pacs.viewer_url) return fill(pacs.viewer_url);
  if (pacs.orthanc_url) return `${pacs.orthanc_url}/stone-webviewer/index.html?study=${encodeURIComponent(order.study_uid)}`;
  return null;
}

// ── Reception: dashboard and orders ───────────────────────────────────────

export interface RadiologyStats {
  todaysOrders: number;
  pending: number;
  awaitingFee: number;
  activeMachines: number;
  waitingQueue: number;
  inProgress: number;
  toReport: number;
  reportedToday: number;
}

export async function radiologyStats(): Promise<RadiologyStats> {
  const t = requireCurrentTenantId();
  const today = localDate();
  const r = (await dbSelect<Record<string, number>>(
    `SELECT
       SUM(CASE WHEN ordered_at LIKE ? THEN 1 ELSE 0 END) AS todays,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'pending' AND COALESCE(fee, 0) > 0 AND COALESCE(paid, 0) != 1 THEN 1 ELSE 0 END) AS unpaid,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS progress,
       SUM(CASE WHEN status = 'performed' THEN 1 ELSE 0 END) AS to_report,
       SUM(CASE WHEN status = 'reported' AND reported_at LIKE ? THEN 1 ELSE 0 END) AS reported_today
     FROM hospital_imaging_orders WHERE tenant_id = ? AND deleted_at IS NULL`,
    [`${today}%`, `${today}%`, t]
  ))[0] ?? {};
  const machines = (await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM radiology_machines WHERE tenant_id = ? AND deleted_at IS NULL AND status = 'active'`, [t]))[0]?.n ?? 0;
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    todaysOrders: n("todays"), pending: n("pending"), awaitingFee: n("unpaid"), activeMachines: machines,
    waitingQueue: n("pending") - n("unpaid"), inProgress: n("progress"), toReport: n("to_report"), reportedToday: n("reported_today"),
  };
}

export interface PortalOrderRow extends HospitalImagingOrder {
  patient_name: string;
  mr_no: string;
  cnic: string | null;
  phone: string | null;
  gender: string | null;
  age_years: number | null;
  dob: string | null;
  episode_no: string | null;
  episode_type: string | null;
  machine_name: string | null;
}

export interface OrderFilter {
  search?: string;
  status?: string;
  priority?: string;
  from?: string;
  to?: string;
  sort?: "newest" | "oldest" | "priority";
  page?: number;
  perPage?: number;
}

const ORDER_SELECT = `SELECT o.*, p.name AS patient_name, p.mr_no, p.cnic, p.phone, p.gender, p.age_years, p.dob, e.episode_no, e.type AS episode_type, m.name AS machine_name
  FROM hospital_imaging_orders o
  JOIN hospital_patients p ON p.id = o.patient_id
  LEFT JOIN hospital_episodes e ON e.id = o.episode_id
  LEFT JOIN radiology_machines m ON m.id = o.machine_id`;

/** Orders for the reception list: search by order number, patient name, MR
 * number, CNIC, phone or study; filtered and paged. */
export async function listPortalOrders(f: OrderFilter = {}): Promise<{ rows: PortalOrderRow[]; total: number }> {
  const where = ["o.tenant_id = ?", "o.deleted_at IS NULL"];
  const args: unknown[] = [requireCurrentTenantId()];
  const q = (f.search ?? "").trim().toLowerCase();
  if (q) {
    where.push(`(LOWER(o.order_no) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(p.mr_no) LIKE ? OR COALESCE(p.cnic, '') LIKE ? OR COALESCE(p.phone, '') LIKE ? OR LOWER(o.modality) LIKE ?)`);
    const like = `%${q}%`;
    args.push(like, like, like, like, like, like);
  }
  if (f.status) { where.push("o.status = ?"); args.push(f.status); }
  if (f.priority) { where.push("o.priority = ?"); args.push(f.priority); }
  if (f.from) { where.push("o.ordered_at >= ?"); args.push(f.from); }
  if (f.to) { where.push("o.ordered_at < ?"); args.push(`${f.to}~`); }
  const order = f.sort === "oldest" ? "o.ordered_at ASC" : f.sort === "priority" ? "CASE o.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, o.ordered_at DESC" : "o.ordered_at DESC";
  const perPage = Math.min(Math.max(f.perPage ?? 20, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const w = where.join(" AND ");
  const total = (await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_imaging_orders o JOIN hospital_patients p ON p.id = o.patient_id WHERE ${w}`, args))[0]?.n ?? 0;
  const rows = await dbSelect<PortalOrderRow>(`${ORDER_SELECT} WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, perPage, (page - 1) * perPage]);
  return { rows, total };
}

export async function getPortalOrder(orderId: string): Promise<PortalOrderRow | null> {
  return (await dbSelect<PortalOrderRow>(`${ORDER_SELECT} WHERE o.id = ? AND o.tenant_id = ?`, [orderId, requireCurrentTenantId()]))[0] ?? null;
}

/** Patients by MR number, CNIC, mobile or name (any of them; all given must match). */
export async function searchPatients(q: { mrn?: string; cnic?: string; phone?: string; name?: string }): Promise<HospitalPatient[]> {
  const where = ["tenant_id = ?", "deleted_at IS NULL"];
  const args: unknown[] = [requireCurrentTenantId()];
  const digits = (s: string) => s.replace(/\D/g, "");
  if (q.mrn?.trim()) { where.push("LOWER(mr_no) LIKE ?"); args.push(`%${q.mrn.trim().toLowerCase()}%`); }
  if (q.cnic && digits(q.cnic)) { where.push("REPLACE(COALESCE(cnic, ''), '-', '') LIKE ?"); args.push(`%${digits(q.cnic)}%`); }
  if (q.phone && digits(q.phone)) { where.push("REPLACE(REPLACE(COALESCE(phone, ''), '-', ''), ' ', '') LIKE ?"); args.push(`%${digits(q.phone)}%`); }
  if (q.name?.trim()) { where.push("LOWER(name) LIKE ?"); args.push(`%${q.name.trim().toLowerCase()}%`); }
  if (args.length === 1) throw new Error("Enter at least one: MR number, CNIC, mobile or name.");
  return dbSelect<HospitalPatient>(`SELECT * FROM hospital_patients WHERE ${where.join(" AND ")} ORDER BY name LIMIT 30`, args);
}

/** Cancels an order that was not examined yet. */
export async function cancelImagingOrder(orderId: string, reason: string): Promise<void> {
  const o = await hospitalImagingRepo.get(orderId);
  if (!o) throw new Error("Order not found.");
  if (o.status !== "pending") throw new Error("Only an order still waiting in the queue can be cancelled.");
  if (!reason.trim()) throw new Error("Enter the reason for cancelling.");
  await hospitalImagingRepo.update(orderId, { status: "cancelled", notes: [o.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") });
}

// ── Technologist: examination ─────────────────────────────────────────────

export interface ExamContext {
  order: PortalOrderRow;
  patient: HospitalPatient | null;
  previous: { id: string; study: string; ordered_at: string; status: string; impression: string | null }[];
  exam: ExamData;
}

export async function getExamContext(orderId: string): Promise<ExamContext> {
  const order = await getPortalOrder(orderId);
  if (!order) throw new Error("Order not found.");
  const patient = await hospitalPatientsRepo.get(order.patient_id);
  const previous = await dbSelect<ExamContext["previous"][number]>(
    `SELECT id, modality AS study, ordered_at, status, impression FROM hospital_imaging_orders
     WHERE tenant_id = ? AND patient_id = ? AND id != ? AND deleted_at IS NULL AND status IN ('performed', 'reported') ORDER BY ordered_at DESC LIMIT 10`,
    [requireCurrentTenantId(), order.patient_id, orderId]
  );
  return { order, patient, previous, exam: parseExam(order.exam_data, order.clinical_history) };
}

/** Calls the patient in: the order goes in progress on this machine. */
export async function startExam(orderId: string, machineId: string): Promise<void> {
  const a = await requireRole(TECHNOLOGIST_ROLES, "perform examinations");
  const o = await hospitalImagingRepo.get(orderId);
  if (!o) throw new Error("Order not found.");
  if (!canProcess(o)) throw new Error("The fee for this study is not paid yet. Reception must take the fee first.");
  if (o.status === "in_progress" && o.machine_id && o.machine_id !== machineId) throw new Error("This patient is being examined on another machine.");
  if (o.status !== "pending" && o.status !== "in_progress") throw new Error(`This study is already ${o.status}.`);
  const m = await machinesRepo.get(machineId);
  if (!m || m.status !== "active") throw new Error("Choose an active machine.");
  await hospitalImagingRepo.update(orderId, {
    status: "in_progress", machine_id: m.id, exam_started_at: o.exam_started_at ?? localDateTime(), exam_started_by_name: o.exam_started_by_name ?? a.name,
  });
}

/** Sends the patient back to the waiting queue (the draft is kept). */
export async function returnToQueue(orderId: string): Promise<void> {
  await requireRole(TECHNOLOGIST_ROLES, "perform examinations");
  const o = await hospitalImagingRepo.get(orderId);
  if (!o || o.status !== "in_progress") throw new Error("This examination is not in progress.");
  await hospitalImagingRepo.update(orderId, { status: "pending", exam_started_at: null, exam_started_by_name: null });
}

export async function saveExamDraft(orderId: string, data: ExamData): Promise<void> {
  await requireRole(TECHNOLOGIST_ROLES, "perform examinations");
  const o = await hospitalImagingRepo.get(orderId);
  if (!o || (o.status !== "in_progress" && o.status !== "pending")) throw new Error("Start the examination first.");
  await hospitalImagingRepo.update(orderId, { exam_data: JSON.stringify(data) });
}

/** Completes the examination: refused while a required check (consent,
 * identity) is not ticked; warnings must be confirmed. The study then waits
 * for the radiologist's report. */
export async function completeExam(orderId: string, data: ExamData, confirmWarnings = false): Promise<{ warnings: string[] }> {
  const a = await requireRole(TECHNOLOGIST_ROLES, "perform examinations");
  const o = await hospitalImagingRepo.get(orderId);
  if (!o) throw new Error("Order not found.");
  if (o.status !== "in_progress") throw new Error("Start the examination first.");
  const p = await hospitalPatientsRepo.get(o.patient_id);
  const { errors, warnings } = validateExam(data, { gender: p?.gender, ageYears: p?.age_years });
  if (errors.length) throw new Error(errors.join(" "));
  if (warnings.length && !confirmWarnings) return { warnings };
  const series = Number(data.acquisition.series);
  const per = Number(data.acquisition.imagesPerSeries);
  await hospitalImagingRepo.update(orderId, {
    status: "performed", performed_at: localDateTime(), performed_by_name: a.name, exam_data: JSON.stringify(data),
    ...(o.series_count == null && series > 0 ? { series_count: series } : {}),
    ...(o.images_count == null && series > 0 && per > 0 ? { images_count: series * per } : {}),
  });
  return { warnings: [] };
}

// ── Reporting ─────────────────────────────────────────────────────────────

/** The radiologist's list: examined studies waiting for a report (or, with
 * "unexamined", also paid studies not yet examined), or reported ones. */
export async function listForReporting(view: "to_report" | "unexamined" | "reported", search = ""): Promise<PortalOrderRow[]> {
  const status = view === "reported" ? ["reported"] : view === "unexamined" ? ["pending", "in_progress"] : ["performed"];
  const where = [`o.tenant_id = ?`, `o.deleted_at IS NULL`, `o.status IN (${status.map(() => "?").join(",")})`];
  const args: unknown[] = [requireCurrentTenantId(), ...status];
  const q = search.trim().toLowerCase();
  if (q) {
    where.push(`(LOWER(o.order_no) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(p.mr_no) LIKE ? OR LOWER(o.modality) LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const order = view === "reported" ? "o.reported_at DESC" : "CASE o.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, COALESCE(o.performed_at, o.ordered_at) ASC";
  const rows = await dbSelect<PortalOrderRow>(`${ORDER_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 200`, args);
  return view === "unexamined" ? rows.filter((r) => canProcess(r)) : rows;
}

/** Writes the report; the radiologist is the logged-in user unless named. */
export async function reportStudy(orderId: string, r: { findings: string | null; impression: string; radiologist?: string | null }): Promise<void> {
  const a = await currentActor();
  await reportImaging(orderId, { findings: r.findings, impression: r.impression, radiologist: clean(r.radiologist) ?? (a.designation ? `${a.name}, ${a.designation}` : a.name) });
}
