import { createTenantRepo, requireCurrentTenantId } from "./base";
import { dbSelect } from "../db";
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
