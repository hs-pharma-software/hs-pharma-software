/** Hospital HR, OPD reception, doctor's desk and paid investigations.
 *
 * Flow: Reception books a patient with a doctor (token + consultation fee,
 * collected on the spot). The doctor opens the patient by slip number or name,
 * writes notes, prescribes from the linked hospital pharmacy (sent to its Rx
 * inbox) and orders lab / radiology from the Service Master. Each order adds its
 * fee to the episode bill; the lab / radiology can only process it once paid. */
import { dbExecute, dbSelect } from "../db";
import { friendlyDbError, requireCurrentTenantId } from "./base";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";
import { localDate, localDateTime } from "../localDate";
import { staffRepo } from "./staff";
import { getSetting, setSetting } from "./settings";
import {
  hospitalEpisodesRepo, hospitalPatientsRepo, hospitalServicesRepo, hospitalLabRepo, hospitalImagingRepo,
  nextEpisodeNo, nextOrderNo, addCharge, addPayment,
} from "./hospital";
import { getPharmacyLink, postToPharmacyMailbox } from "./clinic";
import { DESIGNATIONS, DOCTOR_CATEGORIES, designation, formatEmployeeId } from "../../config/hospitalStaff";
import type { Staff } from "../types";
import { createLabRequest, enterLabResult, labCapabilities, labRequestsRepo, collectionCentersRepo, type LabResultInput } from "./labReports";

const labRequestsRepoCenters = (id: string) => collectionCentersRepo.get(id);
import type { HospitalEpisode, HospitalRxItem, HospitalLabOrder, HospitalImagingOrder, HospitalService, LabRequest, PaymentMethod } from "../types-hospital";

// ── HR: staff with designation, licence and automatic employee id ─────────

const counterKey = (prefix: string) => `hr.employee_seq.${prefix}`;

/** Next employee id for a designation: MO-01, MO-02 ... An id is never handed
 * out twice, even after its holder left or was moved to another designation:
 * the highest number issued per prefix is remembered. */
export async function nextEmployeeId(category: string): Promise<string> {
  const d = designation(category);
  if (!d) throw new Error("Choose a designation.");
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM staff WHERE tenant_id = ? AND staff_category = ?`, [tenantId, category]);
  const issued = Number(await getSetting(counterKey(d.prefix))) || 0;
  let n = Math.max(rows[0]?.n ?? 0, issued) + 1;
  for (;;) {
    const id = formatEmployeeId(d.prefix, n);
    const taken = await dbSelect(`SELECT 1 FROM staff WHERE tenant_id = ? AND employee_id = ?`, [tenantId, id]);
    if (!taken.length) return id;
    n++;
  }
}

/** Creates or updates a hospital staff member. The designation decides the
 * licence that is required (PMDC for doctors, PNC for nurses, a licence for
 * paramedics) and the employee id. Changing designation issues a new id. */
export async function saveHospitalStaff(id: string | null, data: Partial<Staff>): Promise<Staff> {
  const d = designation(data.staff_category);
  if (!d) throw new Error("Choose a designation.");
  if (!data.name?.trim()) throw new Error("Enter the name.");
  const licenseNo = (data.license_no ?? "").trim();
  if (d.licenseRequired && !licenseNo) throw new Error(`Enter the ${d.license === "PNC" ? "PNC" : d.license === "PMDC" ? "PMDC" : "licence"} number.`);
  if (d.key === "head_nurse" && !data.department?.trim()) throw new Error("Choose the Head Nurse's department: admissions to it are confirmed by this Head Nurse.");
  const existing = id ? await staffRepo.get(id) : null;
  if (id && !existing) throw new Error("Staff member not found.");
  if (data.collection_center_id && !(await labRequestsRepoCenters(data.collection_center_id))) throw new Error("That collection center was not found.");
  const employeeId = existing && existing.staff_category === d.key && existing.employee_id ? existing.employee_id : await nextEmployeeId(d.key);
  const payload: Partial<Staff> = {
    ...data,
    name: data.name.trim(),
    designation: d.key === "other" && data.designation?.trim() ? data.designation.trim() : d.label,
    staff_category: d.key,
    employee_id: employeeId,
    license_type: d.license && licenseNo ? d.license : null,
    license_no: d.license ? licenseNo || null : null,
    consultation_fee: d.doctor ? Math.max(0, Number(data.consultation_fee) || 0) : 0,
    specialization: d.doctor ? data.specialization?.trim() || null : null,
  };
  if (licenseNo && d.license) {
    const clash = await dbSelect<{ name: string }>(
      `SELECT name FROM staff WHERE tenant_id = ? AND license_type = ? AND license_no = ? AND deleted_at IS NULL AND id != ?`,
      [requireCurrentTenantId(), d.license, licenseNo, id ?? ""]
    );
    if (clash.length) throw new Error(`${d.license} number ${licenseNo} is already registered for ${clash[0].name}.`);
  }
  const saved = id ? await staffRepo.update(id, payload) : await staffRepo.create(payload);
  if (!saved) throw new Error("Staff member not found.");
  // Remember the highest number issued for this prefix so it is never reused.
  const issuedNo = Number(employeeId.split("-").pop());
  if (Number(await getSetting(counterKey(d.prefix))) < issuedNo) await setSetting(counterKey(d.prefix), String(issuedNo));
  return saved;
}

/** Doctors who can be booked in OPD (HoD, Consultant, Medical Specialist, Medical Officer). */
export async function listHospitalDoctors(): Promise<Staff[]> {
  return staffRepo.list({ where: `staff_category IN (${DOCTOR_CATEGORIES.map(() => "?").join(", ")})`, params: DOCTOR_CATEGORIES, orderBy: "name ASC" });
}

/** The staff record linked to the logged-in user, if any. */
export async function staffForCurrentUser(): Promise<Staff | null> {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) return null;
  return (await staffRepo.list({ where: "user_id = ?", params: [userId] }))[0] ?? null;
}

/** The pages a login for this designation may open (null = everything). */
export function pagesForCategory(category: string | null | undefined): string[] | null {
  const d = designation(category);
  return d ? d.pages : ["hospital_dashboard"];
}

export { DESIGNATIONS };

// ── OPD reception ─────────────────────────────────────────────────────────

/** Next token for a doctor on a day: 1, 2, 3 ... */
async function nextToken(doctorId: string, date: string): Promise<number> {
  const rows = await dbSelect<{ n: number | null }>(
    `SELECT MAX(token_no) AS n FROM hospital_episodes WHERE tenant_id = ? AND doctor_id = ? AND date = ?`,
    [requireCurrentTenantId(), doctorId, date]
  );
  return (rows[0]?.n ?? 0) + 1;
}

export interface BookedVisit {
  episode: HospitalEpisode;
  token: number;
  fee: number;
  paid: number;
}

/** Books an OPD visit: opens the episode with the doctor, gives the next token,
 * adds the doctor's consultation fee to the bill and, when `pay` is given,
 * records the fee as paid. */
export async function bookOpdVisit(input: { patientId: string; doctorId: string; date?: string; time?: string | null; pay?: { method: PaymentMethod } | null; notes?: string | null }): Promise<BookedVisit> {
  const patient = await hospitalPatientsRepo.get(input.patientId);
  if (!patient) throw new Error("Patient not found in this hospital.");
  const doctor = await staffRepo.get(input.doctorId);
  if (!doctor || !DOCTOR_CATEGORIES.includes(doctor.staff_category ?? "")) throw new Error("Choose a doctor.");
  const date = input.date ?? localDate();
  const token = await nextToken(doctor.id, date);
  const episode = await hospitalEpisodesRepo.create({
    episode_no: await nextEpisodeNo("opd", date), type: "opd", patient_id: patient.id, doctor_id: doctor.id, department: doctor.department ?? null,
    date, time: input.time ?? localDateTime().slice(11), status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null,
    diagnosis: null, notes: input.notes ?? null, token_no: token, consult_status: "waiting",
  });
  const fee = Math.max(0, Number(doctor.consultation_fee) || 0);
  let paid = 0;
  if (fee > 0) {
    await addCharge({
      tenant_id: "", episode_id: episode.id, service_id: null, description: `Consultation: ${doctor.name}`, department: doctor.department ?? null,
      category: "consultation", qty: 1, rate: fee, discount_pct: 0, amount: 0, doctor_id: doctor.id, performed_by: null, charge_date: date, notes: null, invoice_id: null,
    });
    if (input.pay) {
      await addPayment({ tenant_id: "", episode_id: episode.id, type: "payment", amount: fee, method: input.pay.method, reference: `Token ${token}`, notes: "OPD fee", received_at: localDateTime() });
      paid = fee;
    }
  }
  return { episode, token, fee, paid };
}

export interface OpdQueueRow {
  id: string;
  episode_no: string;
  token_no: number | null;
  consult_status: string | null;
  status: string;
  date: string;
  time: string | null;
  patient_id: string;
  patient_name: string;
  mr_no: string;
  phone: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  charges: number;
  paid: number;
}

/** OPD visits of a day, optionally for one doctor and matching a slip number / name / MR / phone. */
export async function listOpdQueue(opts: { date?: string; doctorId?: string | null; search?: string } = {}): Promise<OpdQueueRow[]> {
  const where = ["e.tenant_id = ?", "e.type = 'opd'", "e.deleted_at IS NULL", "e.date = ?"];
  const params: unknown[] = [requireCurrentTenantId(), opts.date ?? localDate()];
  if (opts.doctorId) { where.push("e.doctor_id = ?"); params.push(opts.doctorId); }
  const term = opts.search?.trim();
  if (term) {
    where.push("(e.episode_no LIKE ? OR p.name LIKE ? OR p.mr_no LIKE ? OR p.phone LIKE ? OR CAST(e.token_no AS TEXT) = ?)");
    params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, term);
  }
  return dbSelect<OpdQueueRow>(
    `SELECT e.id, e.episode_no, e.token_no, e.consult_status, e.status, e.date, e.time, e.patient_id,
            p.name AS patient_name, p.mr_no, p.phone, e.doctor_id, s.name AS doctor_name,
            COALESCE((SELECT SUM(amount) FROM hospital_charges WHERE episode_id = e.id AND deleted_at IS NULL), 0) AS charges,
            COALESCE((SELECT SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) FROM hospital_payments WHERE episode_id = e.id AND deleted_at IS NULL), 0) AS paid
     FROM hospital_episodes e
     LEFT JOIN hospital_patients p ON p.id = e.patient_id
     LEFT JOIN staff s ON s.id = e.doctor_id
     WHERE ${where.join(" AND ")}
     ORDER BY s.name, COALESCE(e.token_no, 9999), e.created_at`,
    params
  );
}

// ── Doctor's desk ─────────────────────────────────────────────────────────

/** Saves the doctor's consultation notes on the visit. */
export async function saveConsultationNotes(
  episodeId: string,
  notes: { complaint?: string | null; vitals?: string | null; findings?: string | null; diagnosis?: string | null; advice?: string | null; followup_date?: string | null; consult_status?: "waiting" | "in_consultation" | "done" }
): Promise<HospitalEpisode> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit not found in this hospital.");
  const updated = await hospitalEpisodesRepo.update(episodeId, notes);
  return updated!;
}

export async function listRx(episodeId: string): Promise<HospitalRxItem[]> {
  return dbSelect<HospitalRxItem>(
    `SELECT * FROM hospital_rx_items WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL ORDER BY created_at`,
    [requireCurrentTenantId(), episodeId]
  );
}

export type RxDraft = Pick<HospitalRxItem, "product_id" | "product_name" | "generic_name" | "dose" | "route" | "frequency" | "duration" | "qty" | "instructions">;

/** Replaces the visit's prescription (old lines soft-deleted so the change syncs). */
export async function saveRx(episodeId: string, lines: RxDraft[]): Promise<HospitalRxItem[]> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit not found in this hospital.");
  const tenantId = requireCurrentTenantId();
  const clean = lines.filter((l) => l.product_name?.trim());
  for (const l of clean) if (!(Number(l.qty) > 0)) throw new Error(`Enter a quantity for ${l.product_name}.`);
  const ts = nowIso();
  // Inpatient medication orders (MAR) are never replaced here; see repo/medication.ts.
  for (const old of (await listRx(episodeId)).filter((r) => r.order_type !== "inpatient")) {
    await dbExecute(`UPDATE hospital_rx_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [ts, ts, old.id, tenantId]);
    await recordOutbox("hospital_rx_items", old.id, "delete", null);
  }
  for (const l of clean) {
    const row = {
      id: newId(), tenant_id: tenantId, episode_id: episodeId, product_id: l.product_id ?? null, product_name: l.product_name.trim(),
      generic_name: l.generic_name ?? null, dose: l.dose ?? null, route: l.route ?? null, frequency: l.frequency ?? null, duration: l.duration ?? null,
      qty: Number(l.qty), instructions: l.instructions ?? null, sent_at: null, created_at: ts, updated_at: ts, deleted_at: null,
    };
    const cols = Object.keys(row);
    try {
      await dbExecute(`INSERT INTO hospital_rx_items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => (row as Record<string, unknown>)[c]));
    } catch (e) {
      throw friendlyDbError(e);
    }
    await recordOutbox("hospital_rx_items", row.id, "insert", row);
  }
  return listRx(episodeId);
}

/** Sends the visit's prescription to the hospital's linked pharmacy (its Rx inbox). */
export async function sendRxToPharmacy(episodeId: string): Promise<void> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit not found in this hospital.");
  const link = await getPharmacyLink();
  if (!link) throw new Error("Link the hospital pharmacy first (Doctor Desk, Linked Pharmacy).");
  const lines = await listRx(episodeId);
  const patient = await hospitalPatientsRepo.get(ep.patient_id);
  const doctor = ep.doctor_id ? await staffRepo.get(ep.doctor_id) : null;
  await postToPharmacyMailbox({
    pharmacyTenantId: link.pharmacy_tenant_id, prescriptionId: episodeId, patientName: patient?.name ?? "", patientId: ep.patient_id,
    doctorName: doctor?.name ?? null, senderName: useAuthStore.getState().currentTenant?.name ?? null, rxDate: ep.date,
    notes: [ep.diagnosis, ep.advice].filter(Boolean).join(" | ") || null, lines,
  });
  const ts = nowIso();
  await dbExecute(`UPDATE hospital_rx_items SET sent_at = ?, updated_at = ? WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL`, [ts, ts, requireCurrentTenantId(), episodeId]);
}

// ── Investigations with fees ──────────────────────────────────────────────

export type OrderKind = "lab" | "imaging";

/** Whether an order may be processed: free, or its fee is paid. */
export function canProcess(order: { fee?: number | null; paid?: number | null }): boolean {
  return !(Number(order.fee) > 0) || Number(order.paid) === 1;
}

/** Orders a lab test or radiology study from the Service Master for a visit:
 * the fee goes on the visit's bill and the order waits until it is paid. */
/** The lab request a doctor's order joins: the visit's department order that
 * the lab has not started on yet, or a new one (registered by the department). */
async function departmentLabRequest(ep: HospitalEpisode, orderedBy: string | null): Promise<string> {
  const open = await dbSelect<{ id: string }>(
    `SELECT r.id FROM hospital_lab_requests r
     WHERE r.tenant_id = ? AND r.episode_id = ? AND r.deleted_at IS NULL
       AND r.registration_location = 'department'
       AND NOT EXISTS (SELECT 1 FROM hospital_lab_orders o WHERE o.request_id = r.id AND o.status NOT IN ('pending', 'cancelled'))
     ORDER BY r.created_at DESC LIMIT 1`,
    [requireCurrentTenantId(), ep.id]
  );
  if (open[0]) return open[0].id;
  const doctor = ep.doctor_id ? await staffRepo.get(ep.doctor_id) : null;
  const req = await createLabRequest({ patientId: ep.patient_id, episodeId: ep.id, referringDoctor: orderedBy ?? doctor?.name ?? null, location: "department" });
  return req.id;
}

export async function orderInvestigation(episodeId: string, serviceId: string, orderedBy: string | null = null, labRequestId: string | null = null): Promise<{ kind: OrderKind; order: HospitalLabOrder | HospitalImagingOrder }> {
  const ep = await hospitalEpisodesRepo.get(episodeId);
  if (!ep) throw new Error("Visit not found in this hospital.");
  const svc = await hospitalServicesRepo.get(serviceId);
  if (!svc || !svc.is_active) throw new Error("Service not found.");
  const kind: OrderKind | null = svc.category === "lab" ? "lab" : svc.category === "imaging" ? "imaging" : null;
  if (!kind) throw new Error(`"${svc.name}" is not a lab or radiology service.`);
  const fee = Math.max(0, Number(svc.rate) || 0);
  const charge = fee > 0
    ? await addCharge({
        tenant_id: "", episode_id: ep.id, service_id: svc.id, description: svc.name, department: svc.department, category: svc.category,
        qty: 1, rate: fee, discount_pct: 0, amount: 0, doctor_id: ep.doctor_id, performed_by: null, charge_date: localDate(), notes: null, invoice_id: null,
      })
    : null;
  const common = {
    episode_id: ep.id, patient_id: ep.patient_id, priority: "routine" as const, ordered_by: orderedBy, ordered_at: localDateTime(), reported_at: null, notes: null,
    service_id: svc.id, charge_id: charge?.id ?? null, fee, paid: fee > 0 ? 0 : 1,
  };
  if (kind === "lab") {
    // The test's unit and normal range come along, so the result form is pre-filled.
    const requestId = labRequestId ?? (await departmentLabRequest(ep, orderedBy));
    const order = await hospitalLabRepo.create({
      ...common, order_no: await nextOrderNo("hospital_lab_orders"), test_name: svc.name, status: "pending",
      result_value: null, unit: svc.unit ?? null, ref_range: svc.ref_range ?? null, flag: null,
      request_id: requestId, sample_type: svc.sample_type ?? null,
    });
    return { kind, order };
  }
  const order = await hospitalImagingRepo.create({
    ...common, order_no: await nextOrderNo("hospital_imaging_orders"), modality: svc.name, body_part: null, status: "pending",
    findings: null, impression: null, radiologist: null,
  });
  return { kind, order };
}

/** Takes the fee of an order; the lab / radiology can then process it. */
export async function payOrderFee(kind: OrderKind, orderId: string, method: PaymentMethod): Promise<void> {
  const repo = kind === "lab" ? hospitalLabRepo : hospitalImagingRepo;
  const order = await repo.get(orderId);
  if (!order) throw new Error("Order not found in this hospital.");
  if (canProcess(order)) throw new Error("This order is already paid.");
  if (!order.episode_id) throw new Error("This order is not on a visit, so its fee cannot be taken here.");
  await addPayment({ tenant_id: "", episode_id: order.episode_id, type: "payment", amount: Number(order.fee), method, reference: order.order_no, notes: "Investigation fee", received_at: localDateTime() });
  await repo.update(orderId, { paid: 1 });
}

export interface UnpaidOrderRow {
  kind: OrderKind;
  id: string;
  order_no: string;
  name: string;
  fee: number;
  episode_id: string;
  episode_no: string;
  patient_name: string;
  mr_no: string;
  ordered_at: string;
  /** Unique Lab Number of a lab test (null for radiology). */
  lab_no: string | null;
}

/** Investigations waiting for their fee, newest first. */
export async function listUnpaidOrders(): Promise<UnpaidOrderRow[]> {
  const t = requireCurrentTenantId();
  return dbSelect<UnpaidOrderRow>(
    `SELECT 'lab' AS kind, o.id, o.order_no, o.test_name AS name, o.fee, o.episode_id, e.episode_no, p.name AS patient_name, p.mr_no, o.ordered_at, r.lab_no
     FROM hospital_lab_orders o JOIN hospital_episodes e ON e.id = o.episode_id JOIN hospital_patients p ON p.id = o.patient_id
     LEFT JOIN hospital_lab_requests r ON r.id = o.request_id
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND o.status != 'cancelled' AND o.fee > 0 AND COALESCE(o.paid, 0) = 0
     UNION ALL
     SELECT 'imaging' AS kind, o.id, o.order_no, o.modality AS name, o.fee, o.episode_id, e.episode_no, p.name AS patient_name, p.mr_no, o.ordered_at, NULL AS lab_no
     FROM hospital_imaging_orders o JOIN hospital_episodes e ON e.id = o.episode_id JOIN hospital_patients p ON p.id = o.patient_id
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND o.status != 'cancelled' AND o.fee > 0 AND COALESCE(o.paid, 0) = 0
     ORDER BY ordered_at DESC`,
    [t, t]
  );
}

/** Enters a lab result (refused while the fee is unpaid). The result is not
 * released: it waits for a pathologist's verification (see labReports.ts). */
export async function reportLabResult(orderId: string, r: LabResultInput): Promise<void> {
  await enterLabResult(orderId, r);
}

/** Writes a radiology report; refused while the fee is unpaid. */
export async function reportImaging(orderId: string, r: { findings: string | null; impression: string; radiologist: string | null }): Promise<void> {
  const order = await hospitalImagingRepo.get(orderId);
  if (!order) throw new Error("Order not found in this hospital.");
  if (!canProcess(order)) throw new Error("The fee for this study is not paid yet. Reception must take the fee first.");
  if (!r.impression.trim()) throw new Error("Enter the impression.");
  await hospitalImagingRepo.update(orderId, { ...r, impression: r.impression.trim(), status: "reported", reported_at: localDateTime() });
}

/** Lab and radiology orders of one visit (for the doctor's desk). */
export async function listVisitOrders(episodeId: string): Promise<{ kind: OrderKind; id: string; order_no: string; name: string; fee: number; paid: number; status: string; result: string | null; request_id: string | null }[]> {
  const t = requireCurrentTenantId();
  return dbSelect(
    `SELECT 'lab' AS kind, id, order_no, test_name AS name, COALESCE(fee, 0) AS fee, COALESCE(paid, 0) AS paid, status,
            CASE WHEN status != 'reported' OR result_value IS NULL THEN NULL ELSE result_value || COALESCE(' ' || unit, '') END AS result, request_id
     FROM hospital_lab_orders WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL
     UNION ALL
     SELECT 'imaging' AS kind, id, order_no, modality AS name, COALESCE(fee, 0) AS fee, COALESCE(paid, 0) AS paid, status, impression AS result, NULL AS request_id
     FROM hospital_imaging_orders WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL`,
    [t, episodeId, t, episodeId]
  );
}

// ── Lab: performing tests (the lab's own test list) ──────────────────────

export interface LabTestInput {
  name: string;
  code?: string | null;
  sample_type?: string | null;
  unit?: string | null;
  ref_range?: string | null;
  turnaround_hours?: number | null;
  rate: number;
  is_active?: number;
  department?: string | null;
}

/** The tests this lab performs (Service Master entries of category "lab"). */
export async function listLabTests(opts: { includeInactive?: boolean } = {}): Promise<HospitalService[]> {
  const all = await hospitalServicesRepo.list({ where: "category = 'lab'", orderBy: "name ASC" });
  return opts.includeInactive ? all : all.filter((s) => s.is_active);
}

/** Next free test code: LAB-001, LAB-002 ... */
async function nextLabCode(): Promise<string> {
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM hospital_services WHERE tenant_id = ? AND category = 'lab'`, [tenantId]);
  let n = (rows[0]?.n ?? 0) + 1;
  for (;;) {
    const code = `LAB-${String(n).padStart(3, "0")}`;
    const taken = await dbSelect(`SELECT 1 FROM hospital_services WHERE tenant_id = ? AND code = ?`, [tenantId, code]);
    if (!taken.length) return code;
    n++;
  }
}

/** Adds or edits a test the lab performs. A blank code gets the next LAB-nnn;
 * the same test name twice is refused. */
export async function saveLabTest(id: string | null, t: LabTestInput): Promise<HospitalService> {
  const name = t.name?.trim();
  if (!name) throw new Error("Enter the test name.");
  if (!(Number(t.rate) >= 0)) throw new Error("The fee cannot be negative.");
  if (t.turnaround_hours != null && !(Number(t.turnaround_hours) >= 0)) throw new Error("Turnaround time cannot be negative.");
  const clash = await dbSelect<{ id: string }>(
    `SELECT id FROM hospital_services WHERE tenant_id = ? AND category = 'lab' AND deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(?) AND id != ?`,
    [requireCurrentTenantId(), name, id ?? ""]
  );
  if (clash.length) throw new Error(`"${name}" is already in the test list.`);
  const existing = id ? await hospitalServicesRepo.get(id) : null;
  if (id && (!existing || existing.category !== "lab")) throw new Error("Test not found.");
  const payload: Partial<HospitalService> = {
    name,
    code: t.code?.trim() ? t.code.trim().toUpperCase() : existing?.code ?? (await nextLabCode()),
    department: t.department?.trim() || existing?.department || "Laboratory",
    category: "lab",
    billing_unit: "test",
    rate: Number(t.rate) || 0,
    is_active: t.is_active ?? existing?.is_active ?? 1,
    sample_type: t.sample_type?.trim() || null,
    unit: t.unit?.trim() || null,
    ref_range: t.ref_range?.trim() || null,
    turnaround_hours: t.turnaround_hours != null && String(t.turnaround_hours) !== "" ? Number(t.turnaround_hours) : null,
  };
  const saved = id ? await hospitalServicesRepo.update(id, payload) : await hospitalServicesRepo.create(payload);
  if (!saved) throw new Error("Test not found.");
  return saved;
}

/** The patient's open visits (newest first), to put lab tests on. */
export async function listOpenVisits(patientId: string): Promise<HospitalEpisode[]> {
  return hospitalEpisodesRepo.list({ where: "patient_id = ? AND status = 'open'", params: [patientId], orderBy: "date DESC, created_at DESC" });
}

/** Orders tests from the lab's list for a patient. They go on the chosen open
 * visit, or today's open visit, or a new "Laboratory" visit, so each fee is on a
 * bill that Reception can collect; the lab starts a test once its fee is paid. */
export async function orderLabTests(input: {
  patientId: string; serviceIds: string[]; episodeId?: string | null; priority?: "routine" | "urgent" | "stat"; orderedBy?: string | null;
  externalRef?: string | null; sampleCollected?: boolean;
}): Promise<{ episode: HospitalEpisode; orders: HospitalLabOrder[]; request: LabRequest }> {
  const caps = await labCapabilities();
  if (!caps.register) throw new Error("You do not have permission to register lab tests.");
  const patient = await hospitalPatientsRepo.get(input.patientId);
  if (!patient) throw new Error("Patient not found in this hospital.");
  const ids = [...new Set(input.serviceIds)];
  if (!ids.length) throw new Error("Choose at least one test.");
  const tests = await Promise.all(ids.map((id) => hospitalServicesRepo.get(id)));
  const bad = tests.findIndex((s) => !s || s.category !== "lab" || !s.is_active);
  if (bad >= 0) throw new Error("One of the chosen tests is not in the lab's list.");

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
      episode_no: await nextEpisodeNo("opd", date), type: "opd", patient_id: patient.id, doctor_id: null, department: "Laboratory",
      date, time: localDateTime().slice(11), status: "open", room_ward: null, bed_no: null, admission_date: null, discharge_date: null,
      diagnosis: null, notes: "Lab visit", token_no: null, consult_status: "done",
    });
  }
  const request = await createLabRequest({
    patientId: patient.id, episodeId: episode.id, referringDoctor: input.orderedBy ?? null,
    externalRef: input.externalRef ?? null, sampleCollected: input.sampleCollected ?? false,
  });
  const orders: HospitalLabOrder[] = [];
  for (const id of ids) {
    const { order } = await orderInvestigation(episode.id, id, input.orderedBy ?? null, request.id);
    if (input.priority && input.priority !== "routine") await hospitalLabRepo.update(order.id, { priority: input.priority });
    orders.push({ ...(order as HospitalLabOrder), priority: input.priority ?? "routine" });
  }
  return { episode, orders, request: (await labRequestsRepo.get(request.id)) ?? request };
}

/** Loads the standard list of major lab tests into Performing Tests. Tests
 * already in the list (same name) are left as they are. New ones come without a
 * fee and "not performing", so nothing can be ordered free by mistake; entering a
 * test's fee starts performing it. */
export async function importStandardLabTests(onProgress?: (done: number, total: number) => void): Promise<{ added: number; skipped: number }> {
  const { STANDARD_LAB_TESTS } = await import("../../config/labTestCatalog");
  const existing = new Set((await listLabTests({ includeInactive: true })).map((t) => t.name.trim().toLowerCase()));
  const todo = STANDARD_LAB_TESTS.filter((t) => !existing.has(t.name.toLowerCase()));
  let code = await nextLabCode();
  let n = Number(code.split("-").pop());
  const taken = new Set((await dbSelect<{ code: string }>(`SELECT code FROM hospital_services WHERE tenant_id = ?`, [requireCurrentTenantId()])).map((r) => r.code));
  let done = 0;
  for (const t of todo) {
    while (taken.has(code)) code = `LAB-${String(++n).padStart(3, "0")}`;
    taken.add(code);
    await hospitalServicesRepo.create({
      code, name: t.name, department: t.section, category: "lab", billing_unit: "test", rate: 0, is_active: 0, notes: null,
      sample_type: t.sample, unit: t.unit, ref_range: t.range, turnaround_hours: t.tat,
    });
    done++;
    onProgress?.(done, todo.length);
  }
  return { added: todo.length, skipped: STANDARD_LAB_TESTS.length - todo.length };
}

/** Sets a test's fee from the list. A fee above zero also starts performing the test. */
export async function setLabTestFee(id: string, fee: number): Promise<HospitalService> {
  if (!(Number(fee) >= 0)) throw new Error("The fee cannot be negative.");
  const t = await hospitalServicesRepo.get(id);
  if (!t || t.category !== "lab") throw new Error("Test not found.");
  const updated = await hospitalServicesRepo.update(id, { rate: Number(fee), ...(Number(fee) > 0 ? { is_active: 1 } : {}) });
  return updated!;
}

/** Starts or stops performing a test (stopped tests cannot be ordered). */
export async function setLabTestActive(id: string, active: boolean): Promise<HospitalService> {
  const t = await hospitalServicesRepo.get(id);
  if (!t || t.category !== "lab") throw new Error("Test not found.");
  return (await hospitalServicesRepo.update(id, { is_active: active ? 1 : 0 }))!;
}
