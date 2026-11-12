#!/usr/bin/env node
/**
 * Bundles MAVIN's approved pharmacy catalogue for Mavin Pharmacy Offline
 * (desktop-standalone/resources/catalogue.json): the shared products
 * (tenant_id NULL, catalog_group 'pharma' or none), shared units and the
 * shared categories. Read only on the database. No business's data.
 *
 *   node scripts/standalone/export-catalogue.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client/web");

const root = path.join(__dirname, "..", "..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const url = env.TURSO_DATABASE_URL || env.NEXT_PUBLIC_TURSO_DATABASE_URL;
const authToken = env.TURSO_AUTH_TOKEN || env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
if (!url || !authToken) { console.error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN missing in .env.local"); process.exit(1); }

/** The same selection the catalogue endpoint serves (src/server/standalone/catalogue.ts). */
const SELECT = {
  uoms: `SELECT * FROM uoms WHERE tenant_id IS NULL`,
  categories: `SELECT * FROM categories WHERE tenant_id IS NULL AND (catalog_group IS NULL OR catalog_group = 'pharma')`,
  sub_categories: `SELECT * FROM sub_categories WHERE tenant_id IS NULL AND (catalog_group IS NULL OR catalog_group = 'pharma')`,
  products: `SELECT * FROM products WHERE tenant_id IS NULL AND (catalog_group IS NULL OR catalog_group = 'pharma')`,
};

(async () => {
  const c = createClient({ url, authToken });
  const tx = await c.transaction("read");
  const rows = {};
  let maxUpdated = "";
  try {
    for (const [t, sql] of Object.entries(SELECT)) {
      const cols = (await tx.execute(`PRAGMA table_info(${t})`)).rows.map((r) => String(r.name));
      const q = sql.replace(/AND \(catalog_group[^)]*\)/, cols.includes("catalog_group") ? "$&" : "");
      const rs = await tx.execute(`${q} AND deleted_at IS NULL`);
      rows[t] = rs.rows.map((r) => Object.fromEntries(rs.columns.map((col, i) => [col, typeof r[i] === "bigint" ? Number(r[i]) : r[i]])));
      for (const r of rows[t]) if (String(r.updated_at ?? "") > maxUpdated) maxUpdated = String(r.updated_at);
    }
  } finally {
    tx.close();
  }
  const count = Object.values(rows).reduce((n, l) => n + l.length, 0);
  const bundle = { version: `${maxUpdated}|${count}`, cursor: maxUpdated || null, generatedAt: new Date().toISOString(), rows };
  const out = path.join(root, "desktop-standalone", "resources", "catalogue.json");
  fs.writeFileSync(out, JSON.stringify(bundle));
  console.log(`Catalogue: ${Object.entries(rows).map(([t, l]) => `${l.length} ${t}`).join(", ")}; version ${bundle.version}; ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
