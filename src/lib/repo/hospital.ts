import { dbExecute, dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { newId, nowIso } from "../id";
import type {
  HospitalPatient,
  HospitalService,
  HospitalEpisode,
  HospitalCharge,
  HospitalPayment,
  EpisodeType,
  HospitalDepartment,
  HospitalLabOrder,
  HospitalImagingOrder,
} from "../types-hospital";

export type { HospitalDepartment, HospitalLabOrder, HospitalImagingOrder, HospitalPatient, HospitalService, HospitalEpisode, HospitalCharge, HospitalPayment };

export const hospitalPatientsRepo = createTenantRepo<HospitalPatient>("hospital_patients");
export const hospitalServicesRepo = createTenantRepo<HospitalService>("hospital_services");
export const hospitalEpisodesRepo = createTenantRepo<HospitalEpisode>("hospital_episodes");
export const hospitalChargesRepo = createTenantRepo<HospitalCharge>("hospital_charges");
export const hospitalPaymentsRepo = createTenantRepo<HospitalPayment>("hospital_payments");
export const hospitalDepartmentsRepo = createTenantRepo<HospitalDepartment>("hospital_departments");
export const hospitalLabRepo = createTenantRepo<HospitalLabOrder>("hospital_lab_orders");
export const hospitalImagingRepo = createTenantRepo<HospitalImagingOrder>("hospital_imaging_orders");

export async function nextOrderNo(table: "hospital_lab_orders" | "hospital_imaging_orders"): Promise<string> {
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, [tenantId]);
  const prefix = table === "hospital_lab_orders" ? "LAB" : "RAD";
  return `${prefix}-${nowIso().slice(0, 10).replace(/-/g, "")}-${String((rows[0]?.n ?? 0) + 1).padStart(4, "0")}`;
}

// ── Episode number generation ──────────────────────────────────────────────

export async function nextEpisodeNo(type: EpisodeType): Promise<string> {
  const tenantId = requireCurrentTenantId();
  const prefix = type === "opd" ? "OPD" : type === "ipd" ? "IPD" : "ER";
  const today = nowIso().slice(0, 10).replace(/-/g, "");
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) AS n FROM hospital_episodes WHERE tenant_id = ? AND type = ? AND date = ?`,
    [tenantId, type, nowIso().slice(0, 10)]
  );
  const seq = (rows[0]?.n ?? 0) + 1;
  return `${prefix}-${today}-${String(seq).padStart(3, "0")}`;
}

// ── Episode with patient name ──────────────────────────────────────────────

export interface EpisodeListRow {
  id: string;
  episode_no: string;
  type: string;
  status: string;
  patient_id: string;
  patient_name: string;
  mr_no: string;
  doctor_id: string | null;
  department: string | null;
  date: string;
  diagnosis: string | null;
  total_charges: number;
  total_paid: number;
}

export async function listEpisodes(opts: {
  status?: string;
  type?: string;
  date?: string;
  limit?: number;
} = {}): Promise<EpisodeListRow[]> {
  const tenantId = requireCurrentTenantId();
  const where: string[] = ["e.tenant_id = ?", "e.deleted_at IS NULL"];
  const params: unknown[] = [tenantId];
  if (opts.status) { where.push("e.status = ?"); params.push(opts.status); }
  if (opts.type) { where.push("e.type = ?"); params.push(opts.type); }
  if (opts.date) { where.push("e.date = ?"); params.push(opts.date); }
  const limit = opts.limit ?? 100;
  return dbSelect<EpisodeListRow>(
    `SELECT e.id, e.episode_no, e.type, e.status, e.patient_id,
            p.name AS patient_name, p.mr_no,
            e.doctor_id, e.department, e.date, e.diagnosis,
            COALESCE((SELECT SUM(amount) FROM hospital_charges WHERE episode_id = e.id AND deleted_at IS NULL), 0) AS total_charges,
            COALESCE((SELECT SUM(amount) FROM hospital_payments WHERE episode_id = e.id AND deleted_at IS NULL), 0) AS total_paid
     FROM hospital_episodes e
     LEFT JOIN hospital_patients p ON p.id = e.patient_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT ?`,
    [...params, limit]
  );
}

// ── Charges for an episode ─────────────────────────────────────────────────

export async function listChargesForEpisode(episodeId: string): Promise<HospitalCharge[]> {
  return dbSelect<HospitalCharge>(
    `SELECT * FROM hospital_charges WHERE episode_id = ? AND deleted_at IS NULL ORDER BY charge_date, created_at`,
    [episodeId]
  );
}

export async function addCharge(charge: Omit<HospitalCharge, "id" | "created_at" | "updated_at" | "deleted_at">): Promise<HospitalCharge> {
  const tenantId = requireCurrentTenantId();
  const id = newId();
  const now = nowIso();
  const amount = charge.qty * charge.rate * (1 - (charge.discount_pct || 0) / 100);
  await dbExecute(
    `INSERT INTO hospital_charges (id, tenant_id, episode_id, service_id, description, department, category, qty, rate, discount_pct, amount, doctor_id, performed_by, charge_date, notes, invoice_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [id, tenantId, charge.episode_id, charge.service_id ?? null, charge.description, charge.department ?? null,
     charge.category ?? null, charge.qty, charge.rate, charge.discount_pct ?? 0, amount,
     charge.doctor_id ?? null, charge.performed_by ?? null, charge.charge_date,
     charge.notes ?? null, charge.invoice_id ?? null, now, now]
  );
  return { ...charge, id, amount, created_at: now, updated_at: now, deleted_at: null };
}

export async function deleteCharge(id: string): Promise<void> {
  const now = nowIso();
  await dbExecute(`UPDATE hospital_charges SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
}

// ── Payments for an episode ────────────────────────────────────────────────

export async function listPaymentsForEpisode(episodeId: string): Promise<HospitalPayment[]> {
  return dbSelect<HospitalPayment>(
    `SELECT * FROM hospital_payments WHERE episode_id = ? AND deleted_at IS NULL ORDER BY received_at`,
    [episodeId]
  );
}

export async function addPayment(payment: Omit<HospitalPayment, "id" | "created_at" | "updated_at" | "deleted_at">): Promise<HospitalPayment> {
  const tenantId = requireCurrentTenantId();
  const id = newId();
  const now = nowIso();
  await dbExecute(
    `INSERT INTO hospital_payments (id, tenant_id, episode_id, type, amount, method, reference, notes, received_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [id, tenantId, payment.episode_id, payment.type, payment.amount, payment.method,
     payment.reference ?? null, payment.notes ?? null, payment.received_at, now, now]
  );
  return { ...payment, id, created_at: now, updated_at: now, deleted_at: null };
}

// ── Stats ──────────────────────────────────────────────────────────────────

export interface HospitalStats {
  totalPatients: number;
  openOpdToday: number;
  openIpd: number;
  openEmergency: number;
  todayRevenue: number;
}

export async function getHospitalStats(): Promise<HospitalStats> {
  const tenantId = requireCurrentTenantId();
  const today = nowIso().slice(0, 10);
  const [patients, opd, ipd, er, rev] = await Promise.all([
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_patients WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_episodes WHERE tenant_id = ? AND type = 'opd' AND date = ? AND status = 'open' AND deleted_at IS NULL`, [tenantId, today]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_episodes WHERE tenant_id = ? AND type = 'ipd' AND status = 'open' AND deleted_at IS NULL`, [tenantId]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_episodes WHERE tenant_id = ? AND type = 'emergency' AND status = 'open' AND deleted_at IS NULL`, [tenantId]),
    dbSelect<{ n: number }>(`SELECT COALESCE(SUM(amount), 0) AS n FROM hospital_payments WHERE tenant_id = ? AND received_at >= ? AND deleted_at IS NULL`, [tenantId, today]),
  ]);
  return {
    totalPatients: patients[0]?.n ?? 0,
    openOpdToday: opd[0]?.n ?? 0,
    openIpd: ipd[0]?.n ?? 0,
    openEmergency: er[0]?.n ?? 0,
    todayRevenue: rev[0]?.n ?? 0,
  };
}

// ── MR number generation ───────────────────────────────────────────────────

export async function nextMrNo(): Promise<string> {
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) AS n FROM hospital_patients WHERE tenant_id = ? AND deleted_at IS NULL`,
    [tenantId]
  );
  const seq = (rows[0]?.n ?? 0) + 1;
  return `MR-${String(seq).padStart(6, "0")}`;
}
