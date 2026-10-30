/** Clinic Settings: the Clinic Profile printed on slips (name falls back to
 * the clinic's account name) and the Settings tab with Clinic Profile / Users. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { loadClinicProfile, saveClinicProfile } from "@/lib/clinicProfile";
import { visibleNavFor } from "@/config/navFilter";
import { moduleKeyForPath } from "@/lib/moduleAccess";

const tenant: SessionTenant = {
  id: "clinic-a", name: "City Clinic", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "clinic",
};

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: tenant.id, permissions: null }, currentTenant: tenant });
});

test("clinic profile: saved trimmed, name required, account name until one is saved", async () => {
  assert.deepEqual(await loadClinicProfile(), { name: "City Clinic", address: "", contact: "", phc_reg_no: "", ntn: "" });
  await assert.rejects(saveClinicProfile({ name: "  ", address: "", contact: "", phc_reg_no: "", ntn: "" }), /clinic name/);
  await saveClinicProfile({ name: " Al-Shifa Clinic ", address: "Main Bazar, Okara", contact: "0300-1234567", phc_reg_no: "R-12345", ntn: "1234567-8" });
  assert.deepEqual(await loadClinicProfile(), { name: "Al-Shifa Clinic", address: "Main Bazar, Okara", contact: "0300-1234567", phc_reg_no: "R-12345", ntn: "1234567-8" });
});

test("clinics get a Settings tab with Clinic Profile and Users; other businesses do not", () => {
  const settings = visibleNavFor("clinic", null, null).find((n) => n.moduleKey === "clinic_settings");
  assert.deepEqual(settings?.children?.map((c) => c.label), ["Clinic Profile", "Users"]);
  assert.equal(visibleNavFor("hospital", null, null).some((n) => n.moduleKey === "clinic_settings"), false);
  assert.equal(moduleKeyForPath("/clinic/settings/users"), "clinic_settings");
  assert.equal(visibleNavFor("clinic", null, ["clinic_patients"]).some((n) => n.moduleKey === "clinic_settings"), false, "a staff login without it");
});
