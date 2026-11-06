/** Which SEO integrations are configured. Only whether each secret is set is
 * reported, never its value. Secrets live in the server's environment
 * (Vercel > Settings > Environment Variables), never in the database. */
if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface IntegrationStatus {
  id: string;
  name: string;
  /** What it is used for. */
  purpose: string;
  /** Environment variables it needs (names only). */
  needs: string[];
  configured: boolean;
  /** Build phase that uses it. */
  phase: number;
  /** Least-privilege access to grant. */
  access: string;
}

const has = (name: string, env: Record<string, string | undefined>) => Boolean(env[name]?.trim());

export function integrationStatus(env: Record<string, string | undefined> = process.env): IntegrationStatus[] {
  const list: Omit<IntegrationStatus, "configured">[] = [
    { id: "scheduler", name: "Scheduler (Vercel Cron)", purpose: "Runs the daily, weekly and monthly jobs.", needs: ["CRON_SECRET"], phase: 1, access: "A random secret only the cron job sends." },
    { id: "pagespeed", name: "Google PageSpeed Insights", purpose: "Core Web Vitals and mobile checks.", needs: ["PAGESPEED_API_KEY"], phase: 2, access: "An API key restricted to the PageSpeed Insights API (optional: works without, with lower limits)." },
    { id: "gsc", name: "Google Search Console", purpose: "Clicks, impressions, CTR, position, indexing.", needs: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GSC_SITE_URL"], phase: 3, access: "Service account added to the property as a restricted (read-only) user." },
    { id: "ga4", name: "Google Analytics 4", purpose: "Visits and conversions from organic search.", needs: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GA4_PROPERTY_ID"], phase: 3, access: "Service account with the Viewer role on the property. The site sends visits only when NEXT_PUBLIC_GA_MEASUREMENT_ID (G-…) is set." },
    { id: "github", name: "GitHub", purpose: "Approved changes as a branch and pull request.", needs: ["GITHUB_TOKEN", "GITHUB_REPO"], phase: 5, access: "Fine-grained token for this repository only: contents and pull requests (read and write). GITHUB_REPO is owner/name; GITHUB_BASE_BRANCH defaults to main." },
    { id: "vercel", name: "Vercel", purpose: "Deployment status in reports.", needs: ["VERCEL_API_TOKEN", "VERCEL_PROJECT_ID"], phase: 6, access: "A read-only token scoped to this project." },
  ];
  return list.map((i) => ({
    ...i,
    // PageSpeed works without a key (lower quota), so it counts as available.
    configured: i.id === "pagespeed" ? true : i.needs.every((n) => has(n, env)),
  }));
}

/** Whether the public site is open to search engines (config/site.ts). */
export function sitePublished(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_SITE_PUBLISHED === "1";
}
