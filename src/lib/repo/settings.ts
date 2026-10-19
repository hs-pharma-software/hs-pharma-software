import { dbExecute, dbSelect } from "../db";
import { nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";

/** Settings are tenant-private (tax rate, receipt layout, etc.) but the
 * table has no `tenant_id` column of its own — scoping is done by prefixing
 * the key instead, so no schema change was needed. Falls back to the bare
 * key when no tenant is logged in (shouldn't normally happen outside the
 * Super Admin, who has no use for these settings). */
function scopedKey(key: string): string {
  const tenantId = useAuthStore.getState().currentTenant?.id;
  return tenantId ? `${tenantId}::${key}` : key;
}

export async function getSetting(key: string): Promise<string | null> {
  const rows = await dbSelect<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [scopedKey(key)]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const ts = nowIso();
  const fullKey = scopedKey(key);
  await dbExecute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [fullKey, value, ts]
  );
  await recordOutbox("settings", fullKey, "update", { key: fullKey, value, updated_at: ts });
}
