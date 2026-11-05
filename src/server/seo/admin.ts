/** Super Admin > SEO: the actions behind the screens. The route checks the
 * caller is the Super Admin; everything here reads or writes seo_* tables only. */
import { HttpError } from "../db";
import type { Sql } from "../subSupers";
import { KILL_SWITCH_KEY, ensureJobs, getSetting, isDue, isKilled, logActivity, runJob, setSetting, type Cadence } from "./engine";
import { integrationStatus, sitePublished } from "./integrations";
import { SEO_JOBS } from "./jobs";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const CADENCES: Cadence[] = ["daily", "weekly", "monthly"];
const count = async (sql: Sql, q: string, args: unknown[] = []) => Number((await sql.execute(q, args)).rows[0]?.n ?? 0);

export async function overview(sql: Sql) {
  await ensureJobs(sql, SEO_JOBS);
  const lastRun = (await sql.execute(`SELECT job_id, status, started_at, finished_at, error FROM seo_job_runs ORDER BY started_at DESC LIMIT 1`)).rows[0] ?? null;
  return {
    killSwitch: await isKilled(sql),
    sitePublished: sitePublished(),
    integrations: integrationStatus(),
    lastRun,
    failedRuns7d: await count(sql, `SELECT COUNT(*) AS n FROM seo_job_runs WHERE status = 'failed' AND started_at >= ?`, [new Date(Date.now() - 7 * 86_400_000).toISOString()]),
    openFindings: await count(sql, `SELECT COUNT(*) AS n FROM seo_audit_findings WHERE resolved_at IS NULL`),
    openRecommendations: await count(sql, `SELECT COUNT(*) AS n FROM seo_recommendations WHERE status = 'proposed'`),
    drafts: await count(sql, `SELECT COUNT(*) AS n FROM seo_content_drafts WHERE status IN ('draft','in_review')`),
    keywords: await count(sql, `SELECT COUNT(*) AS n FROM seo_keywords`),
    metricsDays: await count(sql, `SELECT COUNT(DISTINCT day) AS n FROM seo_metrics_daily`),
  };
}

export async function listJobs(sql: Sql) {
  await ensureJobs(sql, SEO_JOBS);
  const rows = new Map((await sql.execute(`SELECT * FROM seo_jobs`)).rows.map((r) => [String(r.id), r]));
  const now = new Date();
  return SEO_JOBS.map((j) => {
    const r = rows.get(j.id)!;
    return {
      id: j.id, label: j.label, description: j.description, phase: j.phase, available: Boolean(j.run),
      enabled: Number(r.enabled) === 1, cadence: r.cadence as Cadence, lastRunAt: r.last_run_at ?? null, lastSuccessAt: r.last_success_at ?? null,
      lastStatus: r.last_status ?? null, running: Boolean(r.lock_until && String(r.lock_until) > now.toISOString()),
      due: Boolean(j.run) && Number(r.enabled) === 1 && isDue(r.cadence as Cadence, (r.last_success_at as string) ?? null, now),
    };
  });
}

export async function updateJob(sql: Sql, actor: string, id: string, patch: { enabled?: unknown; cadence?: unknown }) {
  const def = SEO_JOBS.find((j) => j.id === id);
  if (!def) throw new HttpError(404, "Unknown job.");
  await ensureJobs(sql, SEO_JOBS);
  if (patch.enabled !== undefined) {
    if (patch.enabled && !def.run) throw new HttpError(400, `This job arrives in phase ${def.phase}.`);
    await sql.execute(`UPDATE seo_jobs SET enabled = ?, updated_at = ? WHERE id = ?`, [patch.enabled ? 1 : 0, new Date().toISOString(), id]);
  }
  if (patch.cadence !== undefined) {
    if (!CADENCES.includes(patch.cadence as Cadence)) throw new HttpError(400, "Choose daily, weekly or monthly.");
    await sql.execute(`UPDATE seo_jobs SET cadence = ?, updated_at = ? WHERE id = ?`, [patch.cadence, new Date().toISOString(), id]);
  }
  await logActivity(sql, { actor, action: "job_updated", detail: { job: id, ...patch } });
}

export async function setKillSwitch(sql: Sql, actor: string, on: boolean, reason: unknown) {
  const why = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  if (on && why.length < 3) throw new HttpError(400, "Say why you are stopping the jobs.");
  await setSetting(sql, KILL_SWITCH_KEY, on ? "on" : "off", actor);
  await setSetting(sql, "kill_reason", on ? why : null, actor);
  await logActivity(sql, { actor, level: on ? "warn" : "info", action: on ? "kill_switch_on" : "kill_switch_off", detail: why || null });
}

export async function runNow(sql: Sql, actor: string, id: string) {
  await ensureJobs(sql, SEO_JOBS);
  return runJob(sql, SEO_JOBS, id, "manual", actor);
}

export async function listRuns(sql: Sql, f: { jobId?: unknown; limit?: unknown }) {
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const job = typeof f.jobId === "string" && f.jobId ? f.jobId : null;
  return (await sql.execute(
    `SELECT * FROM seo_job_runs${job ? " WHERE job_id = ?" : ""} ORDER BY started_at DESC LIMIT ?`, job ? [job, limit] : [limit],
  )).rows;
}

/** Activity log, newest first: filter by level and text, page with `before` (a created_at). */
export async function listActivity(sql: Sql, f: { level?: unknown; q?: unknown; before?: unknown; limit?: unknown }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.level === "info" || f.level === "warn" || f.level === "error") { where.push("level = ?"); args.push(f.level); }
  if (typeof f.q === "string" && f.q.trim()) {
    const like = `%${f.q.trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(action LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR actor LIKE ? ESCAPE '\\')`);
    args.push(like, like, like);
  }
  if (typeof f.before === "string" && f.before) { where.push("created_at < ?"); args.push(f.before); }
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  return (await sql.execute(
    `SELECT * FROM seo_activity_log${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`, [...args, limit],
  )).rows;
}

/** Read-only lists for the screens that later phases fill. */
export async function listTable(sql: Sql, table: "keywords" | "findings" | "recommendations" | "drafts" | "reports") {
  const q = {
    keywords: `SELECT * FROM seo_keywords ORDER BY priority DESC, keyword LIMIT 500`,
    findings: `SELECT * FROM seo_audit_findings ORDER BY resolved_at IS NOT NULL, CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT 500`,
    recommendations: `SELECT * FROM seo_recommendations ORDER BY CASE status WHEN 'proposed' THEN 0 ELSE 1 END, created_at DESC LIMIT 500`,
    drafts: `SELECT id, kind, title, target_keyword, target_path, status, created_at, updated_at, pr_url FROM seo_content_drafts ORDER BY updated_at DESC LIMIT 500`,
    reports: `SELECT id, period, created_at FROM seo_reports ORDER BY period DESC LIMIT 120`,
  }[table];
  return (await sql.execute(q)).rows;
}

export async function getSettings(sql: Sql) {
  return { killSwitch: await isKilled(sql), killReason: await getSetting(sql, "kill_reason"), integrations: integrationStatus(), sitePublished: sitePublished() };
}

/** The owner's decision on a proposed fix. Approving does not change the site:
 * approved fixes are made by hand for now, or as a pull request from phase 5. */
export async function decideRecommendation(sql: Sql, actor: string, id: string, status: unknown, note: unknown) {
  if (status !== "approved" && status !== "rejected" && status !== "done" && status !== "proposed") throw new HttpError(400, "Unknown decision.");
  const why = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (status === "rejected" && why.length < 3) throw new HttpError(400, "Say why you are rejecting it.");
  const t = new Date().toISOString();
  const r = await sql.execute(
    `UPDATE seo_recommendations SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ?`,
    [status, actor, t, why || null, t, id],
  );
  if (!r.rowsAffected) throw new HttpError(404, "Recommendation not found.");
  await logActivity(sql, { actor, action: `recommendation_${status}`, detail: { id, note: why || null } });
}
