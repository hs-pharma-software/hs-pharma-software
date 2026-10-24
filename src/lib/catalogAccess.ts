/**
 * Shared product catalog access rules.
 *
 * Pharmacy family tenants (retail_pharmacy, medical_store, hospital_pharmacy)
 * share a common pharma master catalog. They can also access a shared general
 * store catalog. Each tenant maintains its own independent stock, batches,
 * pricing and transactions — "shared catalog" only means the master product
 * definition (name, strength, barcode, category, etc.) is visible to all.
 *
 * catalog_group values on products / categories / sub_categories:
 *   'pharma'        — shared among retail_pharmacy, medical_store, hospital_pharmacy
 *   'general_store' — shared among all pharmacy-family + general_store tenants
 *   NULL            — tenant-private (electric, solar, restaurant, etc.) OR
 *                     quarantined (tenant_id also NULL, not in any catalog)
 *
 * Electric / Electronics / Solar tenants have no shared catalog: every product
 * they create is private to their own tenant (catalog_group = NULL, tenant_id
 * set to their own id).
 */

/** Business types that share the pharmacy product master catalog. */
export const PHARMACY_FAMILY_TYPES = [
  "retail_pharmacy",
  "medical_store",
  "hospital_pharmacy",
] as const;

export type PharmacyFamilyType = (typeof PHARMACY_FAMILY_TYPES)[number];

/** catalog_group values that are shared across multiple tenants. */
export type SharedCatalogGroup = "pharma" | "general_store";

/** Returns the catalog_group values that are visible to a given business type
 * in addition to its own tenant-private products. */
export function sharedCatalogGroupsFor(businessType: string | null | undefined): SharedCatalogGroup[] {
  const bt = (businessType ?? "").trim();
  if ((PHARMACY_FAMILY_TYPES as readonly string[]).includes(bt))
    return ["pharma", "general_store"];
  if (bt === "general_store") return ["general_store"];
  return [];
}

/** Whether this tenant type can access any shared catalog at all. */
export function hasSharedCatalogAccess(businessType: string | null | undefined): boolean {
  return sharedCatalogGroupsFor(businessType).length > 0;
}

/** Whether this is one of the three pharmacy family types. */
export function isPharmacyFamilyType(businessType: string | null | undefined): boolean {
  return (PHARMACY_FAMILY_TYPES as readonly string[]).includes((businessType ?? "").trim());
}

/** SQL fragment to include shared catalog rows in addition to tenant-private
 * ones, given a tenant and its shared group list.
 * Returns {clause, params} where clause is appended after "AND ".
 * Example: "(tenant_id = ? OR (tenant_id IS NULL AND catalog_group IN (?,?)))"
 */
export function sharedCatalogWhereClause(
  tenantId: string,
  sharedGroups: SharedCatalogGroup[]
): { clause: string; params: (string | null)[] } {
  if (!sharedGroups.length) {
    return { clause: "tenant_id = ?", params: [tenantId] };
  }
  const placeholders = sharedGroups.map(() => "?").join(", ");
  // Also match unowned products where catalog_group was never backfilled (NULL) —
  // all such rows are pharma catalog entries predating the v32 migration.
  const nullFallback = sharedGroups.includes("pharma")
    ? " OR (tenant_id IS NULL AND catalog_group IS NULL)"
    : "";
  return {
    clause: `(tenant_id = ? OR (tenant_id IS NULL AND catalog_group IN (${placeholders}))${nullFallback})`,
    params: [tenantId, ...sharedGroups],
  };
}
