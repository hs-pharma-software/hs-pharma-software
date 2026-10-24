/**
 * split-turso-data.cjs
 *
 * Copies the existing data of Hospital (or Clinic) tenants from the platform
 * Turso database into that system's own Turso database. Nothing is deleted or
 * changed in the platform database; rows already present in the target are left
 * untouched (INSERT OR IGNORE), so it is safe to run again.
 *
 *   1. Create the Turso database and add to .env.local:
 *        NEXT_PUBLIC_TURSO_HOSPITAL_DATABASE_URL / NEXT_PUBLIC_TURSO_HOSPITAL_AUTH_TOKEN
 *        NEXT_PUBLIC_TURSO_CLINIC_DATABASE_URL   / NEXT_PUBLIC_TURSO_CLINIC_AUTH_TOKEN
 *   2. node scripts/migrate-turso.cjs --target=hospital      (creates the tables)
 *   3. node scripts/split-turso-data.cjs --target=hospital   (dry run: counts only)
 *   4. node scripts/split-turso-data.cjs --target=hospital --apply
 *
 * Only after step 4 should the web build use the new variables: until they are
 * set, Hospital and Clinic keep using the platform database.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(fs.readFileSync(envPath, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};

const TARGET = ((process.argv.find((a) => a.startsWith('--target=')) ?? '').split('=')[1] || '').toLowerCase();
const APPLY = process.argv.includes('--apply');
const TYPES = { hospital: 'hospital', clinic: 'clinic' };
const KEYS = {
  platform: ['NEXT_PUBLIC_TURSO_DATABASE_URL', 'NEXT_PUBLIC_TURSO_AUTH_TOKEN'],
  hospital: ['NEXT_PUBLIC_TURSO_HOSPITAL_DATABASE_URL', 'NEXT_PUBLIC_TURSO_HOSPITAL_AUTH_TOKEN'],
  clinic: ['NEXT_PUBLIC_TURSO_CLINIC_DATABASE_URL', 'NEXT_PUBLIC_TURSO_CLINIC_AUTH_TOKEN'],
};
if (!TYPES[TARGET]) { console.error('Usage: node scripts/split-turso-data.cjs --target=hospital|clinic [--apply]'); process.exit(1); }

function conf(system) {
  const [u, t] = KEYS[system];
  const url = (env[u] ?? '').replace('libsql://', 'https://');
  const token = env[t] ?? '';
  if (!url || !token) { console.error(`Missing ${u} or ${t} in .env.local`); process.exit(1); }
  return { url, token };
}
const PLATFORM = conf('platform');
const DEST = conf(TARGET);
if (PLATFORM.url === DEST.url) { console.error('The target database is the same as the platform database; nothing to split.'); process.exit(1); }

// Never copied: sign-in data, the pharmacy mailbox, the sync queue and cursors.
const NEVER = new Set(['tenants', 'users', 'subscription_plans', 'pharmacy_rx_notifications', 'pharmacy_rx_items', 'sync_outbox', 'sync_meta', 'backups', '_sqlx_migrations']);
// Tables with no tenant_id column, and how to pick one tenant's rows. ? = tenant id.
const SCOPE = {
  clinic_rx_items: 'prescription_id IN (SELECT id FROM clinic_prescriptions WHERE tenant_id = ?)',
  clinic_pharmacy_link: 'clinic_tenant_id = ?',
  settings: "key LIKE ? OR key NOT LIKE '%::%'",
};

const enc = (v) => (v === null || v === undefined ? { type: 'null' } : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }) : { type: 'text', value: String(v) });

async function run(c, sql, args = []) {
  const res = await fetch(`${c.url}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args: args.map((a) => (a && typeof a === 'object' ? a : enc(a))) } }, { type: 'close' }] }),
  });
  const data = await res.json();
  const r = data.results?.[0];
  if (!r || r.type === 'error') throw new Error(`${r?.error?.message ?? JSON.stringify(data).slice(0, 200)}\n  SQL: ${sql.slice(0, 140)}`);
  const result = r.response.result;
  return { cols: result.cols.map((x) => x.name), rows: result.rows };
}
const val = (cell) => (cell && cell.type !== 'null' ? cell.value : null);
const q = (n) => `"${n.replace(/"/g, '""')}"`;
const columnsOf = async (c, table) => (await run(c, `PRAGMA table_info(${q(table)})`)).rows.map((row) => val(row[1]));

async function main() {
  console.log(`${APPLY ? 'COPYING' : 'DRY RUN (add --apply to copy)'}: ${TYPES[TARGET]} tenants, platform -> ${TARGET} database`);
  const tenants = (await run(PLATFORM, `SELECT id, name FROM tenants WHERE LOWER(business_type) = ? AND deleted_at IS NULL`, [TYPES[TARGET]])).rows.map((r) => ({ id: val(r[0]), name: val(r[1]) }));
  if (!tenants.length) { console.log('No tenants of this type; nothing to do.'); return; }

  const destTables = (await run(DEST, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).rows.map((r) => val(r[0]));
  if (!destTables.includes('hospital_patients') && !destTables.includes('clinic_patients')) { console.error(`The ${TARGET} database has no tables yet. Run: node scripts/migrate-turso.cjs --target=${TARGET}`); process.exit(1); }
  const srcTables = new Set((await run(PLATFORM, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).rows.map((r) => val(r[0])));

  let problems = 0;
  for (const t of tenants) {
    console.log(`\n${t.name} (${t.id})`);
    for (const table of destTables) {
      if (NEVER.has(table) || !srcTables.has(table)) continue;
      const srcCols = await columnsOf(PLATFORM, table);
      const where = SCOPE[table] ?? (srcCols.includes('tenant_id') ? 'tenant_id = ?' : null);
      if (!where) continue;
      const arg = table === 'settings' ? `${t.id}::%` : t.id;
      const dstCols = new Set(await columnsOf(DEST, table));
      const cols = srcCols.filter((c) => dstCols.has(c));
      const total = Number(val((await run(PLATFORM, `SELECT COUNT(*) FROM ${q(table)} WHERE ${where}`, [arg])).rows[0][0]));
      if (!total) continue;
      if (!APPLY) { console.log(`  ${table}: ${total} rows would be copied`); continue; }

      const sel = `SELECT ${cols.map(q).join(', ')} FROM ${q(table)} WHERE ${where}`;
      for (let offset = 0; offset < total; offset += 500) {
        const page = await run(PLATFORM, `${sel} LIMIT 500 OFFSET ${offset}`, [arg]);
        for (const row of page.rows) {
          await run(DEST, `INSERT OR IGNORE INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, row);
        }
      }
      const have = Number(val((await run(DEST, `SELECT COUNT(*) FROM ${q(table)} WHERE ${where}`, [arg])).rows[0][0]));
      const ok = have >= total;
      if (!ok) problems++;
      console.log(`  ${table}: ${have}/${total} ${ok ? 'ok' : 'SHORT'}`);
    }
  }
  console.log(problems ? `\n${problems} table(s) came out short. Run again; nothing was deleted anywhere.` : '\nDone.');
  process.exitCode = problems ? 1 : 0;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
