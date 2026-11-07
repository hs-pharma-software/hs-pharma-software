/** The SEO jobs. Each is read-only towards the site and business data: it
 * reads, audits or drafts, and writes only to the seo_* tables. Jobs without
 * a `run` belong to a later build phase: they are listed but cannot run. */
import type { JobContext, JobDef } from "./engine";
import { integrationStatus, sitePublished } from "./integrations";
import { httpFetcher, parsePage, runTechnicalAudit } from "./technical";
import { runContentProposals } from "./content";
import { refreshPullRequests } from "./studio";
import { runMonthlyReport } from "./report";
import { runPageSpeed } from "./pagespeed";
import { runGscSync } from "./gsc";
import { runGa4Sync } from "./ga4";
import { runKeywordResearch } from "./keywords";
import { APP_URL, SITE_PAGES, SITE_URL } from "../../config/site";
import { SITE_PRODUCTS } from "../../config/siteProducts";

/** Every public page of the website. */
export const PUBLIC_PATHS = [...SITE_PAGES, ...SITE_PRODUCTS.map((p) => `/products/${p.slug}`)];
/** Pages whose speed matters most (PageSpeed is slow, so only a few). */
export const SPEED_PATHS = ["/", "/products", "/products/retail-pharmacy-pos", "/integrations/fbr-digital-invoicing"];

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** Phase 1: is the SEO system itself set up? Configuration only; no outside calls. */
async function healthCheck(ctx: JobContext) {
  const integrations = integrationStatus();
  const missing = integrations.filter((i) => !i.configured);
  const tables = Number((await ctx.sql.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'seo_%'`)).rows[0]?.n ?? 0);
  const published = sitePublished();
  if (!published) await ctx.log("warn", "site_not_published", "The public site is closed to search engines (draft). No search data can be collected until it is opened.");
  for (const i of missing) await ctx.log("info", "integration_not_configured", { integration: i.name, needs: i.needs });
  return { tables, sitePublished: published, configured: integrations.filter((i) => i.configured).map((i) => i.id), missing: missing.map((i) => i.id) };
}

export const SEO_JOBS: JobDef[] = [
  { id: "health_check", label: "SEO system health check", description: "Checks the SEO tables, the integrations that are set up and whether the site is open to search engines.", defaultCadence: "daily", phase: 1, run: healthCheck },
  {
    id: "technical_audit", label: "Technical SEO audit", description: "Metadata, canonicals, sitemap, robots.txt, broken links, duplicates, structured data, and that app pages stay unindexed.", defaultCadence: "daily", phase: 2,
    run: (ctx) => runTechnicalAudit(ctx, { siteUrl: SITE_URL, appUrl: APP_URL, published: sitePublished(), paths: PUBLIC_PATHS }),
  },
  {
    id: "pagespeed", label: "Core Web Vitals (PageSpeed)", description: "Mobile performance and Core Web Vitals of the key public pages.", defaultCadence: "weekly", phase: 2,
    run: (ctx) => runPageSpeed(ctx, { urls: SPEED_PATHS.map((p) => `${SITE_URL}${p === "/" ? "/" : p}`) }),
  },
  {
    id: "gsc_sync", label: "Search Console import", description: "Daily clicks, impressions, CTR, position and indexing from Google Search Console.", defaultCadence: "daily", phase: 3,
    run: (ctx) => runGscSync(ctx, { siteUrl: process.env.GSC_SITE_URL?.trim() ?? "", published: sitePublished(), inspectUrls: PUBLIC_PATHS.map((p) => `${SITE_URL}${p}`) }),
  },
  {
    id: "ga4_sync", label: "Analytics import", description: "Organic visits and conversions from Google Analytics 4, where configured.", defaultCadence: "daily", phase: 3,
    run: (ctx) => runGa4Sync(ctx, { propertyId: process.env.GA4_PROPERTY_ID ?? "" }),
  },
  {
    id: "keyword_research", label: "Keyword research", description: "Pakistan-focused keyword candidates with intent and evidence; no invented volumes.", defaultCadence: "weekly", phase: 4,
    run: (ctx) => runKeywordResearch(ctx, { siteUrl: SITE_URL }),
  },
  {
    id: "content_proposals", label: "Content proposals", description: "Draft articles and better page titles and descriptions for review; approved drafts become pull requests.", defaultCadence: "weekly", phase: 5,
    run: async (ctx) => ({
      // Drafts whose pull request was merged since last week are now published.
      pullRequests: await refreshPullRequests(ctx.sql, "job:content_proposals"),
      ...(await runContentProposals(ctx, {
      siteUrl: SITE_URL,
      currentMeta: async (path) => {
        const r = await httpFetcher(`${SITE_URL}${path}`);
        const p = r.status === 200 ? parsePage(r.body) : null;
        return { title: p?.title ?? undefined, description: p?.description ?? undefined };
      },
    })),
    }),
  },
  {
    id: "monthly_report", label: "Monthly report", description: "Last month's search performance, technical health, keywords, content and automation; trims SEO logs older than 180 days.", defaultCadence: "monthly", phase: 6,
    run: (ctx) => runMonthlyReport(ctx),
  },
  {
    id: "data_retention", label: "Data retention", description: "Deletes website contact and demo enquiries older than 12 months, as the privacy notice says.", defaultCadence: "monthly", phase: 6,
    run: async (ctx) => {
      const cut = new Date(ctx.now.getTime() - 365 * 86_400_000).toISOString();
      const r = await ctx.sql.execute(`DELETE FROM site_queries WHERE created_at < ?`, [cut]);
      return { deletedEnquiries: r.rowsAffected, olderThan: cut.slice(0, 10) };
    },
  },
];
