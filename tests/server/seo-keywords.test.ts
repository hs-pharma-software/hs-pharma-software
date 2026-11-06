/** SEO Manager, phase 4: keyword research with a fake Google suggest (no
 * network). Relevance, intent, page matching and scores are explainable; no
 * volume is ever invented; owner choices (manual, ignored) survive runs;
 * Search Console opportunities become one proposal each; business data untouched. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { JobContext } from "@/server/seo/engine";
import { setSetting } from "@/server/seo/engine";
import { AUTOCOMPLETE_SETTING, SEEDS, classifyIntent, relevant, runKeywordResearch, score, targetFor, type Suggest } from "@/server/seo/keywords";
import { addKeyword, listKeywords, setKeywordIgnored } from "@/server/seo/admin";
import type { Sql } from "@/server/subSupers";

const SITE = "https://www.example-site.pk";
const NOW = new Date("2026-11-06T01:00:00.000Z");
let db: DatabaseSync;
let sql: Sql;
let ctx: JobContext;
const all = (q: string, ...a: unknown[]) => db.prepare(q).all(...(a as never[])) as Record<string, unknown>[];
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  ctx = { sql, now: NOW, log: async () => {} };
});

const suggest = (calls: string[] = []): Suggest => async (q) => {
  calls.push(q);
  if (q === "pharmacy pos pakistan") return ["pharmacy pos software in lahore", "pharmacy jobs in lahore", "pharmacy near me", "Pharmacy POS price Pakistan"];
  if (q === "fbr digital invoicing") return ["fbr digital invoicing rules", "fbr digital invoicing software free download"];
  return [];
};

const gscQuery = (query: string, days: number, impressions: number, clicks: number, position: number) => {
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(2026, 10, 4) - i * 86_400_000).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO seo_metrics_daily (id, day, page, query, clicks, impressions, ctr, position, source, fetched_at) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, 'gsc_query', ?)`)
      .run(randomUUID(), day, query, clicks, impressions, position, NOW.toISOString());
  }
};

test("relevance, intent and page matching", () => {
  assert.ok(relevant("pharmacy pos software in lahore"));
  assert.ok(!relevant("pharmacy jobs in lahore"), "jobs are off topic");
  assert.ok(!relevant("pharmacy near me"), "not about software");
  assert.ok(!relevant("best biryani in karachi"), "not our products");
  assert.equal(classifyIntent("pharmacy pos price pakistan"), "transactional");
  assert.equal(classifyIntent("best pharmacy software"), "commercial");
  assert.equal(classifyIntent("what is fbr digital invoicing"), "informational");
  assert.equal(classifyIntent("mavin pos login"), "navigational");
  assert.equal(targetFor("medical store software")?.path, "/products/medical-store-pos");
  assert.equal(targetFor("hospital pharmacy system")?.path, "/products/hospital-pharmacy");
  assert.equal(targetFor("pharmacy pos with fbr integration")?.path, "/integrations/fbr-digital-invoicing");
  assert.equal(targetFor("kiryana store software")?.path, "/products/general-store-pos");
  const s = score("pharmacy pos price pakistan", "transactional", targetFor("pharmacy pos price pakistan"), { sources: ["autocomplete"] });
  assert.equal(s.priority, 40 + 25 + 10 + 10);
  assert.equal(s.why.length, 4);
});

test("research: seeds and relevant suggestions are stored with sources; volume is never invented", async () => {
  const calls: string[] = [];
  const r = await runKeywordResearch(ctx, { suggest: suggest(calls), siteUrl: SITE, pause: 0 });
  assert.equal(calls.length, 19, "only the focus seeds are expanded");
  assert.equal(r.added, r.candidates);
  const kw = new Map(all(`SELECT * FROM seo_keywords`).map((x) => [String(x.keyword), x]));
  for (const s of SEEDS) assert.ok(kw.has(s), s);
  assert.ok(kw.has("pharmacy pos software in lahore"));
  assert.ok(kw.has("pharmacy pos price pakistan"), "normalised to lower case");
  assert.ok(!kw.has("pharmacy jobs in lahore") && !kw.has("pharmacy near me"));
  assert.equal(kw.get("fbr digital invoicing software free download")?.intent, "transactional");
  assert.equal(kw.get("fbr digital invoicing rules")?.intent, "informational", "FBR topics count even without a software word");
  const price = kw.get("pharmacy pos price pakistan")!;
  assert.equal(price.intent, "transactional");
  assert.equal(price.product, "/products/retail-pharmacy-pos");
  assert.deepEqual(JSON.parse(String(price.notes)).sources, ["autocomplete"]);
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_keywords WHERE search_volume IS NOT NULL OR volume_source IS NOT NULL OR competition IS NOT NULL`).n, 0);

  const again = await runKeywordResearch(ctx, { suggest: suggest(), siteUrl: SITE, pause: 0 });
  assert.equal(again.added, 0);
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_keywords`).n, r.candidates);
});

test("autocomplete can be switched off; failures stop after three and the run still succeeds", async () => {
  await setSetting(sql, AUTOCOMPLETE_SETTING, "off", "admin:1");
  const calls: string[] = [];
  const off = await runKeywordResearch(ctx, { suggest: suggest(calls), siteUrl: SITE, pause: 0 });
  assert.equal(calls.length, 0);
  assert.equal(off.autocomplete, "off");
  await setSetting(sql, AUTOCOMPLETE_SETTING, "on", "admin:1");
  let n = 0;
  const failing = await runKeywordResearch(ctx, { suggest: async () => { n++; throw new Error("429"); }, siteUrl: SITE, pause: 0 });
  assert.equal(n, 3);
  assert.deepEqual(failing.autocomplete, { suggestions: 0, errors: 3 });
});

test("Search Console queries: real numbers, striking-distance and low-CTR proposals, once each", async () => {
  gscQuery("pharmacy software lahore", 28, 5, 0, 8.4);
  gscQuery("pos software pakistan", 28, 10, 0, 2.1);
  await runKeywordResearch(ctx, { suggest: async () => [], siteUrl: SITE, pause: 0 });
  const k = one(`SELECT * FROM seo_keywords WHERE keyword = 'pharmacy software lahore'`);
  const ev = JSON.parse(String(k.notes));
  assert.deepEqual(ev.sources, ["search_console"]);
  assert.equal(ev.gsc.impressions, 140);
  assert.equal(Math.round(ev.gsc.position * 10) / 10, 8.4);
  const recs = all(`SELECT kind, url, impact FROM seo_recommendations ORDER BY kind`);
  assert.deepEqual(recs.map((r) => r.kind), ["keyword_low_ctr", "keyword_striking"]);
  assert.equal(recs.find((r) => r.kind === "keyword_striking")!.url, `${SITE}/products/retail-pharmacy-pos`);
  await runKeywordResearch(ctx, { suggest: async () => [], siteUrl: SITE, pause: 0 });
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_recommendations`).n, 2, "no duplicates");
});

test("owner choices survive research: manual keywords stay, ignored ones are not brought back", async () => {
  await addKeyword(sql, "admin:1", "  Pharmacy Software Multan ", "");
  await assert.rejects(addKeyword(sql, "admin:1", "pharmacy software multan", ""), /already/);
  await assert.rejects(addKeyword(sql, "admin:1", "x", ""), /3 to 80/);
  await assert.rejects(addKeyword(sql, "admin:1", "abc def", "/nowhere"), /Unknown page/);
  await runKeywordResearch(ctx, { suggest: suggest(), siteUrl: SITE, pause: 0 });
  const list = await listKeywords(sql);
  const manual = list.keywords.find((k) => k.keyword === "pharmacy software multan")!;
  assert.ok(manual.manual);
  assert.equal(manual.target, "/products/retail-pharmacy-pos");
  assert.ok(manual.sources.includes("manual"));
  assert.equal(manual.volume, null);

  const seed = list.keywords.find((k) => k.keyword === "pos system pakistan")!;
  await setKeywordIgnored(sql, "admin:1", seed.id, true);
  await runKeywordResearch(ctx, { suggest: suggest(), siteUrl: SITE, pause: 0 });
  const after = (await listKeywords(sql)).keywords.find((k) => k.id === seed.id)!;
  assert.ok(after.ignored);
  assert.equal(after.priority, -1);
  await setKeywordIgnored(sql, "admin:1", seed.id, false);
  await runKeywordResearch(ctx, { suggest: suggest(), siteUrl: SITE, pause: 0 });
  assert.ok((await listKeywords(sql)).keywords.find((k) => k.id === seed.id)!.priority > 0);
});

test("research never touches business data", async () => {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'seo_%' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((t) => t.name);
  const snapshot = () => tables.map((t) => `${t}:${(db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n}`).join(",");
  const before = snapshot();
  gscQuery("pharmacy software lahore", 3, 50, 1, 6);
  await runKeywordResearch(ctx, { suggest: suggest(), siteUrl: SITE, pause: 0 });
  assert.equal(snapshot(), before);
});
