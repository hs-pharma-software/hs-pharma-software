/** Google Search Console import (read-only). Daily totals, pages and queries go
 * to seo_metrics_daily; once the site is open to search engines, the public
 * pages' index status is checked with URL Inspection and problems become
 * findings (index_*). Re-running a day replaces that day, so imports never
 * double count. */
import { randomUUID } from "node:crypto";
import { JobSkip, setSetting, type JobContext } from "./engine";
import { SCOPES, accessToken, defaultHttp, googleCall, isoDay, parseServiceAccount, type Http } from "./google";
import { pool, recordFindings, type Finding } from "./technical";
import type { Sql } from "../subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const GSC_SOURCES = { total: "gsc_total", page: "gsc_page", query: "gsc_query" } as const;
/** Search Console keeps 16 months; the first import fetches this many days. */
const BACKFILL_DAYS = 90;
/** Later imports refresh this many days (Google revises recent days). */
const REFRESH_DAYS = 16;
const PAGE_SIZE = 5000;
const MAX_ROWS = 25000;
export const INDEX_SUMMARY_KEY = "gsc_index_summary";

interface GscRow { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }
export interface MetricRow { day: string; page: string | null; query: string | null; clicks: number; impressions: number; ctr: number | null; position: number | null; source: string }

/** Turns Search Analytics rows (keys: date, then page or query) into metric rows. */
export function toMetricRows(rows: GscRow[], source: string, second: "page" | "query" | null): MetricRow[] {
  return rows
    .filter((r) => r.keys?.[0])
    .map((r) => ({
      day: r.keys![0],
      page: second === "page" ? r.keys![1] ?? null : null,
      query: second === "query" ? r.keys![1] ?? null : null,
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      ctr: r.ctr ?? null,
      position: r.position ?? null,
      source,
    }));
}

/** Replaces one source's days [from, to] with these rows, in batches. */
export async function replaceMetrics(sql: Sql, source: string, from: string, to: string, rows: MetricRow[], now: Date): Promise<number> {
  const t = now.toISOString();
  const inserts = rows.map((r) => ({
    sql: `INSERT INTO seo_metrics_daily (id, day, page, query, clicks, impressions, ctr, position, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), r.day, r.page, r.query, r.clicks, r.impressions, r.ctr, r.position, source, t],
  }));
  const del = { sql: `DELETE FROM seo_metrics_daily WHERE source = ? AND day >= ? AND day <= ?`, args: [source, from, to] };
  // The delete and the first rows commit together; the rest follow in chunks.
  const CHUNK = 400;
  await sql.batch([del, ...inserts.slice(0, CHUNK)]);
  for (let i = CHUNK; i < inserts.length; i += CHUNK) await sql.batch(inserts.slice(i, i + CHUNK));
  return rows.length;
}

export interface GscOptions { siteUrl: string; published: boolean; inspectUrls: string[]; http?: Http; serviceAccountJson?: string }

interface Inspection {
  inspectionResult?: {
    indexStatusResult?: { verdict?: string; coverageState?: string; robotsTxtState?: string; indexingState?: string; lastCrawlTime?: string; googleCanonical?: string; userCanonical?: string; pageFetchState?: string };
  };
}

/** What an inspection says is wrong with a page (nothing when it is indexed as itself). */
export function inspectionFindings(url: string, r: Inspection): Finding[] {
  const s = r.inspectionResult?.indexStatusResult;
  if (!s) return [];
  const evidence = { verdict: s.verdict, coverage: s.coverageState, lastCrawl: s.lastCrawlTime ?? null, googleCanonical: s.googleCanonical ?? null, userCanonical: s.userCanonical ?? null };
  const out: Finding[] = [];
  if (s.verdict && s.verdict !== "PASS") {
    out.push({ checkId: "index_not_indexed", url, severity: s.verdict === "FAIL" ? "critical" : "warning", message: `Not in Google's index: ${s.coverageState ?? s.verdict}.`, evidence });
  }
  if (s.googleCanonical && s.userCanonical && s.googleCanonical !== s.userCanonical) {
    out.push({ checkId: "index_canonical_mismatch", url, severity: "warning", message: `Google chose ${s.googleCanonical} as the original instead of this page.`, evidence });
  }
  return out;
}

export async function runGscSync(ctx: JobContext, o: GscOptions) {
  const raw = o.serviceAccountJson ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim() || !o.siteUrl) throw new JobSkip("Search Console is not connected: set GOOGLE_SERVICE_ACCOUNT_JSON and GSC_SITE_URL (Settings tab).");
  const http = o.http ?? defaultHttp;
  const token = await accessToken(parseServiceAccount(raw), SCOPES.searchConsole, http);
  const site = encodeURIComponent(o.siteUrl);

  const hasData = Number((await ctx.sql.execute(`SELECT COUNT(*) AS n FROM seo_metrics_daily WHERE source = ?`, [GSC_SOURCES.total])).rows[0]?.n ?? 0) > 0;
  // Search data arrives about two days late.
  const to = isoDay(ctx.now, -2);
  const from = isoDay(ctx.now, -2 - (hasData ? REFRESH_DAYS : BACKFILL_DAYS) + 1);

  const query = async (dimensions: string[]) => {
    const rows: GscRow[] = [];
    for (let start = 0; start < MAX_ROWS; start += PAGE_SIZE) {
      const r = await googleCall<{ rows?: GscRow[] }>(http, token, `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
        startDate: from, endDate: to, dimensions, rowLimit: PAGE_SIZE, startRow: start, type: "web",
      });
      rows.push(...(r.rows ?? []));
      if ((r.rows?.length ?? 0) < PAGE_SIZE) break;
    }
    return rows;
  };

  const imported = {
    days: await replaceMetrics(ctx.sql, GSC_SOURCES.total, from, to, toMetricRows(await query(["date"]), GSC_SOURCES.total, null), ctx.now),
    pages: await replaceMetrics(ctx.sql, GSC_SOURCES.page, from, to, toMetricRows(await query(["date", "page"]), GSC_SOURCES.page, "page"), ctx.now),
    queries: await replaceMetrics(ctx.sql, GSC_SOURCES.query, from, to, toMetricRows(await query(["date", "query"]), GSC_SOURCES.query, "query"), ctx.now),
  };
  await ctx.log("info", "gsc_imported", { from, to, ...imported });

  // Index status: only meaningful once search engines may index the site.
  let indexing: Record<string, unknown> = { checked: 0, reason: "The site is in draft (closed to search engines)." };
  if (o.published && o.inspectUrls.length) {
    const results = await pool(o.inspectUrls, async (url) => {
      try {
        const r = await googleCall<Inspection>(http, token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: url, siteUrl: o.siteUrl });
        return { url, ok: true as const, r };
      } catch (e) {
        return { url, ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    }, 3);
    const done = results.filter((x) => x.ok);
    const failed = results.filter((x) => !x.ok);
    const findings = done.flatMap((x) => (x.ok ? inspectionFindings(x.url, x.r) : []));
    const verdicts = done.map((x) => (x.ok ? x.r.inspectionResult?.indexStatusResult?.verdict : undefined));
    indexing = { checked: done.length, indexed: verdicts.filter((v) => v === "PASS").length, notIndexed: verdicts.filter((v) => v && v !== "PASS").length, failed: failed.length, at: ctx.now.toISOString() };
    // Old index findings are resolved only when every page was inspected; a
    // page that could not be inspected keeps its previous finding.
    const rec = await recordFindings(ctx.sql, failed.length ? [] : ["index_"], findings, ctx.now);
    if (failed.length) await ctx.log("warn", "inspection_failed", failed.map((x) => ({ url: x.url, error: x.ok ? null : x.error })));
    indexing = { ...indexing, ...rec };
  }
  await setSetting(ctx.sql, INDEX_SUMMARY_KEY, JSON.stringify(indexing), "job:gsc_sync");
  return { from, to, ...imported, indexing };
}
