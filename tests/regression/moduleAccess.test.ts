/** Scenario J (access layer): the restaurant changes to navigation and
 * route access must not change anything for the other business types. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV } from "@/config/nav";
import { BUSINESS_TYPES } from "@/config/businessTypes";
import { hasModuleAccess, moduleKeyForPath } from "@/lib/moduleAccess";
import { useAuthStore, type SessionTenant, type SessionUser } from "@/store/authStore";

const PHARMACY_KEYS = NAV.filter((n) => !n.onlyFor).map((n) => n.moduleKey);
const RESTAURANT_KEYS = NAV.filter((n) => n.onlyFor?.includes("restaurant")).map((n) => n.moduleKey);

/** The route mapping as it was before the restaurant module (top-level hrefs only). */
function oldModuleKeyForPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const matches = NAV.filter((i) => !i.onlyFor).filter((item) => {
    const href = item.href.replace(/\/+$/, "");
    return normalized === href || normalized.startsWith(`${href}/`);
  });
  if (!matches.length) return null;
  return matches.reduce((a, b) => (b.href.length > a.href.length ? b : a)).moduleKey;
}

function session(type: string, allowed: string[], user: Partial<SessionUser> = {}) {
  const tenant: SessionTenant = {
    id: "t1",
    name: "T",
    subscriptionStatus: "active",
    subscriptionExpiresAt: null,
    allowedModules: allowed,
    maxStaffLogins: 3,
    maxInvoicesPerMonth: null,
    mrpDiscountPct: 0,
    sourceTenantId: null,
    businessType: type,
  };
  const u: SessionUser = { id: "u1", username: "u", displayName: "U", role: "owner", tenantId: "t1", permissions: null, ...user };
  useAuthStore.setState({ currentUser: u, currentTenant: tenant });
}

test("every existing screen maps to the same module as before", () => {
  const paths = NAV.filter((n) => !n.onlyFor).flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]);
  assert.ok(paths.length > 40);
  for (const p of paths) assert.equal(moduleKeyForPath(p), oldModuleKeyForPath(p), p);
});

test("restaurant screens map to their own sections", () => {
  assert.equal(moduleKeyForPath("/restaurant"), "restaurant_pos");
  assert.equal(moduleKeyForPath("/restaurant/deals"), "restaurant_menu");
  assert.equal(moduleKeyForPath("/restaurant/offers"), "restaurant_menu");
  assert.equal(moduleKeyForPath("/restaurant/kitchen"), "restaurant_kitchen");
  assert.equal(moduleKeyForPath("/restaurant/pra"), "restaurant_settings");
  assert.equal(moduleKeyForPath("/restaurant/audit"), "restaurant_reports");
});

test("non-restaurant types: same access to their modules, no restaurant screens", () => {
  for (const t of BUSINESS_TYPES.filter((b) => b.id !== "restaurant")) {
    session(t.id, t.defaultModules);
    for (const key of PHARMACY_KEYS) assert.equal(hasModuleAccess(key), t.defaultModules.includes(key), `${t.id} ${key}`);
    for (const key of RESTAURANT_KEYS) assert.equal(hasModuleAccess(key), false, `${t.id} must not open ${key}`);
  }
});

test("legacy tenants without a type behave as Retail Pharmacy", () => {
  session(null as unknown as string, ["dashboard", "invoices"]);
  assert.equal(hasModuleAccess("invoices"), true);
  assert.equal(hasModuleAccess("restaurant_pos"), false);
});

test("restaurant tenants open restaurant screens regardless of the plan list", () => {
  session("restaurant", ["dashboard"]);
  for (const key of RESTAURANT_KEYS) assert.equal(hasModuleAccess(key), true, key);
  assert.equal(hasModuleAccess("invoices"), false, "plan still governs the general modules");
});

test("staff limited to some sections can't open others by URL (dashboard stays reachable)", () => {
  session("restaurant", ["dashboard", "staff"], { role: "staff", permissions: ["restaurant_kitchen"] });
  assert.equal(hasModuleAccess("restaurant_kitchen"), true);
  assert.equal(hasModuleAccess("restaurant_pos"), false);
  assert.equal(hasModuleAccess("restaurant_settings"), false);
  assert.equal(hasModuleAccess("dashboard"), true);
  session("retail_pharmacy", ["dashboard", "invoices", "stock"], { role: "staff", permissions: ["invoices"] });
  assert.equal(hasModuleAccess("invoices"), true);
  assert.equal(hasModuleAccess("stock"), false);
  session("retail_pharmacy", ["dashboard", "invoices", "stock"], { role: "staff", permissions: null });
  assert.equal(hasModuleAccess("stock"), true, "unrestricted staff unchanged");
});

test("super admin keeps full access", () => {
  session("retail_pharmacy", [], { role: "super_admin", tenantId: null });
  assert.equal(hasModuleAccess("restaurant_pos"), true);
  assert.equal(hasModuleAccess("stock"), true);
});
