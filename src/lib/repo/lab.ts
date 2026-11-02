/** Diagnostic lab (business type "lab"). Built on the clinic's patient, test
 * (clinic_services, category lab) and order tables, with a lab visit per
 * reception desk registration (v67):
 *
 *   reception: patient + tests + bill (paid in full, part or credit)
 *   -> technologist: sample collected, results entered (panels parameter by parameter)
 *   -> pathologist: verifies (or sends back for recheck) -> report released.
 *
 * A result is never shown as a released report until the pathologist has
 * verified it. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { localDate, localDateTime } from "../localDate";
import { invoicesRepo, nextInvoiceNo } from "./invoices";
import { patientsRepo } from "./clinic";
import { isMissingSchemaError } from "../dbErrors";
import {
  actorName, clinicOrdersRepo, clinicServicesRepo, enterClinicLabResult, nextClinicOrderNo, type ClinicOrder,
} from "./clinicServices";
import type { LabComponent } from "../types-hospital";
import type { ClinicPatient } from "../types-clinic";
import type { Invoice } from "../types2";
import { settlingCreate } from "./docNumbers";

export const LAB_VISIT_INVOICE_TYPE = "lab_visit";

export interface LabVisit extends TenantRow {
  visit_no: string;
  patient_id: string;
  referred_by: string | null;
  priority: "routine" | "urgent" | "stat";
  status: string;
  notes: string | null;
  created_by: string | null;
}

/** Lab visits; two registered at the same moment never share a visit number. */
export const labVisitsRepo = settlingCreate(createTenantRepo<LabVisit>("lab_visits"), "lab_visits", "visit_no", { regenerate: () => nextLabVisitNo() });

const round = (n: number) => Math.round(n * 100) / 100;
const NEEDS_V67 = "The lab needs the latest database update (v67). Ask the administrator to run it.";
async function v67<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingSchemaError(e)) throw new Error(NEEDS_V67);
    throw e;
  }
}

async function nextLabVisitNo(): Promise<string> {
  const day = localDate().replace(/-/g, "");
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM lab_visits WHERE tenant_id = ? AND visit_no LIKE ?`, [requireCurrentTenantId(), `LV-${day}-%`]);
  let n = (Number(rows[0]?.n) || 0) + 1;
  for (;;) {
    const no = `LV-${day}-${String(n).padStart(3, "0")}`;
    if (!(await dbSelect(`SELECT 1 FROM lab_visits WHERE tenant_id = ? AND visit_no = ?`, [requireCurrentTenantId(), no])).length) return no;
    n++;
  }
}

/** Reception: registers the patient's tests and bills them at once. */
export async function createLabVisit(input: {
  patientId: string;
  serviceIds: string[];
  referredBy?: string | null;
  priority?: LabVisit["priority"];
  notes?: string | null;
  discount?: number;
  paid?: number;
}): Promise<{ visit: LabVisit; invoice: Invoice; orders: ClinicOrder[] }> {
  return v67(async () => {
    const patient = await patientsRepo.get(input.patientId);
    if (!patient) throw new Error("Choose the patient.");
    const ids = [...new Set(input.serviceIds)];
    if (!ids.length) throw new Error("Add at least one test.");
    const services = [];
    for (const id of ids) {
      const s = await clinicServicesRepo.get(id);
      if (!s || s.deleted_at || s.category !== "lab") throw new Error("One of the tests is not in the lab's test list.");
      if (!s.is_active) throw new Error(`${s.name} is not offered. Turn it on in Tests & Rates.`);
      services.push(s);
    }
    const total = round(services.reduce((t, s) => t + Number(s.rate || 0), 0));
    const discount = Math.max(0, Number(input.discount) || 0);
    if (discount > total) throw new Error("The discount is more than the bill.");
    const payable = round(total - discount);
    const paid = Math.min(Math.max(0, Number(input.paid) || 0), payable);
    const priority = input.priority ?? "routine";

    const visit = await labVisitsRepo.create({
      visit_no: await nextLabVisitNo(), patient_id: patient.id, referred_by: input.referredBy?.trim() || null, priority,
      status: "registered", notes: input.notes?.trim() || null, created_by: actorName(),
    });
    const invoice = await invoicesRepo.create({
      invoice_no: await nextInvoiceNo(), date: localDate(), inv_on: paid >= payable ? "cash" : "credit", invoice_type: LAB_VISIT_INVOICE_TYPE,
      description: `Lab visit ${visit.visit_no}${visit.referred_by ? ` - Ref: ${visit.referred_by}` : ""}`, salesman_id: null, customer_id: null,
      customer_name: patient.name, customer_phone: patient.phone ?? null,
      total, charges: 0, discount_pct: 0, discount_rs: discount, tax_pct: 0, payable, paid, balance: round(payable - paid),
      is_return: 0, is_memorized: 0, is_quotation: 0,
    } as Partial<Invoice>);
    const orders: ClinicOrder[] = [];
    for (const s of services) {
      orders.push(await clinicOrdersRepo.create({
        order_no: await nextClinicOrderNo("lab"), patient_id: patient.id, consultation_id: null, doctor_id: null, service_id: s.id,
        kind: "lab", name: s.name, qty: 1, rate: Number(s.rate || 0), amount: Number(s.rate || 0), status: "ordered", priority,
        unit: s.unit, ref_range: s.ref_range, ordered_by: actorName(), ordered_at: localDateTime(), invoice_id: invoice.id, lab_visit_id: visit.id,
      }));
    }
    return { visit, invoice, orders };
  });
}

export interface LabVisitRow extends LabVisit {
  patient_name: string;
  mrn: string | null;
  phone: string | null;
  gender: string | null;
  tests: number;
  ordered: number;
  collected: number;
  performed: number;
  reported: number;
  test_names: string;
  invoice_id: string | null;
  invoice_no: number | null;
  payable: number;
  paid: number;
  balance: number;
}

/** Visits with their progress and bill. `stage` limits to those with tests at
 * that stage (samples to take / results to enter, to verify, released). */
export async function listLabVisits(opts: { date?: string; term?: string; stage?: "samples" | "verify" | "released" } = {}): Promise<LabVisitRow[]> {
  const t = opts.term?.trim();
  const having = opts.stage === "samples" ? "HAVING (ordered + collected) > 0"
    : opts.stage === "verify" ? "HAVING performed > 0"
    : opts.stage === "released" ? "HAVING reported > 0" : "";
  return v67(() => dbSelect<LabVisitRow>(
    `SELECT v.*, p.name AS patient_name, p.mrn, p.phone, p.gender,
            COUNT(o.id) AS tests,
            SUM(CASE WHEN o.status = 'ordered' THEN 1 ELSE 0 END) AS ordered,
            SUM(CASE WHEN o.status = 'collected' THEN 1 ELSE 0 END) AS collected,
            SUM(CASE WHEN o.status = 'performed' THEN 1 ELSE 0 END) AS performed,
            SUM(CASE WHEN o.status = 'reported' THEN 1 ELSE 0 END) AS reported,
            GROUP_CONCAT(o.name, ', ') AS test_names,
            MAX(o.invoice_id) AS invoice_id, i.invoice_no, COALESCE(i.payable, 0) AS payable, COALESCE(i.paid, 0) AS paid, COALESCE(i.balance, 0) AS balance
     FROM lab_visits v
     JOIN clinic_patients p ON p.id = v.patient_id
     LEFT JOIN clinic_orders o ON o.lab_visit_id = v.id AND o.deleted_at IS NULL AND o.status != 'cancelled'
     LEFT JOIN invoices i ON i.id = o.invoice_id
     WHERE v.tenant_id = ? AND v.deleted_at IS NULL
       ${opts.date ? "AND substr(v.created_at, 1, 10) = ?" : ""}
       ${t ? "AND (p.name LIKE ? OR p.mrn LIKE ? OR p.phone LIKE ? OR v.visit_no LIKE ?)" : ""}
     GROUP BY v.id
     ${having}
     ORDER BY CASE v.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, v.created_at ${opts.stage === "released" || !opts.stage ? "DESC" : "ASC"}
     LIMIT 300`,
    [requireCurrentTenantId(), ...(opts.date ? [opts.date] : []), ...(t ? Array(4).fill(`%${t}%`) : [])]
  ));
}

export interface LabVisitDetail {
  visit: LabVisit;
  patient: ClinicPatient | null;
  orders: ClinicOrder[];
  invoice: Invoice | null;
}

export async function getLabVisit(visitId: string): Promise<LabVisitDetail> {
  const visit = await v67(() => labVisitsRepo.get(visitId));
  if (!visit || visit.deleted_at) throw new Error("Lab visit not found.");
  const orders = (await clinicOrdersRepo.list({ where: "lab_visit_id = ? AND status != 'cancelled'", params: [visitId], orderBy: "ordered_at ASC, order_no ASC" }));
  const [patient, invoice] = await Promise.all([
    patientsRepo.get(visit.patient_id),
    orders[0]?.invoice_id ? invoicesRepo.get(orders[0].invoice_id) : Promise.resolve(null),
  ]);
  return { visit, patient, orders, invoice };
}

/** Technologist: samples taken for these tests. */
export async function collectSamples(orderIds: string[]): Promise<void> {
  for (const id of orderIds) {
    const o = await clinicOrdersRepo.get(id);
    if (!o || o.kind !== "lab" || !o.lab_visit_id) throw new Error("Lab test not found.");
    if (o.status !== "ordered") continue;
    await clinicOrdersRepo.update(id, { status: "collected", collected_by: actorName(), collected_at: localDateTime() });
  }
}

/** Technologist: the result, which then waits for the pathologist. */
export async function enterLabResult(orderId: string, r: { value: string; unit?: string | null; refRange?: string | null; components?: LabComponent[] }): Promise<ClinicOrder> {
  const o = await clinicOrdersRepo.get(orderId);
  if (o && o.status === "ordered") await collectSamples([orderId]);
  return enterClinicLabResult(orderId, r, { awaitVerification: true });
}

/** Pathologist: verifies results and releases the report (with a comment). */
export async function verifyLabResults(orderIds: string[], note: string | null = null): Promise<void> {
  if (!orderIds.length) throw new Error("Choose the results to verify.");
  const who = actorName();
  const at = localDateTime();
  for (const id of orderIds) {
    const o = await clinicOrdersRepo.get(id);
    if (!o || !o.lab_visit_id) throw new Error("Lab test not found.");
    if (o.status !== "performed") throw new Error(`${o.name} has no result waiting for verification.`);
    await clinicOrdersRepo.update(id, {
      status: "reported", verified_by: who, verified_at: at, reported_by: who, reported_at: at,
      pathologist_note: note?.trim() || o.pathologist_note || null,
    });
  }
}

/** Pathologist: sends a result back to the technologist to recheck. */
export async function returnForRecheck(orderId: string, reason: string): Promise<void> {
  const why = reason.trim();
  if (!why) throw new Error("Say what to recheck.");
  const o = await clinicOrdersRepo.get(orderId);
  if (!o || !o.lab_visit_id) throw new Error("Lab test not found.");
  if (o.status !== "performed") throw new Error(`${o.name} is not waiting for verification.`);
  await clinicOrdersRepo.update(orderId, { status: "collected", pathologist_note: `Recheck: ${why}` });
}

/** Receives a payment against a lab bill's balance. */
export async function collectLabPayment(invoiceId: string, amount: number): Promise<Invoice> {
  const inv = await invoicesRepo.get(invoiceId);
  if (!inv || inv.invoice_type !== LAB_VISIT_INVOICE_TYPE) throw new Error("Lab bill not found.");
  const a = round(Number(amount) || 0);
  if (a <= 0) throw new Error("Enter the amount received.");
  if (a > round(inv.balance) + 1e-9) throw new Error(`Only Rs ${inv.balance.toFixed(2)} is due on this bill.`);
  const paid = round(inv.paid + a);
  return (await invoicesRepo.update(invoiceId, { paid, balance: round(inv.payable - paid), inv_on: paid >= inv.payable ? "cash" : "credit" }))!;
}

export interface LabBillRow {
  id: string;
  invoice_no: number | null;
  date: string;
  customer_name: string | null;
  description: string | null;
  payable: number;
  paid: number;
  balance: number;
  fbr_invoice_no: string | null;
}

export async function listLabBills(opts: { from?: string; to?: string; term?: string; dueOnly?: boolean } = {}): Promise<LabBillRow[]> {
  const t = opts.term?.trim();
  return dbSelect<LabBillRow>(
    `SELECT id, invoice_no, date, customer_name, description, payable, paid, balance, fbr_invoice_no FROM invoices
     WHERE tenant_id = ? AND deleted_at IS NULL AND invoice_type = ?
       ${opts.from ? "AND date >= ?" : ""} ${opts.to ? "AND date <= ?" : ""} ${opts.dueOnly ? "AND balance > 0.009" : ""}
       ${t ? "AND (customer_name LIKE ? OR CAST(invoice_no AS TEXT) LIKE ? OR description LIKE ?)" : ""}
     ORDER BY date DESC, invoice_no DESC LIMIT 300`,
    [requireCurrentTenantId(), LAB_VISIT_INVOICE_TYPE, ...(opts.from ? [opts.from] : []), ...(opts.to ? [opts.to] : []), ...(t ? Array(3).fill(`%${t}%`) : [])]
  );
}

/** A lab bill's lines (its tests). */
export async function labBillLines(invoiceId: string): Promise<ClinicOrder[]> {
  return clinicOrdersRepo.list({ where: "invoice_id = ? AND status != 'cancelled'", params: [invoiceId], orderBy: "order_no ASC" });
}

export interface LabDayStats {
  visits: number;
  tests: number;
  toCollect: number;
  toEnter: number;
  toVerify: number;
  released: number;
  billed: number;
  collected: number;
  due: number;
}

/** The dashboard: a day's work and money. */
export async function labDayStats(date = localDate()): Promise<LabDayStats> {
  const tenantId = requireCurrentTenantId();
  return v67(async () => {
    const [w] = await dbSelect<{ visits: number }>(`SELECT COUNT(*) AS visits FROM lab_visits WHERE tenant_id = ? AND deleted_at IS NULL AND substr(created_at, 1, 10) = ?`, [tenantId, date]);
    const [o] = await dbSelect<{ tests: number; released: number }>(
      `SELECT COUNT(*) AS tests, SUM(CASE WHEN status = 'reported' THEN 1 ELSE 0 END) AS released FROM clinic_orders
       WHERE tenant_id = ? AND deleted_at IS NULL AND lab_visit_id IS NOT NULL AND status != 'cancelled' AND substr(ordered_at, 1, 10) = ?`, [tenantId, date]
    );
    const [pend] = await dbSelect<{ toCollect: number; toEnter: number; toVerify: number }>(
      `SELECT SUM(CASE WHEN status = 'ordered' THEN 1 ELSE 0 END) AS toCollect, SUM(CASE WHEN status = 'collected' THEN 1 ELSE 0 END) AS toEnter,
              SUM(CASE WHEN status = 'performed' THEN 1 ELSE 0 END) AS toVerify
       FROM clinic_orders WHERE tenant_id = ? AND deleted_at IS NULL AND lab_visit_id IS NOT NULL`, [tenantId]
    );
    const [m] = await dbSelect<{ billed: number; collected: number; due: number }>(
      `SELECT COALESCE(SUM(payable), 0) AS billed, COALESCE(SUM(paid), 0) AS collected, COALESCE(SUM(balance), 0) AS due FROM invoices
       WHERE tenant_id = ? AND deleted_at IS NULL AND invoice_type = ? AND date = ?`, [tenantId, LAB_VISIT_INVOICE_TYPE, date]
    );
    return {
      visits: Number(w?.visits) || 0, tests: Number(o?.tests) || 0, released: Number(o?.released) || 0,
      toCollect: Number(pend?.toCollect) || 0, toEnter: Number(pend?.toEnter) || 0, toVerify: Number(pend?.toVerify) || 0,
      billed: Number(m?.billed) || 0, collected: Number(m?.collected) || 0, due: Number(m?.due) || 0,
    };
  });
}
