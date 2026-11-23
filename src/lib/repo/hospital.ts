import { dbExecute, dbSelect } from "../db";
import { createTenantRepo, friendlyDbError, requireCurrentTenantId } from "./base";
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
import { localDate } from "../localDate";
import { invoicesRepo } from "./invoices";
import { useAuthStore } from "../../store/authStore";
import { settlingCreate } from "./docNumbers";
import { formatMr, parseMr } from "../hospitalMr";
import { departmentScope, deptScopeSql } from "./deptScope";

export type { HospitalDepartment, HospitalLabOrder, HospitalImagingOrder, HospitalPatient, HospitalService, HospitalEpisode, HospitalCharge, HospitalPayment };

const patientsBase = createTenantRepo<HospitalPatient>("hospital_patients");
/** Patients. A new patient given a new-format MR (MR-0001-23112026-2026) keeps
 * its number, registration date and year; if another counter took that
 * number a moment earlier, the next free one is given instead. */
export const hospitalPatientsRepo = {
  ...patientsBase,
  async create(data: Partial<HospitalPatient>): Promise<HospitalPatient> {
    for (let attempt = 0; ; attempt++) {
      const parsed = parseMr(data.mr_no);
      const row = parsed ? { ...data, mr_seq: parsed.seq, mr_reg_date: parsed.regDate, mr_year: parsed.year } : data;
      try {
        return await patientsBase.create(row);
      } catch (e) {
        // Before the v97 database update: the MR is kept, without its parts.
        if (parsed && /no such column: mr_|has no column named mr_/i.test(String(e instanceof Error ? e.message : e))) return patientsBase.create(data);
        const clash = /UNIQUE constraint failed: hospital_patients.(tenant_id, )?.*mr_no|ux_hosp_patient_mr|mr no is already in use/i.test(String(e instanceof Error ? e.message : e));
        if (!parsed || !clash || attempt >= 4) throw e;
        data = { ...data, mr_no: await nextMrNo(parsed.regDate) };
      }
    }
  },
};
export const hospitalServicesRepo = createTenantRepo<HospitalService>("hospital_services");
const PATIENT_REF: [string, string, string] = ["patient_id", "hospital_patients", "Patient"];
const EPISODE_REF: [string, string, string] = ["episode_id", "hospital_episodes", "Episode"];
// from_episode_id: the visit an admission came from (same hospital), or empty.
const episodesBase = createTenantRepo<HospitalEpisode>("hospital_episodes", { refs: [PATIENT_REF, ["from_episode_id", "hospital_episodes", "Source visit"]] });
/** Episodes. A visit in a new year first renews the year part of the patient's MR. */
export const hospitalEpisodesRepo = {
  ...episodesBase,
  async create(data: Partial<HospitalEpisode>): Promise<HospitalEpisode> {
    if (data.patient_id) await renewMrForVisit(data.patient_id, data.date || localDate()).catch(() => null);
    return episodesBase.create(data);
  },
};
export const hospitalChargesRepo = createTenantRepo<HospitalCharge>("hospital_charges", { refs: [EPISODE_REF] });
export const hospitalPaymentsRepo = createTenantRepo<HospitalPayment>("hospital_payments", { refs: [EPISODE_REF] });
export const hospitalDepartmentsRepo = createTenantRepo<HospitalDepartment>("hospital_departments");
/** Lab / imaging orders; two placed at the same moment never share an order number. */
export const hospitalLabRepo = settlingCreate(createTenantRepo<HospitalLabOrder>("hospital_lab_orders", { refs: [PATIENT_REF] }), "hospital_lab_orders", "order_no", { regenerate: () => nextOrderNo("hospital_lab_orders") });
export const hospitalImagingRepo = settlingCreate(createTenantRepo<HospitalImagingOrder>("hospital_imaging_orders", { refs: [PATIENT_REF] }), "hospital_imaging_orders", "order_no", { regenerate: () => nextOrderNo("hospital_imaging_orders") });

/** LAB-20261024-0001 / RAD-... : counts the tenant's orders, then skips any number already used. */
export async function nextOrderNo(table: "hospital_lab_orders" | "hospital_imaging_orders"): Promise<string> {
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, [tenantId]);
  const prefix = table === "hospital_lab_orders" ? "LAB" : "RAD";
  const day = localDate().replace(/-/g, "");
  let seq = (rows[0]?.n ?? 0) + 1;
  for (;;) {
    const no = `${prefix}-${day}-${String(seq).padStart(4, "0")}`;
    const taken = await dbSelect(`SELECT 1 FROM ${table} WHERE tenant_id = ? AND order_no = ?`, [tenantId, no]);
    if (!taken.length) return no;
    seq++;
  }
}

// ── Episode number generation ──────────────────────────────────────────────

/** Next free episode number for the day: OPD-20261024-001, IPD-..., ER-... .
 * Counts every episode of that type and date (deleted ones too, because the
 * number stays reserved) and skips any number already taken. */
export async function nextEpisodeNo(type: EpisodeType, date?: string): Promise<string> {
  const tenantId = requireCurrentTenantId();
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDate();
  const prefix = type === "opd" ? "OPD" : type === "ipd" ? "IPD" : "ER";
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) AS n FROM hospital_episodes WHERE tenant_id = ? AND type = ? AND date = ?`,
    [tenantId, type, day]
  );
  let seq = (rows[0]?.n ?? 0) + 1;
  for (;;) {
    const no = `${prefix}-${day.replace(/-/g, "")}-${String(seq).padStart(3, "0")}`;
    const taken = await dbSelect(`SELECT 1 FROM hospital_episodes WHERE tenant_id = ? AND episode_no = ?`, [tenantId, no]);
    if (!taken.length) return no;
    seq++;
  }
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
  /** Admission confirmation (v47); null when not needed, absent on an older database. */
  admission_status?: string | null;
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
  // MOs, nurses and paramedics: only the department they are on duty in.
  const depts = await departmentScope();
  if (depts) { const d = deptScopeSql("e", depts); where.push(d.sql); params.push(...d.params); }
  const limit = opts.limit ?? 100;
  return dbSelect<EpisodeListRow>(
    // e.* rather than a column list: works on a database from before newer
    // episode columns (admission_status, v47) instead of failing every queue.
    `SELECT e.*, p.name AS patient_name, p.mr_no,
            COALESCE((SELECT SUM(amount) FROM hospital_charges WHERE episode_id = e.id AND deleted_at IS NULL), 0) AS total_charges,
            COALESCE((SELECT SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) FROM hospital_payments WHERE episode_id = e.id AND deleted_at IS NULL), 0) AS total_paid
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
  const episode = await hospitalEpisodesRepo.get(charge.episode_id);
  if (!episode) throw new Error("Episode not found in this hospital.");
  if (episode.status !== "open") throw new Error("This episode is closed. Charges can only be added to an open episode.");
  if (!charge.description?.trim()) throw new Error("Enter a description for the charge.");
  if (!(charge.qty > 0)) throw new Error("Quantity must be more than zero.");
  if (!(charge.rate >= 0)) throw new Error("Rate cannot be negative.");
  const discount = charge.discount_pct || 0;
  if (discount < 0 || discount > 100) throw new Error("Discount must be between 0 and 100 %.");
  const id = newId();
  const now = nowIso();
  const amount = Math.round(charge.qty * charge.rate * (1 - discount / 100) * 100) / 100;
  // Shares: those given, else the service's per unit (Service Master).
  let doctorShare = charge.doctor_share ?? null;
  let staffShare = charge.staff_share ?? null;
  if (charge.service_id && doctorShare == null && staffShare == null) {
    const svc = (await dbSelect<{ doctor_share: number | null; staff_share: number | null }>(
      `SELECT doctor_share, staff_share FROM hospital_services WHERE id = ? AND tenant_id = ?`, [charge.service_id, tenantId]
    ).catch(() => []))[0];
    if (svc?.doctor_share) doctorShare = Math.round(Number(svc.doctor_share) * charge.qty * 100) / 100;
    if (svc?.staff_share) staffShare = Math.round(Number(svc.staff_share) * charge.qty * 100) / 100;
  }
  try {
    await dbExecute(
      `INSERT INTO hospital_charges (id, tenant_id, episode_id, service_id, description, department, category, qty, rate, discount_pct, amount, doctor_id, performed_by, charge_date, notes, invoice_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [id, tenantId, charge.episode_id, charge.service_id ?? null, charge.description.trim(), charge.department ?? null,
       charge.category ?? null, charge.qty, charge.rate, discount, amount,
       charge.doctor_id ?? null, charge.performed_by ?? null, charge.charge_date,
       charge.notes ?? null, charge.invoice_id ?? null, now, now]
    );
  } catch (e) {
    throw friendlyDbError(e);
  }
  if (doctorShare != null || staffShare != null) {
    await dbExecute(`UPDATE hospital_charges SET doctor_share = ?, staff_share = ? WHERE id = ? AND tenant_id = ?`, [doctorShare, staffShare, id, tenantId]).catch(() => undefined);
  }
  return { ...charge, tenant_id: tenantId, id, amount, discount_pct: discount, doctor_share: doctorShare, staff_share: staffShare, created_at: now, updated_at: now, deleted_at: null };
}

/** Removes a charge (soft delete). Only from this hospital, and only while the episode is open. */
export async function deleteCharge(id: string): Promise<void> {
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ status: string }>(
    `SELECT e.status FROM hospital_charges c JOIN hospital_episodes e ON e.id = c.episode_id
     WHERE c.id = ? AND c.tenant_id = ? AND c.deleted_at IS NULL`,
    [id, tenantId]
  );
  if (!rows.length) throw new Error("Charge not found.");
  if (rows[0].status !== "open") throw new Error("This episode is closed. Its charges can no longer be removed.");
  const now = nowIso();
  await dbExecute(`UPDATE hospital_charges SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [now, now, id, tenantId]);
}

// ── Payments for an episode ────────────────────────────────────────────────

export async function listPaymentsForEpisode(episodeId: string): Promise<HospitalPayment[]> {
  return dbSelect<HospitalPayment>(
    `SELECT * FROM hospital_payments WHERE episode_id = ? AND deleted_at IS NULL ORDER BY received_at`,
    [episodeId]
  );
}

/** Records a deposit, payment or refund. A refund can never be more than what was received. */
export async function addPayment(payment: Omit<HospitalPayment, "id" | "created_at" | "updated_at" | "deleted_at">): Promise<HospitalPayment> {
  const tenantId = requireCurrentTenantId();
  const episode = await hospitalEpisodesRepo.get(payment.episode_id);
  if (!episode) throw new Error("Episode not found in this hospital.");
  if (!(payment.amount > 0)) throw new Error("Enter an amount more than zero.");
  if (payment.type === "refund") {
    const rows = await dbSelect<{ paid: number }>(
      `SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END), 0) AS paid
       FROM hospital_payments WHERE episode_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [payment.episode_id, tenantId]
    );
    const paid = rows[0]?.paid ?? 0;
    if (payment.amount > paid) throw new Error(`A refund cannot be more than the ${paid.toFixed(0)} received so far.`);
  }
  const id = newId();
  const now = nowIso();
  // Who took the money: their own day closing accounts for it.
  const user = useAuthStore.getState().currentUser;
  const staff = user
    ? (await dbSelect<{ name: string }>(`SELECT name FROM staff WHERE user_id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`, [user.id, tenantId]).catch(() => []))[0]
    : undefined;
  const receivedBy = user?.id ?? null;
  const receivedByName = staff?.name ?? user?.displayName ?? user?.username ?? null;
  const base = [id, tenantId, payment.episode_id, payment.type, payment.amount, payment.method, payment.reference ?? null, payment.notes ?? null, payment.received_at];
  try {
    await dbExecute(
      `INSERT INTO hospital_payments (id, tenant_id, episode_id, type, amount, method, reference, notes, received_at, received_by, received_by_name, closing_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      [...base, receivedBy, receivedByName, now, now]
    );
  } catch (e) {
    // A database not yet migrated to v58 has no receiver columns: the money is still taken, just without the receiver.
    if (!/received_by|closing_id/i.test(String(e instanceof Error ? e.message : e))) throw friendlyDbError(e);
    try {
      await dbExecute(
        `INSERT INTO hospital_payments (id, tenant_id, episode_id, type, amount, method, reference, notes, received_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [...base, now, now]
      );
    } catch (e2) {
      throw friendlyDbError(e2);
    }
  }
  await syncEpisodeInvoices(payment.episode_id);
  return { ...payment, tenant_id: tenantId, id, received_by: receivedBy, received_by_name: receivedByName, closing_id: null, created_at: now, updated_at: now, deleted_at: null };
}

/** Keeps Paid / Balance of an admission's invoices (surgery invoices in
 * Billing) in step with the payments taken on the admission: the net amount
 * received goes to its invoices oldest first. */
export async function syncEpisodeInvoices(episodeId: string): Promise<void> {
  const tenantId = requireCurrentTenantId();
  let invoices: { id: string; payable: number; paid: number }[];
  try {
    invoices = await dbSelect(
      `SELECT id, payable, paid FROM invoices WHERE tenant_id = ? AND hospital_episode_id = ? AND deleted_at IS NULL ORDER BY created_at, invoice_no`,
      [tenantId, episodeId]
    );
  } catch (e) {
    // A database before v45 has no surgery invoices; the payment itself stands.
    if (/no such column: hospital_episode_id/i.test(String(e instanceof Error ? e.message : e))) return;
    throw e;
  }
  if (!invoices.length) return;
  const rows = await dbSelect<{ paid: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END), 0) AS paid
     FROM hospital_payments WHERE episode_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [episodeId, tenantId]
  );
  let left = Math.max(0, rows[0]?.paid ?? 0);
  for (const inv of invoices) {
    const payable = Number(inv.payable) || 0;
    const paid = Math.round(Math.min(payable, left) * 100) / 100;
    left -= paid;
    if (paid !== Number(inv.paid)) await invoicesRepo.update(inv.id, { paid, balance: Math.round((payable - paid) * 100) / 100 });
  }
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
  const today = localDate();
  const [patients, opd, ipd, er, rev] = await Promise.all([
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_patients WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_episodes WHERE tenant_id = ? AND type = 'opd' AND date = ? AND status = 'open' AND deleted_at IS NULL`, [tenantId, today]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_episodes WHERE tenant_id = ? AND type = 'ipd' AND status = 'open' AND deleted_at IS NULL`, [tenantId]),
    dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_episodes WHERE tenant_id = ? AND type = 'emergency' AND status = 'open' AND deleted_at IS NULL`, [tenantId]),
    dbSelect<{ n: number }>(`SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END), 0) AS n FROM hospital_payments WHERE tenant_id = ? AND received_at >= ? AND received_at < ? AND deleted_at IS NULL`, [tenantId, today, today + "~"]),
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

/** The next MR: the number after the highest given (never restarts), today's
 * date as the registration date, this year. */
export async function nextMrNo(regDate: string = localDate()): Promise<string> {
  const tenantId = requireCurrentTenantId();
  // Before the v97 database update there is no mr_seq: count the patients instead.
  const hasSeq = await dbSelect(`SELECT mr_seq FROM hospital_patients WHERE tenant_id = ? LIMIT 0`, [tenantId]).then(() => true, () => false);
  const rows = await dbSelect<{ n: number | null }>(
    hasSeq ? `SELECT MAX(mr_seq) AS n FROM hospital_patients WHERE tenant_id = ?` : `SELECT COUNT(*) AS n FROM hospital_patients WHERE tenant_id = ?`, [tenantId]);
  let seq = (Number(rows[0]?.n) || 0) + 1;
  for (;;) {
    const mr = formatMr(seq, regDate, Number(regDate.slice(0, 4)));
    const taken = await dbSelect(
      hasSeq ? `SELECT 1 FROM hospital_patients WHERE tenant_id = ? AND (mr_no = ? OR mr_seq = ?)` : `SELECT 1 FROM hospital_patients WHERE tenant_id = ? AND mr_no LIKE ?`,
      hasSeq ? [tenantId, mr, seq] : [tenantId, `MR-${String(seq).padStart(4, "0")}-%`]);
    if (!taken.length) return mr;
    seq++;
  }
}

/** At a patient's first visit of a new year the MR's year part is renewed
 * (MR-0001-23112026-2026 becomes ...-2027); the earlier MR goes to the
 * history. Returns the MR to use for the visit. */
export async function renewMrForVisit(patientId: string, visitDate: string = localDate()): Promise<string | null> {
  const tenantId = requireCurrentTenantId();
  const p = (await dbSelect<{ mr_no: string; mr_seq: number | null; mr_reg_date: string | null; mr_year: number | null }>(
    `SELECT mr_no, mr_seq, mr_reg_date, mr_year FROM hospital_patients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [patientId, tenantId]
  ).catch(() => []))[0];
  if (!p) return null;
  const year = Number(visitDate.slice(0, 4));
  if (p.mr_seq == null || !p.mr_reg_date || !(year > Number(p.mr_year ?? 0))) return p.mr_no;
  const mr = formatMr(Number(p.mr_seq), p.mr_reg_date, year);
  const now = nowIso();
  await dbExecute(
    `INSERT INTO hospital_patient_mr_history (id, tenant_id, patient_id, mr_no, replaced_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), tenantId, patientId, p.mr_no, visitDate.slice(0, 10), now, now]
  );
  await patientsBase.update(patientId, { mr_no: mr, mr_year: year } as Partial<HospitalPatient>);
  return mr;
}

/** A patient's earlier MR numbers, newest first. */
export async function mrHistory(patientId: string): Promise<{ mr_no: string; replaced_on: string }[]> {
  return dbSelect<{ mr_no: string; replaced_on: string }>(
    `SELECT mr_no, replaced_on FROM hospital_patient_mr_history WHERE tenant_id = ? AND patient_id = ? AND deleted_at IS NULL ORDER BY replaced_on DESC, created_at DESC`,
    [requireCurrentTenantId(), patientId]
  ).catch(() => []);
}
