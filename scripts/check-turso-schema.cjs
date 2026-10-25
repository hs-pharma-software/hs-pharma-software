/**
 * check-turso-schema.cjs  (read-only)
 *
 * Compares the Turso database (or a SQLite file) with the schema the code
 * expects (the migrations in src-tauri/src/lib.rs) and reports, per migration
 * version, every missing table, column, index or NOT NULL difference, plus the
 * recorded migration history.
 *
 *   node scripts/check-turso-schema.cjs                 the Turso database in .env.local
 *   node scripts/check-turso-schema.cjs --file=backup.db  a SQLite file (e.g. a backup)
 *
 * Exit code 0 = up to date, 3 = migrations missing, 1 = could not check.
 * Prints the database host only, never credentials.
 */
const path = require('path');
const { expectedByVersion, liveSnapshot, compare, latestVersion } = require('./lib/turso-schema.cjs');
const { tursoQuery, tursoHost } = require('./lib/turso-http.cjs');

(async () => {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  let query;
  let target;
  if (fileArg) {
    const { DatabaseSync } = require('node:sqlite');
    const file = path.resolve(fileArg.slice('--file='.length));
    const db = new DatabaseSync(file, { readOnly: true });
    query = async (sql) => db.prepare(sql).all();
    target = `file ${file}`;
  } else {
    query = tursoQuery;
    target = `Turso ${tursoHost()}`;
  }

  const expected = expectedByVersion();
  const live = await liveSnapshot(query);
  const report = compare(expected, live);
  let history = [];
  try {
    history = await query(`SELECT version, source, applied_at FROM schema_migrations ORDER BY version`);
  } catch {
    history = null;
  }

  const latest = latestVersion();
  console.log(`Target: ${target}`);
  console.log(`Code needs schema v${latest}. Schema present up to v${report.presentUpTo}.`);
  console.log(history === null
    ? 'Migration history: none recorded yet (schema_migrations does not exist; migrate-turso.cjs creates it).'
    : `Migration history: ${history.length} versions recorded, latest v${history.at(-1)?.version ?? '—'}.`);
  if (report.incomplete.length) {
    console.log('\nMissing:');
    for (const v of report.incomplete) console.log(`  v${v.version}: ${v.missing.join(', ')}`);
    const from = report.incomplete[0].version;
    console.log(`\nTo fix (after a backup: node scripts/backup-turso-snapshot.cjs):\n  node scripts/migrate-turso.cjs --from=${from}`);
  } else {
    console.log('Every table, column and index the code needs is present.');
  }
  if (report.extraTables.length) console.log(`\nTables in the database the migrations do not define (left untouched): ${report.extraTables.join(', ')}`);
  process.exit(report.incomplete.length ? 3 : 0);
})().catch((e) => {
  console.error(`Could not check the schema: ${e.message}`);
  process.exit(1);
});
