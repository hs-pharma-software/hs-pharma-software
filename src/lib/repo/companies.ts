/** Companies (manufacturers) are the company names on products: there is no
 * separate table. The list covers the business's own products and, for
 * pharmacy-family businesses, the shared catalog they can see. */
import { dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { useAuthStore } from "../../store/authStore";
import { sharedCatalogGroupsFor } from "../catalogAccess";
import { productsRepo } from "./products";

export interface CompanyRow {
  name: string;
  products: number;
  /** Products of this business (its own, not the shared catalog). */
  own: number;
}

function visibleProducts(): { where: string; params: unknown[] } {
  const tenantId = requireCurrentTenantId();
  const groups = sharedCatalogGroupsFor(useAuthStore.getState().currentTenant?.businessType);
  return groups.length
    ? { where: `p.deleted_at IS NULL AND (p.tenant_id = ? OR (p.tenant_id IS NULL AND p.catalog_group IN (${groups.map(() => "?").join(", ")})))`, params: [tenantId, ...groups] }
    : { where: "p.deleted_at IS NULL AND p.tenant_id = ?", params: [tenantId] };
}

/** Every company with its number of products, spelled as most products spell it. */
export async function listCompanies(): Promise<CompanyRow[]> {
  const v = visibleProducts();
  const rows = await dbSelect<{ name: string; n: number; own: number }>(
    `SELECT TRIM(p.company_name) AS name, COUNT(*) AS n, SUM(CASE WHEN p.tenant_id = ? THEN 1 ELSE 0 END) AS own
     FROM products p WHERE ${v.where} AND p.company_name IS NOT NULL AND TRIM(p.company_name) != ''
     GROUP BY TRIM(p.company_name)`,
    [requireCurrentTenantId(), ...v.params]
  );
  // "GSK" and "gsk " are one company: group case-insensitively, keep the most used spelling.
  const groups = new Map<string, { best: string; bestN: number; products: number; own: number }>();
  for (const r of rows) {
    const k = r.name.toUpperCase();
    const g = groups.get(k) ?? { best: r.name, bestN: 0, products: 0, own: 0 };
    if (Number(r.n) > g.bestN) { g.best = r.name; g.bestN = Number(r.n); }
    g.products += Number(r.n);
    g.own += Number(r.own);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({ name: g.best, products: g.products, own: g.own })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Company names for suggestions while typing. */
export async function companyNames(): Promise<string[]> {
  return (await listCompanies()).map((c) => c.name);
}

export async function companyProducts(name: string): Promise<{ id: string; name: string; tenant_id: string | null }[]> {
  const v = visibleProducts();
  return dbSelect(
    `SELECT p.id, p.name, p.tenant_id FROM products p WHERE ${v.where} AND UPPER(TRIM(p.company_name)) = UPPER(TRIM(?)) ORDER BY p.name`,
    [...v.params, name]
  );
}

/** Renames a company on this business's own products (spelling fixes,
 * merging duplicates). Shared catalog products are left as they are. */
export async function renameCompany(from: string, to: string): Promise<{ changed: number; sharedLeft: number }> {
  const target = to.trim();
  if (!target) throw new Error("Enter the new company name.");
  const rows = await companyProducts(from);
  const tenantId = requireCurrentTenantId();
  const own = rows.filter((r) => r.tenant_id === tenantId);
  for (const r of own) await productsRepo.update(r.id, { company_name: target });
  return { changed: own.length, sharedLeft: rows.length - own.length };
}
