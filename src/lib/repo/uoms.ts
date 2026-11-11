import { createTenantRepo, requireCurrentTenantId } from "./base";
import { dbExecute, dbSelect } from "../db";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { sharedCatalogGroupsFor } from "../catalogAccess";
import { useAuthStore } from "../../store/authStore";
import type { Uom } from "../types";

/** Units belong to one tenant (v29). */
export const uomsRepo = createTenantRepo<Uom>("uoms");

/** Returns tenant's own UOMs plus shared catalog UOMs for pharmacy-family
 * tenants. Used in the product form dropdowns. */
export async function listUomsWithShared(): Promise<Uom[]> {
  const tenantId = requireCurrentTenantId();
  const bType = useAuthStore.getState().currentTenant?.businessType;
  const sharedGroups = sharedCatalogGroupsFor(bType);
  if (sharedGroups.length) {
    // UOMs have no catalog_group column — shared UOMs are simply those with
    // tenant_id IS NULL (globally visible to any tenant using the shared catalog).
    return dbSelect<Uom>(
      `SELECT * FROM uoms
       WHERE deleted_at IS NULL
         AND (tenant_id = ? OR tenant_id IS NULL)
       ORDER BY name ASC`,
      [tenantId]
    );
  }
  return uomsRepo.list({ orderBy: "name ASC" });
}

/** The shared unit (tenant_id NULL) to use on a shared catalogue product.
 * A business's own unit is private: on a shared product every other business
 * would see it empty and have to enter it again. So a business unit is
 * replaced by the shared unit of the same name (the oldest one), created if
 * there is none. The business keeps its own unit for its own products. */
export async function sharedUnitFor(uomId: string | null | undefined): Promise<string | null> {
  if (!uomId) return null;
  const u = (await dbSelect<{ id: string; name: string; description: string | null; tenant_id: string | null }>(
    `SELECT id, name, description, tenant_id FROM uoms WHERE id = ? AND deleted_at IS NULL`, [uomId],
  ))[0];
  if (!u || u.tenant_id === null) return uomId;
  const name = u.name.trim();
  const same = (await dbSelect<{ id: string }>(
    `SELECT id FROM uoms WHERE tenant_id IS NULL AND deleted_at IS NULL AND UPPER(TRIM(name)) = UPPER(?) ORDER BY created_at, id LIMIT 1`, [name],
  ))[0];
  if (same) return same.id;
  const ts = nowIso();
  const record = { id: newId(), name, description: u.description, tenant_id: null, created_at: ts, updated_at: ts, deleted_at: null };
  await dbExecute(`INSERT INTO uoms (id, name, description, tenant_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.name, record.description, null, ts, ts, null]);
  await recordOutbox("uoms", record.id, "insert", record);
  return record.id;
}

/** Common units for a tenant whose list is empty (explicit, per tenant). */
export const STARTER_UOMS = ["PCS", "Pack", "Strip", "Box", "Bottle", "Tube", "Sachet", "Vial", "Ampoule", "KG", "Gram", "Litre", "ML", "Dozen", "Carton"];

export async function seedStarterUoms(): Promise<number> {
  requireCurrentTenantId();
  const have = new Set((await uomsRepo.list()).map((u) => u.name.toUpperCase()));
  let added = 0;
  for (const name of STARTER_UOMS) {
    if (have.has(name.toUpperCase())) continue;
    await uomsRepo.create({ name, description: null });
    added++;
  }
  return added;
}
