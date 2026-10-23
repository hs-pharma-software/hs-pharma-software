import { useAuthStore } from "../store/authStore";
import { NAV } from "../config/nav";
import { businessType } from "../config/businessTypes";

/** Maps a pathname like "/invoices/returns" back to its top-level module key
 * ("invoices") by matching the longest NAV href that's a prefix of it. */
export function moduleKeyForPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  // Child links count too, e.g. /restaurant/deals belongs to Menu, not to
  // the /restaurant (POS) section it shares a prefix with.
  const links = NAV.flatMap((item) => [item.href, ...(item.children ?? []).map((c) => c.href)].map((href) => ({ href: href.replace(/\/+$/, ""), key: item.moduleKey })));
  const matches = links.filter((l) => normalized === l.href || normalized.startsWith(`${l.href}/`));
  if (matches.length === 0) return null;
  return matches.reduce((longest, candidate) => (candidate.href.length > longest.href.length ? candidate : longest)).key;
}

/** Whether the logged-in tenant's subscription plan includes this module.
 * Always true for the Super Admin (who isn't on a plan) \u2014 module gating
 * only applies to tenant users. */
export function hasModuleAccess(moduleKey: string | null): boolean {
  const { currentUser, currentTenant } = useAuthStore.getState();
  if (!moduleKey) return true;
  if (currentUser?.role === "super_admin") return true;
  if (!currentTenant) return false;
  // A staff login limited to some sections can't open others by URL.
  // (Dashboard stays reachable: it is the landing page after sign-in.)
  if (moduleKey !== "dashboard" && currentUser?.role === "staff" && currentUser.permissions && !currentUser.permissions.includes(moduleKey)) return false;
  const item = NAV.find((n) => n.moduleKey === moduleKey);
  if (item?.onlyFor) return item.onlyFor.includes(businessType(currentTenant.businessType).id);
  return currentTenant.allowedModules.includes(moduleKey);
}
