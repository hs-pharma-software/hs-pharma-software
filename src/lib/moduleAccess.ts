import { useAuthStore } from "../store/authStore";
import { NAV } from "../config/nav";

/** Maps a pathname like "/invoices/returns" back to its top-level module key
 * ("invoices") by matching the longest NAV href that's a prefix of it. */
export function moduleKeyForPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const matches = NAV.filter((item) => {
    const href = item.href.replace(/\/+$/, "");
    return normalized === href || normalized.startsWith(`${href}/`);
  });
  if (matches.length === 0) return null;
  return matches.reduce((longest, candidate) => (candidate.href.length > longest.href.length ? candidate : longest))
    .moduleKey;
}

/** Whether the logged-in tenant's subscription plan includes this module.
 * Always true for the Super Admin (who isn't on a plan) — module gating
 * only applies to tenant users. */
export function hasModuleAccess(moduleKey: string | null): boolean {
  const { currentUser, currentTenant } = useAuthStore.getState();
  if (!moduleKey) return true;
  if (currentUser?.role === "super_admin") return true;
  if (!currentTenant) return false;
  return currentTenant.allowedModules.includes(moduleKey);
}
