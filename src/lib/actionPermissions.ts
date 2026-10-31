import { useAuthStore } from "../store/authStore";

/** Actions an owner can allow or restrict per staff login. Stored on the
 * user as a list of DENIED keys, so anything not listed is allowed. An
 * opt-in action is the other way round: a staff login has it only when the
 * owner ticks it (stored as "+key"); the owner always has it. */
export const ACTION_PERMISSIONS: readonly { key: string; label: string; group: string; optIn?: true }[] = [
  { key: "invoice.edit", label: "Edit invoices", group: "Invoices" },
  { key: "invoice.delete", label: "Delete invoices", group: "Invoices" },
  { key: "invoice.fbr_submit", label: "Submit invoices to FBR", group: "Invoices" },
  { key: "memorized.edit", label: "Edit memorized invoices", group: "Memorized Invoices", optIn: true },
  { key: "memorized.delete", label: "Delete memorized invoices", group: "Memorized Invoices", optIn: true },
  { key: "memorized.convert", label: "Convert to invoice", group: "Memorized Invoices", optIn: true },
  { key: "purchase.edit", label: "Edit purchases", group: "Purchases" },
  { key: "purchase.delete", label: "Delete purchases", group: "Purchases" },
  { key: "rest.order", label: "Take orders and payments", group: "Restaurant" },
  { key: "rest.discount", label: "Give manual discounts", group: "Restaurant" },
  { key: "rest.void", label: "Cancel sent dishes / orders", group: "Restaurant" },
  { key: "rest.refund", label: "Refund invoices", group: "Restaurant" },
  { key: "rest.menu", label: "Edit menu, deals, offers, tables, stock", group: "Restaurant" },
  { key: "rest.settings", label: "Tax and PRA settings", group: "Restaurant" },
];

export type ActionKey =
  | "invoice.edit" | "invoice.delete" | "invoice.fbr_submit"
  | "memorized.edit" | "memorized.delete" | "memorized.convert"
  | "purchase.edit" | "purchase.delete"
  | "rest.order" | "rest.discount" | "rest.void" | "rest.refund" | "rest.menu" | "rest.settings";

const isOptIn = (key: string) => ACTION_PERMISSIONS.some((a) => a.key === key && a.optIn);

/** Whether a staff login's stored list allows an action. */
export function staffAllows(list: readonly string[] | null | undefined, key: string): boolean {
  const l = list ?? [];
  return isOptIn(key) ? l.includes(`+${key}`) : !l.includes(key);
}

/** Ticks or unticks an action in a staff login's stored list. */
export function toggleStaffAction(list: readonly string[], key: string): string[] {
  const stored = isOptIn(key) ? `+${key}` : key;
  return list.includes(stored) ? list.filter((k) => k !== stored) : [...list, stored];
}

/** The stored list for "Allow All" / "Block All" over some actions. */
export function staffListFor(allow: boolean, keys: readonly string[]): string[] {
  return allow ? keys.filter(isOptIn).map((k) => `+${k}`) : keys.filter((k) => !isOptIn(k));
}

/** How many of these actions a staff login does not have. */
export function restrictedCount(list: readonly string[], keys: readonly string[]): number {
  return keys.filter((k) => !staffAllows(list, k)).length;
}

export const NO_PERMISSION_MESSAGE = "You don't have permission for this action. Ask the owner (or the administrator) to allow it.";

/** The Super Admin can do everything. Owners and staff can't do what the
 * Super Admin turned off for their pharmacy; staff also not what the owner
 * denied them. */
export function can(action: ActionKey): boolean {
  const { currentUser: user, currentTenant } = useAuthStore.getState();
  if (!user) return false;
  if (user.role === "super_admin") return true;
  if ((currentTenant?.deniedActions ?? []).includes(action)) return false;
  if (user.role !== "staff") return true;
  return staffAllows(user.deniedActions, action);
}

export function useCan(action: ActionKey): boolean {
  const role = useAuthStore((s) => s.currentUser?.role);
  const denied = useAuthStore((s) => s.currentUser?.deniedActions);
  const tenantDenied = useAuthStore((s) => s.currentTenant?.deniedActions);
  if (!role) return false;
  if (role === "super_admin") return true;
  if ((tenantDenied ?? []).includes(action)) return false;
  if (role !== "staff") return true;
  return staffAllows(denied, action);
}

export function parseDeniedActions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
