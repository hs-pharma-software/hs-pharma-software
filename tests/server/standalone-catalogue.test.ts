/** The catalogue endpoint for Mavin Pharmacy Offline (src/server/standalone/catalogue.ts),
 * consumed by the desktop's real catalogue code (desktop-standalone/src/core/catalogue.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { cataloguePage, catalogueVersion, PAGE } from "@/server/standalone/catalogue";
import { LocalDb } from "../../desktop-standalone/src/core/localdb.ts";
import { Catalogue } from "../../desktop-standalone/src/core/catalogue.ts";

const ts = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 1000).toISOString();

function server() {
  const db = fullSchemaDb();
  const ins = db.prepare(`INSERT INTO products (id, name, tenant_id, catalog_group, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  db.exec("BEGIN");
  for (let i = 0; i < PAGE + 150; i++) ins.run(`p${i}`, `Med ${i}`, null, "pharma", ts(0), ts(i % 3 === 0 ? i : i + 1), null);
  ins.run("gs1", "Soap", null, "general_store", ts(0), ts(5), null);
  ins.run("own1", "Business secret product", "t1", null, ts(0), ts(5), null);
  db.prepare(`INSERT INTO uoms (id, name, tenant_id, created_at, updated_at) VALUES ('u1', 'Tablet', NULL, ?, ?)`).run(ts(0), ts(2));
  db.prepare(`INSERT INTO uoms (id, name, tenant_id, created_at, updated_at) VALUES ('u2', 'Mine', 't1', ?, ?)`).run(ts(0), ts(2));
  db.exec("COMMIT");
  return { db, sql: sqliteSql(db) };
}

test("only MAVIN's shared pharmacy catalogue is served; pages lose nothing; unchanged version sends nothing", async () => {
  const { sql } = server();
  const seen = new Map<string, Record<string, unknown>>();
  let since: string | null = null;
  let pages = 0;
  for (;;) {
    const p = await cataloguePage(sql, { since });
    pages++;
    for (const list of Object.values(p.rows)) for (const r of list ?? []) seen.set(String(r.id), r);
    since = p.cursor;
    if (!p.more) break;
    assert.ok(pages < 10);
  }
  assert.ok(pages >= 2, "more than one page");
  assert.equal([...seen.keys()].filter((k) => k.startsWith("p")).length, PAGE + 150, "every product exactly once (by id)");
  assert.ok(seen.has("u1"));
  for (const k of ["gs1", "own1", "u2"]) assert.ok(!seen.has(k), `${k} must not be served`);
  const v = await catalogueVersion(sql);
  const again = await cataloguePage(sql, { since, version: v });
  assert.deepEqual([again.unchanged, Object.keys(again.rows).length], [true, 0]);
});

test("the desktop downloads the endpoint's pages into its catalogue (end to end, no network)", async () => {
  const { db: sdb, sql } = server();
  const dir = mkdtempSync(join(tmpdir(), "mavin-cat-"));
  const local = new LocalDb(join(dir, "pharmacy.db"), readFileSync(new URL("../../desktop/resources/schema.sql", import.meta.url), "utf8"));
  try {
    const source = "https://app.mavin.pk/api/catalogue/pharma/";
    let calls = 0;
    const cat = new Catalogue(local, source, async (url) => {
      calls++;
      const u = new URL(url);
      assert.equal(`${u.origin}${u.pathname}`, source);
      return JSON.parse(JSON.stringify(await cataloguePage(sql, { since: u.searchParams.get("since"), version: u.searchParams.get("version") })));
    });
    const s = await cat.sync(true);
    assert.equal(s.lastError, null);
    assert.equal(s.products, PAGE + 150);
    assert.equal((local.db.prepare(`SELECT COUNT(*) AS n FROM products WHERE id = 'own1'`).get() as { n: number }).n, 0);
    // A catalogue change upstream reaches the desktop; an unchanged catalogue is not downloaded again.
    sdb.prepare(`UPDATE products SET name = 'Med 7 new', updated_at = ? WHERE id = 'p7'`).run(ts(99999));
    const before = calls;
    await cat.sync(true);
    assert.equal((local.db.prepare(`SELECT name FROM products WHERE id = 'p7'`).get() as { name: string }).name, "Med 7 new");
    const mid = calls;
    await cat.sync(true);
    assert.equal(calls - mid, 1, "one call answered 'unchanged'");
    assert.ok(mid - before >= 1);
  } finally {
    local.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
