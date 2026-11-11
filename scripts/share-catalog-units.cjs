/**
 * Shared catalogue products (tenant_id NULL) whose pack or loose unit is a
 * business's private unit: every other business sees the unit empty and has
 * to enter it again. This points those products at the shared unit with the
 * same name (the oldest one), creating a shared unit where none exists.
 *
 * Changes only products.base_unit_id / secondary_unit_id of SHARED products
 * (and adds shared units). Business units, business products, purchases and
 * invoices are not touched. One transaction: all or nothing.
 *
 *   node scripts/share-catalog-units.cjs                 dry run on the live database (default)
 *   node scripts/share-catalog-units.cjs --apply         apply on the live database (back up first)
 *   node scripts/share-catalog-units.cjs --db=<file>     dry run on a local SQLite copy
 *   node scripts/share-catalog-units.cjs --db=<file> --apply   rehearse on the copy
 */
const { randomUUID } = require('crypto');

const APPLY = process.argv.includes('--apply');
const DB_FILE = (process.argv.find((a) => a.startsWith('--db=')) ?? '').slice(5) || null;

async function target() {
  if (DB_FILE) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB_FILE);
    return {
      where: `local copy ${DB_FILE}`,
      query: async (sql, args = []) => db.prepare(sql).all(...args),
      transaction: async (stmts) => {
        db.exec('BEGIN');
        try { const n = stmts.map((s) => Number(db.prepare(s.sql).run(...s.args).changes)); db.exec('COMMIT'); return n; } catch (e) { db.exec('ROLLBACK'); throw e; }
      },
    };
  }
  const { tursoQuery, tursoTransaction, tursoHost } = require('./lib/turso-http.cjs');
  return { where: `Turso ${tursoHost()}`, query: tursoQuery, transaction: tursoTransaction };
}

(async () => {
  const t = await target();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} on ${t.where}`);
  const key = (n) => String(n).trim().toUpperCase();

  // Business units used by shared products (pack or loose unit).
  const used = await t.query(
    `SELECT u.id, u.name, u.description, u.tenant_id, tn.name AS owner,
            SUM(CASE WHEN p.base_unit_id = u.id THEN 1 ELSE 0 END) AS as_base,
            SUM(CASE WHEN p.secondary_unit_id = u.id THEN 1 ELSE 0 END) AS as_secondary
     FROM products p JOIN uoms u ON u.id IN (p.base_unit_id, p.secondary_unit_id)
     LEFT JOIN tenants tn ON tn.id = u.tenant_id
     WHERE p.tenant_id IS NULL AND p.deleted_at IS NULL AND u.tenant_id IS NOT NULL
     GROUP BY u.id ORDER BY u.name`,
  );
  if (!used.length) { console.log('Nothing to do: every shared product already uses shared units.'); return; }

  const shared = new Map();
  for (const s of await t.query(`SELECT id, name FROM uoms WHERE tenant_id IS NULL AND deleted_at IS NULL ORDER BY created_at, id`)) {
    if (!shared.has(key(s.name))) shared.set(key(s.name), s.id);
  }
  const now = new Date().toISOString();
  const stmts = [];
  const created = [];
  const newIds = new Set();
  for (const u of used) {
    let to = shared.get(key(u.name));
    if (!to) {
      to = randomUUID();
      shared.set(key(u.name), to);
      created.push(u.name.trim());
      newIds.add(to);
      stmts.push({ sql: `INSERT INTO uoms (id, name, description, tenant_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, ?, NULL)`, args: [to, u.name.trim(), u.description ?? null, now, now] });
    }
    u.to = to;
    stmts.push({ sql: `UPDATE products SET base_unit_id = ?, updated_at = ? WHERE tenant_id IS NULL AND base_unit_id = ?`, args: [to, now, u.id] });
    stmts.push({ sql: `UPDATE products SET secondary_unit_id = ?, updated_at = ? WHERE tenant_id IS NULL AND secondary_unit_id = ?`, args: [to, now, u.id] });
  }

  console.log('\nUnit (owner)                         pack  loose  -> shared unit');
  for (const u of used) console.log(`${`${u.name} (${u.owner ?? u.tenant_id})`.padEnd(36).slice(0, 36)} ${String(u.as_base).padStart(5)} ${String(u.as_secondary).padStart(6)}  -> ${newIds.has(u.to) ? 'new shared' : 'existing shared'} "${u.name.trim()}"`);
  const totalBase = used.reduce((s, u) => s + Number(u.as_base), 0);
  const totalSec = used.reduce((s, u) => s + Number(u.as_secondary), 0);
  console.log(`\n${used.length} business units; ${totalBase} pack-unit and ${totalSec} loose-unit links on shared products; ${created.length} shared units to create (${created.join(', ') || 'none'}).`);

  if (!APPLY) { console.log('\nDry run: nothing changed. Add --apply to make these changes.'); return; }
  const n = await t.transaction(stmts);
  console.log(`\nApplied in one transaction (${n.length} statements, ${n.reduce((a, b) => a + b, 0)} rows).`);
  const left = await t.query(`SELECT COUNT(*) AS n FROM products p JOIN uoms u ON u.id IN (p.base_unit_id, p.secondary_unit_id) WHERE p.tenant_id IS NULL AND p.deleted_at IS NULL AND u.tenant_id IS NOT NULL`);
  console.log(`Check: shared products still using a business unit: ${left[0].n}`);
  if (Number(left[0].n) !== 0) process.exitCode = 1;
})().catch((e) => { console.error(e.message); process.exit(1); });
