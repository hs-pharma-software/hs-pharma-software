/** The online copy of a diagnostic-lab visit's report, opened from the QR code
 * on its receipt or printed report. No login: the visit's random token is the
 * key. Only verified (reported) results are included; the lab's own name,
 * logo, report design and paper are used. */
import { buildLabReportView, type LabReportView, type ReportOrder } from "../lib/labReportView";
import { HttpError } from "./db";
import type { Sql } from "./subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface PublicLabReport {
  ready: boolean;
  /** Tests still in progress (not verified yet). */
  pending: number;
  visitNo: string;
  view: LabReportView | null;
  profile: { name: string; address: string; contact: string; phc_reg_no: string; ntn: string };
  template: { paper: "a4" | "a5" | "thermal"; headerAlign: "center" | "left"; showIds: boolean; signature: boolean; footer: string; design: string };
  logo: string | null;
}

const json = <T>(raw: unknown, fallback: T): T => {
  try {
    return raw ? { ...fallback, ...(JSON.parse(String(raw)) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
};

export async function getPublicLabVisitReport(sql: Sql, token: string): Promise<PublicLabReport> {
  if (!/^[0-9a-f]{32,64}$/.test(token)) throw new HttpError(404, "This report link is not valid. Scan the QR code again.");
  const visit = (await sql.execute(
    `SELECT id, tenant_id, visit_no, patient_id, referred_by FROM lab_visits WHERE public_token = ? AND deleted_at IS NULL`, [token],
  )).rows[0];
  if (!visit) throw new HttpError(404, "This report link is not valid. Scan the QR code again.");
  const tenant = String(visit.tenant_id);
  const orders = (await sql.execute(
    `SELECT id, order_no, kind, name, status, result_value, unit, ref_range, flag, components, findings, impression, reported_by, reported_at,
            verified_by, pathologist_note
     FROM clinic_orders WHERE lab_visit_id = ? AND tenant_id = ? AND deleted_at IS NULL AND status <> 'cancelled' ORDER BY ordered_at, order_no`,
    [visit.id, tenant],
  )).rows;
  const done = orders.filter((o) => o.status === "reported") as unknown as ReportOrder[];
  const settings = new Map((await sql.execute(
    `SELECT key, value FROM settings WHERE key IN (?, ?, ?)`, [`${tenant}::clinic.profile`, `${tenant}::clinic.print.lab`, `${tenant}::print_logo`],
  )).rows.map((r) => [String(r.key).split("::")[1], r.value]));
  const tenantName = String((await sql.execute(`SELECT name FROM tenants WHERE id = ?`, [tenant])).rows[0]?.name ?? "Laboratory");
  const profile = json(settings.get("clinic.profile"), { name: "", address: "", contact: "", phc_reg_no: "", ntn: "" });
  profile.name = profile.name?.trim() || tenantName;
  const template = json(settings.get("clinic.print.lab"), {
    paper: "a4" as const, headerAlign: "center" as const, showIds: true, signature: true, footer: "", design: "classic",
  });
  const patient = (await sql.execute(`SELECT name, mrn, gender, dob FROM clinic_patients WHERE id = ? AND tenant_id = ?`, [visit.patient_id, tenant])).rows[0];
  return {
    ready: done.length > 0,
    pending: orders.length - done.length,
    visitNo: String(visit.visit_no),
    view: done.length
      ? buildLabReportView({
          orders: done,
          patient: patient ? { name: String(patient.name), mrn: (patient.mrn as string) ?? null, gender: (patient.gender as string) ?? null, dob: (patient.dob as string) ?? null } : null,
          referredBy: (visit.referred_by as string) || null,
          signature: Boolean(template.signature),
        })
      : null,
    profile,
    template,
    logo: (settings.get("print_logo") as string) || null,
  };
}
