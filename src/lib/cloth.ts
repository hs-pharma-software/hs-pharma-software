/** Cloth store: garment types, standard sizes, and the measurement points
 * kept for a customer's custom size (Measurements book, cloth_measurements). */
import { dbSelect } from "./db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./repo/base";
import { nowIso } from "./id";
import { isMissingSchemaError } from "./dbErrors";

export const CLOTH_TYPES = [
  "Shalwar Kameez", "Kurta", "Kameez", "Shalwar", "Shirt", "Trouser", "Waistcoat", "Coat", "Sherwani", "Prince Coat",
  "Frock", "Lehenga", "Abaya", "Dupatta", "Unstitched Fabric",
];

export const CLOTH_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "Free size", "Custom"];

/** Measurement points (inches) for each kind of garment. */
export const MEASUREMENT_POINTS: Record<string, string[]> = {
  "Shalwar Kameez": ["Length", "Chest", "Waist", "Hip", "Shoulder", "Sleeve", "Collar", "Cuff", "Shalwar Length", "Shalwar Bottom"],
  Kurta: ["Length", "Chest", "Waist", "Hip", "Shoulder", "Sleeve", "Collar", "Cuff"],
  Shirt: ["Length", "Chest", "Waist", "Shoulder", "Sleeve", "Collar", "Cuff"],
  Trouser: ["Length", "Waist", "Hip", "Thigh", "Knee", "Bottom", "Inseam"],
  Waistcoat: ["Length", "Chest", "Waist", "Shoulder"],
  Coat: ["Length", "Chest", "Waist", "Hip", "Shoulder", "Sleeve", "Collar"],
  Sherwani: ["Length", "Chest", "Waist", "Hip", "Shoulder", "Sleeve", "Collar"],
  "Ladies Suit": ["Length", "Bust", "Waist", "Hip", "Shoulder", "Sleeve", "Arm Hole", "Neck (front)", "Neck (back)", "Trouser Length", "Trouser Bottom"],
  Other: ["Length", "Chest", "Waist", "Shoulder", "Sleeve"],
};

export const MEASUREMENT_GARMENTS = Object.keys(MEASUREMENT_POINTS);

export interface ClothMeasurement extends TenantRow {
  customer_name: string;
  mobile: string | null;
  garment: string;
  /** JSON: { [point]: value } */
  measurements: string;
  notes: string | null;
  last_used_at: string | null;
}

export const measurementsRepo = createTenantRepo<ClothMeasurement>("cloth_measurements");

const NEEDS_V67 = "The measurements book needs the latest database update (v67). Ask the administrator to run it.";

export function parseMeasurements(json: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x ?? "")])) : {};
  } catch {
    return {};
  }
}

/** "Chest 40 · Waist 34 · ..." for a list or a slip. */
export function measurementSummary(m: Pick<ClothMeasurement, "measurements">): string {
  return Object.entries(parseMeasurements(m.measurements)).filter(([, v]) => v.trim()).map(([k, v]) => `${k} ${v}`).join(" · ");
}

const MOBILE = /^03\d{9}$/;

/** Saves a customer's measurements (new, or changes to a saved one). */
export async function saveMeasurement(id: string | null, m: { customer_name: string; mobile?: string | null; garment: string; values: Record<string, string>; notes?: string | null }): Promise<ClothMeasurement> {
  const name = m.customer_name.trim();
  if (!name) throw new Error("Enter the customer's name.");
  const mobile = (m.mobile ?? "").replace(/[\s-]/g, "");
  if (mobile && !MOBILE.test(mobile)) throw new Error("Mobile must be 11 digits starting with 03, e.g. 03001234567.");
  if (!m.garment.trim()) throw new Error("Choose the garment.");
  const values = Object.fromEntries(Object.entries(m.values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  if (!Object.keys(values).length) throw new Error("Enter at least one measurement.");
  const data = { customer_name: name, mobile: mobile || null, garment: m.garment.trim(), measurements: JSON.stringify(values), notes: m.notes?.trim() || null };
  try {
    if (id) {
      const updated = await measurementsRepo.update(id, data);
      if (!updated) throw new Error("Measurement not found.");
      return updated;
    }
    return await measurementsRepo.create({ ...data, last_used_at: null });
  } catch (e) {
    if (isMissingSchemaError(e)) throw new Error(NEEDS_V67);
    throw e;
  }
}

/** Saved measurements found by customer name or mobile (newest use first). */
export async function searchMeasurements(term: string): Promise<ClothMeasurement[]> {
  const t = term.trim();
  const digits = t.replace(/\D/g, "");
  try {
    return await dbSelect<ClothMeasurement>(
      `SELECT * FROM cloth_measurements WHERE tenant_id = ? AND deleted_at IS NULL
       ${t ? `AND (customer_name LIKE ?${digits.length >= 3 ? " OR mobile LIKE ?" : ""})` : ""}
       ORDER BY COALESCE(last_used_at, updated_at) DESC LIMIT 100`,
      [requireCurrentTenantId(), ...(t ? [`%${t}%`] : []), ...(t && digits.length >= 3 ? [`%${digits}%`] : [])]
    );
  } catch (e) {
    if (isMissingSchemaError(e)) throw new Error(NEEDS_V67);
    throw e;
  }
}

/** Marks a measurement used on a bill (it then comes first in searches). */
export async function touchMeasurement(id: string): Promise<void> {
  await measurementsRepo.update(id, { last_used_at: nowIso() });
}
