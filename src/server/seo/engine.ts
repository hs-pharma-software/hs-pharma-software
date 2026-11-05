/** Mavin SEO Manager: the job runner.
 *
 * Jobs are read-only audits, data imports and draft generation; they write
 * only to the seo_* tables, never to business (tenant) data. Every run:
 *   1. checks the kill switch (stopped => recorded as "blocked", nothing runs);
 *   2. takes the job's lock (a second run of the same job is "skipped");
 *   3. runs the job with retries and a growing pause between attempts;
 *   4. records the outcome, every attempt and every message in the activity log.
 *
 * Functions take the database (Sql), so tests run them on the real schema. */
import { randomUUID } from "node:crypto";
import type { Sql } from "../subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export type Cadence = "daily" | "weekly" | "monthly";
export type Trigger = "schedule" | "manual";

/** What a job may do while it runs: write to the activity log and return a summary. */
export interface JobContext {
  sql: Sql;
  now: Date;
  log: (level: "info" | "warn" | "error", action: string, detail?: unknown) => Promise<void>;
}

export interface JobDef {
  id: string;
  label: string;
  description: string;
  defaultCadence: Cadence;
  /** Build phase that delivers it; jobs without a handler are listed but cannot run yet. */
  phase: number;
  run?: (ctx: JobContext) => Promise<unknown>;
}

export const KILL_SWITCH_KEY = "kill_switch";
const LOCK_MINUTES = 15;
export const MAX_ATTEMPTS = 3;

const iso = (d: Date) => d.toISOString();

export async function getSetting(sql: Sql, key: string): Promise<string | null> {
  const r = (await sql.execute(`SELECT value FROM seo_settings WHERE key = ?`, [key])).rows[0];
  return r ? (r.value as string | null) : null;
}

export async function setSetting(sql: Sql, key: string, value: string | null, by: string): Promise<void> {
  await sql.execute(
    `INSERT INTO seo_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [key, value, by, iso(new Date())],
  );
}

/** True when all automated jobs are stopped. */
export async function isKilled(sql: Sql): Promise<boolean> {
  return (await getSetting(sql, KILL_SWITCH_KEY)) === "on";
}

export async function logActivity(sql: Sql, e: { runId?: string | null; actor: string; level?: "info" | "warn" | "error"; action: string; detail?: unknown }): Promise<void> {
  const detail = e.detail === undefined ? null : typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
  await sql.execute(
    `INSERT INTO seo_activity_log (id, run_id, actor, level, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), e.runId ?? null, e.actor, e.level ?? "info", e.action, detail ? detail.slice(0, 4000) : null, iso(new Date())],
  );
}

/** Creates the schedule row of each known job (enabled, default cadence) once. */
export async function ensureJobs(sql: Sql, jobs: JobDef[]): Promise<void> {
  const t = iso(new Date());
  for (const j of jobs) {
    await sql.execute(`INSERT INTO seo_jobs (id, enabled, cadence, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`, [j.id, j.run ? 1 : 0, j.defaultCadence, t]);
  }
}

/** Whether a job with this cadence is due, given its last successful run. */
export function isDue(cadence: Cadence, lastSuccess: string | null, now: Date): boolean {
  if (!lastSuccess) return true;
  const last = new Date(lastSuccess);
  // A small allowance so a daily cron that fires a few minutes early still runs.
  const days = (now.getTime() - last.getTime()) / 86_400_000 + 1 / 24;
  if (cadence === "daily") return days >= 1;
  if (cadence === "weekly") return days >= 7;
  return now.getUTCFullYear() * 12 + now.getUTCMonth() > last.getUTCFullYear() * 12 + last.getUTCMonth();
}

export interface RunResult { runId: string; status: "succeeded" | "failed" | "blocked" | "skipped"; attempts: number; error?: string; summary?: unknown }

/** Runs one job now (manual or scheduled), honouring the kill switch and the lock. */
export async function runJob(sql: Sql, jobs: JobDef[], jobId: string, trigger: Trigger, actor: string, opts: { sleep?: (ms: number) => Promise<void>; now?: Date } = {}): Promise<RunResult> {
  const def = jobs.find((j) => j.id === jobId);
  if (!def) throw new Error(`Unknown job ${jobId}.`);
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const runId = randomUUID();
  const start = (status: RunResult["status"] | "running", summary: string | null = null) =>
    sql.execute(
      `INSERT INTO seo_job_runs (id, job_id, trigger, triggered_by, status, attempts, started_at, finished_at, summary) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [runId, jobId, trigger, actor, status, iso(now), status === "running" ? null : iso(now), summary],
    );

  if (await isKilled(sql)) {
    await start("blocked", "The kill switch is on: automated jobs are stopped.");
    await logActivity(sql, { runId, actor, level: "warn", action: "run_blocked", detail: { job: jobId, reason: "kill switch" } });
    return { runId, status: "blocked", attempts: 0 };
  }
  if (!def.run) {
    await start("skipped", `Not available yet (phase ${def.phase}).`);
    return { runId, status: "skipped", attempts: 0 };
  }
  // The lock: only one run of a job at a time (a crashed run's lock expires).
  await ensureJobs(sql, [def]);
  const lock = await sql.execute(
    `UPDATE seo_jobs SET lock_until = ?, updated_at = ? WHERE id = ? AND (lock_until IS NULL OR lock_until < ?)`,
    [iso(new Date(now.getTime() + LOCK_MINUTES * 60_000)), iso(now), jobId, iso(now)],
  );
  if (!lock.rowsAffected) {
    await start("skipped", "Already running.");
    await logActivity(sql, { runId, actor, level: "warn", action: "run_skipped_locked", detail: { job: jobId } });
    return { runId, status: "skipped", attempts: 0 };
  }

  await start("running");
  await logActivity(sql, { runId, actor, action: "run_started", detail: { job: jobId, trigger } });
  const ctx: JobContext = { sql, now, log: (level, action, detail) => logActivity(sql, { runId, actor: `job:${jobId}`, level, action, detail }) };
  let attempts = 0;
  let lastError = "";
  let summary: unknown;
  let ok = false;
  while (attempts < MAX_ATTEMPTS && !ok) {
    attempts++;
    try {
      summary = await def.run(ctx);
      ok = true;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      await logActivity(sql, { runId, actor, level: attempts < MAX_ATTEMPTS ? "warn" : "error", action: "attempt_failed", detail: { job: jobId, attempt: attempts, error: lastError } });
      // The kill switch also stops retries.
      if (attempts < MAX_ATTEMPTS && !(await isKilled(sql))) await sleep(2 ** attempts * 1000);
      else break;
    }
  }
  const status = ok ? "succeeded" : "failed";
  const finished = iso(new Date());
  await sql.batch([
    {
      sql: `UPDATE seo_job_runs SET status = ?, attempts = ?, finished_at = ?, summary = ?, error = ? WHERE id = ?`,
      args: [status, attempts, finished, summary === undefined ? null : JSON.stringify(summary).slice(0, 8000), ok ? null : lastError.slice(0, 2000), runId],
    },
    {
      sql: `UPDATE seo_jobs SET lock_until = NULL, last_run_at = ?, last_status = ?, last_success_at = CASE WHEN ? = 'succeeded' THEN ? ELSE last_success_at END, updated_at = ? WHERE id = ?`,
      args: [finished, status, status, finished, finished, jobId],
    },
  ]);
  await logActivity(sql, { runId, actor, level: ok ? "info" : "error", action: ok ? "run_succeeded" : "run_failed", detail: { job: jobId, attempts, ...(ok ? {} : { error: lastError }) } });
  return { runId, status, attempts, ...(ok ? { summary } : { error: lastError }) };
}

/** The scheduler's entry point: runs every enabled job that is due. */
export async function runDueJobs(sql: Sql, jobs: JobDef[], opts: { now?: Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<RunResult[]> {
  const now = opts.now ?? new Date();
  await ensureJobs(sql, jobs);
  if (await isKilled(sql)) {
    await logActivity(sql, { actor: "scheduler", level: "warn", action: "schedule_blocked", detail: "The kill switch is on." });
    return [];
  }
  const rows = (await sql.execute(`SELECT id, enabled, cadence, last_success_at FROM seo_jobs`)).rows;
  const out: RunResult[] = [];
  for (const r of rows) {
    const def = jobs.find((j) => j.id === r.id);
    if (!def?.run || !Number(r.enabled)) continue;
    if (!isDue(r.cadence as Cadence, (r.last_success_at as string) ?? null, now)) continue;
    out.push(await runJob(sql, jobs, def.id, "schedule", "scheduler", opts));
  }
  return out;
}
