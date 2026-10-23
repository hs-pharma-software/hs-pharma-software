import { createTenantRepo, requireCurrentTenantId } from "./base";
import type { Uom } from "../types";

/** Units belong to one tenant (v29). */
export const uomsRepo = createTenantRepo<Uom>("uoms");

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
