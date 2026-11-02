/** Company Profile: the name line can be left off or replaced, extra numbers
 * (PST, CDSL...) are kept with their headings, and template section names
 * say "Business" outside pharmacies. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { fillWarranty, loadCompanyProfile, printedBusinessName, saveCompanyProfile, MEDICINE_WARRANTY_TEXT } from "@/lib/companyProfile";
import { blockLabel } from "@/lib/printTemplates";

const tenant: SessionTenant = {
  id: "con-a", name: "Hadayat Ullah & Sons", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "contractor",
};

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: tenant.id, permissions: null }, currentTenant: tenant });
});

test("saves name choice and extra numbers", async () => {
  const p = await loadCompanyProfile();
  assert.equal(p.showName, true);
  assert.equal(printedBusinessName(p, tenant.name), tenant.name);
  await saveCompanyProfile({ ...p, showName: false, numbers: [{ label: " PST ", value: " 123 " }, { label: "CDSL No", value: "" }] });
  const q = await loadCompanyProfile();
  assert.equal(printedBusinessName(q, tenant.name), "");
  assert.deepEqual(q.numbers, [{ label: "PST", value: "123" }]);
  await saveCompanyProfile({ ...q, showName: true, printName: "HUS Surgical" });
  assert.equal(printedBusinessName(await loadCompanyProfile(), tenant.name), "HUS Surgical");
});

test("section names and warranty text", () => {
  assert.equal(blockLabel("logo", "contractor"), "Business logo");
  assert.equal(blockLabel("business", "medical_store"), "Pharmacy name & address");
  const w = fillWarranty(MEDICINE_WARRANTY_TEXT, { owner: "Usama", business: "HUS", address: "Sargodha" });
  assert.match(w, /I Usama being a person resident in Pakistan/);
  assert.match(w, /under the name of HUS, Sargodha/);
});
