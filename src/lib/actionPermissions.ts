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

export const NO_PERMISSION_MESSAGE = "You don't have permission for this action. Ask the owner to allow it in User Logins > Permissions.";

/** Owners and the Super Admin can do everything; staff unless denied. */
export function can(action: ActionKey): boolean {
  const user = useAuthStore.getState().currentUser;
  if (!user) return false;
  if (user.role !== "staff") return true;
  return !(user.deniedActions ?? []).includes(action);
}

export function useCan(action: ActionKey): boolean {
  const role = useAuthStore((s) => s.currentUser?.role);
  const denied = useAuthStore((s) => s.currentUser?.deniedActions);
  if (!role) return false;
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
