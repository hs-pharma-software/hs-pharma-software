import { PLATFORM_TABLES } from "./dbRouting";
import { SYNCABLE_TABLES } from "./sync/tables";

/** The two things the copy needs from a database. */
export interface SqlRunner {
  select: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** Tables never copied: sign-in data and the pharmacy mailbox stay on the
 * platform database; the sync queue and its cursors belong to each file. */
const NEVER_COPY = new Set([...PLATFORM_TABLES, "sync_outbox", "sync_meta", "backups", "_sqlx_migrations"]);

/** How to pick one tenant's rows from tables that have no `tenant_id` column
 * (or whose owner column has another name). `?` is the tenant id. */
const SCOPE: Record<string, { where: string; params: (t: string) => unknown[] }> = {
  clinic_rx_items: { where: `prescription_id IN (SELECT id FROM clinic_prescriptions WHERE tenant_id = ?)`, params: (t) => [t] },
  clinic_pharmacy_link: { where: `clinic_tenant_id = ?`, params: (t) => [t] },
  // Settings are scoped by key prefix; un-prefixed keys are global app settings.
  settings: { where: `key LIKE ? OR key NOT LIKE '%::%'`, params: (t) => [`${t}::%`] },
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function columnsOf(db: SqlRunner, table: string): Promise<string[]> {
  const rows = await db.select(`PRAGMA table_info(${q(table)})`);
  return rows.map((r) => String(r.name));
}

export function markerKey(tenantId: string): string {
  return `split_copy_${tenantId}`;
}

export interface CopyResult {
  skipped: boolean;
  tables: number;
  rows: number;
}

/** Copies one tenant's existing rows from the platform database into the
 * tenant's own (Hospital or Clinic) database. Nothing is moved or deleted in
 * the source, so the platform file stays a full backup. Safe to repeat:
 * rows already present are left untouched (INSERT OR IGNORE) and a marker
 * records a completed copy. Throws if the copy came out short, so an
 * incomplete database is never mistaken for a complete one. */
export async function copyTenantData(source: SqlRunner, target: SqlRunner, tenantId: string): Promise<CopyResult> {
  const done = await target.select(`SELECT value FROM sync_meta WHERE key = ?`, [markerKey(tenantId)]);
  if (done.length) return { skipped: true, tables: 0, rows: 0 };

  const targetTables = (await target.select(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).map((r) => String(r.name));
  const sourceTables = new Set((await source.select(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).map((r) => String(r.name)));

  const known = SYNCABLE_TABLES as readonly string[];
  const ordered = [...targetTables].sort((a, b) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  let tables = 0;
  let rows = 0;
  for (const table of ordered) {
    if (NEVER_COPY.has(table) || !sourceTables.has(table)) continue;
    const srcCols = await columnsOf(source, table);
    const scope = SCOPE[table] ?? (srcCols.includes("tenant_id") ? { where: `tenant_id = ?`, params: (t: string) => [t] } : null);
    if (!scope) continue;

    const dstCols = new Set(await columnsOf(target, table));
    const cols = srcCols.filter((c) => dstCols.has(c));
    if (!cols.length) continue;

    const data = await source.select(`SELECT ${cols.map(q).join(", ")} FROM ${q(table)} WHERE ${scope.where}`, scope.params(tenantId));
    for (const row of data) {
      await target.execute(
        `INSERT OR IGNORE INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        cols.map((c) => row[c] ?? null)
      );
    }
    // Check this table landed completely before moving on.
    const have = Number((await target.select(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${scope.where}`, scope.params(tenantId)))[0]?.n ?? 0);
    if (have < data.length) throw new Error(`Copying ${table} into the tenant database came out short (${have} of ${data.length} rows).`);
    if (data.length) {
      tables++;
      rows += data.length;
    }
  }

  await target.execute(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, [markerKey(tenantId), new Date().toISOString()]);
  return { skipped: false, tables, rows };
}
