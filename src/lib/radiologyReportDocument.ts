/** The radiology report as a document: how it is built from the database, and
 * the online copy behind the report's QR code. No browser dependencies: the
 * server's public-report route uses it with its own database calls. */
import type { HospitalImagingOrder, HospitalPatient } from "./types-hospital";
import type { ReportDb } from "./labReportDocument";

/** Only what a report shows: fees, the technologist's record and internal notes stay out of the online copy. */
export type RadiologyReportOrder = Pick<HospitalImagingOrder, "order_no" | "modality" | "body_part" | "ordered_at" | "reported_at" | "findings" | "impression" | "radiologist"> & {
  structured_report?: string | null;
};

export interface RadiologyReport {
  order: RadiologyReportOrder;
  hospital: { name: string; address: string | null; phone: string | null; registration: string | null };
  /** The business logo (Settings > Print Templates), printed in the header. */
  logo: string | null;
  patient: { name: string; mrNo: string; age: string | null; gender: string | null };
  episodeNo: string | null;
  referringDoctor: string | null;
  /** Token of the online copy (QR code). */
  publicToken: string | null;
}

type OrderRow = HospitalImagingOrder & { structured_report?: string | null; public_token?: string | null };

/** A new random key for a report's online copy (128 bits, as hex). */
export function newRadiologyToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Builds the report of an order with plain queries, so the online copy works without a signed-in user. */
export async function assembleRadiologyReport(tenantId: string, order: OrderRow, tenantName: string, io: ReportDb): Promise<RadiologyReport> {
  const one = async <T>(sql: string, params: unknown[]): Promise<T | null> => (await io.select<T>(sql, params))[0] ?? null;
  const patient = await one<HospitalPatient>(`SELECT * FROM hospital_patients WHERE id = ? AND tenant_id = ?`, [order.patient_id, tenantId]);
  const ep = order.episode_id
    ? await one<{ episode_no: string | null; doctor_id: string | null }>(`SELECT episode_no, doctor_id FROM hospital_episodes WHERE id = ? AND tenant_id = ?`, [order.episode_id, tenantId])
    : null;
  const doctor = ep?.doctor_id ? (await one<{ name: string }>(`SELECT name FROM staff WHERE id = ? AND tenant_id = ?`, [ep.doctor_id, tenantId]))?.name ?? null : null;
  let profile: { name?: string; address?: string; phone?: string; registration_no?: string; city?: string } = {};
  try {
    profile = JSON.parse((await one<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [`${tenantId}::hospital.profile`]))?.value ?? "{}");
  } catch {
    profile = {};
  }
  const logo = (await one<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [`${tenantId}::print_logo`]))?.value || null;
  return {
    logo: logo && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(logo) ? logo : null,
    order: {
      order_no: order.order_no, modality: order.modality, body_part: order.body_part, ordered_at: order.ordered_at, reported_at: order.reported_at,
      findings: order.findings, impression: order.impression, radiologist: order.radiologist, structured_report: order.structured_report ?? null,
    },
    hospital: {
      name: profile.name || tenantName,
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
    publicToken: order.public_token ?? null,
  };
}

/** The online copy: only a released report, found by its random token. */
export async function getPublicRadiologyReport(token: string, io: ReportDb): Promise<RadiologyReport> {
  const t = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(t)) throw new Error("This report link is not valid.");
  const order = (await io.select<OrderRow>(`SELECT * FROM hospital_imaging_orders WHERE public_token = ? AND deleted_at IS NULL`, [t]))[0];
  if (!order || order.status !== "reported") throw new Error("Report not found. It may have been withdrawn by the hospital.");
  const tenant = (await io.select<{ name: string }>(`SELECT name FROM tenants WHERE id = ?`, [order.tenant_id]))[0];
  return assembleRadiologyReport(String(order.tenant_id), order, tenant?.name ?? "Hospital", io);
}
