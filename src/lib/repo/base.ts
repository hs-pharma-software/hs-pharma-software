import { dbExecute, dbSelect } from "../db";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";
import { sharedCatalogGroupsFor, sharedCatalogWhereClause } from "../catalogAccess";

export interface BaseRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Base shape for every table that's private to one tenant \u2014 since v29 that
 * includes the catalog (products, categories, sub categories, units,
 * generic names), which used to be shared by every tenant. */
export interface TenantRow extends BaseRow {
  tenant_id: string;
}

export function requireCurrentTenantId(): string {
  const tenantId = useAuthStore.getState().currentTenant?.id;
  if (!tenantId) {
    throw new Error("No tenant is logged in \u2014 this action requires a tenant session.");
  }
  return tenantId;
}

/** Generic CRUD factory shared by every module's repository. Handles id/
 * timestamp stamping, soft deletes, and recording every write to the sync
 * outbox \u2014 so individual repo files only need to add table-specific queries
 * (joins, filters) on top of this. */
export function createRepo<T extends BaseRow>(table: string) {
  async function get(id: string): Promise<T | null> {
    const rows = await dbSelect<T>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  return {
    table,
    get,

    async list(opts: { where?: string; params?: unknown[]; orderBy?: string } = {}): Promise<T[]> {
      const { where = "", params = [], orderBy = "created_at DESC" } = opts;
      return dbSelect<T>(
        `SELECT * FROM ${table} WHERE deleted_at IS NULL ${where ? `AND ${where}` : ""} ORDER BY ${orderBy}`,
        params
      );
    },

    async create(data: Partial<T>): Promise<T> {
      const id = (data.id as string) ?? newId();
      const ts = nowIso();
      const record = { ...data, id, created_at: ts, updated_at: ts, deleted_at: null } as T;
      const keys = Object.keys(record);
      await dbExecute(
        `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        keys.map((k) => (record as Record<string, unknown>)[k] ?? null)
      );
      await recordOutbox(table, id, "insert", record as unknown as Record<string, unknown>);
      return record;
    },

    async update(id: string, data: Partial<T>): Promise<T | null> {
      const ts = nowIso();
      const patch = { ...data, updated_at: ts };
      delete (patch as Partial<T>).id;
      const keys = Object.keys(patch);
      if (keys.length > 0) {
        await dbExecute(
          `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
          [...keys.map((k) => (patch as Record<string, unknown>)[k] ?? null), id]
        );
      }
      const full = await get(id);
      if (full) await recordOutbox(table, id, "update", full as unknown as Record<string, unknown>);
      return full;
    },

    /** Soft delete. Optionally logs a reason to `delete_history` (Utilities
     * -> Delete History in the reference app). */
    async remove(id: string, reason?: string, deletedFromLabel?: string): Promise<void> {
      const ts = nowIso();
      await dbExecute(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [ts, ts, id]);
      await recordOutbox(table, id, "delete", null);
      if (reason) {
        const tenantId = useAuthStore.getState().currentTenant?.id ?? null;
        const deletedBy = useAuthStore.getState().currentUser?.displayName ?? "user";
        await dbExecute(
          `INSERT INTO delete_history (id, tenant_id, date, delete_from, delete_by, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [newId(), tenantId, ts, deletedFromLabel ?? table, deletedBy, reason, ts]
        );
      }
    },
  };
}

/** Catalog tables whose rows may be shared across pharmacy-family tenants. */
const SHARED_CATALOG_TABLES = new Set(["products", "categories", "sub_categories", "uoms"]);

/** Throws unless every non-empty id belongs to the logged-in tenant OR is a
 * shared catalog row accessible to the tenant's business type.
 *
 * Pharmacy-family tenants (retail_pharmacy, medical_store, hospital_pharmacy)
 * may reference shared catalog products/categories/sub_categories/uoms
 * (rows where tenant_id IS NULL and catalog_group IS NOT NULL). All other
 * tenants may only reference their own rows. */
export async function assertOwnedRefs(refs: [table: string, id: string | null | undefined, label: string][]): Promise<void> {
  const tenantId = requireCurrentTenantId();
  const bType = useAuthStore.getState().currentTenant?.businessType;
  const sharedGroups = sharedCatalogGroupsFor(bType);

  for (const [table, id, label] of refs) {
    if (!id) continue;
    let rows: { id: string }[];
    if (sharedGroups.length && SHARED_CATALOG_TABLES.has(table)) {
      if (table === "uoms") {
        // UOMs have no catalog_group column — shared ones are simply tenant_id IS NULL.
        rows = await dbSelect<{ id: string }>(
          `SELECT id FROM uoms WHERE id = ? AND deleted_at IS NULL AND (tenant_id = ? OR tenant_id IS NULL)`,
          [id, tenantId]
        );
      } else {
        const { clause, params } = sharedCatalogWhereClause(tenantId, sharedGroups);
        rows = await dbSelect<{ id: string }>(`SELECT id FROM ${table} WHERE id = ? AND ${clause}`, [id, ...params]);
      }
    } else {
      rows = await dbSelect<{ id: string }>(`SELECT id FROM ${table} WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
    }
    if (!rows.length) throw new Error(`${label} not found in this business.`);
  }
}

/** Same generic CRUD factory as `createRepo`, but for tables private to one
 * pharmacy tenant: every `list` is filtered to the logged-in tenant, `create`
 * auto-stamps `tenant_id` if the caller didn't already set it, and
 * `get`/`update`/`remove` re-check `tenant_id` in their `WHERE` clause as a
 * defense-in-depth measure so an id lookup can never cross tenants. */
/** Catalog columns line tables carry; `refs` checks them on every write. */
export const LINE_REFS: [column: string, table: string, label: string][] = [
  ["product_id", "products", "Product"],
  ["uom_id", "uoms", "Unit"],
];

export function createTenantRepo<T extends TenantRow>(table: string, opts: { refs?: [column: string, table: string, label: string][] } = {}) {
  const checkRefs = (data: Partial<T>) =>
    opts.refs ? assertOwnedRefs(opts.refs.map(([col, t, label]) => [t, (data as Record<string, string | null | undefined>)[col], label])) : Promise.resolve();
  async function get(id: string): Promise<T | null> {
    const rows = await dbSelect<T>(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, [
      id,
      requireCurrentTenantId(),
    ]);
    return rows[0] ?? null;
  }

  return {
    table,
    get,

    async list(opts: { where?: string; params?: unknown[]; orderBy?: string } = {}): Promise<T[]> {
      const { where = "", params = [], orderBy = "created_at DESC" } = opts;
      return dbSelect<T>(
        `SELECT * FROM ${table} WHERE deleted_at IS NULL AND tenant_id = ? ${
          where ? `AND ${where}` : ""
        } ORDER BY ${orderBy}`,
        [requireCurrentTenantId(), ...params]
      );
    },

    async create(data: Partial<T>): Promise<T> {
      const id = (data.id as string) ?? newId();
      const ts = nowIso();
      // Always the session's tenant: a caller-supplied tenant_id must match it.
      const tenantId = requireCurrentTenantId();
      if (data.tenant_id && data.tenant_id !== tenantId) throw new Error("This record belongs to another business.");
      await checkRefs(data);
      const record = { ...data, id, tenant_id: tenantId, created_at: ts, updated_at: ts, deleted_at: null } as T;
      const keys = Object.keys(record);
      await dbExecute(
        `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        keys.map((k) => (record as Record<string, unknown>)[k] ?? null)
      );
      await recordOutbox(table, id, "insert", record as unknown as Record<string, unknown>);
      return record;
    },

    async update(id: string, data: Partial<T>): Promise<T | null> {
      await checkRefs(data);
      const ts = nowIso();
      const patch = { ...data, updated_at: ts };
      delete (patch as Partial<T>).id;
      delete (patch as Partial<T>).tenant_id;
      const keys = Object.keys(patch);
      if (keys.length > 0) {
        await dbExecute(
          `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND tenant_id = ?`,
          [...keys.map((k) => (patch as Record<string, unknown>)[k] ?? null), id, requireCurrentTenantId()]
        );
      }
      const full = await get(id);
      if (full) await recordOutbox(table, id, "update", full as unknown as Record<string, unknown>);
      return full;
    },

    /** Soft delete. Optionally logs a reason to `delete_history`. */
    async remove(id: string, reason?: string, deletedFromLabel?: string): Promise<void> {
      const ts = nowIso();
      const tenantId = requireCurrentTenantId();
      await dbExecute(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [
        ts,
        ts,
        id,
        tenantId,
      ]);
      await recordOutbox(table, id, "delete", null);
      if (reason) {
        const deletedBy = useAuthStore.getState().currentUser?.displayName ?? "user";
        await dbExecute(
          `INSERT INTO delete_history (id, tenant_id, date, delete_from, delete_by, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [newId(), tenantId, ts, deletedFromLabel ?? table, deletedBy, reason, ts]
        );
      }
    },
  };
}
