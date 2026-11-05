/** SEO Manager, phase 3: Search Console and GA4 imports through a fake Google
 * (no network) with a throwaway key. Sign-in is a valid RS256 assertion,
 * imports are idempotent, a missing setup is "skipped" (not failed), index
 * problems become findings, the dashboard adds up, and business data is untouched. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { runJob, type JobContext, type JobDef } from "@/server/seo/engine";
import { SCOPES, clearTokens, parseServiceAccount, signedAssertion, type Http } from "@/server/seo/google";
import { inspectionFindings, runGscSync, toMetricRows } from "@/server/seo/gsc";
import { runGa4Sync, toChannelRows } from "@/server/seo/ga4";
import { searchDashboard } from "@/server/seo/admin";
import type { Sql } from "@/server/subSupers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({ type: "service_account", client_email: "seo-test@example.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
const SITE = "https://www.example-site.pk/";
const NOW = new Date("2026-11-06T01:00:00.000Z");

let db: DatabaseSync;
let sql: Sql;
let ctx: JobContext;
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  ctx = { sql, now: NOW, log: async () => {} };
  clearTokens();
});

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10));
  return out;
};

/** A fake Google: token endpoint, Search Analytics, URL Inspection, GA4. Records calls. */
function fakeGoogle(o: { verdicts?: Record<string, string>; inspectFails?: string[] } = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const http: Http = async (url, init) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      const p = new URLSearchParams(init.body);
      return { status: 200, json: { access_token: `tok-${p.get("assertion")!.length}`, expires_in: 3600 } };
    }
    const body = JSON.parse(init.body ?? "{}");
    calls.push({ url, body });
    assert.match(init.headers?.Authorization ?? "", /^Bearer tok-/);
    if (url.includes("searchAnalytics/query")) {
      const ds = days(body.startDate, body.endDate);
      const dims = body.dimensions as string[];
      if (body.startRow > 0) return { status: 200, json: {} };
      const rows = ds.flatMap((d, i) => dims.length === 1
        ? [{ keys: [d], clicks: i % 5, impressions: 100 + i, ctr: (i % 5) / (100 + i), position: 12 }]
        : dims[1] === "page"
          ? [{ keys: [d, `${SITE}products`], clicks: 1, impressions: 40, ctr: 0.025, position: 9 }, { keys: [d, SITE], clicks: 2, impressions: 50, ctr: 0.04, position: 7 }]
          : [{ keys: [d, "pharmacy pos pakistan"], clicks: 1, impressions: 30, ctr: 0.033, position: 8 }]);
      return { status: 200, json: { rows } };
    }
    if (url.includes("urlInspection")) {
      const u = body.inspectionUrl as string;
      if (o.inspectFails?.includes(u)) return { status: 429, json: { error: { message: "Quota exceeded" } } };
      const verdict = o.verdicts?.[u] ?? "PASS";
      return { status: 200, json: { inspectionResult: { indexStatusResult: { verdict, coverageState: verdict === "PASS" ? "Submitted and indexed" : "Discovered - currently not indexed", googleCanonical: u, userCanonical: u } } } };
    }
    if (url.includes("analyticsdata.googleapis.com")) {
      const ds = days(body.dateRanges[0].startDate, body.dateRanges[0].endDate);
      return {
        status: 200,
        json: { rows: ds.flatMap((d) => [
          { dimensionValues: [{ value: d.replace(/-/g, "") }, { value: "Organic Search" }], metricValues: [{ value: "10" }, { value: "6" }, { value: "1" }] },
          { dimensionValues: [{ value: d.replace(/-/g, "") }, { value: "Direct" }], metricValues: [{ value: "4" }, { value: "2" }, { value: "0" }] },
        ]) },
      };
    }
    return { status: 404, json: {} };
  };
  return { http, calls };
}

test("the service account signs a valid RS256 assertion for the read-only scope; bad keys fail plainly", () => {
  const sa = parseServiceAccount(Buffer.from(KEY_JSON).toString("base64"));
  const jwt = signedAssertion(sa, SCOPES.searchConsole, NOW.getTime());
  const [h, b, sig] = jwt.split(".");
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, "base64url")));
  const claims = JSON.parse(Buffer.from(b, "base64url").toString());
  assert.equal(claims.scope, "https://www.googleapis.com/auth/webmasters.readonly");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.throws(() => parseServiceAccount(""), /not set/);
  assert.throws(() => parseServiceAccount("{nope"), /not valid JSON/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ client_email: "x" })), (e: Error) => /missing/.test(e.message) && !e.message.includes("PRIVATE"));
});

test("Search Console: first import backfills 90 days, a re-run replaces days instead of adding them", async () => {
  const g = fakeGoogle();
  const r = await runGscSync(ctx, { siteUrl: SITE, published: false, inspectUrls: [`${SITE}`], http: g.http, serviceAccountJson: KEY_JSON });
  assert.equal(r.from, "2026-08-07");
  assert.equal(r.to, "2026-11-04");
  assert.equal(r.days, 90);
  assert.equal(r.pages, 180);
  assert.equal(r.indexing.checked, 0, "draft: no inspection");
  assert.ok(g.calls.every((c) => !c.url.includes("urlInspection")));
  assert.ok(g.calls[0].url.includes(encodeURIComponent(SITE)));
  const before = one(`SELECT COUNT(*) AS n, SUM(clicks) AS c FROM seo_metrics_daily`);

  const again = await runGscSync(ctx, { siteUrl: SITE, published: false, inspectUrls: [], http: g.http, serviceAccountJson: KEY_JSON });
  assert.equal(again.from, "2026-10-20", "later runs refresh 16 days");
  const after = one(`SELECT COUNT(*) AS n FROM seo_metrics_daily`);
  assert.equal(after.n, before.n);
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_metrics_daily WHERE source = 'gsc_total' AND day = '2026-11-01'`).n, 1);
});

test("index inspection (published site): problems become findings with a proposal; a failed check keeps old findings", async () => {
  const urls = [`${SITE}`, `${SITE}pricing`];
  let g = fakeGoogle({ verdicts: { [`${SITE}pricing`]: "NEUTRAL" } });
  const r = await runGscSync(ctx, { siteUrl: SITE, published: true, inspectUrls: urls, http: g.http, serviceAccountJson: KEY_JSON });
  assert.equal(r.indexing.indexed, 1);
  assert.equal(r.indexing.notIndexed, 1);
  const f = one(`SELECT * FROM seo_audit_findings WHERE check_id = 'index_not_indexed'`);
  assert.equal(f.url, `${SITE}pricing`);
  assert.equal(f.severity, "warning");
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_recommendations WHERE kind = 'index_not_indexed' AND status = 'proposed'`).n, 1);

  g = fakeGoogle({ inspectFails: [`${SITE}pricing`] });
  await runGscSync(ctx, { siteUrl: SITE, published: true, inspectUrls: urls, http: g.http, serviceAccountJson: KEY_JSON });
  assert.equal(one(`SELECT resolved_at FROM seo_audit_findings WHERE check_id = 'index_not_indexed'`).resolved_at, null, "not re-checked: still open");

  g = fakeGoogle();
  await runGscSync(ctx, { siteUrl: SITE, published: true, inspectUrls: urls, http: g.http, serviceAccountJson: KEY_JSON });
  assert.ok(one(`SELECT resolved_at FROM seo_audit_findings WHERE check_id = 'index_not_indexed'`).resolved_at, "indexed now: resolved");
  assert.deepEqual(inspectionFindings("u", { inspectionResult: { indexStatusResult: { verdict: "PASS", googleCanonical: "a", userCanonical: "b" } } }).map((x) => x.checkId), ["index_canonical_mismatch"]);
});

test("GA4: channels per day, organic totals, idempotent re-import", async () => {
  const g = fakeGoogle();
  const r = await runGa4Sync(ctx, { propertyId: "properties/123456", http: g.http, serviceAccountJson: KEY_JSON });
  assert.equal(r.to, "2026-11-05");
  assert.equal(r.rows, 180);
  assert.equal(r.organicSessions, 900);
  assert.ok(g.calls[0].url.endsWith("/properties/123456:runReport"));
  const n = one(`SELECT COUNT(*) AS n FROM seo_analytics_daily`).n;
  await runGa4Sync(ctx, { propertyId: "123456", http: g.http, serviceAccountJson: KEY_JSON });
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_analytics_daily`).n, n);
  await assert.rejects(runGa4Sync(ctx, { propertyId: "G-ABC123", http: g.http, serviceAccountJson: KEY_JSON }), /numeric property ID/);
  assert.deepEqual(toChannelRows({ rows: [{ dimensionValues: [{ value: "bad" }] }] }), []);
  assert.equal(toMetricRows([{ keys: [] }], "gsc_total", null).length, 0);
});

test("not connected: the job is skipped with the reason, not retried and not failed", async () => {
  let attempts = 0;
  const jobs: JobDef[] = [{ id: "gsc_sync", label: "x", description: "", defaultCadence: "daily", phase: 3, run: (c) => { attempts++; return runGscSync(c, { siteUrl: "", published: false, inspectUrls: [], serviceAccountJson: "" }); } }];
  const r = await runJob(sql, jobs, "gsc_sync", "manual", "admin:1", { sleep: async () => {} });
  assert.equal(r.status, "skipped");
  assert.equal(attempts, 1);
  const run = one(`SELECT status, error, summary FROM seo_job_runs WHERE id = ?`, r.runId);
  assert.equal(run.error, null);
  assert.match(String(run.summary), /not connected/);
  assert.equal(one(`SELECT last_status FROM seo_jobs WHERE id = 'gsc_sync'`).last_status, "skipped");
});

test("Google errors fail the run with a readable message and no secrets", async () => {
  const http: Http = async (url) => url.includes("token") ? { status: 400, json: { error: "invalid_grant", error_description: "Invalid JWT Signature." } } : { status: 500, json: {} };
  const jobs: JobDef[] = [{ id: "gsc_sync", label: "x", description: "", defaultCadence: "daily", phase: 3, run: (c) => runGscSync(c, { siteUrl: SITE, published: false, inspectUrls: [], http, serviceAccountJson: KEY_JSON }) }];
  const r = await runJob(sql, jobs, "gsc_sync", "manual", "admin:1", { sleep: async () => {} });
  assert.equal(r.status, "failed");
  assert.match(r.error!, /Invalid JWT Signature/);
  const logged = (db.prepare(`SELECT detail FROM seo_activity_log`).all() as { detail: string | null }[]).map((x) => x.detail ?? "").join("\n");
  assert.ok(!logged.includes("PRIVATE KEY") && !logged.includes("tok-"));
});

test("the dashboard adds up the last 28 days against the 28 before; empty without imports", async () => {
  const empty = await searchDashboard(sql);
  assert.equal(empty.search, null);
  assert.equal(empty.analytics, null);

  const g = fakeGoogle();
  await runGscSync(ctx, { siteUrl: SITE, published: false, inspectUrls: [], http: g.http, serviceAccountJson: KEY_JSON });
  await runGa4Sync(ctx, { propertyId: "1", http: g.http, serviceAccountJson: KEY_JSON });
  const d = await searchDashboard(sql);
  assert.ok(d.search && d.analytics);
  assert.equal(d.search.latest, "2026-11-04");
  assert.equal(d.search.current.from, "2026-10-08");
  assert.equal(d.search.current.days, 28);
  const expect = one(`SELECT SUM(clicks) AS c, SUM(impressions) AS i FROM seo_metrics_daily WHERE source = 'gsc_total' AND day BETWEEN '2026-10-08' AND '2026-11-04'`);
  assert.equal(d.search.current.clicks, expect.c);
  assert.equal(d.search.current.impressions, expect.i);
  assert.equal(d.search.current.position, 12);
  assert.equal(d.search.previous.days, 28);
  assert.equal(d.search.series.length, 90);
  assert.deepEqual(d.search.topQueries.map((q) => [q.key, q.clicks]), [["pharmacy pos pakistan", 28]]);
  assert.equal(d.search.topPages[0].key, SITE);
  assert.equal(d.analytics.organicSessions, 280);
  assert.equal(d.analytics.channels[0].channel, "Organic Search");
});

test("imports never touch business data", async () => {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'seo_%' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((t) => t.name);
  const snapshot = () => tables.map((t) => `${t}:${(db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n}`).join(",");
  const before = snapshot();
  const g = fakeGoogle({ verdicts: { [`${SITE}`]: "FAIL" } });
  await runGscSync(ctx, { siteUrl: SITE, published: true, inspectUrls: [`${SITE}`], http: g.http, serviceAccountJson: KEY_JSON });
  await runGa4Sync(ctx, { propertyId: "1", http: g.http, serviceAccountJson: KEY_JSON });
  assert.equal(snapshot(), before);
});
