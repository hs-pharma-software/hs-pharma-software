/** Patient history across visits, admission from the doctor's desk, and
 * surgeries (types with fees in the Surgery tab, bookings on admissions). */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { localDate, localDateTime } from "../localDate";
import { staffRepo } from "./staff";
import { hospitalEpisodesRepo, hospitalPatientsRepo, hospitalServicesRepo, nextEpisodeNo, addCharge, deleteCharge } from "./hospital";
import type { HospitalEpisode, HospitalRxItem, HospitalService, SurgeryBooking } from "../types-hospital";

export const surgeryBookingsRepo = createTenantRepo<SurgeryBooking>("hospital_surgery_bookings", {
  refs: [["episode_id", "hospital_episodes", "Admission"], ["patient_id", "hospital_patients", "Patient"], ["service_id", "hospital_services", "Surgery"]],
});

// ── Surgery types (Surgery tab) ───────────────────────────────────────────

/** Surgeries the hospital performs (Service Master entries of category "ot"). */
export async function listSurgeryTypes(opts: { includeInactive?: boolean } = {}): Promise<HospitalService[]> {
  const all = await hospitalServicesRepo.list({ where: "category = 'ot'", orderBy: "name ASC" });
  return opts.includeInactive ? all : all.filter((s) => s.is_active);
}

async function nextSurgeryCode(): Promise<string> {
  const t = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_services WHERE tenant_id = ? AND category = 'ot'`, [t]);
  let n = (rows[0]?.n ?? 0) + 1;
  for (;;) {
    const code = `SURG-${String(n).padStart(3, "0")}`;
    if (!(await dbSelect(`SELECT 1 FROM hospital_services WHERE tenant_id = ? AND code = ?`, [t, code])).length) return code;
    n++;
  }
}

/** Adds or edits a surgery type with its fee. A blank code gets SURG-nnn. */
export async function saveSurgeryType(id: string | null, s: { name: string; code?: string | null; department?: string | null; rate: number; notes?: string | null; is_active?: number }): Promise<HospitalService> {
  const name = s.name?.trim();
  if (!name) throw new Error("Enter the surgery name.");
  if (!(Number(s.rate) >= 0)) throw new Error("The fee cannot be negative.");
  const clash = await dbSelect<{ id: string }>(
    `SELECT id FROM hospital_services WHERE tenant_id = ? AND category = 'ot' AND deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(?) AND id != ?`,
    [requireCurrentTenantId(), name, id ?? ""]
  );
  if (clash.length) throw new Error(`"${name}" is already in the surgery list.`);
  const existing = id ? await hospitalServicesRepo.get(id) : null;
  if (id && (!existing || existing.category !== "ot")) throw new Error("Surgery not found.");
  const payload: Partial<HospitalService> = {
    name,
    code: s.code?.trim() ? s.code.trim().toUpperCase() : existing?.code ?? (await nextSurgeryCode()),
    department: s.department?.trim() || existing?.department || "Surgery",
    category: "ot",
    billing_unit: "procedure",
    rate: Number(s.rate) || 0,
    notes: s.notes?.trim() || null,
    is_active: s.is_active ?? existing?.is_active ?? 1,
  };
  const saved = id ? await hospitalServicesRepo.update(id, payload) : await hospitalServicesRepo.create(payload);
  if (!saved) throw new Error("Surgery not found.");
  return saved;
}

// ── Admission ─────────────────────────────────────────────────────────────

export interface AdmitInput {
  fromEpisodeId: string;
  reason: string;
  plan: "ipd" | "surgery";
  department?: string | null;
  wardRoom?: string | null;
  bedNo?: string | null;
  surgeryTypeId?: string | null;
  plannedDate?: string | null;
  surgeonId?: string | null;
}

/** Admits the patient of an OPD / emergency visit: opens an IPD admission
 * linked to that visit and, for surgery, books the surgery with its fee on the
 * admission bill. A patient already admitted is not admitted twice. */
export async function admitFromVisit(input: AdmitInput): Promise<{ admission: HospitalEpisode; booking: SurgeryBooking | null }> {
  const visit = await hospitalEpisodesRepo.get(input.fromEpisodeId);
  if (!visit) throw new Error("Visit not found in this hospital.");
  if (visit.type === "ipd") throw new Error("This is already an admission.");
  const reason = input.reason?.trim();
  if (!reason) throw new Error("Enter the reason for admission.");
  const already = await hospitalEpisodesRepo.list({ where: "patient_id = ? AND type = 'ipd' AND status = 'open'", params: [visit.patient_id] });
  if (already.length) throw new Error(`This patient is already admitted (${already[0].episode_no}).`);

  let surgery: HospitalService | null = null;
  if (input.plan === "surgery") {
    if (!input.surgeryTypeId) throw new Error("Choose the type of surgery.");
    surgery = await hospitalServicesRepo.get(input.surgeryTypeId);
    if (!surgery || surgery.category !== "ot" || !surgery.is_active) throw new Error("Choose a surgery from the Surgery list.");
    if (input.surgeonId) {
      const surgeon = await staffRepo.get(input.surgeonId);
      if (!surgeon) throw new Error("Surgeon not found.");
    }
  }

  const today = localDate();
  const admission = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("ipd", today),
    type: "ipd",
    patient_id: visit.patient_id,
    doctor_id: input.surgeonId || visit.doctor_id,
    department: input.department?.trim() || surgery?.department || visit.department,
    date: today,
    time: localDateTime().slice(11),
    status: "open",
    room_ward: input.wardRoom?.trim() || null,
    bed_no: input.bedNo?.trim() || null,
    admission_date: today,
    discharge_date: null,
    diagnosis: visit.diagnosis,
    notes: `${input.plan === "surgery" ? "Admitted for surgery" : "Admitted"}: ${reason}`,
    from_episode_id: visit.id,
    consult_status: "done",
  });
  await hospitalEpisodesRepo.update(visit.id, {
    consult_status: "done",
    notes: [visit.notes, `Admitted as ${admission.episode_no}`].filter(Boolean).join("\n"),
  });

  let booking: SurgeryBooking | null = null;
  if (surgery) {
    const fee = Math.max(0, Number(surgery.rate) || 0);
    const charge = fee > 0
      ? await addCharge({
          tenant_id: "", episode_id: admission.id, service_id: surgery.id, description: `Surgery: ${surgery.name}`, department: surgery.department,
          category: "ot", qty: 1, rate: fee, discount_pct: 0, amount: 0, doctor_id: input.surgeonId || visit.doctor_id, performed_by: null,
          charge_date: today, notes: null, invoice_id: null,
        })
      : null;
    booking = await surgeryBookingsRepo.create({
      episode_id: admission.id, patient_id: visit.patient_id, service_id: surgery.id, surgery_name: surgery.name, fee, charge_id: charge?.id ?? null,
      surgeon_id: input.surgeonId || visit.doctor_id || null, planned_date: input.plannedDate || null, status: "planned", notes: reason, performed_at: null,
    });
  }
  return { admission, booking };
}

// ── Surgeries ─────────────────────────────────────────────────────────────

export interface SurgeryRow extends SurgeryBooking {
  patient_name: string;
  mr_no: string;
  episode_no: string;
  surgeon_name: string | null;
}

export async function listSurgeryBookings(status?: "planned" | "done" | "cancelled"): Promise<SurgeryRow[]> {
  return dbSelect<SurgeryRow>(
    `SELECT b.*, p.name AS patient_name, p.mr_no, e.episode_no, s.name AS surgeon_name
     FROM hospital_surgery_bookings b
     JOIN hospital_patients p ON p.id = b.patient_id
     JOIN hospital_episodes e ON e.id = b.episode_id
     LEFT JOIN staff s ON s.id = b.surgeon_id
     WHERE b.tenant_id = ? AND b.deleted_at IS NULL ${status ? "AND b.status = ?" : ""}
     ORDER BY COALESCE(b.planned_date, '9999-12-31'), b.created_at`,
    status ? [requireCurrentTenantId(), status] : [requireCurrentTenantId()]
  );
}

export async function markSurgeryDone(id: string): Promise<void> {
  const b = await surgeryBookingsRepo.get(id);
  if (!b) throw new Error("Surgery not found.");
  if (b.status !== "planned") throw new Error("This surgery is not planned.");
  await surgeryBookingsRepo.update(id, { status: "done", performed_at: localDateTime() });
}

/** Cancels a planned surgery and takes its fee off the admission bill. */
export async function cancelSurgery(id: string, reason: string): Promise<void> {
  const b = await surgeryBookingsRepo.get(id);
  if (!b) throw new Error("Surgery not found.");
  if (b.status !== "planned") throw new Error("Only a planned surgery can be cancelled.");
  if (!reason.trim()) throw new Error("Say why the surgery is cancelled.");
  if (b.charge_id) await deleteCharge(b.charge_id);
  await surgeryBookingsRepo.update(id, { status: "cancelled", notes: [b.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") });
}

// ── Patient history ───────────────────────────────────────────────────────

export interface HistoryVisit {
  episode: HospitalEpisode;
  doctorName: string | null;
  prescriptions: HospitalRxItem[];
  labs: { test_name: string; result_value: string | null; unit: string | null; ref_range: string | null; flag: string | null; verified_at: string | null }[];
  pendingLabs: string[];
  imaging: { modality: string; body_part: string | null; findings: string | null; impression: string | null; reported_at: string | null }[];
  pendingImaging: string[];
  surgeries: { surgery_name: string; status: string; planned_date: string | null; performed_at: string | null }[];
}

/** The patient's earlier visits, newest first, with the doctor's notes,
 * prescriptions, verified lab results, radiology reports and surgeries.
 * Unverified lab results are not shown, only that they are pending. */
export async function getPatientHistory(patientId: string, excludeEpisodeId?: string | null, limit = 30): Promise<HistoryVisit[]> {
  const t = requireCurrentTenantId();
  if (!(await hospitalPatientsRepo.get(patientId))) throw new Error("Patient not found in this hospital.");
  const visits = await dbSelect<HospitalEpisode & { doctor_name: string | null }>(
    `SELECT e.*, s.name AS doctor_name FROM hospital_episodes e LEFT JOIN staff s ON s.id = e.doctor_id
     WHERE e.tenant_id = ? AND e.patient_id = ? AND e.deleted_at IS NULL AND e.id != ?
     ORDER BY e.date DESC, e.created_at DESC LIMIT ?`,
    [t, patientId, excludeEpisodeId ?? "", limit]
  );
  const out: HistoryVisit[] = [];
  for (const v of visits) {
    const { doctor_name, ...episode } = v;
    const [rx, labs, imaging, surgeries] = await Promise.all([
      dbSelect<HospitalRxItem>(`SELECT * FROM hospital_rx_items WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL ORDER BY created_at`, [t, v.id]),
      dbSelect<{ test_name: string; status: string; result_value: string | null; unit: string | null; ref_range: string | null; flag: string | null; verified_at: string | null }>(
        `SELECT test_name, status, result_value, unit, ref_range, flag, verified_at FROM hospital_lab_orders
         WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL AND status NOT IN ('cancelled', 'superseded') ORDER BY created_at`, [t, v.id]),
      dbSelect<{ modality: string; body_part: string | null; status: string; findings: string | null; impression: string | null; reported_at: string | null }>(
        `SELECT modality, body_part, status, findings, impression, reported_at FROM hospital_imaging_orders
         WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL AND status != 'cancelled' ORDER BY created_at`, [t, v.id]),
      dbSelect<{ surgery_name: string; status: string; planned_date: string | null; performed_at: string | null }>(
        `SELECT surgery_name, status, planned_date, performed_at FROM hospital_surgery_bookings WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL ORDER BY created_at`, [t, v.id]),
    ]);
    out.push({
      episode: episode as HospitalEpisode,
      doctorName: doctor_name,
      prescriptions: rx,
      labs: labs.filter((l) => l.status === "reported").map((l) => ({ test_name: l.test_name, result_value: l.result_value, unit: l.unit, ref_range: l.ref_range, flag: l.flag, verified_at: l.verified_at })),
      pendingLabs: labs.filter((l) => l.status !== "reported").map((l) => l.test_name),
      imaging: imaging.filter((i) => i.status === "reported").map((i) => ({ modality: i.modality, body_part: i.body_part, findings: i.findings, impression: i.impression, reported_at: i.reported_at })),
      pendingImaging: imaging.filter((i) => i.status !== "reported").map((i) => i.modality),
      surgeries,
    });
  }
  return out;
}
