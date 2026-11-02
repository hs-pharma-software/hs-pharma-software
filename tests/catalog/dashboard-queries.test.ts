/** Every dashboard query runs (products joined with batches and units, which
 * also carry tenant_id, must not be ambiguous). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { productsRepo, productBatchesRepo } from "@/lib/repo/products";
import { uomsRepo } from "@/lib/repo/uoms";
import * as dash from "@/lib/repo/dashboard";

const tenant: SessionTenant = {
  id: "ph-a", name: "Pharmacy", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy",
};
beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "o", username: "o", displayName: "Owner", role: "owner", tenantId: "ph-a", permissions: null }, currentTenant: tenant });
});

test("dashboard queries run for a pharmacy (shared catalog) and a store", async () => {
  for (const businessType of ["retail_pharmacy", "general_store", "mobile_shop"]) {
    useAuthStore.setState({ currentTenant: { ...tenant, businessType } });
    const pack = await uomsRepo.create({ name: `Pack ${businessType}` });
    const p = await productsRepo.create({ name: `Item ${businessType}`, packing: 10, base_unit_id: pack.id } as never);
    await productBatchesRepo.create({ product_id: p.id, batch_no: "B1", expiry_date: "2026-12-01", qty: 3, location: null, purchase_price: 10 });
    const units = await dash.getInventoryByUnitType();
    assert.ok(units.some((u) => u.unit_type === `Pack ${businessType}`), businessType);
    await dash.getInventoryByCategory();
    await dash.getLowStockProducts();
    await dash.getExpiringSoonBatches(400);
    await dash.getTopSellingProducts();
    await dash.getRecentInvoices();
    assert.ok((await dash.countProducts()) >= 1);
    await dash.getTodaySummary();
  }
});
