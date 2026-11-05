/** Core Web Vitals of key public pages from Google PageSpeed Insights (mobile).
 * Read-only. Field data (real Chrome users) is used when Google has it; otherwise
 * the lab test, and the evidence says which. Results become findings
 * (cwv_*) and, when poor, proposed fixes. */
import type { JobContext } from "./engine";
import { recordFindings, type Finding } from "./technical";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface Vitals {
  url: string;
  source: "field" | "lab";
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
}

type Psi = {
  loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
  lighthouseResult?: { categories?: { performance?: { score?: number } }; audits?: Record<string, { numericValue?: number }> };
};

/** Reads the PageSpeed answer: field numbers first, lab numbers otherwise. */
export function parsePsi(url: string, data: Psi): Vitals {
  const field = data.loadingExperience?.metrics ?? {};
  const lab = data.lighthouseResult?.audits ?? {};
  const fieldLcp = field.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
  const hasField = fieldLcp !== undefined;
  const score = data.lighthouseResult?.categories?.performance?.score;
  return {
    url,
    source: hasField ? "field" : "lab",
    score: score === undefined || score === null ? null : Math.round(score * 100),
    lcpMs: hasField ? fieldLcp! : lab["largest-contentful-paint"]?.numericValue ?? null,
    // The field CLS percentile is reported times 100.
    cls: hasField && field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile !== undefined ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : lab["cumulative-layout-shift"]?.numericValue ?? null,
    inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
  };
}

/** Google's thresholds: good / needs improvement / poor. */
export function vitalsFindings(v: Vitals): Finding[] {
  const f: Finding[] = [];
  const ev = { ...v };
  if (v.score !== null && v.score < 90) f.push({ checkId: "cwv_performance", url: v.url, severity: v.score < 50 ? "critical" : "warning", message: `Mobile performance score ${v.score} (${v.source} data).`, evidence: ev });
  if (v.lcpMs !== null && v.lcpMs > 2500) f.push({ checkId: "cwv_lcp", url: v.url, severity: v.lcpMs > 4000 ? "critical" : "warning", message: `Largest Contentful Paint ${(v.lcpMs / 1000).toFixed(1)} s (good is under 2.5 s).`, evidence: ev });
  if (v.cls !== null && v.cls > 0.1) f.push({ checkId: "cwv_cls", url: v.url, severity: v.cls > 0.25 ? "critical" : "warning", message: `Cumulative Layout Shift ${v.cls.toFixed(2)} (good is under 0.1).`, evidence: ev });
  if (v.inpMs !== null && v.inpMs > 200) f.push({ checkId: "cwv_inp", url: v.url, severity: v.inpMs > 500 ? "critical" : "warning", message: `Interaction to Next Paint ${v.inpMs} ms (good is under 200 ms).`, evidence: ev });
  return f;
}

export type PsiFetcher = (url: string) => Promise<Psi>;

export const psiFetcher = (apiKey?: string): PsiFetcher => async (url) => {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "PERFORMANCE" });
  if (apiKey) q.set("key", apiKey);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: ctrl.signal });
    const body = (await res.json().catch(() => ({}))) as Psi & { error?: { message?: string } };
    if (!res.ok) throw new Error(`PageSpeed answered ${res.status}: ${body.error?.message ?? "no details"}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
};

export async function runPageSpeed(ctx: JobContext, o: { urls: string[]; fetch?: PsiFetcher }) {
  const get = o.fetch ?? psiFetcher(process.env.PAGESPEED_API_KEY);
  const results: Vitals[] = [];
  const findings: Finding[] = [];
  const failed: string[] = [];
  // In parallel: each test takes 10 to 30 seconds.
  const settled = await Promise.allSettled(o.urls.map(async (url) => parsePsi(url, await get(url))));
  for (const [i, s] of settled.entries()) {
    if (s.status === "fulfilled") {
      results.push(s.value);
      findings.push(...vitalsFindings(s.value));
    } else {
      failed.push(o.urls[i]);
      await ctx.log("warn", "pagespeed_failed", { url: o.urls[i], error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
    }
  }
  if (!results.length) throw new Error(`PageSpeed could not test any page (${failed.length} failed).`);
  const rec = await recordFindings(ctx.sql, ["cwv_"], findings, ctx.now);
  // A page that could not be tested this time keeps its earlier findings open.
  for (const url of failed) {
    await ctx.sql.execute(`UPDATE seo_audit_findings SET resolved_at = NULL WHERE url = ? AND check_id LIKE 'cwv_%' AND resolved_at = ?`, [url, ctx.now.toISOString()]);
  }
  await ctx.log("info", "pagespeed_done", { tested: results.length, failed: failed.length, ...rec });
  return { results, failed, ...rec };
}
