/** SEO Manager, phase 1: the job runner (kill switch, lock, retries, logs,
 * schedule), the cron secret, admin actions, and that jobs never touch
 * business data. Real schema in SQLite; jobs are fakes or the read-only
 * health check. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { isDue, runDueJobs, runJob, ensureJobs, type JobDef } from "@/server/seo/engine";
import { SEO_JOBS } from "@/server/seo/jobs";
import { listActivity, listJobs, setKillSwitch, updateJob } from "@/server/seo/admin";
import { integrationStatus } from "@/server/seo/integrations";
import { cronAuthorized } from "@/server/seo/cron";
import type { Sql } from "@/server/subSupers";

let db: DatabaseSync;
let sql: Sql;
const noSleep = async () => {};
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
});

const fake = (run: JobDef["run"], id = "fake"): JobDef[] => [{ id, label: "Fake", description: "", defaultCadence: "daily", phase: 1, run }];

test("the kill switch blocks manual and scheduled runs; the job never starts", async () => {
  let calls = 0;
  const jobs = fake(async () => { calls++; });
  await ensureJobs(sql, jobs);
  await assert.rejects(setKillSwitch(sql, "admin:1", true, ""), /Say why/);
  await setKillSwitch(sql, "admin:1", true, "Checking a wrong recommendation");
  const r = await runJob(sql, jobs, "fake", "manual", "admin:1", { sleep: noSleep });
  assert.equal(r.status, "blocked");
  assert.deepEqual(await runDueJobs(sql, jobs, { sleep: noSleep }), []);
  assert.equal(calls, 0);
  assert.equal(one(`SELECT status FROM seo_job_runs WHERE id = ?`, r.runId).status, "blocked");
  await setKillSwitch(sql, "admin:1", false, null);
  assert.equal((await runJob(sql, jobs, "fake", "manual", "admin:1", { sleep: noSleep })).status, "succeeded");
  assert.equal(calls, 1);
});

test("only one run of a job at a time; a crashed run's lock expires", async () => {
  const jobs = fake(async () => "ok");
  await ensureJobs(sql, jobs);
  db.prepare(`UPDATE seo_jobs SET lock_until = ? WHERE id = 'fake'`).run(new Date(Date.now() + 600_000).toISOString());
  assert.equal((await runJob(sql, jobs, "fake", "manual", "a", { sleep: noSleep })).status, "skipped");
  db.prepare(`UPDATE seo_jobs SET lock_until = ? WHERE id = 'fake'`).run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await runJob(sql, jobs, "fake", "manual", "a", { sleep: noSleep })).status, "succeeded");
  assert.equal(one(`SELECT lock_until FROM seo_jobs WHERE id = 'fake'`).lock_until, null, "released after the run");
});

test("a failing attempt is retried with a growing pause and logged", async () => {
  let n = 0;
  const pauses: number[] = [];
  const jobs = fake(async () => { if (++n < 3) throw new Error(`timeout ${n}`); return { pages: 4 }; });
  await ensureJobs(sql, jobs);
  const r = await runJob(sql, jobs, "fake", "manual", "a", { sleep: async (ms) => { pauses.push(ms); } });
  assert.equal(r.status, "succeeded");
  assert.equal(r.attempts, 3);
  assert.deepEqual(pauses, [2000, 4000]);
  const failed = db.prepare(`SELECT detail FROM seo_activity_log WHERE run_id = ? AND action = 'attempt_failed'`).all(r.runId) as { detail: string }[];
  assert.equal(failed.length, 2);
  assert.match(failed[0].detail, /timeout 1/);
  assert.deepEqual(JSON.parse(String(one(`SELECT summary FROM seo_job_runs WHERE id = ?`, r.runId).summary)), { pages: 4 });
});

test("a job that keeps failing is recorded as failed and its last success is kept", async () => {
  const jobs = fake(async () => { throw new Error("Search Console unavailable"); });
  await ensureJobs(sql, jobs);
  db.prepare(`UPDATE seo_jobs SET last_success_at = '2026-11-01T00:00:00.000Z' WHERE id = 'fake'`).run();
  const r = await runJob(sql, jobs, "fake", "schedule", "scheduler", { sleep: noSleep });
  assert.equal(r.status, "failed");
  assert.equal(r.attempts, 3);
  const job = one(`SELECT * FROM seo_jobs WHERE id = 'fake'`);
  assert.equal(job.last_status, "failed");
  assert.equal(job.last_success_at, "2026-11-01T00:00:00.000Z");
  assert.equal(job.lock_until, null);
  assert.match(String(one(`SELECT error FROM seo_job_runs WHERE id = ?`, r.runId).error), /unavailable/);
});

test("due dates: daily, weekly, monthly (a cron a few minutes early still counts)", () => {
  const now = new Date("2026-11-05T01:00:00.000Z");
  assert.equal(isDue("daily", null, now), true);
  assert.equal(isDue("daily", "2026-11-04T01:10:00.000Z", now), true, "ten minutes short of a day");
  assert.equal(isDue("daily", "2026-11-05T00:30:00.000Z", now), false);
  assert.equal(isDue("weekly", "2026-10-30T01:00:00.000Z", now), false);
  assert.equal(isDue("weekly", "2026-10-29T01:00:00.000Z", now), true);
  assert.equal(isDue("monthly", "2026-11-01T01:00:00.000Z", now), false);
  assert.equal(isDue("monthly", "2026-10-31T23:00:00.000Z", now), true, "a new month");
});

test("the scheduler runs each due, enabled job once a day", async () => {
  let calls = 0;
  const jobs: JobDef[] = [...fake(async () => { calls++; }), { id: "later", label: "Later", description: "", defaultCadence: "daily", phase: 4 }];
  const now = new Date("2026-11-05T01:00:00.000Z");
  const first = await runDueJobs(sql, jobs, { now, sleep: noSleep });
  assert.deepEqual(first.map((r) => r.status), ["succeeded"], "the later-phase job is not run");
  assert.deepEqual(await runDueJobs(sql, jobs, { now: new Date("2026-11-05T05:00:00.000Z"), sleep: noSleep }), [], "not due again the same day");
  db.prepare(`UPDATE seo_jobs SET enabled = 0 WHERE id = 'fake'`).run();
  assert.deepEqual(await runDueJobs(sql, jobs, { now: new Date("2026-11-07T01:00:00.000Z"), sleep: noSleep }), [], "disabled");
  assert.equal(calls, 1);
});

test("jobs of later phases are listed but cannot be switched on or run", async () => {
  const list = await listJobs(sql);
  assert.deepEqual(list.filter((j) => j.available).map((j) => j.id), ["health_check", "technical_audit", "pagespeed"]);
  await assert.rejects(updateJob(sql, "a", "gsc_sync", { enabled: true }), /phase 3/);
  await assert.rejects(updateJob(sql, "a", "health_check", { cadence: "hourly" }), /daily, weekly or monthly/);
  assert.equal((await runJob(sql, SEO_JOBS, "gsc_sync", "manual", "a", { sleep: noSleep })).status, "skipped");
});

test("the health check and the scheduler never touch business data", async () => {
  const business = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'seo_%' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name);
  const snapshot = () => Object.fromEntries(business.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())]));
  db.prepare(`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ('t1', 'Synthetic Pharmacy', 'x', 'x')`).run();
  const before = snapshot();
  const r = await runJob(sql, SEO_JOBS, "health_check", "manual", "a", { sleep: noSleep });
  assert.equal(r.status, "succeeded");
  assert.equal((r.summary as { tables: number }).tables, 10);
  await runDueJobs(sql, SEO_JOBS, { sleep: noSleep });
  assert.deepEqual(snapshot(), before);
});

test("the scheduler endpoint needs the exact cron secret", () => {
  const secret = "s3cr3t-value-that-is-long-enough";
  assert.equal(cronAuthorized(`Bearer ${secret}`, secret), true);
  assert.equal(cronAuthorized(`Bearer ${secret}x`, secret), false);
  assert.equal(cronAuthorized(null, secret), false);
  assert.equal(cronAuthorized("Bearer short", "short"), false, "a too-short secret is never accepted");
  assert.equal(cronAuthorized("Bearer ", undefined), false, "no secret configured: nobody can run it");
});

test("integration status says only whether each secret is set, never its value", () => {
  const env = { CRON_SECRET: "cron-secret-value-123", GOOGLE_SERVICE_ACCOUNT_JSON: "{\"private_key\":\"KEY\"}", GSC_SITE_URL: "sc-domain:mavin.pk" };
  const s = integrationStatus(env);
  assert.equal(s.find((i) => i.id === "scheduler")!.configured, true);
  assert.equal(s.find((i) => i.id === "gsc")!.configured, true);
  assert.equal(s.find((i) => i.id === "ga4")!.configured, false);
  const text = JSON.stringify(s);
  for (const v of Object.values(env)) assert.ok(!text.includes(v), "no secret value in the status");
});

test("activity log: newest first, filter by level and text, page backwards", async () => {
  const jobs = fake(async () => { throw new Error("boom"); });
  await ensureJobs(sql, jobs);
  await runJob(sql, jobs, "fake", "manual", "admin:1", { sleep: noSleep });
  const errors = await listActivity(sql, { level: "error" });
  assert.ok(errors.length >= 1 && errors.every((e) => e.level === "error"));
  assert.ok((await listActivity(sql, { q: "boom" })).length >= 3);
  const page1 = await listActivity(sql, { limit: 2 });
  const page2 = await listActivity(sql, { limit: 2, before: page1[1].created_at });
  assert.ok(page2.every((r) => String(r.created_at) < String(page1[1].created_at)));
});
