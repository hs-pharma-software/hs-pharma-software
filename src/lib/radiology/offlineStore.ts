/** Radiology Centre saves made without internet. The desktop runs them on its
 * local copy; MAVIN.pk runs the same code again when the connection returns,
 * with the same ids, clock and receipt number, so both end with the same rows
 * and everything already printed stays true.
 *
 * Numbers come from the computer's receipt number, so two computers working
 * offline can never give out the same MR, visit or order number. No browser or
 * server imports: this runs in the desktop's main process and on the server. */
import type { RestContext, RestDb } from "../restaurant/store.ts";
import { TECHNOLOGIST_ROLES } from "../../config/hospitalStaff.ts";
import { validateExam, type ExamData } from "../../config/radiologyPortal.ts";
import { findingsText, isUltrasoundStudy, ultrasoundTemplate, validateUltrasound, type StructuredReport } from "../../config/ultrasoundReports.ts";

type Row = Record<string, unknown>;

/** The save's own place: its receipt number and the branch of the computer. */
export interface RadiologyJob { offlineRef: string; branchId: string }

/** The numbers of a save, worked out only from its receipt number and day.
 * An order number stays all digits after the date: its DICOM Accession Number
 * is limited to 16 characters. */
export function offlineNumbers(offlineRef: string, day: string) {
  const m = /^D([0-9A-F]{4})-(\d+)$/.exec(offlineRef);
  if (!m) throw new Error("This save has no receipt number from this computer.");
  const ymd = day.replace(/-/g, "");
  const seq = m[2].padStart(6, "0");
  const device = String(parseInt(m[1], 16) % 1000).padStart(3, "0");
  return {
    mrNo: `MR-D${m[1]}-${seq}`,
    episodeNo: `OPD-${ymd}-D${m[1]}${seq}`,
    orderNo: `RAD-${ymd}-${device}${String(Number(m[2]) % 100000).padStart(5, "0")}`,
  };
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (n: number) => Math.round(n * 100) / 100;
const canProcess = (o: Row) => !(Number(o.fee) > 0) || Number(o.paid) === 1;

/** The computer's local time of the save, as the page read it ("yyyy-mm-dd hh:mm"). */
function timeOf(input: { time?: unknown }): string {
  const t = String(input.time ?? "");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) throw new Error("This save has no time.");
  return t;
}

const PATIENT_FIELDS = ["name", "father_name", "gender", "dob", "phone", "cnic", "address", "city", "blood_group", "allergies", "chronic_conditions", "insurance_company", "insurance_no", "next_of_kin_name", "next_of_kin_phone", "next_of_kin_relation", "notes"] as const;

function patientValues(p: Row): Row {
  const out: Row = {};
  for (const k of PATIENT_FIELDS) out[k] = text(p[k]);
  out.age_years = num(p.age_years);
  out.age_months = num(p.age_months);
  return out;
}

export function createRadiologyStore(db: RestDb, context: () => RestContext, job: RadiologyJob) {
  const ctx = context();
  const tenantId = ctx.tenantId;
  if (!tenantId) throw new Error("No business is signed in.");
  const stamp = () => db.now().toISOString();

  const insert = async (table: string, row: Row) => {
    const keys = Object.keys(row);
    await db.execute(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => row[k]));
  };
  const update = async (table: string, id: string, row: Row) => {
    const keys = Object.keys(row);
    await db.execute(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND tenant_id = ?`, [...keys.map((k) => row[k]), stamp(), id, tenantId]);
  };
  const find = async (table: string, id: string) =>
    (await db.select<Row>(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [id, tenantId]))[0] ?? null;
  const needOrder = async (id: string) => {
    const o = await find("hospital_imaging_orders", id);
    if (!o) throw new Error("Order not found in this centre.");
    return o;
  };

  /** The login's permissions; null = every section. */
  async function permissions(): Promise<string[] | null> {
    if (ctx.role !== "staff") return null;
    const rows = await db.select<{ permissions: string | null }>(`SELECT permissions FROM users WHERE id = ? AND tenant_id = ?`, [ctx.userId, tenantId]).catch(() => []);
    if (!rows[0]?.permissions) return null;
    try {
      const v = JSON.parse(rows[0].permissions) as unknown;
      return Array.isArray(v) ? v.map(String) : null;
    } catch {
      return [];
    }
  }

  /** The signed-in person, by the same rule the screens use online. */
  async function actor() {
    const allowed = await permissions();
    if (allowed && !allowed.some((p) => p.startsWith("hospital_"))) throw new Error("Your login cannot work in the radiology sections.");
    const staff = (await db.select<Row>(`SELECT name, staff_category, designation FROM staff WHERE user_id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`, [ctx.userId, tenantId]).catch(() => []))[0];
    return {
      id: ctx.userId,
      name: text(staff?.name) ?? ctx.userName ?? "User",
      role: text(staff?.staff_category),
      designation: text(staff?.designation),
      full: allowed === null,
    };
  }
  async function technologist() {
    const a = await actor();
    if (!a.full && !TECHNOLOGIST_ROLES.includes(a.role ?? "")) throw new Error("Your login cannot perform examinations.");
    return a;
  }

  async function addPayment(episodeId: string, amount: number, method: string, reference: string | null, notes: string, time: string, who: { id: string | null; name: string }) {
    const now = stamp();
    await insert("hospital_payments", {
      id: db.newId(), tenant_id: tenantId, branch_id: job.branchId, episode_id: episodeId, type: "payment", amount, method, reference, notes,
      received_at: time, received_by: who.id, received_by_name: who.name, closing_id: null, created_at: now, updated_at: now, deleted_at: null,
    });
  }

  return {
    /** Registers a patient; the MR number comes from this computer's receipt number. */
    async registerPatient(input: Row) {
      await actor();
      const values = patientValues(input);
      if (!values.name) throw new Error("Enter the patient's name.");
      if (!values.gender) throw new Error("Choose the patient's gender.");
      const id = db.newId();
      const now = stamp();
      await insert("hospital_patients", { id, tenant_id: tenantId, mr_no: offlineNumbers(job.offlineRef, timeOf(input).slice(0, 10)).mrNo, ...values, created_at: now, updated_at: now, deleted_at: null });
      return find("hospital_patients", id);
    },

    async updatePatient(input: Row) {
      await actor();
      const id = String(input.id ?? "");
      if (!(await find("hospital_patients", id))) throw new Error("Patient not found in this centre.");
      const values = patientValues(input);
      if (!values.name) throw new Error("Enter the patient's name.");
      await update("hospital_patients", id, values);
      return find("hospital_patients", id);
    },

    /** Books a study: on the visit the page chose, or on a new one. The fee is
     * the one the patient was told, even if the price changes online meanwhile. */
    async orderStudy(input: Row) {
      await actor();
      const time = timeOf(input);
      const date = time.slice(0, 10);
      const numbers = offlineNumbers(job.offlineRef, date);
      const patientId = String(input.patientId ?? "");
      if (!(await find("hospital_patients", patientId))) throw new Error("Patient not found in this centre.");
      const svc = await find("hospital_services", String(input.serviceId ?? ""));
      if (!svc || svc.category !== "imaging") throw new Error("Choose a study from Performing Images.");
      const fee = Math.max(0, Number(input.fee) || 0);
      const now = stamp();
      let episodeId = text(input.visitId);
      if (episodeId) {
        const ep = await find("hospital_episodes", episodeId);
        if (!ep || ep.patient_id !== patientId || ep.status !== "open") throw new Error("Choose an open visit of this patient.");
      } else {
        episodeId = db.newId();
        await insert("hospital_episodes", {
          id: episodeId, tenant_id: tenantId, branch_id: job.branchId, episode_no: numbers.episodeNo, type: "opd", patient_id: patientId, doctor_id: null, department: "Radiology",
          date, time: time.slice(11), status: "open", diagnosis: null, notes: "Radiology visit", token_no: null, consult_status: "done", created_at: now, updated_at: now, deleted_at: null,
        });
      }
      let chargeId: string | null = null;
      if (fee > 0) {
        chargeId = db.newId();
        await insert("hospital_charges", {
          id: chargeId, tenant_id: tenantId, branch_id: job.branchId, episode_id: episodeId, service_id: svc.id, description: svc.name, department: svc.department ?? null, category: svc.category,
          qty: 1, rate: fee, discount_pct: 0, amount: round(fee), doctor_id: null, performed_by: null, charge_date: date, notes: null, invoice_id: null, created_at: now, updated_at: now, deleted_at: null,
        });
      }
      const orderId = db.newId();
      const priority = input.priority === "urgent" || input.priority === "stat" ? input.priority : "routine";
      await insert("hospital_imaging_orders", {
        id: orderId, tenant_id: tenantId, branch_id: job.branchId, episode_id: episodeId, patient_id: patientId, order_no: numbers.orderNo, modality: svc.name, body_part: text(input.bodyPart), priority, status: "pending",
        ordered_by: text(input.orderedBy), ordered_at: time, service_id: svc.id, charge_id: chargeId, fee, paid: fee > 0 ? 0 : 1,
        clinical_history: text(input.clinicalHistory), modality_code: text(input.modalityCode), created_at: now, updated_at: now, deleted_at: null,
      });
      return { episode: await find("hospital_episodes", episodeId), order: await find("hospital_imaging_orders", orderId) };
    },

    /** Takes what is due on a visit and marks its studies paid. A fee already
     * covered by an earlier payment is marked paid without taking money twice. */
    async collectFees(input: Row) {
      const who = await actor();
      const time = timeOf(input);
      const episodeId = String(input.episodeId ?? "");
      const method = text(input.method) ?? "cash";
      const scope = input.scope === "all" ? "all" : "imaging";
      const episode = await find("hospital_episodes", episodeId);
      if (!episode) throw new Error("Visit not found in this centre.");
      const dueNow = async () => {
        const charges = await db.select<{ t: number }>(`SELECT COALESCE(SUM(amount), 0) AS t FROM hospital_charges WHERE episode_id = ? AND tenant_id = ? AND deleted_at IS NULL`, [episodeId, tenantId]);
        const paid = await db.select<{ t: number }>(`SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END), 0) AS t FROM hospital_payments WHERE episode_id = ? AND tenant_id = ? AND deleted_at IS NULL`, [episodeId, tenantId]);
        return round(Number(charges[0]?.t ?? 0) - Number(paid[0]?.t ?? 0));
      };
      const orders = await db.select<Row>(
        `SELECT id, order_no, fee FROM hospital_imaging_orders WHERE tenant_id = ? AND episode_id = ? AND deleted_at IS NULL AND status != 'cancelled' AND fee > 0 AND COALESCE(paid, 0) != 1 ORDER BY ordered_at ASC`,
        [tenantId, episodeId],
      );
      let covered = round(orders.reduce((t, o) => t + Number(o.fee), 0) - Math.max(0, await dueNow()));
      let taken = 0;
      let settled = 0;
      for (const o of orders) {
        const fee = Number(o.fee);
        if (covered >= fee) {
          covered = round(covered - fee);
          settled++;
        } else {
          await addPayment(episodeId, fee, method, String(o.order_no), "Investigation fee", time, who);
          taken = round(taken + fee);
        }
        await update("hospital_imaging_orders", String(o.id), { paid: 1 });
      }
      if (scope === "all") {
        const rest = await dueNow();
        if (rest > 0) {
          await addPayment(episodeId, rest, method, String(episode.episode_no), "Balance paid at reception", time, who);
          taken = round(taken + rest);
        }
      }
      if (!taken && !settled) throw new Error(scope === "all" ? "Nothing is due on this visit." : "No radiology fee is due on this visit.");
      return { amount: taken };
    },

    async cancelOrder(input: Row) {
      await actor();
      const o = await needOrder(String(input.orderId ?? ""));
      if (o.status !== "pending") throw new Error("Only an order still waiting in the queue can be cancelled.");
      const reason = text(input.reason);
      if (!reason) throw new Error("Enter the reason for cancelling.");
      await update("hospital_imaging_orders", String(o.id), { status: "cancelled", notes: [text(o.notes), `Cancelled: ${reason}`].filter(Boolean).join("\n") });
      return { ok: true };
    },

    async startExam(input: Row) {
      const a = await technologist();
      const time = timeOf(input);
      const o = await needOrder(String(input.orderId ?? ""));
      const machineId = String(input.machineId ?? "");
      if (!canProcess(o)) throw new Error("The fee for this study is not paid yet. Reception must take the fee first.");
      if (o.status === "in_progress" && o.machine_id && o.machine_id !== machineId) throw new Error("This patient is being examined on another machine.");
      if (o.status !== "pending" && o.status !== "in_progress") throw new Error(`This study is already ${String(o.status)}.`);
      const m = await find("radiology_machines", machineId);
      if (!m || m.status !== "active") throw new Error("Choose an active machine.");
      await update("hospital_imaging_orders", String(o.id), { status: "in_progress", machine_id: m.id, exam_started_at: o.exam_started_at ?? time, exam_started_by_name: o.exam_started_by_name ?? a.name });
      return { ok: true };
    },

    async returnToQueue(input: Row) {
      await technologist();
      const o = await needOrder(String(input.orderId ?? ""));
      if (o.status !== "in_progress") throw new Error("This examination is not in progress.");
      await update("hospital_imaging_orders", String(o.id), { status: "pending", exam_started_at: null, exam_started_by_name: null });
      return { ok: true };
    },

    async saveExamDraft(input: Row) {
      await technologist();
      const o = await needOrder(String(input.orderId ?? ""));
      if (o.status !== "in_progress" && o.status !== "pending") throw new Error("Start the examination first.");
      await update("hospital_imaging_orders", String(o.id), { exam_data: JSON.stringify(input.data) });
      return { ok: true };
    },

    async completeExam(input: Row) {
      const a = await technologist();
      const time = timeOf(input);
      const o = await needOrder(String(input.orderId ?? ""));
      if (o.status !== "in_progress") throw new Error("Start the examination first.");
      const data = input.data as ExamData;
      const p = await find("hospital_patients", String(o.patient_id));
      const { errors, warnings } = validateExam(data, { gender: p?.gender as string | undefined, ageYears: p?.age_years as number | undefined });
      if (errors.length) throw new Error(errors.join(" "));
      if (warnings.length && input.confirm !== true) return { warnings };
      const series = Number(data.acquisition.series);
      const per = Number(data.acquisition.imagesPerSeries);
      await update("hospital_imaging_orders", String(o.id), {
        status: "performed", performed_at: time, performed_by_name: a.name, exam_data: JSON.stringify(data),
        ...(o.series_count == null && series > 0 ? { series_count: series } : {}),
        ...(o.images_count == null && series > 0 && per > 0 ? { images_count: series * per } : {}),
      });
      return { warnings: [] as string[] };
    },

    /** Signs the report. The key of its online copy is made here, so a QR code
     * printed offline opens the report once it has reached MAVIN.pk. */
    async signReport(input: Row) {
      const a = await actor();
      const time = timeOf(input);
      const token = db.newId().replace(/-/g, "").toLowerCase();
      const o = await needOrder(String(input.orderId ?? ""));
      if (!canProcess(o)) throw new Error("The fee for this study is not paid yet. Reception must take the fee first.");
      const impression = text(input.impression);
      if (!impression) throw new Error("Enter the conclusion.");
      let findings = text(input.findings);
      let structured: StructuredReport | null = null;
      const s = input.structured as StructuredReport | null | undefined;
      if (s) {
        const template = ultrasoundTemplate(s.template);
        if (!template) throw new Error("Choose the report pattern.");
        const p = await find("hospital_patients", String(o.patient_id));
        const check = { gender: (p?.gender as string | null) ?? null, reportDate: time.slice(0, 10) };
        const errors = validateUltrasound(template, s.values, check);
        if (errors.length) throw new Error(errors.join(" "));
        findings = findingsText(template, s.values, check);
        structured = { template: template.id, values: s.values, recommendation: text(s.recommendation), note: text(s.note) };
      }
      const scannedByDoctor = !o.performed_at && isUltrasoundStudy(o as never);
      await update("hospital_imaging_orders", String(o.id), {
        structured_report: structured ? JSON.stringify(structured) : null, findings, impression, status: "reported", reported_at: time,
        radiologist: text(input.radiologist) ?? (a.designation ? `${a.name}, ${a.designation}` : a.name),
        ...(scannedByDoctor ? { performed_at: time, performed_by_name: a.name } : {}),
      });
      await db.execute(`UPDATE hospital_imaging_orders SET public_token = COALESCE(public_token, ?) WHERE id = ? AND tenant_id = ?`, [token, o.id, tenantId]);
      return { ok: true };
    },
  };
}
