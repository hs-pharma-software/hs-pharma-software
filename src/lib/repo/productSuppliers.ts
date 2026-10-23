import { dbExecute, dbSelect } from "../db";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";
import { assertOwnedRefs } from "./base";

function currentTenantId(): string | null {
  return useAuthStore.getState().currentTenant?.id ?? null;
}

export interface AssignedProductRow {
  id: string;
  product_id: string;
  product_name: string;
  barcode: string | null;
  company_name: string | null;
}

export async function listAssignedProducts(supplierId: string): Promise<AssignedProductRow[]> {
  return dbSelect<AssignedProductRow>(
    `
    SELECT ps.id, p.id AS product_id, p.name AS product_name, p.barcode, p.company_name
    FROM product_suppliers ps
    JOIN products p ON p.id = ps.product_id AND p.tenant_id = ps.tenant_id
    WHERE ps.supplier_id = ? AND ps.tenant_id = ? AND ps.deleted_at IS NULL
    ORDER BY p.name ASC
  `,
    [supplierId, currentTenantId()]
  );
}

export async function assignProductToSupplier(productId: string, supplierId: string): Promise<void> {
  // Both must be this tenant's own records.
  await assertOwnedRefs([["products", productId, "Product"], ["suppliers", supplierId, "Supplier"]]);
  const tenantId = currentTenantId();
  const existing = await dbSelect<{ id: string }>(
    `SELECT id FROM product_suppliers WHERE product_id = ? AND supplier_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [productId, supplierId, tenantId]
  );
  if (existing[0]) return;
  const id = newId();
  const ts = nowIso();
  await dbExecute(
    `INSERT INTO product_suppliers (id, tenant_id, product_id, supplier_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [id, tenantId, productId, supplierId, ts, ts]
  );
  await recordOutbox("product_suppliers", id, "insert", {
    id,
    tenant_id: tenantId,
    product_id: productId,
    supplier_id: supplierId,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  });
}

export async function unassignProduct(linkId: string): Promise<void> {
  const ts = nowIso();
  await dbExecute(`UPDATE product_suppliers SET deleted_at = ?, updated_at = ? WHERE id = ?`, [ts, ts, linkId]);
  await recordOutbox("product_suppliers", linkId, "delete", null);
}
