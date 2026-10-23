/** Super Admin review of catalog rows that belong to no tenant: rows the
 * v29 ownership migration could not attribute (quarantine). They are never
 * shown to tenants; the Super Admin either hands one to a tenant (move),
 * gives a tenant its own copy (copy), or deletes it. */
import { dbExecute, dbSelect } from "../db";
import { nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";
import { cloneId } from "../catalogOwnership";
import type { Product } from "../types";

function requireSuperAdmin() {
  if (useAuthStore.getState().currentUser?.role !== "super_admin") throw new Error("Only the Super Admin can review the unowned catalog.");
}

export interface UnownedProductRow extends Product {
  category_name: string | null;
  unit_name: string | null;
}

export async function listUnownedProducts(): Promise<UnownedProductRow[]> {
  requireSuperAdmin();
  return dbSelect<UnownedProductRow>(
    `SELECT p.*, c.name AS category_name, u.name AS unit_name FROM products p
     LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id IS NULL
     LEFT JOIN uoms u ON u.id = p.base_unit_id AND u.tenant_id IS NULL
     WHERE p.tenant_id IS NULL AND p.deleted_at IS NULL ORDER BY p.name`
  );
}

export async function unownedCounts(): Promise<Record<string, number>> {
  requireSuperAdmin();
  const out: Record<string, number> = {};
  for (const t of ["products", "categories", "sub_categories", "uoms", "generic_names"]) {
    out[t] = (await dbSelect<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id IS NULL AND deleted_at IS NULL`))[0]?.n ?? 0;
  }
  return out;
}

/** The target tenant's copy of an unowned category / sub category / unit
 * (created once, never overwriting the tenant's own edits), or null when
 * the referenced row is not an unowned row available here. */
async function tenantRef(table: "categories" | "sub_categories" | "uoms", id: string | null, tenantId: string, ts: string): Promise<string | null> {
  if (!id) return null;
  const src = (await dbSelect<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ? AND tenant_id IS NULL`, [id]))[0];
  if (!src) return null;
  const row: Record<string, unknown> = { ...src, id: cloneId(id, tenantId), tenant_id: tenantId, created_at: ts, updated_at: ts, deleted_at: null };
  if (table === "sub_categories") {
    row.category_id = await tenantRef("categories", src.category_id as string | null, tenantId, ts);
    row.default_secondary_unit_id = await tenantRef("uoms", (src.default_secondary_unit_id as string | null) ?? null, tenantId, ts);
    if (!row.category_id) return null;
  }
  const keys = Object.keys(row);
  await dbExecute(`INSERT OR IGNORE INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => row[k]));
  await recordOutbox(table, row.id as string, "insert_if_absent", row);
  return row.id as string;
}

/** Move: the row itself now belongs to the tenant. Copy: the tenant gets its
 * own copy (once; repeating it changes nothing) and the row stays unowned. */
export async function giveProductsToTenant(productIds: string[], tenantId: string, mode: "move" | "copy"): Promise<number> {
  requireSuperAdmin();
  if (!tenantId) throw new Error("Choose a tenant.");
  const ts = nowIso();
  let n = 0;
  for (const id of productIds) {
    const p = (await dbSelect<Record<string, unknown>>(`SELECT * FROM products WHERE id = ? AND tenant_id IS NULL`, [id]))[0];
    if (!p) continue;
    const refs = {
      category_id: await tenantRef("categories", p.category_id as string | null, tenantId, ts),
      sub_category_id: await tenantRef("sub_categories", p.sub_category_id as string | null, tenantId, ts),
      base_unit_id: await tenantRef("uoms", p.base_unit_id as string | null, tenantId, ts),
      secondary_unit_id: await tenantRef("uoms", p.secondary_unit_id as string | null, tenantId, ts),
    };
    if (mode === "move") {
      await dbExecute(
        `UPDATE products SET tenant_id = ?, category_id = ?, sub_category_id = ?, base_unit_id = ?, secondary_unit_id = ?, updated_at = ? WHERE id = ? AND tenant_id IS NULL`,
        [tenantId, refs.category_id, refs.sub_category_id, refs.base_unit_id, refs.secondary_unit_id, ts, id]
      );
      const full = (await dbSelect<Record<string, unknown>>(`SELECT * FROM products WHERE id = ?`, [id]))[0];
      await recordOutbox("products", id, "update", full);
    } else {
      const row: Record<string, unknown> = { ...p, ...refs, id: cloneId(id, tenantId), tenant_id: tenantId, created_at: ts, updated_at: ts, deleted_at: null };
      const keys = Object.keys(row);
      await dbExecute(`INSERT OR IGNORE INTO products (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => row[k]));
      await recordOutbox("products", row.id as string, "insert_if_absent", row);
    }
    n++;
  }
  return n;
}

// ── Tenant catalog views (super admin only) ──────────────────────────────────

export interface TenantProductRow extends UnownedProductRow {
  tenant_id: string;
  tenant_name: string;
}

/** All products belonging to tenants of the given business type. */
export async function listProductsByBusinessType(typeId: string): Promise<TenantProductRow[]> {
  requireSuperAdmin();
  // Tenants with no business_type stored default to retail_pharmacy
  const typeFilter =
    typeId === "retail_pharmacy"
      ? `(t.business_type = 'retail_pharmacy' OR t.business_type IS NULL OR t.business_type = '')`
      : `t.business_type = ?`;
  const params: unknown[] = typeId === "retail_pharmacy" ? [] : [typeId];
  return dbSelect<TenantProductRow>(
    `SELECT p.*, c.name AS category_name, u.name AS unit_name, t.name AS tenant_name
     FROM products p
     JOIN tenants t ON t.id = p.tenant_id AND t.deleted_at IS NULL
     LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
     LEFT JOIN uoms u ON u.id = p.base_unit_id AND u.tenant_id = p.tenant_id
     WHERE p.tenant_id IS NOT NULL AND p.deleted_at IS NULL AND ${typeFilter}
     ORDER BY t.name, p.name`,
    params
  );
}

/** Product counts per business type (for tab badges). */
export async function catalogCountsByType(): Promise<Record<string, number>> {
  requireSuperAdmin();
  const rows = await dbSelect<{ btype: string; n: number }>(
    `SELECT COALESCE(NULLIF(TRIM(t.business_type),''), 'retail_pharmacy') AS btype, COUNT(p.id) AS n
     FROM products p
     JOIN tenants t ON t.id = p.tenant_id AND t.deleted_at IS NULL
     WHERE p.tenant_id IS NOT NULL AND p.deleted_at IS NULL
     GROUP BY btype`
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.btype] = r.n;
  return out;
}

export async function deleteUnownedProduct(id: string): Promise<void> {
  requireSuperAdmin();
  const ts = nowIso();
  await dbExecute(`UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id IS NULL`, [ts, ts, id]);
  await recordOutbox("products", id, "delete", null);
}

/** Copy all unowned products to tenants of matching business types, based on
 *  the product's catalog_group field.  pharma → retail_pharmacy + medical_store +
 *  hospital_pharmacy; general_store → general_store.  Uses INSERT OR IGNORE so
 *  it is safe to run more than once. */
export async function bulkAssignByClassification(): Promise<{ assigned: number; skipped: number }> {
  requireSuperAdmin();

  const groupToTypes: Record<string, string[]> = {
    pharma: ["retail_pharmacy", "medical_store", "hospital_pharmacy"],
    general_store: ["general_store"],
  };

  const products = await dbSelect<{ id: string; catalog_group: string | null; product_classification: string | null }>(
    `SELECT id, catalog_group, product_classification FROM products WHERE tenant_id IS NULL AND deleted_at IS NULL`
  );

  const tenants = await dbSelect<{ id: string; business_type: string }>(
    `SELECT id, COALESCE(NULLIF(TRIM(business_type),''), 'retail_pharmacy') AS business_type
     FROM tenants WHERE deleted_at IS NULL`
  );

  const byType: Record<string, string[]> = {};
  for (const t of tenants) {
    (byType[t.business_type] ??= []).push(t.id);
  }

  let assigned = 0;
  let skipped = 0;

  for (const p of products) {
    const group = p.catalog_group ?? p.product_classification ?? "";
    const types = groupToTypes[group] ?? [];
    const tenantIds = types.flatMap((type) => byType[type] ?? []);
    if (!tenantIds.length) { skipped++; continue; }
    for (const tenantId of tenantIds) {
      assigned += await giveProductsToTenant([p.id], tenantId, "copy");
    }
  }

  return { assigned, skipped };
}
