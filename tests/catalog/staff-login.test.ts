/** Staff and logins: a staff member can be linked to the login they use;
 * one login belongs to one staff member; unlinking clears it. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { saveStaffWithLogin, staffRepo } from "@/lib/repo/staff";

const tenant: SessionTenant = {
  id: "clinic-a", name: "Clinic", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "clinic",
};

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: tenant.id, permissions: null }, currentTenant: tenant });
});

test("link a staff member to a login, once per login", async () => {
  const dr = await saveStaffWithLogin(null, { name: "Dr Rab Nawaz", designation: "MBBS", basic_pay: 70000, opening_balance: 0, balance_type: "payable" }, "u-rab");
  assert.equal(dr.user_id, "u-rab");
  const nurse = await saveStaffWithLogin(null, { name: "Sana", designation: "Nurse", basic_pay: 30000, opening_balance: 0, balance_type: "payable" }, null);
  await assert.rejects(saveStaffWithLogin(nurse.id, { name: "Sana" }, "u-rab"), /already linked to Dr Rab Nawaz/);
  await saveStaffWithLogin(dr.id, { name: "Dr Rab Nawaz" }, dr.user_id ?? null);
  await saveStaffWithLogin(dr.id, { name: "Dr Rab Nawaz" }, null);
  assert.equal((await staffRepo.get(dr.id))!.user_id, null);
  await saveStaffWithLogin(nurse.id, { name: "Sana" }, "u-rab");
  assert.equal((await staffRepo.get(nurse.id))!.user_id, "u-rab");
});
