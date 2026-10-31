/** Action permissions: ordinary actions are allowed unless the owner unticks
 * them; memorized-invoice actions are opt-in: a staff login has them only
 * when ticked, the owner always. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { can, staffAllows, toggleStaffAction, staffListFor, restrictedCount } from "@/lib/actionPermissions";

const tenant: SessionTenant = {
  id: "t", name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
const as = (role: "owner" | "staff", deniedActions: string[]) =>
  useAuthStore.setState({ currentUser: { id: "u", username: "u", displayName: "u", role, tenantId: "t", permissions: null, deniedActions }, currentTenant: tenant });

test("memorized actions are off for staff until ticked; on for the owner", () => {
  as("staff", []);
  assert.equal(can("invoice.edit"), true);
  assert.equal(can("memorized.convert"), false);
  as("staff", toggleStaffAction([], "memorized.convert"));
  assert.equal(can("memorized.convert"), true);
  assert.equal(can("memorized.delete"), false);
  as("owner", []);
  assert.equal(can("memorized.delete"), true);
  useAuthStore.setState({ currentTenant: { ...tenant, deniedActions: ["memorized.delete"] } });
  assert.equal(can("memorized.delete"), false, "the Super Admin can switch it off for the business");
});

test("ticking, Allow All / Block All and the restricted count", () => {
  const keys = ["invoice.edit", "memorized.edit"];
  let list = toggleStaffAction([], "invoice.edit");
  assert.deepEqual(list, ["invoice.edit"]);
  assert.equal(staffAllows(list, "invoice.edit"), false);
  list = toggleStaffAction(list, "memorized.edit");
  assert.equal(staffAllows(list, "memorized.edit"), true);
  assert.deepEqual(staffListFor(true, keys), ["+memorized.edit"]);
  assert.deepEqual(staffListFor(false, keys), ["invoice.edit"]);
  assert.equal(restrictedCount([], keys), 1);
  assert.equal(restrictedCount(staffListFor(true, keys), keys), 0);
});
