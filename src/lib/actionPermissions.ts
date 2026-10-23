import { useAuthStore } from "../store/authStore";

/** Actions an owner can allow or restrict per staff login. Stored on the
 * user as a list of DENIED keys, so anything not listed is allowed. */
export const ACTION_PERMISSIONS = [
  { key: "invoice.edit", label: "Edit invoices", group: "Invoices" },
  { key: "invoice.delete", label: "Delete invoices", group: "Invoices" },
  { key: "invoice.fbr_submit", label: "Submit invoices to FBR", group: "Invoices" },
  { key: "purchase.edit", label: "Edit purchases", group: "Purchases" },
  { key: "purchase.delete", label: "Delete purchases", group: "Purchases" },
] as const;

export type ActionKey = (typeof ACTION_PERMISSIONS)[number]["key"];

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
  return !(user.deniedActions ?? []).includes(action);
}

export function useCan(action: ActionKey): boolean {
  const role = useAuthStore((s) => s.currentUser?.role);
  const denied = useAuthStore((s) => s.currentUser?.deniedActions);
  const tenantDenied = useAuthStore((s) => s.currentTenant?.deniedActions);
  if (!role) return false;
  if (role === "super_admin") return true;
  if ((tenantDenied ?? []).includes(action)) return false;
  if (role !== "staff") return true;
  return !(denied ?? []).includes(action);
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
