/**
 * The schema the code expects, built from the migrations in
 * src-tauri/src/lib.rs (schema_sql, schema_sql_v2 ... schema_sql_vN), and the
 * comparison of a live database against it. Used by migrate-turso.cjs and
 * check-turso-schema.cjs. Read-only on any database it is given.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const RS = fs.readFileSync(path.join(__dirname, '..', '..', 'src-tauri', 'src', 'lib.rs'), 'utf8');

function schemaSql(n) {
  const name = n === 1 ? 'schema_sql' : `schema_sql_v${n}`;
  const m = new RegExp(`fn ${name}\\(\\)[^{]*\\{\\s*r#"([\\s\\S]*?)"#`).exec(RS);
  return m ? m[1] : null;
}

/** Highest schema_sql_vN in lib.rs: the version the code needs. */
function latestVersion() {
  let n = 1;
  while (schemaSql(n + 1) !== null) n++;
  return n;
}

/** Tables kept on each desktop only, never in the shared database (see lib.rs v26 / v28). */
const DEVICE_ONLY = new Set(['local_secrets', 'local_assets']);
const INTERNAL = (name) => /^(sqlite_|libsql_|_)/.test(name) || name === 'schema_migrations' || DEVICE_ONLY.has(name);

/** { tables: { name: { column: notnull } }, indexes: Set } of a node:sqlite database. */
function snapshot(db) {
  const tables = {};
  for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()) {
    if (INTERNAL(name)) continue;
    tables[name] = Object.fromEntries(db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => [c.name, Number(c.notnull)]));
  }
  const indexes = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL`).all().map((r) => r.name).filter((n) => !INTERNAL(n)));
  return { tables, indexes };
}

/** What each version adds: tables, columns, indexes, and columns whose NOT NULL changed (table rebuilds). */
function expectedByVersion(upTo = latestVersion()) {
  const db = new DatabaseSync(':memory:');
  const versions = [];
  let prev = { tables: {}, indexes: new Set() };
  for (let v = 1; v <= upTo; v++) {
    db.exec(schemaSql(v));
    const cur = snapshot(db);
    const adds = { version: v, tables: [], columns: [], indexes: [], nullability: [] };
    for (const [t, cols] of Object.entries(cur.tables)) {
      if (!prev.tables[t]) { adds.tables.push(t); continue; }
      for (const [c, notnull] of Object.entries(cols)) {
        if (!(c in prev.tables[t])) adds.columns.push(`${t}.${c}`);
        else if (prev.tables[t][c] !== notnull) adds.nullability.push({ column: `${t}.${c}`, notnull });
      }
    }
    for (const i of cur.indexes) if (!prev.indexes.has(i)) adds.indexes.push(i);
    versions.push(adds);
    prev = cur;
  }
  db.close();
  // An index created again by a later version (IF NOT EXISTS) belongs to the
  // last version that creates it: that version is the one that adds it to a
  // database which never had it.
  for (const idx of prev.indexes) {
    let last = null;
    for (let v = 1; v <= upTo; v++) if (new RegExp(`INDEX\\s+(IF NOT EXISTS\\s+)?"?${idx}"?\\s+ON`, "i").test(schemaSql(v))) last = v;
    if (!last) continue;
    for (const adds of versions) {
      const i = adds.indexes.indexOf(idx);
      if (i >= 0 && adds.version !== last) adds.indexes.splice(i, 1);
      if (adds.version === last && !adds.indexes.includes(idx)) adds.indexes.push(idx);
    }
  }
  return { versions, final: prev };
}

/** Live schema through an `exec(sql) -> rows` function (Turso HTTP or node:sqlite). */
async function liveSnapshot(query) {
  const rows = await query(
    `SELECT m.name AS t, p.name AS c, p."notnull" AS nn FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`
  );
  const tables = {};
  for (const r of rows) {
    if (INTERNAL(r.t)) continue;
    (tables[r.t] ??= {})[r.c] = Number(r.nn);
  }
  const idx = await query(`SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL`);
  return { tables, indexes: new Set(idx.map((r) => r.name).filter((n) => !INTERNAL(n))) };
}

/** What a version added (and the final schema still has) that the live schema lacks. */
function missingFor(adds, live, final) {
  const missing = [];
  for (const t of adds.tables) if (final.tables[t] && !live.tables[t]) missing.push(`table ${t}`);
  for (const tc of adds.columns) {
    const [t, c] = tc.split('.');
    if (!final.tables[t] || !(c in final.tables[t])) continue; // removed by a later version
    if (!live.tables[t] || !(c in live.tables[t])) missing.push(`column ${tc}`);
  }
  for (const i of adds.indexes) if (final.indexes.has(i) && !live.indexes.has(i)) missing.push(`index ${i}`);
  for (const { column, notnull } of adds.nullability) {
    const [t, c] = column.split('.');
    if (live.tables[t] && c in live.tables[t] && live.tables[t][c] !== notnull) missing.push(`${column} should be ${notnull ? 'NOT NULL' : 'nullable'}`);
  }
  return missing;
}

/** Full report: per version what is missing, the highest version fully present, and objects the code does not know. */
function compare(expected, live) {
  const perVersion = expected.versions.map((adds) => ({ version: adds.version, missing: missingFor(adds, live, expected.final) }));
  let presentUpTo = 0;
  for (const v of perVersion) {
    if (v.missing.length) break;
    presentUpTo = v.version;
  }
  const extraTables = Object.keys(live.tables).filter((t) => !expected.final.tables[t]);
  return { perVersion, presentUpTo, incomplete: perVersion.filter((v) => v.missing.length), extraTables };
}

module.exports = { schemaSql, latestVersion, expectedByVersion, liveSnapshot, compare, missingFor };
