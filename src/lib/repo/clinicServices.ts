/** Clinic services, lab and radiology, and the visit bill.
 *
 * The clinic keeps its own list of services with fees: doctor consultation,
 * lab tests, radiology studies, procedures, room, nursing / staff, indoor
 * medicine. A consultation orders from it; lab tests get a result, radiology
 * a report; every order is a line of the visit's bill. Billing the visit
 * makes one invoice (type clinic_visit) whose lines are those orders, with
 * the doctor's fee added once. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { localDate, localDateTime } from "../localDate";
import { useAuthStore } from "../../store/authStore";
import { consultationsRepo, doctorsRepo, patientsRepo, appointmentsRepo } from "./clinic";
import { invoicesRepo, nextInvoiceNo } from "./invoices";
import { flagFor } from "../../config/labPanels";
import type { ClinicConsultation, ClinicDoctor, ClinicPatient } from "../types-clinic";
import type { Invoice } from "../types2";

export type ClinicServiceCategory = "consultation" | "lab" | "radiology" | "procedure" | "room" | "nursing" | "medicine" | "other";

/** In bill order. */
export const SERVICE_CATEGORIES: { key: ClinicServiceCategory; label: string; unit: string }[] = [
  { key: "consultation", label: "Doctor fee", unit: "per visit" },
  { key: "lab", label: "Lab test", unit: "per test" },
  { key: "radiology", label: "Radiology", unit: "per study" },
  { key: "procedure", label: "Procedure", unit: "per procedure" },
  { key: "room", label: "Room charges", unit: "per day" },
  { key: "nursing", label: "Nursing / staff fee", unit: "per day" },
  { key: "medicine", label: "Indoor medicine", unit: "per item" },
  { key: "other", label: "Other", unit: "per item" },
];
export const categoryLabel = (c: string) => SERVICE_CATEGORIES.find((x) => x.key === c)?.label ?? c;

export interface ClinicService extends TenantRow {
  code: string | null;
  name: string;
  category: ClinicServiceCategory;
  rate: number;
  billing_unit: string | null;
  sample_type: string | null;
  unit: string | null;
  ref_range: string | null;
  section: string | null;
  modality: string | null;
  is_active: number;
  notes: string | null;
}

export type ClinicOrderStatus = "ordered" | "collected" | "performed" | "reported" | "cancelled";

export interface ClinicOrder extends TenantRow {
  order_no: string;
  patient_id: string;
  consultation_id: string | null;
  doctor_id: string | null;
  service_id: string | null;
  /** The service category: lab, radiology, consultation, room... */
  kind: ClinicServiceCategory;
  name: string;
  qty: number;
  rate: number;
  amount: number;
  status: ClinicOrderStatus;
  priority: "routine" | "urgent" | "stat";
  result_value: string | null;
  unit: string | null;
  ref_range: string | null;
  flag: "N" | "H" | "L" | null;
  findings: string | null;
  impression: string | null;
  reported_by: string | null;
  reported_at: string | null;
  ordered_by: string | null;
  ordered_at: string;
  notes: string | null;
  invoice_id: string | null;
}

export const clinicServicesRepo = createTenantRepo<ClinicService>("clinic_services");
export const clinicOrdersRepo = createTenantRepo<ClinicOrder>("clinic_orders");

const round = (n: number) => Math.round(n * 100) / 100;
const actorName = () => {
  const u = useAuthStore.getState().currentUser;
  return u?.displayName || u?.username || "User";
};

// ── Services ──────────────────────────────────────────────────────────────

export async function listClinicServices(opts: { category?: ClinicServiceCategory; includeInactive?: boolean } = {}): Promise<ClinicService[]> {
  const all = await clinicServicesRepo.list({
    where: opts.category ? "category = ?" : undefined, params: opts.category ? [opts.category] : [], orderBy: "category ASC, name ASC",
  });
  return opts.includeInactive ? all : all.filter((s) => s.is_active);
}

export interface ClinicServiceInput {
  name: string;
  category: ClinicServiceCategory;
  rate: number;
  code?: string | null;
  billing_unit?: string | null;
  sample_type?: string | null;
  unit?: string | null;
  ref_range?: string | null;
  section?: string | null;
  modality?: string | null;
  is_active?: boolean;
  notes?: string | null;
}

const clean = (s: string | null | undefined) => (s ?? "").trim() || null;

export async function saveClinicService(id: string | null, s: ClinicServiceInput): Promise<ClinicService> {
  const name = s.name.trim();
  if (!name) throw new Error("Enter the service name.");
  if (!SERVICE_CATEGORIES.some((c) => c.key === s.category)) throw new Error("Choose the category.");
  const rate = Number(s.rate);
  if (!(rate >= 0)) throw new Error("The fee cannot be negative.");
  const clash = (await listClinicServices({ category: s.category, includeInactive: true }))
    .find((x) => x.id !== id && x.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) throw new Error(`"${name}" is already in ${categoryLabel(s.category)}.`);
  const payload: Partial<ClinicService> = {
    name, category: s.category, rate, code: clean(s.code), billing_unit: clean(s.billing_unit) ?? SERVICE_CATEGORIES.find((c) => c.key === s.category)!.unit,
    sample_type: clean(s.sample_type), unit: clean(s.unit), ref_range: clean(s.ref_range), section: clean(s.section), modality: clean(s.modality),
    is_active: s.is_active === false ? 0 : 1, notes: clean(s.notes),
  };
  if (id && !(await clinicServicesRepo.get(id))) throw new Error("Service not found.");
  return id ? (await clinicServicesRepo.update(id, payload))! : clinicServicesRepo.create(payload);
}

/** Loads the standard lab tests or radiology studies (without fees, not
 * offered until a fee is set). Names already in the list are skipped. */
export async function loadStandardClinicServices(kind: "lab" | "radiology"): Promise<{ added: number; skipped: number }> {
  const have = new Set((await listClinicServices({ category: kind, includeInactive: true })).map((s) => s.name.trim().toLowerCase()));
  let added = 0;
  let skipped = 0;
  if (kind === "lab") {
    const { STANDARD_LAB_TESTS } = await import("../../config/labTestCatalog");
    for (const t of STANDARD_LAB_TESTS) {
      if (have.has(t.name.toLowerCase())) { skipped++; continue; }
      await clinicServicesRepo.create({
        name: t.name, category: "lab", rate: 0, billing_unit: "per test", sample_type: t.sample, unit: t.unit, ref_range: t.range, section: t.section, is_active: 0,
      });
      added++;
    }
  } else {
    const { STANDARD_IMAGING_STUDIES } = await import("../../config/radiologyCatalog");
    for (const t of STANDARD_IMAGING_STUDIES) {
      if (have.has(t.name.toLowerCase())) { skipped++; continue; }
      await clinicServicesRepo.create({ name: t.name, category: "radiology", rate: 0, billing_unit: "per study", modality: t.modality, is_active: 0 });
      added++;
    }
  }
  return { added, skipped };
}

// ── Orders from a consultation ────────────────────────────────────────────

async function nextClinicOrderNo(kind: ClinicServiceCategory): Promise<string> {
  const prefix = kind === "lab" ? "LAB" : kind === "radiology" ? "RAD" : "SRV";
  const day = localDate().replace(/-/g, "");
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) AS n FROM clinic_orders WHERE tenant_id = ? AND order_no LIKE ?`, [requireCurrentTenantId(), `${prefix}-${day}-%`]
  );
  let n = (Number(rows[0]?.n) || 0) + 1;
  for (;;) {
    const no = `${prefix}-${day}-${String(n).padStart(3, "0")}`;
    if (!(await dbSelect(`SELECT 1 FROM clinic_orders WHERE tenant_id = ? AND order_no = ?`, [requireCurrentTenantId(), no])).length) return no;
    n++;
  }
}

/** Orders a service (lab test, radiology study, room day...) for a consultation. */
export async function addClinicOrder(input: {
  consultationId: string; serviceId: string; qty?: number; priority?: ClinicOrder["priority"]; notes?: string | null;
}): Promise<ClinicOrder> {
  const c = await consultationsRepo.get(input.consultationId);
  if (!c) throw new Error("Save the consultation first.");
  const svc = await clinicServicesRepo.get(input.serviceId);
  if (!svc || !svc.is_active) throw new Error("Choose a service from the clinic's list (Services).");
  const qty = input.qty == null ? 1 : Number(input.qty);
  if (!(qty > 0)) throw new Error("The quantity must be more than 0.");
  return clinicOrdersRepo.create({
    order_no: await nextClinicOrderNo(svc.category), patient_id: c.patient_id, consultation_id: c.id, doctor_id: c.doctor_id, service_id: svc.id,
    kind: svc.category, name: svc.name, qty, rate: Number(svc.rate) || 0, amount: round((Number(svc.rate) || 0) * qty),
    status: "ordered", priority: input.priority ?? "routine", unit: svc.unit, ref_range: svc.ref_range,
    ordered_by: actorName(), ordered_at: localDateTime(), notes: clean(input.notes),
  });
}

export async function listOrdersForConsultation(consultationId: string): Promise<ClinicOrder[]> {
  return clinicOrdersRepo.list({ where: "consultation_id = ?", params: [consultationId], orderBy: "ordered_at ASC, created_at ASC" });
}

/** Cancels an order that is not reported or billed yet. */
export async function cancelClinicOrder(orderId: string): Promise<void> {
  const o = await clinicOrdersRepo.get(orderId);
  if (!o) throw new Error("Order not found.");
  if (o.invoice_id) throw new Error("This item is already billed.");
  if (o.status === "reported") throw new Error("This test is already reported.");
  await clinicOrdersRepo.update(orderId, { status: "cancelled" });
}

// ── Lab and radiology worklists ───────────────────────────────────────────

export interface ClinicWorkRow extends ClinicOrder {
  patient_name: string;
  mrn: string | null;
  gender: string | null;
  dob: string | null;
  doctor_name: string | null;
}

export async function listClinicWork(kind: "lab" | "radiology", view: "pending" | "reported" | "all" = "pending"): Promise<ClinicWorkRow[]> {
  const status = view === "pending" ? `AND o.status IN ('ordered', 'collected', 'performed')` : view === "reported" ? `AND o.status = 'reported'` : `AND o.status != 'cancelled'`;
  return dbSelect<ClinicWorkRow>(
    `SELECT o.*, p.name AS patient_name, p.mrn, p.gender, p.dob, d.name AS doctor_name
     FROM clinic_orders o
     JOIN clinic_patients p ON p.id = o.patient_id
     LEFT JOIN clinic_doctors d ON d.id = o.doctor_id
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND o.kind = ? ${status}
     ORDER BY CASE o.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, o.ordered_at ${view === "reported" ? "DESC" : "ASC"}
     LIMIT 300`,
    [requireCurrentTenantId(), kind]
  );
}

/** Sample collected (lab) / examination done (radiology). */
export async function markClinicOrderStarted(orderId: string): Promise<void> {
  const o = await clinicOrdersRepo.get(orderId);
  if (!o || o.status !== "ordered") throw new Error("This order is not waiting.");
  await clinicOrdersRepo.update(orderId, { status: o.kind === "lab" ? "collected" : "performed" });
}

/** Enters a lab result; the flag (high / low / normal) follows from the range and the patient's sex. */
export async function enterClinicLabResult(orderId: string, r: { value: string; unit?: string | null; refRange?: string | null }): Promise<ClinicOrder> {
  const o = await clinicOrdersRepo.get(orderId);
  if (!o || o.kind !== "lab") throw new Error("Lab order not found.");
  if (o.status === "cancelled") throw new Error("This test is cancelled.");
  const value = r.value.trim();
  if (!value) throw new Error("Enter the result.");
  const patient = await patientsRepo.get(o.patient_id);
  const range = clean(r.refRange) ?? o.ref_range;
  return (await clinicOrdersRepo.update(orderId, {
    result_value: value, unit: clean(r.unit) ?? o.unit, ref_range: range, flag: flagFor(value, range, patient?.gender ?? null),
    status: "reported", reported_by: actorName(), reported_at: localDateTime(),
  }))!;
}

export async function reportClinicRadiology(orderId: string, r: { findings: string | null; impression: string }): Promise<ClinicOrder> {
  const o = await clinicOrdersRepo.get(orderId);
  if (!o || o.kind !== "radiology") throw new Error("Radiology order not found.");
  if (o.status === "cancelled") throw new Error("This study is cancelled.");
  if (!r.impression.trim()) throw new Error("Enter the impression.");
  return (await clinicOrdersRepo.update(orderId, {
    findings: clean(r.findings), impression: r.impression.trim(), status: "reported", reported_by: actorName(), reported_at: localDateTime(),
  }))!;
}

export interface ClinicReport {
  order: ClinicOrder;
  patient: ClinicPatient | null;
  doctor: ClinicDoctor | null;
}

export async function getClinicReport(orderId: string): Promise<ClinicReport> {
  const order = await clinicOrdersRepo.get(orderId);
  if (!order) throw new Error("Order not found.");
  if (order.status !== "reported") throw new Error("This is not reported yet.");
  const [patient, doctor] = await Promise.all([
    patientsRepo.get(order.patient_id), order.doctor_id ? doctorsRepo.get(order.doctor_id) : Promise.resolve(null),
  ]);
  return { order, patient, doctor };
}

// ── The visit bill ────────────────────────────────────────────────────────

export interface VisitBillLine {
  orderId: string | null;
  kind: ClinicServiceCategory;
  name: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface VisitBill {
  consultation: ClinicConsultation;
  patient: ClinicPatient | null;
  doctor: ClinicDoctor | null;
  /** Not billed yet, in bill order; the doctor's fee first when not billed before. */
  lines: VisitBillLine[];
  total: number;
  /** Invoices already made for this visit. */
  invoices: { id: string; invoice_no: number | null; payable: number; balance: number }[];
}

const KIND_ORDER = (k: string) => {
  const i = SERVICE_CATEGORIES.findIndex((c) => c.key === k);
  return i < 0 ? 99 : i;
};

async function doctorFee(c: ClinicConsultation, doctor: ClinicDoctor | null): Promise<number> {
  if (!doctor) return 0;
  const appt = c.appointment_id ? await appointmentsRepo.get(c.appointment_id) : null;
  return Number(appt?.type === "follow_up" ? doctor.follow_up_fee : doctor.consultation_fee) || 0;
}

/** What the visit would bill now. */
export async function getVisitBill(consultationId: string): Promise<VisitBill> {
  const c = await consultationsRepo.get(consultationId);
  if (!c) throw new Error("Consultation not found.");
  const [patient, doctor, orders] = await Promise.all([
    patientsRepo.get(c.patient_id), c.doctor_id ? doctorsRepo.get(c.doctor_id) : Promise.resolve(null), listOrdersForConsultation(c.id),
  ]);
  const lines: VisitBillLine[] = [];
  const feeBilled = orders.some((o) => o.kind === "consultation" && o.status !== "cancelled");
  const fee = feeBilled ? 0 : await doctorFee(c, doctor);
  if (fee > 0 && doctor) lines.push({ orderId: null, kind: "consultation", name: `Consultation fee - Dr. ${doctor.name}`, qty: 1, rate: fee, amount: fee });
  for (const o of orders) {
    if (o.status === "cancelled" || o.invoice_id) continue;
    lines.push({ orderId: o.id, kind: o.kind, name: o.name, qty: Number(o.qty), rate: Number(o.rate), amount: Number(o.amount) });
  }
  lines.sort((a, b) => KIND_ORDER(a.kind) - KIND_ORDER(b.kind));
  const invoiceIds = [...new Set(orders.map((o) => o.invoice_id).filter(Boolean))] as string[];
  const invoices = [];
  for (const id of invoiceIds) {
    const inv = await invoicesRepo.get(id);
    if (inv && !inv.deleted_at) invoices.push({ id, invoice_no: inv.invoice_no, payable: Number(inv.payable) || 0, balance: Number(inv.balance) || 0 });
  }
  return { consultation: c, patient, doctor, lines, total: round(lines.reduce((s, l) => s + l.amount, 0)), invoices };
}

export const CLINIC_VISIT_INVOICE_TYPE = "clinic_visit";

/** Bills everything not billed yet (the doctor's fee once) as one invoice. */
export async function createVisitInvoice(consultationId: string, pay: { discount?: number; paid?: number; method?: "Cash" | "Credit" }): Promise<Invoice> {
  const bill = await getVisitBill(consultationId);
  if (!bill.lines.length) throw new Error("Nothing to bill: every item of this visit is billed already.");
  const discount = Math.max(0, Number(pay.discount) || 0);
  if (discount > bill.total) throw new Error("The discount is more than the bill.");
  const payable = round(bill.total - discount);
  const paid = Math.min(Math.max(0, Number(pay.paid) || 0), payable);
  const invoice = await invoicesRepo.create({
    invoice_no: await nextInvoiceNo(), date: localDate(), inv_on: paid >= payable ? "cash" : "credit", invoice_type: CLINIC_VISIT_INVOICE_TYPE,
    description: `Visit ${bill.consultation.date}${bill.doctor ? ` - Dr. ${bill.doctor.name}` : ""}`, salesman_id: null, customer_id: null,
    customer_name: bill.patient?.name ?? null, customer_phone: bill.patient?.phone ?? null,
    total: bill.total, charges: 0, discount_pct: 0, discount_rs: discount, tax_pct: 0, payable, paid, balance: round(payable - paid),
    is_return: 0, is_memorized: 0, is_quotation: 0,
  } as Partial<Invoice>);
  for (const l of bill.lines) {
    if (l.orderId) {
      await clinicOrdersRepo.update(l.orderId, { invoice_id: invoice.id });
    } else {
      // The doctor's fee becomes its own billed line.
      await clinicOrdersRepo.create({
        order_no: await nextClinicOrderNo("consultation"), patient_id: bill.consultation.patient_id, consultation_id: bill.consultation.id,
        doctor_id: bill.consultation.doctor_id, service_id: null, kind: "consultation", name: l.name, qty: 1, rate: l.rate, amount: l.amount,
        status: "performed", priority: "routine", ordered_by: actorName(), ordered_at: localDateTime(), invoice_id: invoice.id,
      });
    }
  }
  return invoice;
}

export interface ClinicVisitInvoice {
  invoice: Invoice;
  lines: ClinicOrder[];
  patient: ClinicPatient | null;
  doctor: ClinicDoctor | null;
}

/** A clinic visit invoice with its lines (grouped by category when printed). */
export async function getClinicVisitInvoice(invoiceId: string): Promise<ClinicVisitInvoice> {
  const invoice = await invoicesRepo.get(invoiceId);
  if (!invoice || invoice.deleted_at || invoice.invoice_type !== CLINIC_VISIT_INVOICE_TYPE) throw new Error("Clinic invoice not found.");
  const lines = (await clinicOrdersRepo.list({ where: "invoice_id = ?", params: [invoiceId], orderBy: "created_at ASC" }))
    .sort((a, b) => KIND_ORDER(a.kind) - KIND_ORDER(b.kind));
  const first = lines[0];
  const [patient, doctor] = await Promise.all([
    first ? patientsRepo.get(first.patient_id) : Promise.resolve(null),
    first?.doctor_id ? doctorsRepo.get(first.doctor_id) : Promise.resolve(null),
  ]);
  return { invoice, lines, patient, doctor };
}
