/** SEO Manager, phase 6: the monthly report from recorded numbers (made-up
 * data), Vercel deployments through a fake API, log trimming, and that
 * reporting changes only seo_* tables. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { runJob, type JobContext } from "@/server/seo/engine";
import { SEO_JOBS } from "@/server/seo/jobs";
import { KEEP_LOG_DAYS, buildReport, highlightsFor, monthRange, previousPeriod, runMonthlyReport, trimLogs, validPeriod } from "@/server/seo/report";
import { productionDeployments, summarize, vercelConfig, type VercelConfig } from "@/server/seo/vercel";
import { getReport } from "@/server/seo/admin";
import type { Http } from "@/server/seo/google";
import type { Sql } from "@/server/subSupers";

const NOW = new Date("2026-11-03T01:00:00.000Z");
const VC: VercelConfig = { token: "vercel-test-token", projectId: "prj_test", teamId: "team_test" };
let db: DatabaseSync;
let sql: Sql;
let ctx: JobContext;
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  ctx = { sql, now: NOW, log: async () => {} };
});

const days = (period: string) => {
  const { from, to } = monthRange(period);
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10));
  return out;
};
function seedSearch(period: string, clicks: number, impressions: number, position: number) {
  for (const day of days(period)) {
    run(`INSERT INTO seo_metrics_daily (id, day, clicks, impressions, position, source, fetched_at) VALUES (?, ?, ?, ?, ?, 'gsc_total', ?)`, randomUUID(), day, clicks, impressions, position, NOW.toISOString());
    run(`INSERT INTO seo_metrics_daily (id, day, query, clicks, impressions, position, source, fetched_at) VALUES (?, ?, 'pharmacy software lahore', ?, ?, ?, 'gsc_query', ?)`, randomUUID(), day, clicks, impressions, position, NOW.toISOString());
    run(`INSERT INTO seo_analytics_daily (id, day, channel, sessions, engaged_sessions, key_events, source, fetched_at) VALUES (?, ?, 'Organic Search', ?, 1, 1, 'ga4', ?)`, randomUUID(), day, clicks * 2, NOW.toISOString());
  }
}

const fakeVercel = (list: { uid: string; readyState: string; created: number }[]) => {
  const calls: string[] = [];
  const http: Http = async (url, init) => {
    calls.push(url);
    assert.equal(init.method, "GET");
    assert.equal(init.headers?.Authorization, "Bearer vercel-test-token");
    return { status: 200, json: { deployments: list.map((d) => ({ ...d, meta: { githubCommitSha: "abcdef1234", githubCommitMessage: "SEO: new article\n\nbody", githubCommitRef: "main" } })) } };
  };
  return { http, calls };
};

test("periods: the month before, month ranges, valid input", () => {
  assert.equal(previousPeriod(NOW), "2026-10");
  assert.equal(previousPeriod(new Date("2026-01-01T00:30:00Z")), "2025-12");
  assert.deepEqual(monthRange("2024-02"), { from: "2024-02-01", to: "2024-02-29", prev: "2024-01" });
  assert.ok(validPeriod("2026-10") && !validPeriod("2026-13") && !validPeriod("2026-1") && !validPeriod(42));
});

test("the report compares the month with the one before and states it plainly", async () => {
  seedSearch("2026-09", 2, 100, 14);
  seedSearch("2026-10", 3, 120, 11);
  const t = NOW.toISOString();
  run(`INSERT INTO seo_audit_findings (id, check_id, url, severity, message, first_seen_at, last_seen_at) VALUES (?, 'title_long', '/x', 'critical', 'm', '2026-10-05T00:00:00.000Z', ?)`, randomUUID(), t);
  run(`INSERT INTO seo_audit_findings (id, check_id, url, severity, message, first_seen_at, last_seen_at, resolved_at) VALUES (?, 'h1_missing', '/y', 'warning', 'm', '2026-09-05T00:00:00.000Z', ?, '2026-10-20T00:00:00.000Z')`, randomUUID(), t);
  run(`INSERT INTO seo_recommendations (id, kind, title, status, created_at, updated_at) VALUES (?, 'x', 'Fix it', 'proposed', '2026-10-02T00:00:00.000Z', ?)`, randomUUID(), t);
  run(`INSERT INTO seo_job_runs (id, job_id, trigger, status, attempts, started_at, error) VALUES (?, 'pagespeed', 'schedule', 'failed', 3, '2026-10-10T01:00:00.000Z', 'Quota exceeded')`, randomUUID());
  run(`INSERT INTO seo_job_runs (id, job_id, trigger, status, attempts, started_at) VALUES (?, 'health_check', 'schedule', 'succeeded', 1, '2026-10-10T01:00:00.000Z')`, randomUUID());

  const v = fakeVercel([
    { uid: "d3", readyState: "READY", created: Date.parse("2026-10-30T10:00:00Z") },
    { uid: "d2", readyState: "ERROR", created: Date.parse("2026-10-15T10:00:00Z") },
    { uid: "d1", readyState: "READY", created: Date.parse("2026-10-02T10:00:00Z") },
  ]);
  const r = await buildReport(sql, "2026-10", { now: NOW, vercel: VC, http: v.http });
  assert.equal(r.partial, false);
  assert.equal(r.search!.current.clicks, 93);
  assert.equal(r.search!.previous!.clicks, 60);
  assert.equal(r.search!.current.position, 11);
  assert.equal(r.search!.daily.length, 31);
  assert.equal(r.search!.topQueries[0].key, "pharmacy software lahore");
  assert.equal(r.analytics!.organic, 186);
  assert.equal(r.analytics!.previousOrganic, 120);
  assert.deepEqual(r.technical.open, { critical: 1, warning: 0, info: 0 });
  assert.equal(r.technical.newInMonth, 1);
  assert.equal(r.technical.fixedInMonth, 1);
  assert.equal(r.recommendations.waiting, 1);
  assert.deepEqual(r.automation.jobs.map((j) => [j.job, j.succeeded, j.failed]), [["health_check", 1, 0], ["pagespeed", 0, 1]]);
  assert.ok(r.deployments.connected && "total" in r.deployments && r.deployments.total === 3 && r.deployments.failed === 1);
  assert.match(v.calls[0], /projectId=prj_test/);
  assert.match(v.calls[0], /teamId=team_test/);
  assert.match(v.calls[0], /target=production/);

  const h = r.highlights.join("\n");
  assert.match(h, /sent 93 clicks \(up 55% from the month before\)/);
  assert.match(h, /Average position 11\.0 \(better than 14\.0/);
  assert.match(h, /186 visits came from Google search \(up 55%/);
  assert.match(h, /1 critical problem on the site still open/);
  assert.match(h, /1 automated run failed: pagespeed/);
  assert.match(h, /1 website deployment failed/);
});

test("no data: the report says why instead of showing zeros as results", async () => {
  const r = await buildReport(sql, "2026-10", { now: NOW, vercel: null });
  assert.equal(r.search, null);
  assert.equal(r.analytics, null);
  assert.deepEqual(r.deployments, { connected: false });
  assert.match(r.highlights[0], /closed to search engines|No Search Console data/);
  const live = await buildReport(sql, "2026-11", { now: NOW, vercel: null });
  assert.equal(live.partial, true);
  const withError = await buildReport(sql, "2026-10", { now: NOW, vercel: VC, http: async () => ({ status: 403, json: { error: { message: "Not authorized" } } }) });
  assert.ok(withError.deployments.connected && "error" in withError.deployments && /403/.test(withError.deployments.error));
  assert.ok(highlightsFor({ ...r, sitePublished: true }).some((x) => /No Search Console data/.test(x)));
});

test("the monthly job saves last month's report once (rebuilds replace it) and trims old logs", async () => {
  const old = new Date(NOW.getTime() - (KEEP_LOG_DAYS + 5) * 86_400_000).toISOString();
  run(`INSERT INTO seo_activity_log (id, actor, level, action, created_at) VALUES (?, 'x', 'info', 'old', ?)`, randomUUID(), old);
  run(`INSERT INTO seo_activity_log (id, actor, level, action, created_at) VALUES (?, 'x', 'info', 'recent', ?)`, randomUUID(), NOW.toISOString());
  run(`INSERT INTO seo_job_runs (id, job_id, trigger, status, attempts, started_at) VALUES (?, 'health_check', 'schedule', 'succeeded', 1, ?)`, randomUUID(), old);
  const r = await runMonthlyReport(ctx, { vercel: null });
  assert.equal(r.period, "2026-10");
  assert.deepEqual(r.trimmed, { activity: 1, runs: 1 });
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_activity_log WHERE action = 'recent'`).n, 1);
  await runMonthlyReport(ctx, { vercel: null });
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_reports`).n, 1);
  const saved = await getReport(sql, "2026-10");
  assert.equal(saved.period, "2026-10");
  await assert.rejects(getReport(sql, "2026-09"), /No report/);
  assert.deepEqual(await trimLogs(sql, NOW), { activity: 0, runs: 0 });
});

test("the registered monthly job runs through the engine", async () => {
  const res = await runJob(sql, SEO_JOBS, "monthly_report", "manual", "admin:1", { sleep: async () => {}, now: NOW });
  assert.equal(res.status, "succeeded");
  assert.equal(one(`SELECT COUNT(*) AS n FROM seo_reports`).n, 1);
});

test("Vercel: config from the environment, newest deployment and last good one", async () => {
  assert.equal(vercelConfig({}), null);
  assert.deepEqual(vercelConfig({ VERCEL_API_TOKEN: " t ", VERCEL_PROJECT_ID: "p" }), { token: "t", projectId: "p", teamId: null });
  const v = fakeVercel([{ uid: "b", readyState: "ERROR", created: 2_000 }, { uid: "a", readyState: "READY", created: 1_000 }]);
  const s = summarize(await productionDeployments(VC, { http: v.http, limit: 5 }));
  assert.equal(s.latest!.id, "b");
  assert.equal(s.lastReady!.id, "a");
  assert.equal(s.latest!.commit, "abcdef1");
  assert.equal(s.latest!.message, "SEO: new article");
});

test("reports never touch business data", async () => {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'seo_%' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((t) => t.name);
  const snapshot = () => tables.map((t) => `${t}:${(db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n}`).join(",");
  const before = snapshot();
  seedSearch("2026-10", 1, 10, 9);
  await runMonthlyReport(ctx, { vercel: null });
  assert.equal(snapshot(), before);
});
