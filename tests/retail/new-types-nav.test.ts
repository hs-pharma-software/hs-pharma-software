/** The four newer business types keep their own sections: a lab never sees
 * the banquet's or the store's pages and the other way round, by sidebar or
 * by typing the address. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleNavFor } from "@/config/navFilter";
import { BUSINESS_TYPES, businessType, moduleAllowedForType } from "@/config/businessTypes";
import { NAV } from "@/config/nav";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { hasModuleAccess, moduleKeyForPath } from "@/lib/moduleAccess";

const keys = (type: string, perms: string[] | null = null) => {
  const t = businessType(type);
  return visibleNavFor(type, t.defaultModules, perms).flatMap((i) => [i.moduleKey, ...(i.children ?? []).map((c) => c.moduleKey ?? "")]).filter(Boolean);
};
const TYPE_KEYS: Record<string, string[]> = {
  lab: NAV.filter((n) => n.onlyFor?.includes("lab")).map((n) => n.moduleKey),
  banquet_hall: NAV.filter((n) => n.onlyFor?.includes("banquet_hall")).map((n) => n.moduleKey),
  mobile_shop: ["mobile_imei"],
  cloth_store: ["cloth_measurements"],
};

test("the four types are defined and each lands in its own sections", () => {
  for (const id of ["lab", "banquet_hall", "mobile_shop", "cloth_store"]) assert.equal(businessType(id).id, id);
  assert.equal(new Set(BUSINESS_TYPES.map((t) => t.id)).size, BUSINESS_TYPES.length, "type ids are unique");
  assert.deepEqual(visibleNavFor("lab", businessType("lab").defaultModules, null).map((i) => i.label), [
    "Lab Dashboard", "Reception", "Patients", "Samples & Results", "Pathologist", "Reports", "Bills", "Tests & Rates", "Lab Profile",
    "Staff", "Cash Register", "Banks", "Expenses", "Utilities", "Settings",
  ]);
  assert.deepEqual(visibleNavFor("banquet_hall", businessType("banquet_hall").defaultModules, null).map((i) => i.label), [
    "Banquet Dashboard", "Bookings", "Calendar", "Menu & Packages", "Halls", "Banquet Reports",
    "Staff", "Cash Register", "Banks", "Expenses", "Other Revenue", "Utilities", "Settings",
  ]);
});

test("no type sees another type's sections", () => {
  for (const [type, own] of Object.entries(TYPE_KEYS)) {
    const seen = keys(type);
    for (const k of own) assert.ok(seen.includes(k), `${type} has ${k}`);
    for (const [other, theirs] of Object.entries(TYPE_KEYS)) {
      if (other === type) continue;
      for (const k of theirs) assert.ok(!seen.includes(k), `${type} must not see ${other}'s ${k}`);
    }
    for (const k of ["clinic_dashboard", "hospital_dashboard", "restaurant_pos", "rx_inbox"]) assert.ok(!seen.includes(k), `${type} must not see ${k}`);
  }
});

test("lab and banquet have no store catalog; mobile and cloth shops have the store system", () => {
  for (const t of ["lab", "banquet_hall"]) {
    for (const k of ["products", "invoices", "purchase", "stock", "customers", "suppliers"]) assert.equal(moduleAllowedForType(t, k), false, `${t}: ${k}`);
  }
  for (const t of ["mobile_shop", "cloth_store"]) {
    const seen = keys(t);
    for (const k of ["invoices", "products", "purchase", "stock", "settings"]) assert.ok(seen.includes(k), `${t}: ${k}`);
  }
});

test("typing another type's address is refused", () => {
  const as = (type: string) => useAuthStore.setState({
    currentUser: { id: "u", username: "u", displayName: "u", role: "owner", tenantId: "t", permissions: null },
    currentTenant: { id: "t", name: "t", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: businessType(type).defaultModules, maxStaffLogins: 5, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: type } as SessionTenant,
  });
  const can = (path: string) => hasModuleAccess(moduleKeyForPath(path));
  as("lab");
  assert.equal(can("/lab/verify"), true);
  assert.equal(can("/banquet/bookings"), false);
  assert.equal(can("/mobile/imei"), false);
  assert.equal(can("/clinic/consultations"), false);
  as("banquet_hall");
  assert.equal(can("/banquet/bookings/new"), true);
  assert.equal(can("/lab/reception"), false);
  assert.equal(can("/cloth/measurements"), false);
  as("mobile_shop");
  assert.equal(can("/mobile/imei"), true);
  assert.equal(can("/cloth/measurements"), false);
  as("cloth_store");
  assert.equal(can("/cloth/measurements"), true);
  assert.equal(can("/mobile/imei"), false);
});

test("a lab login sees only the desks it was given (receptionist, technologist, pathologist)", () => {
  assert.deepEqual(visibleNavFor("lab", null, ["lab_reception", "lab_patients", "lab_bills"]).map((i) => i.label), ["Reception", "Patients", "Bills"]);
  assert.deepEqual(visibleNavFor("lab", null, ["lab_samples"]).map((i) => i.label), ["Samples & Results"]);
  assert.deepEqual(visibleNavFor("lab", null, ["lab_verify", "lab_reports"]).map((i) => i.label), ["Pathologist", "Reports"]);
});

test("Products > Product Types is a cloth store tab only", () => {
  const children = (type: string) => visibleNavFor(type, businessType(type).defaultModules, null).find((i) => i.moduleKey === "products")?.children?.map((c) => c.label) ?? [];
  assert.ok(children("cloth_store").includes("Product Types"));
  assert.ok(children("cloth_store").includes("Product Detail"));
  for (const t of ["general_store", "mobile_shop", "retail_pharmacy"]) assert.ok(!children(t).includes("Product Types"), t);
});
