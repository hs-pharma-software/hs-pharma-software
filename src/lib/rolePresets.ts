/** Starting points for a staff login's sections and actions. A new staff
 * login starts as a Cashier (least privilege); the owner picks another preset
 * or ticks sections and actions one by one. Only the sections this business
 * type has are kept (a clinic has no Purchase section). */
import { designationsFor, usesHospitalStaff } from "../config/hospitalStaff";

export interface RolePreset {
  id: string;
  label: string;
  /** Section (module) keys. */
  modules: string[];
  /** Opt-in actions this preset ticks (lib/actionPermissions.ts). */
  actions: string[];
  /** A hospital / radiology designation: its sections exactly as listed (sub-sections included). */
  exact?: boolean;
}

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    id: "cashier",
    label: "Cashier",
    modules: ["dashboard", "invoices", "customers", "quotation", "order", "cash_register", "restaurant_pos", "es_sales", "dist_sales", "lab_reception", "lab_bills"],
    actions: [],
  },
  {
    id: "storekeeper",
    label: "Storekeeper",
    modules: ["dashboard", "products", "stock", "purchase", "suppliers", "restaurant_inventory", "es_inventory", "es_products", "es_purchases", "dist_catalog", "dist_purchases", "mobile_imei"],
    actions: [],
  },
  {
    id: "accountant",
    label: "Accountant",
    modules: ["dashboard", "reports", "expenses", "banks", "cash_register", "customers", "suppliers", "other_revenue", "es_reports", "es_parties", "dist_reports", "restaurant_reports"],
    actions: ["data.export", "finance.close"],
  },
  {
    id: "manager",
    label: "Manager",
    // Everything except logins, settings and data utilities (backup / restore).
    modules: ["*"],
    actions: ["invoice.refund", "invoice.fbr_submit", "data.export", "finance.close"],
  },
];

const MANAGER_EXCLUDED = ["staff", "settings", "utilities", "hospital_logins", "dist_settings", "es_settings", "restaurant_settings", "clinic_settings"];

/** The roles a login can start from: a hospital or radiology centre uses its staff
 * designations (Receptionist, Technologist, Radiologist...), other businesses the presets above. */
export function presetsFor(typeId: string | null | undefined): readonly RolePreset[] {
  if (!typeId || !usesHospitalStaff(typeId)) return ROLE_PRESETS;
  return designationsFor(typeId)
    .filter((d) => d.pages !== null)
    .map((d) => ({ id: d.key, label: d.label, modules: d.pages ?? [], actions: [], exact: true }));
}

/** The preset's sections among the ones this business has. */
export function presetModules(preset: RolePreset, available: readonly string[]): string[] {
  if (preset.exact) return [...preset.modules];
  if (preset.modules.includes("*")) return available.filter((k) => !MANAGER_EXCLUDED.includes(k));
  return available.filter((k) => preset.modules.includes(k));
}

/** The preset's stored action list (opt-in keys are stored as "+key"). */
export function presetActions(preset: RolePreset): string[] {
  return preset.actions.map((k) => `+${k}`);
}

export const DEFAULT_PRESET = ROLE_PRESETS[0];
