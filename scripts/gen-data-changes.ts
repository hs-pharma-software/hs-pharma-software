/** Prints schema_sql_v88 (the change log the desktop copy follows): one
 * data_changes table, and on every table holding a business's data an
 * insert / update / delete trigger recording which row changed.
 *
 *   node --import ./tests/register.mjs scripts/gen-data-changes.ts > out.sql
 *
 * Run it again when a migration adds a business table, and add the new
 * table's triggers in that migration (tests/server/replica.test.ts checks
 * that every business table has them). */
import { fullSchemaDb } from "../tests/catalog/fullDb.ts";
import { REPLICA_EXCLUDED, replicaTableKind } from "../src/server/replicaTables.ts";

const db = fullSchemaDb();
const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; pk: number }[]);

const out: string[] = [
  `-- The change log the desktop app's local copy follows (Phase 1): which row`,
  `-- of which table changed, for which business (and branch). Filled by the`,
  `-- triggers below; rows themselves are read through the same rules as /api/db.`,
  `CREATE TABLE IF NOT EXISTS data_changes (`,
  `    seq INTEGER PRIMARY KEY AUTOINCREMENT,`,
  `    tbl TEXT NOT NULL,`,
  `    row_id TEXT NOT NULL,`,
  `    tenant_id TEXT,`,
  `    branch_id TEXT,`,
  `    op TEXT NOT NULL,`,
  `    changed_at TEXT NOT NULL`,
  `);`,
  `CREATE INDEX IF NOT EXISTS idx_data_changes_tenant ON data_changes (tenant_id, seq);`,
];
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
let n = 0;
for (const t of tables) {
  const kind = replicaTableKind(t, cols(t).map((c) => c.name));
  if (!kind || REPLICA_EXCLUDED.has(t)) continue;
  const c = cols(t);
  const pk = c.filter((x) => x.pk).map((x) => x.name);
  if (pk.length !== 1) continue;
  const id = pk[0];
  const branch = c.some((x) => x.name === "branch_id") ? "branch_id" : null;
  for (const [ev, rec, op] of [["INSERT", "NEW", "u"], ["UPDATE", "NEW", "u"], ["DELETE", "OLD", "d"]] as const) {
    const tenant = kind === "tenants" ? `${rec}.id` : kind === "settings" ? `substr(${rec}.key, 1, instr(${rec}.key, '::') - 1)` : `${rec}.tenant_id`;
    out.push(
      `CREATE TRIGGER IF NOT EXISTS trg_dc_${t}_${ev.slice(0, 3).toLowerCase()} AFTER ${ev} ON ${t} BEGIN`,
      `    INSERT INTO data_changes (tbl, row_id, tenant_id, branch_id, op, changed_at) VALUES ('${t}', ${rec}.${id}, ${tenant}, ${branch ? `${rec}.${branch}` : "NULL"}, '${op}', ${NOW});`,
      `END;`,
    );
    n++;
  }
}
console.log(out.join("\n    "));
console.error(`${n} triggers`);
