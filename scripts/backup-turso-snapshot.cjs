/**
 * backup-turso-snapshot.cjs  (read-only on the database)
 *
 * Consistent backup of the remote Turso database: every table, index, view and
 * trigger, read inside ONE read transaction (a single point in time), written as
 *   backups/turso-snapshot-<stamp>/database.db   a standalone SQLite file
 *   backups/turso-snapshot-<stamp>/dump.sql      the same as SQL statements
 *   backups/turso-snapshot-<stamp>/manifest.json row counts, sizes, SHA-256
 * and then verified: integrity check, every table's row count equal to the
 * count read from Turso in the same transaction, and the dump re-applied to a
 * scratch database with the same counts. backups/ is git-ignored.
 *
 *   node scripts/backup-turso-snapshot.cjs
 *
 * Credentials come from .env.local and are never printed or written to the backup.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@libsql/client/web');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};
const url = env.NEXT_PUBLIC_TURSO_DATABASE_URL;
const authToken = env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('NEXT_PUBLIC_TURSO_DATABASE_URL / NEXT_PUBLIC_TURSO_AUTH_TOKEN missing in .env.local');
  process.exit(1);
}

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `X'${Buffer.from(v instanceof ArrayBuffer ? v : v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
const toSqliteValue = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  const client = createClient({ url, authToken, intMode: 'bigint' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(root, 'backups', `turso-snapshot-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'database.db');
  const dumpFile = path.join(dir, 'dump.sql');

  const out = new DatabaseSync(dbFile);
  out.exec('PRAGMA foreign_keys = OFF; PRAGMA journal_mode = DELETE;');
  const dump = fs.openSync(dumpFile, 'w');
  fs.writeSync(dump, `-- Turso snapshot ${stamp}\nPRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n`);

  const liveCounts = {};
  const tx = await client.transaction('read');
  try {
    const master = await tx.execute(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%'`);
    const objects = master.rows.map((r) => ({ type: String(r.type), name: String(r.name), sql: String(r.sql) }));
    const tables = objects.filter((o) => o.type === 'table');
    const later = objects.filter((o) => o.type !== 'table'); // indexes, views, triggers after the data

    for (const t of tables) {
      out.exec(t.sql);
      fs.writeSync(dump, `${t.sql};\n`);
      liveCounts[t.name] = Number((await tx.execute(`SELECT COUNT(*) AS n FROM ${q(t.name)}`)).rows[0].n);
      let copied = 0;
      for (let offset = 0; ; offset += 500) {
        const page = await tx.execute(`SELECT * FROM ${q(t.name)} LIMIT 500 OFFSET ${offset}`);
        if (!page.rows.length) break;
        const cols = page.columns;
        const insert = out.prepare(`INSERT INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
        out.exec('BEGIN');
        for (const row of page.rows) {
          const values = cols.map((_, i) => row[i]);
          insert.run(...values.map(toSqliteValue));
          fs.writeSync(dump, `INSERT INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES (${values.map(sqlLiteral).join(', ')});\n`);
        }
        out.exec('COMMIT');
        copied += page.rows.length;
        if (page.rows.length < 500) break;
      }
      if (copied !== liveCounts[t.name]) throw new Error(`${t.name}: read ${copied} rows, Turso reports ${liveCounts[t.name]}`);
    }
    for (const o of later) {
      out.exec(o.sql);
      fs.writeSync(dump, `${o.sql};\n`);
    }
  } finally {
    await tx.close(); // read-only: nothing to commit
    client.close();
  }
  fs.writeSync(dump, 'COMMIT;\n');
  fs.closeSync(dump);

  // ── Verify ──
  const problems = [];
  const integrity = out.prepare('PRAGMA integrity_check').get();
  if (Object.values(integrity)[0] !== 'ok') problems.push(`integrity_check: ${JSON.stringify(integrity)}`);
  for (const [t, n] of Object.entries(liveCounts)) {
    const got = Number(out.prepare(`SELECT COUNT(*) AS n FROM ${q(t)}`).get().n);
    if (got !== n) problems.push(`database.db ${t}: ${got} rows, Turso ${n}`);
  }
  const objectCount = Number(out.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'`).get().n);
  out.close();

  const replay = new DatabaseSync(':memory:');
  replay.exec(fs.readFileSync(dumpFile, 'utf8'));
  for (const [t, n] of Object.entries(liveCounts)) {
    const got = Number(replay.prepare(`SELECT COUNT(*) AS n FROM ${q(t)}`).get().n);
    if (got !== n) problems.push(`dump.sql ${t}: ${got} rows, Turso ${n}`);
  }
  replay.close();

  const totalRows = Object.values(liveCounts).reduce((a, b) => a + b, 0);
  const manifest = {
    taken_at: new Date().toISOString(),
    source_host: new URL(url.replace('libsql://', 'https://')).host,
    consistency: 'single read transaction',
    tables: Object.keys(liveCounts).length,
    schema_objects: objectCount,
    total_rows: totalRows,
    row_counts: liveCounts,
    files: {
      'database.db': { bytes: fs.statSync(dbFile).size, sha256: sha256(dbFile) },
      'dump.sql': { bytes: fs.statSync(dumpFile).size, sha256: sha256(dumpFile) },
    },
    verified: problems.length === 0,
    problems,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`Backup: ${path.relative(root, dir)}`);
  console.log(`  ${manifest.tables} tables, ${objectCount} schema objects, ${totalRows} rows`);
  console.log(`  database.db ${manifest.files['database.db'].bytes} bytes, dump.sql ${manifest.files['dump.sql'].bytes} bytes`);
  if (problems.length) {
    console.error('VERIFICATION FAILED:\n  ' + problems.join('\n  '));
    process.exit(2);
  }
  console.log('  Verified: integrity ok, row counts match Turso in both files.');
})().catch((e) => {
  console.error(`Backup failed: ${e.message}`);
  process.exit(1);
});
