/** Radiology: the studies the department performs with their fees (Performing
 * Images), orders from the radiology counter, and the report search / print. */
import { dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { localDate, localDateTime } from "../localDate";
import { useAuthStore } from "../../store/authStore";
import { hasPermission } from "../moduleAccess";
import { getSetting } from "./settings";
import { hospitalEpisodesRepo, hospitalImagingRepo, hospitalPatientsRepo, hospitalServicesRepo, nextEpisodeNo } from "./hospital";
import { listOpenVisits, orderInvestigation } from "./hospitalOpd";
import type { HospitalEpisode, HospitalImagingOrder, HospitalService, OrderPriority } from "../types-hospital";

// ── Performing Images ─────────────────────────────────────────────────────

export async function listImagingStudies(opts: { includeInactive?: boolean } = {}): Promise<HospitalService[]> {
  const all = await hospitalServicesRepo.list({ where: "category = 'imaging'", orderBy: "name ASC" });
  return opts.includeInactive ? all : all.filter((s) => s.is_active);
}

async function takenCodes(): Promise<Set<string>> {
  return new Set((await dbSelect<{ code: string }>(`SELECT code FROM hospital_services WHERE tenant_id = ?`, [requireCurrentTenantId()])).map((r) => r.code));
}

function nextFree(taken: Set<string>, start: number): { code: string; n: number } {
  let n = start;
  while (taken.has(`IMG-${String(n).padStart(3, "0")}`)) n++;
  return { code: `IMG-${String(n).padStart(3, "0")}`, n };
}

async function imagingCount(): Promise<number> {
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_services WHERE tenant_id = ? AND category = 'imaging'`, [requireCurrentTenantId()]);
  return rows[0]?.n ?? 0;
}

export interface ImagingStudyInput {
  name: string;
  code?: string | null;
  modality?: string | null;
  department?: string | null;
  rate: number;
  turnaround_hours?: number | null;
  notes?: string | null;
  is_active?: number;
}

/** Adds or edits a radiology study. A blank code gets the next IMG-nnn; the
 * same study name twice is refused. */
export async function saveImagingStudy(id: string | null, s: ImagingStudyInput): Promise<HospitalService> {
  const name = s.name?.trim();
  if (!name) throw new Error("Enter the study name.");
  if (!(Number(s.rate) >= 0)) throw new Error("The fee cannot be negative.");
  if (s.turnaround_hours != null && !(Number(s.turnaround_hours) >= 0)) throw new Error("Reporting time cannot be negative.");
  const clash = await dbSelect<{ id: string }>(
    `SELECT id FROM hospital_services WHERE tenant_id = ? AND category = 'imaging' AND deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(?) AND id != ?`,
    [requireCurrentTenantId(), name, id ?? ""]
  );
  if (clash.length) throw new Error(`"${name}" is already in the radiology list.`);
  const existing = id ? await hospitalServicesRepo.get(id) : null;
  if (id && (!existing || existing.category !== "imaging")) throw new Error("Study not found.");
  const payload: Partial<HospitalService> = {
    name,
    code: s.code?.trim() ? s.code.trim().toUpperCase() : existing?.code ?? nextFree(await takenCodes(), (await imagingCount()) + 1).code,
    department: s.department?.trim() || existing?.department || "Radiology",
    category: "imaging",
    billing_unit: "test",
    rate: Number(s.rate) || 0,
    modality: s.modality?.trim() || null,
    turnaround_hours: s.turnaround_hours != null && String(s.turnaround_hours) !== "" ? Number(s.turnaround_hours) : null,
    notes: s.notes?.trim() || null,
    is_active: s.is_active ?? existing?.is_active ?? 1,
  };
  const saved = id ? await hospitalServicesRepo.update(id, payload) : await hospitalServicesRepo.create(payload);
  if (!saved) throw new Error("Study not found.");
  return saved;
}

/** Sets a study's fee from the list. A fee above zero also starts performing it. */
export async function setImagingFee(id: string, fee: number): Promise<HospitalService> {
  if (!(Number(fee) >= 0)) throw new Error("The fee cannot be negative.");
  const s = await hospitalServicesRepo.get(id);
  if (!s || s.category !== "imaging") throw new Error("Study not found.");
  return (await hospitalServicesRepo.update(id, { rate: Number(fee), ...(Number(fee) > 0 ? { is_active: 1 } : {}) }))!;
}

export async function setImagingActive(id: string, active: boolean): Promise<HospitalService> {
  const s = await hospitalServicesRepo.get(id);
  if (!s || s.category !== "imaging") throw new Error("Study not found.");
  return (await hospitalServicesRepo.update(id, { is_active: active ? 1 : 0 }))!;
}

/** Loads the standard radiology studies. Studies already in the list (same
 * name) are kept; new ones come without a fee and not performed. */
export async function importStandardImagingStudies(onProgress?: (done: number, total: number) => void): Promise<{ added: number; skipped: number }> {
  const { STANDARD_IMAGING_STUDIES } = await import("../../config/radiologyCatalog");
  const existing = new Set((await listImagingStudies({ includeInactive: true })).map((s) => s.name.trim().toLowerCase()));
  const todo = STANDARD_IMAGING_STUDIES.filter((s) => !existing.has(s.name.toLowerCase()));
  const taken = await takenCodes();
  let n = (await imagingCount()) + 1;
  let done = 0;
  for (const s of todo) {
    const next = nextFree(taken, n);
    taken.add(next.code);
    n = next.n + 1;
    await hospitalServicesRepo.create({
      code: next.code, name: s.name, department: "Radiology", category: "imaging", billing_unit: "test", rate: 0, is_active: 0, notes: null,
      modality: s.modality, turnaround_hours: s.tat,
    });
    done++;
    onProgress?.(done, todo.length);
  }
  return { added: todo.length, skipped: STANDARD_IMAGING_STUDIES.length - todo.length };
}

// ── Orders from the radiology counter ─────────────────────────────────────

/** Orders a study from Performing Images for a patient. It goes on the chosen
 * open visit, today's open visit, or a new "Radiology" visit, so its fee is on a
 * bill Reception can collect; radiology reports it once the fee is paid. */
export async function orderImaging(input: {
  patientId: string; serviceId: string; episodeId?: string | null; bodyPart?: string | null; priority?: OrderPriority; orderedBy?: string | null;
}): Promise<{ episode: HospitalEpisode; order: HospitalImagingOrder }> {
  const patient = await hospitalPatientsRepo.get(input.patientId);
  if (!patient) throw new Error("Patient not found in this hospital.");
  const svc = await hospitalServicesRepo.get(input.serviceId);
  if (!svc || svc.category !== "imaging" || !svc.is_active) throw new Error("Choose a study from Performing Images.");
  let episode: HospitalEpisode | null = null;
  if (input.episodeId) {
    episode = await hospitalEpisodesRepo.get(input.episodeId);
    if (!episode || episode.patient_id !== patient.id || episode.status !== "open") throw new Error("Choose an open visit of this patient.");
  } else {
    episode = (await listOpenVisits(patient.id)).find((e) => e.date === localDate()) ?? null;
  }
  if (!episode) {
    const date = localDate();
    episode = await hospitalEpisodesRepo.create({
      episode_no: await nextEpisodeNo("opd", date), type: "opd", patient_id: patient.id, doctor_id: null, department: "Radiology",
      date, time: localDateTime().slice(11), status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null,
      diagnosis: null, notes: "Radiology visit", token_no: null, consult_status: "done",
    });
  }
  const { order } = await orderInvestigation(episode.id, svc.id, input.orderedBy?.trim() || null);
  const extra: Partial<HospitalImagingOrder> = {};
  if (input.bodyPart?.trim()) extra.body_part = input.bodyPart.trim();
  if (input.priority && input.priority !== "routine") extra.priority = input.priority;
  const saved = Object.keys(extra).length ? (await hospitalImagingRepo.update(order.id, extra))! : (order as HospitalImagingOrder);
  return { episode, order: saved };
}

// ── Radiology Reports ─────────────────────────────────────────────────────

function canSearchReports(): boolean {
  const u = useAuthStore.getState().currentUser;
  if (!u || u.role !== "staff" || u.permissions === null) return true;
  return hasPermission(u.permissions, "hospital_radiology_reports") || hasPermission(u.permissions, "hospital_radiology_orders");
}

export interface RadiologyReportRow {
  id: string;
  order_no: string;
  study: string;
  body_part: string | null;
  status: string;
  ordered_at: string;
  reported_at: string | null;
  fee: number;
  paid: number;
  patient_name: string;
  mr_no: string;
  phone: string | null;
  episode_no: string | null;
}

/** Finds radiology orders by patient name, MR number, phone, invoice / order
 * number (RAD-...) or visit number. Newest first. */
export async function searchRadiologyReports(query: string, limit = 50): Promise<RadiologyReportRow[]> {
  if (!canSearchReports()) throw new Error("You do not have permission to search radiology reports.");
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.toLowerCase()}%`;
  return dbSelect<RadiologyReportRow>(
    `SELECT o.id, o.order_no, o.modality AS study, o.body_part, o.status, o.ordered_at, o.reported_at, COALESCE(o.fee, 0) AS fee, COALESCE(o.paid, 0) AS paid,
            p.name AS patient_name, p.mr_no, p.phone, e.episode_no
     FROM hospital_imaging_orders o
     JOIN hospital_patients p ON p.id = o.patient_id
     LEFT JOIN hospital_episodes e ON e.id = o.episode_id
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL
       AND (LOWER(p.name) LIKE ? OR LOWER(p.mr_no) LIKE ? OR LOWER(o.order_no) LIKE ? OR LOWER(COALESCE(e.episode_no, '')) LIKE ? OR COALESCE(p.phone, '') LIKE ?)
     ORDER BY o.ordered_at DESC LIMIT ?`,
    [requireCurrentTenantId(), like, like, like, like, `%${q}%`, limit]
  );
}

export interface RadiologyReport {
  order: HospitalImagingOrder;
  hospital: { name: string; address: string | null; phone: string | null; registration: string | null };
  patient: { name: string; mrNo: string; age: string | null; gender: string | null };
  episodeNo: string | null;
  referringDoctor: string | null;
}

/** A reported study for viewing / printing. Only a reported study prints. */
export async function getRadiologyReport(orderId: string): Promise<RadiologyReport> {
  if (!canSearchReports()) throw new Error("You do not have permission to open radiology reports.");
  const order = await hospitalImagingRepo.get(orderId);
  if (!order) throw new Error("Radiology order not found.");
  if (order.status !== "reported") throw new Error("This study is not reported yet.");
  const patient = await hospitalPatientsRepo.get(order.patient_id);
  const ep = order.episode_id ? await hospitalEpisodesRepo.get(order.episode_id) : null;
  const doctor = ep?.doctor_id
    ? (await dbSelect<{ name: string }>(`SELECT name FROM staff WHERE id = ? AND tenant_id = ?`, [ep.doctor_id, requireCurrentTenantId()]))[0]?.name ?? null
    : null;
  let profile: { name?: string; address?: string; phone?: string; registration_no?: string; city?: string } = {};
  try {
    profile = JSON.parse((await getSetting("hospital.profile")) ?? "{}");
  } catch {
    profile = {};
  }
  return {
    order,
    hospital: {
      name: profile.name || useAuthStore.getState().currentTenant?.name || "Hospital",
      address: [profile.address, profile.city].filter(Boolean).join(", ") || null,
      phone: profile.phone || null,
      registration: profile.registration_no || null,
    },
    patient: {
      name: patient?.name ?? "—",
      mrNo: patient?.mr_no ?? "—",
      age: patient?.age_years != null ? `${patient.age_years} y` : patient?.dob ?? null,
      gender: patient?.gender ?? null,
    },
    episodeNo: ep?.episode_no ?? null,
    referringDoctor: order.ordered_by ?? doctor,
  };
}
