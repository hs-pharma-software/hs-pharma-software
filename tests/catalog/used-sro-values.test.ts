/** The product form's SRO dropdowns fall back to schedules already saved on
 * the tenant's products and the shared catalog, never another tenant's. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { listUsedSroValues } from "@/lib/repo/products";

const T = "ph-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: T, name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant });
});

test("lists SRO values from own and shared products only", async () => {
  const add = db.prepare(`INSERT INTO products (id, tenant_id, catalog_group, name, packing, fbr_sale_type, sro_no, sro_item_serial_no, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 'Exempt goods', ?, ?, 'x', 'x')`);
  add.run("own", T, null, "Own", " 6th Schd Table I ", "100");
  add.run("shared", null, "pharma", "Shared", "Eighth Schedule Table 1", "81");
  add.run("other", "ph-b", null, "Other", "Other tenant schedule", "5");
  add.run("blank", T, null, "Blank", "", null);
  const rows = await listUsedSroValues();
  const got = rows.map((r) => `${r.sro_no}/${r.sro_item_serial_no}`).sort();
  assert.deepEqual(got, ["6th Schd Table I/100", "Eighth Schedule Table 1/81"]);
});
