/** Monthly SEO report (phase 6): one calendar month against the one before,
 * from the numbers the other jobs recorded (Search Console, GA4, audit,
 * keywords, recommendations, drafts, job runs) and Vercel deployments. The
 * highlights are plain sentences built from those numbers, not AI text, so
 * every statement can be traced. Stored in seo_reports (one per month;
 * generating again replaces it). Also trims old SEO logs. */
import type { JobContext } from "./engine";
import { getSetting } from "./engine";
import { GSC_SOURCES, INDEX_SUMMARY_KEY } from "./gsc";
import { GA4_SOURCE } from "./ga4";
import { sitePublished } from "./integrations";
import { productionDeployments, vercelConfig, type Deployment, type VercelConfig } from "./vercel";
import type { Http } from "./google";
import type { Sql } from "../subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** SEO logs older than this are removed by the monthly job. */
export const KEEP_LOG_DAYS = 180;

const num = (v: unknown) => Number(v ?? 0) || 0;
const pad = (n: number) => String(n).padStart(2, "0");

/** The month before `now`, as YYYY-MM. */
export function previousPeriod(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
export function monthRange(period: string): { from: string; to: string; prev: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const p = new Date(Date.UTC(y, m - 2, 1));
  return { from: `${period}-01`, to: `${period}-${pad(last)}`, prev: `${p.getUTCFullYear()}-${pad(p.getUTCMonth() + 1)}` };
}
export const validPeriod = (p: unknown): p is string => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

interface SearchTotals { days: number; clicks: number; impressions: number; ctr: number | null; position: number | null }
interface Top { key: string; clicks: number; impressions: number; position: number | null }

export interface MonthlyReport {
  period: string; from: string; to: string; partial: boolean; generatedAt: string; sitePublished: boolean;
  highlights: string[];
  search: { current: SearchTotals; previous: SearchTotals | null; daily: { day: string; clicks: number; impressions: number }[]; topQueries: Top[]; topPages: Top[] } | null;
  analytics: { organic: number; previousOrganic: number | null; organicKeyEvents: number; channels: { channel: string; sessions: number; keyEvents: number }[] } | null;
  indexing: Record<string, unknown> | null;
  technical: { open: { critical: number; warning: number; info: number }; newInMonth: number; fixedInMonth: number; vitals: string[] };
  keywords: { active: number; addedInMonth: number; withSearchData: number; top: { keyword: string; priority: number; impressions: number | null; position: number | null }[] };
  recommendations: { createdInMonth: number; approved: number; rejected: number; done: number; waiting: number };
  content: { drafted: number; approved: number; published: number; openPullRequests: number };
  automation: { jobs: { job: string; succeeded: number; failed: number; skipped: number; blocked: number }[]; failures: { job: string; at: string; error: string }[] };
  deployments: { connected: false } | { connected: true; error: string } | { connected: true; total: number; ready: number; failed: number; latest: Deployment | null };
}

async function searchTotals(sql: Sql, from: string, to: string): Promise<SearchTotals> {
  const x = (await sql.execute(
    `SELECT COUNT(*) AS days, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS p FROM seo_metrics_daily WHERE source = ? AND day >= ? AND day <= ?`,
    [GSC_SOURCES.total, from, to],
  )).rows[0] ?? {};
  const clicks = num(x.c);
  const impressions = num(x.i);
  return { days: num(x.days), clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions ? num(x.p) / impressions : null };
}

async function top(sql: Sql, source: string, col: "query" | "page", from: string, to: string): Promise<Top[]> {
  return (await sql.execute(
    `SELECT ${col} AS key, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p
     FROM seo_metrics_daily WHERE source = ? AND day >= ? AND day <= ? AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY c DESC, i DESC LIMIT 10`,
    [source, from, to],
  )).rows.map((r) => ({ key: String(r.key), clicks: num(r.c), impressions: num(r.i), position: r.p === null ? null : num(r.p) }));
}

const change = (now: number, before: number | null | undefined) => {
  if (before === null || before === undefined || before === 0) return "";
  const d = Math.round(((now - before) / before) * 100);
  return d === 0 ? " (no change from the month before)" : ` (${d > 0 ? "up" : "down"} ${Math.abs(d)}% from the month before)`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-PK")} ${n === 1 ? one : many}`;

/** Plain sentences from the numbers, most important first. */
export function highlightsFor(r: Omit<MonthlyReport, "highlights">): string[] {
  const h: string[] = [];
  if (r.search && r.search.current.days) {
    const c = r.search.current;
    h.push(`Google showed the site ${plural(c.impressions, "time")} and sent ${plural(c.clicks, "click")}${change(c.clicks, r.search.previous?.days ? r.search.previous.clicks : null)}.`);
    if (c.position !== null) {
      const p = r.search.previous?.position ?? null;
      h.push(`Average position ${c.position.toFixed(1)}${p !== null ? ` (${c.position < p ? "better than" : c.position > p ? "worse than" : "same as"} ${p.toFixed(1)} the month before)` : ""}.`);
    }
    if (r.search.topQueries[0]) h.push(`Top search: “${r.search.topQueries[0].key}” (${plural(r.search.topQueries[0].clicks, "click")}).`);
  } else if (!r.sitePublished) {
    h.push("The site was closed to search engines (draft) all month, so Google has no search numbers to report.");
  } else {
    h.push("No Search Console data for this month: check that Search Console is connected and its import runs.");
  }
  if (r.analytics) h.push(`${plural(r.analytics.organic, "visit")} came from Google search${change(r.analytics.organic, r.analytics.previousOrganic)}.`);
  const t = r.technical;
  h.push(t.open.critical ? `${plural(t.open.critical, "critical problem")} on the site still open (see Technical Audit).` : "No critical technical problems open.");
  if (t.fixedInMonth || t.newInMonth) h.push(`Technical audit: ${t.fixedInMonth} fixed, ${t.newInMonth} new this month.`);
  if (r.recommendations.waiting) h.push(`${plural(r.recommendations.waiting, "proposed fix", "proposed fixes")} waiting for your decision.`);
  if (r.content.drafted || r.content.published) h.push(`Content: ${plural(r.content.drafted, "draft")} written, ${r.content.published} published.`);
  const failed = r.automation.jobs.reduce((n, j) => n + j.failed, 0);
  if (failed) h.push(`${plural(failed, "automated run")} failed: ${Array.from(new Set(r.automation.failures.map((f) => f.job))).join(", ")} (see Activity Logs).`);
  if (r.deployments.connected && "failed" in r.deployments && r.deployments.failed) h.push(`${plural(r.deployments.failed, "website deployment")} failed this month.`);
  return h;
}

export async function buildReport(sql: Sql, period: string, o: { now?: Date; vercel?: VercelConfig | null; http?: Http } = {}): Promise<MonthlyReport> {
  const now = o.now ?? new Date();
  const { from, to, prev } = monthRange(period);
  const p = monthRange(prev);
  const fromIso = `${from}T00:00:00.000Z`;
  const toIso = `${to}T23:59:59.999Z`;
  const inMonth = (col: string) => `${col} >= '${fromIso}' AND ${col} <= '${toIso}'`;
  const count = async (q: string, args: unknown[] = []) => num((await sql.execute(q, args)).rows[0]?.n);

  // Search Console
  const current = await searchTotals(sql, from, to);
  const previous = await searchTotals(sql, p.from, p.to);
  const search = current.days ? {
    current, previous: previous.days ? previous : null,
    daily: (await sql.execute(`SELECT day, clicks, impressions FROM seo_metrics_daily WHERE source = ? AND day >= ? AND day <= ? ORDER BY day`, [GSC_SOURCES.total, from, to]))
      .rows.map((r) => ({ day: String(r.day), clicks: num(r.clicks), impressions: num(r.impressions) })),
    topQueries: await top(sql, GSC_SOURCES.query, "query", from, to),
    topPages: await top(sql, GSC_SOURCES.page, "page", from, to),
  } : null;

  // GA4
  const ga = async (f: string, t: string) => (await sql.execute(
    `SELECT channel, SUM(sessions) AS s, SUM(key_events) AS k, COUNT(*) AS n FROM seo_analytics_daily WHERE source = ? AND day >= ? AND day <= ? GROUP BY channel ORDER BY s DESC`, [GA4_SOURCE, f, t],
  )).rows;
  const gaNow = await ga(from, to);
  const gaPrev = await ga(p.from, p.to);
  const organicOf = (rows: Record<string, unknown>[]) => rows.find((r) => r.channel === "Organic Search");
  const analytics = gaNow.length ? {
    organic: num(organicOf(gaNow)?.s), previousOrganic: gaPrev.length ? num(organicOf(gaPrev)?.s) : null, organicKeyEvents: num(organicOf(gaNow)?.k),
    channels: gaNow.map((r) => ({ channel: String(r.channel), sessions: num(r.s), keyEvents: num(r.k) })),
  } : null;

  // Technical
  const sev = async (s: string) => count(`SELECT COUNT(*) AS n FROM seo_audit_findings WHERE resolved_at IS NULL AND severity = ?`, [s]);
  const technical = {
    open: { critical: await sev("critical"), warning: await sev("warning"), info: await sev("info") },
    newInMonth: await count(`SELECT COUNT(*) AS n FROM seo_audit_findings WHERE ${inMonth("first_seen_at")}`),
    fixedInMonth: await count(`SELECT COUNT(*) AS n FROM seo_audit_findings WHERE ${inMonth("resolved_at")}`),
    vitals: (await sql.execute(`SELECT url, message FROM seo_audit_findings WHERE resolved_at IS NULL AND check_id LIKE 'cwv_%' ORDER BY severity, url LIMIT 10`)).rows
      .map((r) => `${String(r.url).replace(/^https?:\/\/[^/]+/, "") || "/"}: ${r.message}`),
  };

  // Keywords
  const kw = (await sql.execute(`SELECT keyword, priority, notes, created_at FROM seo_keywords WHERE priority >= 0 ORDER BY priority DESC, keyword`)).rows;
  const gscOf = (notes: unknown) => { try { return (JSON.parse(String(notes ?? "{}")) as { gsc?: { impressions: number; position: number | null } }).gsc ?? null; } catch { return null; } };
  const keywords = {
    active: kw.length,
    addedInMonth: kw.filter((r) => String(r.created_at) >= fromIso && String(r.created_at) <= toIso).length,
    withSearchData: kw.filter((r) => (gscOf(r.notes)?.impressions ?? 0) > 0).length,
    top: kw.slice(0, 10).map((r) => { const g = gscOf(r.notes); return { keyword: String(r.keyword), priority: num(r.priority), impressions: g ? g.impressions : null, position: g?.position ?? null }; }),
  };

  // Recommendations and content
  const decided = async (s: string) => count(`SELECT COUNT(*) AS n FROM seo_recommendations WHERE status = ? AND ${inMonth("decided_at")}`, [s]);
  const recommendations = {
    createdInMonth: await count(`SELECT COUNT(*) AS n FROM seo_recommendations WHERE ${inMonth("created_at")}`),
    approved: await decided("approved"), rejected: await decided("rejected"), done: await decided("done"),
    waiting: await count(`SELECT COUNT(*) AS n FROM seo_recommendations WHERE status = 'proposed'`),
  };
  const content = {
    drafted: await count(`SELECT COUNT(*) AS n FROM seo_content_drafts WHERE ${inMonth("created_at")}`),
    approved: await count(`SELECT COUNT(*) AS n FROM seo_content_drafts WHERE status IN ('approved','published') AND ${inMonth("reviewed_at")}`),
    published: await count(`SELECT COUNT(*) AS n FROM seo_content_drafts WHERE status = 'published' AND ${inMonth("updated_at")}`),
    openPullRequests: await count(`SELECT COUNT(*) AS n FROM seo_content_drafts WHERE status = 'approved' AND pr_url IS NOT NULL`),
  };

  // Automation
  const runs = (await sql.execute(`SELECT job_id, status, COUNT(*) AS n FROM seo_job_runs WHERE ${inMonth("started_at")} GROUP BY job_id, status`)).rows;
  const jobs = new Map<string, { job: string; succeeded: number; failed: number; skipped: number; blocked: number }>();
  for (const r of runs) {
    const j = jobs.get(String(r.job_id)) ?? { job: String(r.job_id), succeeded: 0, failed: 0, skipped: 0, blocked: 0 };
    const s = String(r.status) as "succeeded" | "failed" | "skipped" | "blocked";
    if (s in j) j[s] += num(r.n);
    jobs.set(j.job, j);
  }
  const automation = {
    jobs: Array.from(jobs.values()).sort((a, b) => a.job.localeCompare(b.job)),
    failures: (await sql.execute(`SELECT job_id, started_at, error FROM seo_job_runs WHERE status = 'failed' AND ${inMonth("started_at")} ORDER BY started_at DESC LIMIT 20`)).rows
      .map((r) => ({ job: String(r.job_id), at: String(r.started_at), error: String(r.error ?? "").slice(0, 300) })),
  };

  // Deployments
  const cfg = o.vercel === undefined ? vercelConfig() : o.vercel;
  let deployments: MonthlyReport["deployments"] = { connected: false };
  if (cfg) {
    try {
      const list = (await productionDeployments(cfg, { http: o.http, since: new Date(fromIso), limit: 100 })).filter((d) => d.createdAt <= toIso);
      deployments = { connected: true, total: list.length, ready: list.filter((d) => d.state === "READY").length, failed: list.filter((d) => d.state === "ERROR").length, latest: list[0] ?? null };
    } catch (e) {
      deployments = { connected: true, error: e instanceof Error ? e.message : String(e) };
    }
  }

  let indexing: Record<string, unknown> | null = null;
  try { indexing = JSON.parse((await getSetting(sql, INDEX_SUMMARY_KEY)) ?? "null"); } catch { indexing = null; }

  const base = {
    period, from, to, partial: to >= now.toISOString().slice(0, 10), generatedAt: now.toISOString(), sitePublished: sitePublished(),
    search, analytics, indexing, technical, keywords, recommendations, content, automation, deployments,
  };
  return { ...base, highlights: highlightsFor(base) };
}

export async function saveReport(sql: Sql, r: MonthlyReport): Promise<void> {
  await sql.execute(
    `INSERT INTO seo_reports (id, period, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(period) DO UPDATE SET body = excluded.body, created_at = excluded.created_at`,
    [`report-${r.period}`, r.period, JSON.stringify(r), r.generatedAt],
  );
}

/** Removes SEO activity and run logs older than KEEP_LOG_DAYS (SEO tables only). */
export async function trimLogs(sql: Sql, now: Date): Promise<{ activity: number; runs: number }> {
  const cut = new Date(now.getTime() - KEEP_LOG_DAYS * 86_400_000).toISOString();
  const [activity, runs] = await sql.batch([
    { sql: `DELETE FROM seo_activity_log WHERE created_at < ?`, args: [cut] },
    { sql: `DELETE FROM seo_job_runs WHERE started_at < ? AND status != 'running'`, args: [cut] },
  ]);
  return { activity, runs };
}

/** The monthly job: last month's report, then old logs trimmed. */
export async function runMonthlyReport(ctx: JobContext, o: { vercel?: VercelConfig | null; http?: Http } = {}) {
  const period = previousPeriod(ctx.now);
  const r = await buildReport(ctx.sql, period, { now: ctx.now, vercel: o.vercel, http: o.http });
  await saveReport(ctx.sql, r);
  const trimmed = await trimLogs(ctx.sql, ctx.now);
  await ctx.log("info", "report_saved", { period, highlights: r.highlights.length, trimmed });
  return { period, highlights: r.highlights, trimmed };
}
