/** The hospital's stores. Each has its own section key, so a store keeper's
 * login opens only the stores they work in. */

export type StoreId = "stationery" | "general" | "lab" | "radiology" | "medicine";

export const STORES: { id: StoreId; label: string; short: string }[] = [
  { id: "stationery", label: "Stationery & Printing Store", short: "Stationery & Printing" },
  { id: "general", label: "General Store", short: "General" },
  { id: "lab", label: "Lab Store", short: "Lab" },
  { id: "radiology", label: "Radiology Store", short: "Radiology" },
  { id: "medicine", label: "Medicine Store", short: "Medicine" },
];

export const storeLabel = (id: string) => STORES.find((s) => s.id === id)?.label ?? id;
export const isStoreId = (v: unknown): v is StoreId => STORES.some((s) => s.id === v);

/** The section (permission) key of a store. */
export const storeKey = (id: StoreId) => `hospital_store_${id}`;

/** Roles that work in stores and are given stores ("all" or chosen ones). */
export const STORE_ROLES = ["store_keeper", "purchase_officer"];

/** The stores a staff member works in, from their stored list (["all"] = every store). */
export function staffStores(raw: string | null | undefined): StoreId[] {
  let v: unknown = [];
  try { v = raw ? JSON.parse(raw) : []; } catch { v = []; }
  if (!Array.isArray(v)) return [];
  if (v.includes("all")) return STORES.map((s) => s.id);
  return STORES.map((s) => s.id).filter((id) => v.includes(id));
}
