import { useAuthStore } from "../store/authStore";
import { NAV, type NavChild } from "../config/nav";
import { businessType, moduleAllowedForType } from "../config/businessTypes";

/** Maps a pathname like "/invoices/returns" back to its top-level module key
 * ("invoices") by matching the longest NAV href that's a prefix of it. */
export function moduleKeyForPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  // Child links count too, e.g. /restaurant/deals belongs to Menu, not to
  // the /restaurant (POS) section it shares a prefix with.
  // A group's child can belong to another section (Purchase Cell > Products is
  // "products"), at any depth, so each link carries the key that guards it.
  const links: { href: string; key: string }[] = [];
  const add = (href: string, key: string) => links.push({ href: href.replace(/\/+$/, ""), key });
  const addChildren = (children: NavChild[] | undefined, key: string) =>
    children?.forEach((c) => {
      add(c.href, c.moduleKey ?? key);
      addChildren(c.children, c.moduleKey ?? key);
    });
  NAV.forEach((item) => {
    add(item.href, item.moduleKey);
    addChildren(item.children, item.moduleKey);
  });
  const matches = links.filter((l) => normalized === l.href || normalized.startsWith(`${l.href}/`));
  if (matches.length === 0) return null;
  return matches.reduce((longest, candidate) => (candidate.href.length > longest.href.length ? candidate : longest)).key;
}

/** Whether a staff login's permission list covers a section: its own key, or
 * the key of a menu group that contains it (e.g. Purchase Cell grants Products). */
export function hasPermission(permissions: string[], moduleKey: string): boolean {
  if (permissions.includes(moduleKey)) return true;
  const inside = (children: NavChild[] | undefined): boolean =>
    Boolean(children?.some((c) => c.moduleKey === moduleKey || inside(c.children)));
  return NAV.some((item) => item.onlyFor && permissions.includes(item.moduleKey) && inside(item.children));
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
  if (moduleKey !== "dashboard" && currentUser?.role === "staff" && currentUser.permissions && !hasPermission(currentUser.permissions, moduleKey)) return false;
  // A key may also belong to a sub-tab of a business-type group (Labs > Lab Reports).
  const inside = (children: NavChild[] | undefined): boolean => Boolean(children?.some((c) => c.moduleKey === moduleKey || inside(c.children)));
  const item = NAV.find((n) => n.moduleKey === moduleKey) ?? NAV.find((n) => n.onlyFor && inside(n.children));
  if (item?.onlyFor) return item.onlyFor.includes(businessType(currentTenant.businessType).id);
  if (!moduleAllowedForType(currentTenant.businessType, moduleKey)) return false;
  return currentTenant.allowedModules.includes(moduleKey);
}

/** Whether the logged-in user bills: the owner, a full-access login, or a login
 * with Invoices. A consultant without it does not see fees or billing. */
export function useCanBill(): boolean {
  const user = useAuthStore((s) => s.currentUser);
  if (!user) return false;
  if (user.role !== "staff" || user.permissions === null) return true;
  return hasPermission(user.permissions, "invoices");
}
