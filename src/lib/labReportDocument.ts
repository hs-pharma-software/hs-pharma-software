/** The laboratory report as a document: its contents, status labels, how it
 * is built from the database, and the online copy behind the report QR code.
 * No browser dependencies: the server's public-report route uses it too, with
 * its own database calls (ReportDb). */
import { newId, nowIso } from "./id";
import { parseComponents } from "../config/labPanels";
import type { CollectionCenter, HospitalLabOrder, HospitalPatient, LabComponent, LabRequest } from "./types-hospital";

export interface LabReport {
  request: LabRequest;
  hospital: { name: string; address: string | null; phone: string | null; registration: string | null };
  patient: { name: string; mrNo: string; gender: string | null; age: string | null; phone: string | null };
  referringDoctor: string | null;
  centerName: string | null;
  location: string;
  tests: {
    id: string; order_no: string; test_name: string; sample_type: string | null; result_value: string | null; unit: string | null;
    ref_range: string | null; flag: string | null; verified_by_name: string | null; verified_by_license: string | null; verified_at: string | null;
    /** Parameters of a panel test (CBC); empty for a single-value test. */
    components: LabComponent[];
  }[];
  pendingTests: { order_no: string; test_name: string; label: string }[];
  reportDate: string | null;
  verificationCode: string;
  status: string;
  /** Token of the online copy (QR code); null while nothing is verified. */
  publicToken: string | null;
}

export function testStatusLabel(t: Pick<HospitalLabOrder, "status" | "fee" | "paid">): string {
  switch (t.status) {
    case "pending":
      return Number(t.fee) > 0 && Number(t.paid) !== 1 ? "Registered (fee unpaid)" : "Sample Awaited";
    case "collected": return "Sample Received";
    case "processing": return "Processing";
    case "awaiting_verification": return "Awaiting Verification";
    case "reported": return "Authorized";
    case "cancelled": return "Cancelled";
    case "superseded": return "Superseded";
    default: return t.status;
  }
}

const STAGE: Record<string, number> = { pending: 0, collected: 1, processing: 2, awaiting_verification: 3, reported: 4 };

/** Status of the whole order from its tests. */
export function requestStatusLabel(tests: Pick<HospitalLabOrder, "status" | "fee" | "paid">[], printCount = 0): string {
  const live = tests.filter((t) => t.status !== "cancelled" && t.status !== "superseded");
  if (!tests.length) return "Registered";
  if (!live.length) return tests.some((t) => t.status === "superseded") ? "Superseded" : "Cancelled";
  const done = live.filter((t) => t.status === "reported").length;
  if (done === live.length) return printCount > 1 ? "Reprinted" : printCount === 1 ? "Printed" : "Authorized";
  if (done > 0) return `Partially Authorized (${done} of ${live.length})`;
  const least = live.reduce((m, t) => Math.min(m, STAGE[t.status] ?? 0), 9);
  const lowest = live.find((t) => (STAGE[t.status] ?? 0) === least)!;
  return testStatusLabel(lowest);
}

export function locationLabel(r: Pick<LabRequest, "registration_location">, centerName: string | null, department: string | null): string {
  switch (r.registration_location) {
    case "collection_center": return centerName ? `Collection center: ${centerName}` : "Collection center";
    case "department": return department ? `Hospital department: ${department}` : "Hospital department";
    case "referral": return "Referring facility";
    default: return "Hospital lab counter";
  }
}

function hashCode(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

/** The online copy behind the report QR code. Needs no login: the random token
 * is the key. Shows the verified results only, as on the printed report, and
 * logs the view. */
/** The database calls the public report needs: the page's own (desktop /
 * direct) or the server's, when the server builds the report for /api/public/lab-report. */
export interface ReportDb {
  select: <T>(sql: string, params: unknown[]) => Promise<T[]>;
  execute: (sql: string, params: unknown[]) => Promise<unknown>;
}

export async function getPublicLabReport(token: string, io: ReportDb): Promise<LabReport> {
  const t = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(t)) throw new Error("This report link is not valid.");
  const req = (await io.select<LabRequest>(`SELECT * FROM hospital_lab_requests WHERE public_token = ? AND deleted_at IS NULL`, [t]))[0];
  if (!req) throw new Error("Report not found. It may have been withdrawn by the laboratory.");
  const tenant = (await io.select<{ name: string }>(`SELECT name FROM tenants WHERE id = ?`, [req.tenant_id]))[0];
  const report = await assembleReport(req.tenant_id, req, tenant?.name ?? "Hospital", io);
  if (!report.tests.length) throw new Error("No verified result on this report yet.");
  const ts = nowIso();
  await io.execute(
    `INSERT INTO hospital_lab_report_log (id, tenant_id, request_id, action, user_id, user_name, location_id, details, created_at, updated_at)
     VALUES (?, ?, ?, 'view', NULL, 'Online (QR code)', NULL, 'Opened from the report QR code', ?, ?)`,
    [newId(), req.tenant_id, req.id, ts, ts]
  );
  return report;
}

/** Builds the report of a request of hospital `tenantId` with plain queries,
 * so the online copy works without a signed-in user. */
export async function assembleReport(tenantId: string, req: LabRequest, tenantName: string, io: ReportDb): Promise<LabReport> {
  const one = async <T>(sql: string, params: unknown[]): Promise<T | null> => (await io.select<T>(sql, params))[0] ?? null;
  const patient = await one<HospitalPatient>(`SELECT * FROM hospital_patients WHERE id = ? AND tenant_id = ?`, [req.patient_id, tenantId]);
  const center = req.collection_center_id
    ? await one<CollectionCenter>(`SELECT * FROM hospital_collection_centers WHERE id = ? AND tenant_id = ?`, [req.collection_center_id, tenantId])
    : null;
  const ep = req.episode_id
    ? await one<{ department: string | null; doctor_id: string | null }>(`SELECT department, doctor_id FROM hospital_episodes WHERE id = ? AND tenant_id = ?`, [req.episode_id, tenantId])
    : null;
  const doctorName = req.referring_doctor
    ?? (ep?.doctor_id ? (await one<{ name: string }>(`SELECT name FROM staff WHERE id = ? AND tenant_id = ?`, [ep.doctor_id, tenantId]))?.name ?? null : null);
  const tests = await io.select<HospitalLabOrder>(
    `SELECT * FROM hospital_lab_orders WHERE tenant_id = ? AND request_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
    [tenantId, req.id]
  );
  const released = tests.filter((t) => t.status === "reported");
  const pending = tests.filter((t) => t.status !== "reported" && t.status !== "cancelled" && t.status !== "superseded");

  let profile: { name?: string; address?: string; phone?: string; registration_no?: string; city?: string } = {};
  try {
    // Same key as getSetting("hospital.profile", tenantId), read with this report's database calls.
    profile = JSON.parse((await one<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [`${tenantId}::hospital.profile`]))?.value ?? "{}");
  } catch {
    profile = {};
  }
  const reportDate = released.map((t) => t.verified_at ?? t.reported_at ?? "").sort().pop() || null;

  return {
    request: req,
    hospital: {
      name: profile.name || tenantName,
      address: [profile.address, profile.city].filter(Boolean).join(", ") || null,
      phone: profile.phone || null,
      registration: profile.registration_no || null,
    },
    patient: {
      name: patient?.name ?? "—",
      mrNo: patient?.mr_no ?? "—",
      gender: patient?.gender ?? null,
      age: patient?.age_years != null ? `${patient.age_years} y` : patient?.dob ?? null,
      phone: patient?.phone ?? null,
    },
    referringDoctor: doctorName,
    centerName: center?.name ?? null,
    location: locationLabel(req, center?.name ?? null, ep?.department ?? null),
    tests: released.map((t) => ({
      id: t.id, order_no: t.order_no, test_name: t.test_name, sample_type: t.sample_type ?? null, result_value: t.result_value, unit: t.unit,
      ref_range: t.ref_range, flag: t.flag, verified_by_name: t.verified_by_name ?? null, verified_by_license: t.verified_by_license ?? null, verified_at: t.verified_at ?? null,
      components: parseComponents(t.components),
    })),
    pendingTests: pending.map((t) => ({ order_no: t.order_no, test_name: t.test_name, label: testStatusLabel(t) })),
    reportDate,
    verificationCode: `${req.lab_no}/${hashCode(`${req.lab_no}|${released.map((t) => `${t.id}:${t.verified_at}`).join(",")}`)}`,
    status: requestStatusLabel(tests, req.print_count),
    publicToken: released.length ? req.public_token ?? null : null,
  };
}
