/** Distributor screens open only for distributor tenants; other types are unaffected. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV } from "@/config/nav";
import { BUSINESS_TYPES, businessType } from "@/config/businessTypes";
import { hasModuleAccess, moduleKeyForPath } from "@/lib/moduleAccess";
import { useAuthStore, type SessionTenant } from "@/store/authStore";

function as(type: string, allowed: string[] = []) {
  const tenant: SessionTenant = { id: "t", name: "T", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: allowed, maxStaffLogins: 3, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: type };
  useAuthStore.setState({ currentUser: { id: "u", username: "u", displayName: "U", role: "owner", tenantId: "t", permissions: null }, currentTenant: tenant });
}

const DIST_KEYS = NAV.filter((n) => n.onlyFor?.includes("distributor")).map((n) => n.moduleKey);

test("distributor routes map to distributor sections", () => {
  for (const [path, key] of [
    ["/dist/field", "dist_field"], ["/dist/companies", "dist_companies"], ["/dist/companies/view", "dist_companies"], ["/dist/catalog", "dist_catalog"], ["/dist/categories", "dist_catalog"],
    ["/dist/customers", "dist_customers"], ["/dist/customer-map", "dist_customers"], ["/dist/salesmen", "dist_salesmen"], ["/dist/live-map", "dist_salesmen"],
    ["/dist/bookings", "dist_bookings"], ["/dist/invoices", "dist_sales"], ["/dist/ledger", "dist_sales"], ["/dist/purchases", "dist_purchases"], ["/dist/reports", "dist_reports"],
    ["/dist/settings", "dist_settings"], ["/dist/permissions", "dist_settings"], ["/dist/audit", "dist_settings"],
  ] as const)
    assert.equal(moduleKeyForPath(path), key, path);
});

test("only distributor tenants open distributor sections; distributors can't open pharmacy catalog screens", () => {
  assert.equal(businessType("distributor").id, "distributor");
  as("distributor", ["products", "invoices", "customers"]);
  for (const k of DIST_KEYS) assert.equal(hasModuleAccess(k), true, k);
  assert.equal(hasModuleAccess("products"), false);
  assert.equal(hasModuleAccess("invoices"), false);
  for (const t of BUSINESS_TYPES.filter((b) => b.id !== "distributor")) {
    as(t.id, ["products", "invoices"]);
    for (const k of DIST_KEYS) assert.equal(hasModuleAccess(k), false, `${t.id} -> ${k}`);
  }
  // The legacy Wholesale / Distributor type keeps its pharmacy screens.
  as("wholesale_distributor", ["products", "invoices"]);
  assert.equal(hasModuleAccess("products"), true);
});

test("every distributor table syncs and is tenant-scoped (pulled only for its own tenant)", async () => {
  const { readFileSync } = await import("node:fs");
  const { SYNCABLE_TABLES, TENANT_SCOPED_TABLES } = await import("@/lib/sync/tables");
  const rs = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const v30 = /fn schema_sql_v30\(\)[^{]*\{\s*r#"([\s\S]*?)"#/.exec(rs)![1];
  const tables = [...v30.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.equal(tables.length, 19);
  for (const t of tables) {
    assert.ok((SYNCABLE_TABLES as readonly string[]).includes(t), `${t} syncs`);
    assert.ok(TENANT_SCOPED_TABLES.includes(t), `${t} is tenant-scoped`);
  }
});
