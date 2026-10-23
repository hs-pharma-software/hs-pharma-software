import { dbExecute, dbSelect } from "../db";
import { nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";

/** Settings are tenant-private (tax rate, receipt layout, etc.) but the
 * table has no `tenant_id` column of its own \u2014 scoping is done by prefixing
 * the key instead, so no schema change was needed. Falls back to the bare
 * key when no tenant is logged in (shouldn't normally happen outside the
 * Super Admin, who has no use for these settings). */
function scopedKey(key: string, tenantId = useAuthStore.getState().currentTenant?.id): string {
  return tenantId ? `${tenantId}::${key}` : key;
}

/** `tenantId` reads another pharmacy's setting (Super Admin screens);
 * omitted, the logged-in tenant's. */
export async function getSetting(key: string, tenantId?: string): Promise<string | null> {
  const rows = await dbSelect<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [scopedKey(key, tenantId)]);
  return rows[0]?.value ?? null;
}

/** Reads a global (non-tenant-scoped) setting — used for admin-level keys
 * that apply to all tenants (e.g. Billori AI key). */
export async function getGlobalSetting(key: string): Promise<string | null> {
  const rows = await dbSelect<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key]);
  return rows[0]?.value ?? null;
}

/** Writes a global (non-tenant-scoped) setting. */
export async function setGlobalSetting(key: string, value: string): Promise<void> {
  const ts = nowIso();
  await dbExecute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, ts]
  );
  await recordOutbox("settings", key, "update", { key, value, updated_at: ts });
}

export async function setSetting(key: string, value: string, tenantId?: string): Promise<void> {
  const ts = nowIso();
  const fullKey = scopedKey(key, tenantId);
  await dbExecute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [fullKey, value, ts]
  );
  await recordOutbox("settings", fullKey, "update", { key: fullKey, value, updated_at: ts });
}
