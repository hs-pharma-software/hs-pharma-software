/** Google Analytics 4 import (read-only): daily sessions, engaged sessions and
 * key events per channel (Organic Search among them) into seo_analytics_daily.
 * Re-running a day replaces that day. */
import { randomUUID } from "node:crypto";
import { JobSkip, type JobContext } from "./engine";
import { SCOPES, accessToken, defaultHttp, googleCall, isoDay, parseServiceAccount, type Http } from "./google";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const BACKFILL_DAYS = 90;
const REFRESH_DAYS = 7;
export const GA4_SOURCE = "ga4";

interface Ga4Report { rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[] }
export interface ChannelRow { day: string; channel: string; sessions: number; engaged: number; keyEvents: number }

/** GA4 rows (date YYYYMMDD, channel; sessions, engaged sessions, key events) to channel rows. */
export function toChannelRows(r: Ga4Report): ChannelRow[] {
  return (r.rows ?? []).flatMap((row) => {
    const d = row.dimensionValues?.[0]?.value ?? "";
    if (!/^\d{8}$/.test(d)) return [];
    const m = (i: number) => Number(row.metricValues?.[i]?.value ?? 0) || 0;
    return [{ day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, channel: row.dimensionValues?.[1]?.value || "(other)", sessions: Math.round(m(0)), engaged: Math.round(m(1)), keyEvents: m(2) }];
  });
}

export async function runGa4Sync(ctx: JobContext, o: { propertyId: string; http?: Http; serviceAccountJson?: string }) {
  const raw = o.serviceAccountJson ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const property = o.propertyId.trim().replace(/^properties\//, "");
  if (!raw?.trim() || !property) throw new JobSkip("Google Analytics is not connected: set GOOGLE_SERVICE_ACCOUNT_JSON and GA4_PROPERTY_ID (Settings tab).");
  if (!/^\d+$/.test(property)) throw new Error("GA4_PROPERTY_ID must be the numeric property ID (Admin > Property details).");
  const http = o.http ?? defaultHttp;
  const token = await accessToken(parseServiceAccount(raw), SCOPES.analytics, http);

  const hasData = Number((await ctx.sql.execute(`SELECT COUNT(*) AS n FROM seo_analytics_daily WHERE source = ?`, [GA4_SOURCE])).rows[0]?.n ?? 0) > 0;
  const to = isoDay(ctx.now, -1);
  const from = isoDay(ctx.now, -1 - (hasData ? REFRESH_DAYS : BACKFILL_DAYS) + 1);
  const report = await googleCall<Ga4Report>(http, token, `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
    limit: 10000,
  });
  const rows = toChannelRows(report);
  const t = ctx.now.toISOString();
  await ctx.sql.batch([
    { sql: `DELETE FROM seo_analytics_daily WHERE source = ? AND day >= ? AND day <= ?`, args: [GA4_SOURCE, from, to] },
    ...rows.map((r) => ({
      sql: `INSERT INTO seo_analytics_daily (id, day, channel, sessions, engaged_sessions, key_events, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), r.day, r.channel, r.sessions, r.engaged, r.keyEvents, GA4_SOURCE, t],
    })),
  ]);
  const organic = rows.filter((r) => r.channel === "Organic Search").reduce((n, r) => n + r.sessions, 0);
  await ctx.log("info", "ga4_imported", { from, to, rows: rows.length, organicSessions: organic });
  return { from, to, rows: rows.length, organicSessions: organic };
}
