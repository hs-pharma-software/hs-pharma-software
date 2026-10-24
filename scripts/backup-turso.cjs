/**
 * backup-turso.cjs  (read-only on the database)
 *
 * Full logical backup of the Turso database: the schema (every CREATE statement)
 * and every row of every table, written to backups/turso-<timestamp>/ as
 * schema.sql + one <table>.json file per table. backups/ is git-ignored: it holds
 * patient and sales data.
 *
 *   node scripts/backup-turso.cjs
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(fs.readFileSync(envPath, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};
const url = (env.NEXT_PUBLIC_TURSO_DATABASE_URL ?? '').replace('libsql://', 'https://');
const token = env.NEXT_PUBLIC_TURSO_AUTH_TOKEN ?? '';
if (!url || !token) { console.error('Missing NEXT_PUBLIC_TURSO_DATABASE_URL or NEXT_PUBLIC_TURSO_AUTH_TOKEN in .env.local'); process.exit(1); }

async function run(sql, args = []) {
  const res = await fetch(`${url}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args } }, { type: 'close' }] }),
  });
  const data = await res.json();
  const r = data.results?.[0];
  if (!r || r.type === 'error') throw new Error(r?.error?.message ?? 'request failed');
  return r.response.result;
}
const plain = (c) => (c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.value);

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '..', 'backups', `turso-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const schema = await run(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type = 'table' DESC, name`);
  fs.writeFileSync(path.join(dir, 'schema.sql'), schema.rows.map((r) => `${plain(r[2])};`).join('\n\n') + '\n');

  const tables = schema.rows.filter((r) => plain(r[0]) === 'table').map((r) => plain(r[1])).filter((t) => !t.startsWith('sqlite_') && !t.startsWith('_'));
  const summary = {};
  for (const t of tables) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await run(`SELECT * FROM "${t}" LIMIT 1000 OFFSET ${offset}`);
      const cols = page.cols.map((c) => c.name);
      for (const row of page.rows) rows.push(Object.fromEntries(cols.map((c, i) => [c, plain(row[i])])));
      if (page.rows.length < 1000) break;
    }
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows));
    summary[t] = rows.length;
  }
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ taken_at: new Date().toISOString(), host: new URL(url).host, tables: summary }, null, 2));
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  console.log(`Backed up ${tables.length} tables, ${total} rows, to ${path.relative(path.join(__dirname, '..'), dir)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
