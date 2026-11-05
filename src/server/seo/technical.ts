/** Technical SEO audit of the public website (phase 2). Read-only: it fetches
 * the site's own public pages, robots.txt and sitemap, checks them, and
 * records findings and proposed fixes in the seo_* tables. It never changes
 * the site; fixes are proposals waiting for approval.
 *
 * Parsing and checks are pure functions (tested on made-up pages); fetching
 * goes through a Fetcher so tests need no network. */
import { randomUUID } from "node:crypto";
import type { Sql } from "../subSupers";
import type { JobContext } from "./engine";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export type Severity = "critical" | "warning" | "info";
export interface Finding { checkId: string; url: string; severity: Severity; message: string; evidence?: unknown }

export interface FetchResult { url: string; status: number; finalUrl: string; body: string; contentType: string; error?: string }
export type Fetcher = (url: string, opts?: { method?: "GET" | "HEAD" }) => Promise<FetchResult>;

export interface ParsedPage {
  title: string | null;
  description: string | null;
  robots: string | null;
  canonical: string | null;
  lang: string | null;
  h1: number;
  jsonLd: { valid: boolean; types: string[] }[];
  imagesWithoutAlt: number;
  links: string[];
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decode(m[2] ?? m[3] ?? "") : null;
};
const metaContent = (html: string, name: string) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) if ((attr(tag, "name") ?? attr(tag, "property"))?.toLowerCase() === name) return attr(tag, "content");
  return null;
};

export function parsePage(html: string): ParsedPage {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  let canonical: string | null = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) if (attr(tag, "rel")?.toLowerCase() === "canonical") canonical = attr(tag, "href");
  const jsonLd = [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : data["@graph"] ?? [data];
      return { valid: true, types: items.map((i: { "@type"?: string | string[] }) => [i?.["@type"]].flat()).flat().filter(Boolean).map(String) };
    } catch {
      return { valid: false, types: [] };
    }
  });
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  return {
    title: title ? decode(title[1].replace(/\s+/g, " ")) : null,
    description: metaContent(html, "description"),
    robots: metaContent(html, "robots"),
    canonical,
    lang: (/<html\b[^>]*>/i.exec(html)?.[0] && attr(/<html\b[^>]*>/i.exec(html)![0], "lang")) || null,
    h1: (html.match(/<h1\b/gi) ?? []).length,
    jsonLd,
    // A decorative image may have alt="" on purpose; only a missing alt counts.
    imagesWithoutAlt: imgs.filter((t) => attr(t, "alt") === null).length,
    links: [...html.matchAll(/<a\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => decode(m[2] ?? m[3] ?? "")),
  };
}

/** Same-site links of a page, as absolute URLs without fragments. */
export function internalLinks(links: string[], pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const out = new Set<string>();
  for (const href of links) {
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.host !== base.host) continue;
      u.hash = "";
      out.add(u.toString());
    } catch {
      // not a URL
    }
  }
  return [...out];
}

/** Structured data each kind of page should carry. */
export function expectedSchema(path: string): string | null {
  if (path === "/") return "Organization";
  if (/^\/products\/[^/]+\/?$/.test(path)) return "SoftwareApplication";
  return null;
}

/** Checks one fetched page. `published` = the site is open to search engines. */
export function checkPage(url: string, res: FetchResult, page: ParsedPage | null, opts: { siteUrl: string; published: boolean }): Finding[] {
  const f: Finding[] = [];
  const add = (checkId: string, severity: Severity, message: string, evidence?: unknown) => f.push({ checkId, url, severity, message, evidence });
  if (res.error || res.status >= 400) {
    add("page_status", "critical", res.error ? `The page could not be loaded: ${res.error}` : `The page answers ${res.status}.`, { status: res.status });
    return f;
  }
  if (!page) return f;
  const path = new URL(url).pathname;
  if (!page.title) add("title_missing", "critical", "No <title>.");
  else if (page.title.length < 15) add("title_short", "warning", `The title is very short (${page.title.length} characters).`, { title: page.title });
  else if (page.title.length > 60) add("title_long", "warning", `The title is ${page.title.length} characters; search results cut it at about 60.`, { title: page.title });
  if (!page.description) add("description_missing", "warning", "No meta description.");
  else if (page.description.length < 70 || page.description.length > 160) {
    add("description_length", "info", `The description is ${page.description.length} characters (aim for 70 to 160).`, { description: page.description });
  }
  if (!page.canonical) add("canonical_missing", "warning", "No canonical link.");
  else {
    try {
      const c = new URL(page.canonical);
      const site = new URL(opts.siteUrl);
      if (c.host !== site.host) add("canonical_host", "critical", `The canonical points to ${c.host}, not ${site.host}.`, { canonical: page.canonical });
      else if (c.pathname.replace(/\/+$/, "") !== path.replace(/\/+$/, "")) add("canonical_other", "warning", "The canonical points to a different page.", { canonical: page.canonical });
    } catch {
      add("canonical_invalid", "critical", "The canonical link is not a full address.", { canonical: page.canonical });
    }
  }
  if (page.h1 === 0) add("h1_missing", "warning", "No <h1> heading.");
  else if (page.h1 > 1) add("h1_multiple", "info", `${page.h1} <h1> headings; one is clearer.`);
  if (!page.lang) add("lang_missing", "info", "The page does not declare its language (<html lang>).");
  if (page.imagesWithoutAlt) add("img_alt", "warning", `${page.imagesWithoutAlt} image(s) without alt text.`);
  for (const j of page.jsonLd) if (!j.valid) add("jsonld_invalid", "critical", "Structured data (JSON-LD) is not valid JSON.");
  const want = expectedSchema(path);
  if (want && !page.jsonLd.some((j) => j.types.includes(want))) add("jsonld_missing", "warning", `No ${want} structured data.`, { expected: want });
  if (opts.published && page.robots && /noindex/i.test(page.robots)) add("noindex_published", "critical", "The page asks search engines not to index it, but the site is open.", { robots: page.robots });
  return f;
}

/** Titles and descriptions shared by several pages. */
export function duplicateFindings(pages: { url: string; page: ParsedPage }[]): Finding[] {
  const f: Finding[] = [];
  for (const key of ["title", "description"] as const) {
    const by = new Map<string, string[]>();
    for (const p of pages) {
      const v = p.page[key];
      if (v) by.set(v, [...(by.get(v) ?? []), p.url]);
    }
    for (const [value, urls] of by) {
      if (urls.length < 2) continue;
      for (const url of urls) f.push({ checkId: `${key}_duplicate`, url, severity: "warning", message: `The same ${key} is used on ${urls.length} pages.`, evidence: { value, pages: urls } });
    }
  }
  return f;
}

/** robots.txt of the website and of the app. */
export function checkRobots(site: FetchResult, app: FetchResult | null, opts: { siteUrl: string; appUrl: string; published: boolean }): Finding[] {
  const f: Finding[] = [];
  const robotsUrl = `${opts.siteUrl}/robots.txt`;
  if (site.status !== 200) f.push({ checkId: "robots_missing", url: robotsUrl, severity: "critical", message: `robots.txt answers ${site.status}.` });
  else {
    const blocksAll = /^\s*disallow:\s*\/\s*$/im.test(site.body) && !/^\s*allow:\s*\/\s*$/im.test(site.body);
    if (opts.published && blocksAll) f.push({ checkId: "robots_blocks_site", url: robotsUrl, severity: "critical", message: "robots.txt blocks the whole site although it is open.", evidence: { robots: site.body.slice(0, 300) } });
    if (!opts.published && blocksAll) f.push({ checkId: "site_closed", url: robotsUrl, severity: "info", message: "The site is closed to search engines (draft). Expected until it is approved and opened." });
    if (opts.published && !/^\s*sitemap:/im.test(site.body)) f.push({ checkId: "robots_no_sitemap", url: robotsUrl, severity: "warning", message: "robots.txt does not name the sitemap." });
  }
  // The app (POS, Super Admin, Sub Supers) must never be indexed.
  if (app) {
    const appRobots = `${opts.appUrl}/robots.txt`;
    if (app.status !== 200 || !/^\s*disallow:\s*\/\s*$/im.test(app.body)) {
      f.push({ checkId: "app_indexable", url: appRobots, severity: "critical", message: "The app's robots.txt does not block search engines: POS and admin pages could be indexed.", evidence: { status: app.status, robots: app.body.slice(0, 300) } });
    }
  }
  return f;
}

/** Page addresses listed in a sitemap. */
export function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
}

export function checkSitemap(res: FetchResult, opts: { siteUrl: string; published: boolean; expectedPaths: string[] }): Finding[] {
  const url = `${opts.siteUrl}/sitemap.xml`;
  if (res.status !== 200) return [{ checkId: "sitemap_missing", url, severity: opts.published ? "critical" : "info", message: `sitemap.xml answers ${res.status}.` }];
  if (!/<urlset[\s>]/i.test(res.body)) return [{ checkId: "sitemap_invalid", url, severity: "critical", message: "sitemap.xml is not a valid sitemap." }];
  const listed = new Set(sitemapUrls(res.body).map((u) => { try { return new URL(u).pathname.replace(/\/+$/, "") || "/"; } catch { return u; } }));
  if (!opts.published) return listed.size ? [] : [{ checkId: "sitemap_empty", url, severity: "info", message: "The sitemap is empty while the site is closed (expected)." }];
  const missing = opts.expectedPaths.filter((p) => !listed.has(p.replace(/\/+$/, "") || "/"));
  return missing.length ? [{ checkId: "sitemap_incomplete", url, severity: "warning", message: `${missing.length} public page(s) are not in the sitemap.`, evidence: { missing } }] : [];
}

// ── Recording ─────────────────────────────────────────────────────────────

/** What to propose for a finding (null: nothing to propose, e.g. "site closed"). */
export function proposalFor(f: Finding): { title: string; detail: string; impact: string } | null {
  const P: Record<string, [string, string, string]> = {
    page_status: ["Fix a page that does not load", "Restore the page or redirect it to the right page (a redirect needs your approval).", "high"],
    broken_link: ["Fix a broken link", "Update or remove the link that points to a missing page.", "high"],
    title_missing: ["Add a page title", "Give the page a specific title of 30 to 60 characters with its main topic.", "high"],
    title_long: ["Shorten the page title", "Keep the title under about 60 characters so search results show it in full.", "medium"],
    title_short: ["Make the page title more descriptive", "Say what the page offers, e.g. product and sector.", "medium"],
    title_duplicate: ["Give each page its own title", "Several pages share one title; search engines cannot tell them apart.", "medium"],
    description_missing: ["Add a meta description", "Write a 70 to 160 character summary that makes people want to click.", "medium"],
    description_duplicate: ["Give each page its own description", "Several pages share one description.", "medium"],
    canonical_missing: ["Add a canonical link", "Point the page to its own official address on www.mavin.pk.", "medium"],
    canonical_host: ["Fix the canonical address", "The canonical must use the official address www.mavin.pk.", "high"],
    canonical_other: ["Check the canonical link", "The page says another page is the original; confirm that is intended.", "medium"],
    canonical_invalid: ["Fix the canonical link", "Use a full address starting with https://www.mavin.pk.", "high"],
    h1_missing: ["Add a main heading", "Give the page one <h1> that states its topic.", "low"],
    img_alt: ["Describe images", "Add alt text to images so search engines and screen readers understand them.", "low"],
    jsonld_missing: ["Add structured data", "Add schema.org structured data so search results can show richer information.", "medium"],
    jsonld_invalid: ["Fix structured data", "The JSON-LD block cannot be read; correct its syntax.", "high"],
    noindex_published: ["Allow this page in search", "Remove noindex from a page that should appear in search (needs your approval).", "high"],
    robots_blocks_site: ["Open robots.txt", "robots.txt blocks the whole site although it is published (needs your approval).", "high"],
    robots_no_sitemap: ["Name the sitemap in robots.txt", "Add a Sitemap: line so search engines find every page.", "low"],
    sitemap_incomplete: ["Complete the sitemap", "List every public page in sitemap.xml.", "medium"],
    sitemap_invalid: ["Fix the sitemap", "sitemap.xml is not valid; search engines cannot read it.", "high"],
    sitemap_missing: ["Restore the sitemap", "sitemap.xml cannot be loaded.", "high"],
    app_indexable: ["Block the app from search", "POS and admin pages must stay out of search results: restore Disallow: / in the app's robots.txt.", "high"],
    cwv_performance: ["Improve mobile speed", "Work on the page's largest content and scripts; see the PageSpeed evidence.", "medium"],
    cwv_lcp: ["Speed up the main content", "The largest element appears too late on mobile; compress images and defer heavy scripts.", "medium"],
    cwv_inp: ["Make the page respond faster", "Taps take too long to show a response on mobile; reduce long-running scripts.", "medium"],
    cwv_cls: ["Stop layout shifts", "Reserve space for images and late content so the page does not jump.", "medium"],
    index_not_indexed: ["Get the page into Google", "Open the page in Search Console's URL Inspection, fix the reason shown, then request indexing there.", "high"],
    index_canonical_mismatch: ["Check which page Google treats as the original", "Google picked another address as this page's original; make the canonical and internal links agree.", "medium"],
  };
  const p = P[f.checkId];
  return p ? { title: p[0], detail: p[1], impact: p[2] } : null;
}

/** Records this run's findings: new ones are added, seen ones refreshed, gone ones resolved.
 * Every new warning or critical finding gets one proposed fix (never duplicated). */
export async function recordFindings(sql: Sql, scope: string[], findings: Finding[], now = new Date()): Promise<{ added: number; resolved: number; proposals: number }> {
  const t = now.toISOString();
  let added = 0;
  let proposals = 0;
  for (const f of findings) {
    const evidence = f.evidence === undefined ? null : JSON.stringify(f.evidence).slice(0, 4000);
    const existing = (await sql.execute(`SELECT id, resolved_at FROM seo_audit_findings WHERE check_id = ? AND url = ?`, [f.checkId, f.url])).rows[0];
    if (existing) {
      await sql.execute(`UPDATE seo_audit_findings SET severity = ?, message = ?, evidence = ?, last_seen_at = ?, resolved_at = NULL WHERE id = ?`, [f.severity, f.message, evidence, t, existing.id]);
    } else {
      await sql.execute(
        `INSERT INTO seo_audit_findings (id, check_id, url, severity, message, evidence, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), f.checkId, f.url, f.severity, f.message, evidence, t, t],
      );
      added++;
    }
    const p = f.severity === "info" ? null : proposalFor(f);
    if (p) {
      const open = (await sql.execute(`SELECT 1 FROM seo_recommendations WHERE kind = ? AND url = ? AND status IN ('proposed','approved')`, [f.checkId, f.url])).rows[0];
      if (!open) {
        await sql.execute(
          `INSERT INTO seo_recommendations (id, kind, title, detail, evidence, url, impact, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
          [randomUUID(), f.checkId, p.title, p.detail, JSON.stringify({ finding: f.message, ...(f.evidence ? { data: f.evidence } : {}) }).slice(0, 4000), f.url, p.impact, t, t],
        );
        proposals++;
      }
    }
  }
  // Checks of this scope that did not come back are fixed.
  const seen = new Set(findings.map((f) => `${f.checkId}|${f.url}`));
  const open = (await sql.execute(`SELECT id, check_id, url FROM seo_audit_findings WHERE resolved_at IS NULL`)).rows
    .filter((r) => scope.some((s) => String(r.check_id).startsWith(s)) && !seen.has(`${r.check_id}|${r.url}`));
  for (const r of open) await sql.execute(`UPDATE seo_audit_findings SET resolved_at = ? WHERE id = ?`, [t, r.id]);
  return { added, resolved: open.length, proposals };
}

// ── The job ───────────────────────────────────────────────────────────────

/** Default fetcher: our own public pages only, 15 s timeout, no cookies. */
export const httpFetcher: Fetcher = async (url, opts = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { method: opts.method ?? "GET", redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "MavinSEOAudit/1.0 (+https://www.mavin.pk)" } });
    const body = opts.method === "HEAD" ? "" : (await res.text()).slice(0, 2_000_000);
    return { url, status: res.status, finalUrl: res.url || url, body, contentType: res.headers.get("content-type") ?? "" };
  } catch (e) {
    return { url, status: 0, finalUrl: url, body: "", contentType: "", error: e instanceof Error ? (e.name === "AbortError" ? "timed out" : e.message) : String(e) };
  } finally {
    clearTimeout(timer);
  }
};

export const AUDIT_CHECKS = [
  "page_status", "title_", "description_", "canonical_", "h1_", "lang_", "img_alt", "jsonld_", "noindex_", "robots_", "site_closed", "sitemap_", "app_indexable", "broken_link",
];
const MAX_LINKS = 150;
const CONCURRENCY = 6;

/** Runs fn over items, a few at a time, keeping the order of results. */
export async function pool<T, R>(items: T[], fn: (x: T) => Promise<R>, size = CONCURRENCY): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export async function runTechnicalAudit(ctx: JobContext, o: { siteUrl: string; appUrl: string; published: boolean; paths: string[]; fetcher?: Fetcher }) {
  const fetcher = o.fetcher ?? httpFetcher;
  const findings: Finding[] = [];
  const parsed: { url: string; page: ParsedPage }[] = [];
  const links = new Set<string>();
  const fetched = await pool(o.paths, async (path) => {
    const url = `${o.siteUrl}${path}`;
    return { url, res: await fetcher(url) };
  });
  for (const { url, res } of fetched) {
    const page = res.status && res.status < 400 && /html/i.test(res.contentType || "text/html") ? parsePage(res.body) : null;
    findings.push(...checkPage(url, res, page, { siteUrl: o.siteUrl, published: o.published }));
    if (page) {
      parsed.push({ url, page });
      for (const l of internalLinks(page.links, res.finalUrl || url)) links.add(l);
    }
  }
  findings.push(...duplicateFindings(parsed));
  const crawled = new Set(o.paths.map((p) => `${o.siteUrl}${p}`));
  const toCheck = [...links].filter((l) => !crawled.has(l) && !crawled.has(l.replace(/\/$/, ""))).slice(0, MAX_LINKS);
  const checked = await pool(toCheck, async (l) => ({ l, r: await fetcher(l, { method: "HEAD" }) }));
  for (const { l, r } of checked) {
    if (r.error || r.status >= 400) findings.push({ checkId: "broken_link", url: l, severity: "critical", message: r.error ? `Linked page could not be loaded: ${r.error}` : `Linked page answers ${r.status}.`, evidence: { status: r.status } });
  }
  findings.push(...checkRobots(await fetcher(`${o.siteUrl}/robots.txt`), await fetcher(`${o.appUrl}/robots.txt`), o));
  findings.push(...checkSitemap(await fetcher(`${o.siteUrl}/sitemap.xml`), { siteUrl: o.siteUrl, published: o.published, expectedPaths: o.paths }));
  const rec = await recordFindings(ctx.sql, AUDIT_CHECKS, findings, ctx.now);
  const by = (s: Severity) => findings.filter((f) => f.severity === s).length;
  await ctx.log(by("critical") ? "warn" : "info", "audit_done", { pages: o.paths.length, linksChecked: toCheck.length, critical: by("critical"), warning: by("warning"), info: by("info"), ...rec });
  return { pages: o.paths.length, linksChecked: toCheck.length, critical: by("critical"), warning: by("warning"), info: by("info"), ...rec };
}
