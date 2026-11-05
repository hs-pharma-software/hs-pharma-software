/** SEO Manager, phase 2: the technical audit and Core Web Vitals, on made-up
 * pages through a fake fetcher (no network). Findings are recorded, refreshed
 * and resolved; each problem gets one proposed fix; business data is untouched. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { JobContext } from "@/server/seo/engine";
import {
  checkPage, checkRobots, checkSitemap, duplicateFindings, internalLinks, parsePage, recordFindings, runTechnicalAudit, type Fetcher, type FetchResult,
} from "@/server/seo/technical";
import { parsePsi, runPageSpeed, vitalsFindings } from "@/server/seo/pagespeed";
import { decideRecommendation } from "@/server/seo/admin";
import type { Sql } from "@/server/subSupers";

const SITE = "https://www.example-site.pk";
const APP = "https://app.example-site.pk";
let db: DatabaseSync;
let sql: Sql;
let ctx: JobContext;

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  ctx = { sql, now: new Date("2026-11-06T01:00:00.000Z"), log: async () => {} };
});

const ok = (url: string, body: string, contentType = "text/html"): FetchResult => ({ url, status: 200, finalUrl: url, body, contentType });
const html = (o: { title?: string; desc?: string; canonical?: string; h1?: number; ld?: string; img?: string; links?: string[]; robots?: string; lang?: boolean } = {}) => `<!doctype html>
<html${o.lang === false ? "" : ' lang="en"'}><head>${o.title !== undefined ? `<title>${o.title}</title>` : ""}
${o.desc !== undefined ? `<meta name="description" content="${o.desc}"/>` : ""}
${o.robots ? `<meta name="robots" content="${o.robots}"/>` : ""}
${o.canonical ? `<link rel="canonical" href="${o.canonical}"/>` : ""}
${o.ld ? `<script type="application/ld+json">${o.ld}</script>` : ""}</head>
<body>${"<h1>Heading</h1>".repeat(o.h1 ?? 1)}${o.img ?? ""}${(o.links ?? []).map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;
const GOOD_DESC = "Billing, stock and FBR invoicing for Pakistani pharmacies, in one simple web app.";

test("a well-built page has no findings; a poor one gets each problem named", () => {
  const url = `${SITE}/products/retail-pharmacy-pos`;
  const good = parsePage(html({ title: "Retail Pharmacy POS | MAVIN.pk", desc: GOOD_DESC, canonical: url, ld: JSON.stringify({ "@type": "SoftwareApplication" }), img: '<img src="a.png" alt="Screen">' }));
  assert.deepEqual(checkPage(url, ok(url, ""), good, { siteUrl: SITE, published: true }), []);

  const bad = parsePage(html({ title: "POS", canonical: "https://other.pk/x", h1: 0, ld: "{not json", img: '<img src="a.png"><img src="b.png" alt="">', lang: false }));
  const ids = checkPage(url, ok(url, ""), bad, { siteUrl: SITE, published: true }).map((f) => f.checkId).sort();
  assert.deepEqual(ids, ["canonical_host", "description_missing", "h1_missing", "img_alt", "jsonld_invalid", "jsonld_missing", "lang_missing", "title_short"]);
});

test("page status, noindex only matters once the site is open, long titles", () => {
  const url = `${SITE}/pricing`;
  assert.equal(checkPage(url, { url, status: 404, finalUrl: url, body: "", contentType: "" }, null, { siteUrl: SITE, published: true })[0].checkId, "page_status");
  const noindex = parsePage(html({ title: "Pricing for every business | MAVIN.pk", desc: GOOD_DESC, canonical: url, robots: "noindex, nofollow" }));
  assert.equal(checkPage(url, ok(url, ""), noindex, { siteUrl: SITE, published: false }).length, 0, "draft: expected");
  assert.deepEqual(checkPage(url, ok(url, ""), noindex, { siteUrl: SITE, published: true }).map((f) => f.checkId), ["noindex_published"]);
  const long = parsePage(html({ title: "x".repeat(70), desc: GOOD_DESC, canonical: url }));
  assert.equal(checkPage(url, ok(url, ""), long, { siteUrl: SITE, published: true })[0].checkId, "title_long");
});

test("duplicate titles and descriptions are named on every page that shares them", () => {
  const p = (t: string) => parsePage(html({ title: t, desc: GOOD_DESC }));
  const f = duplicateFindings([{ url: `${SITE}/a`, page: p("Same title for both pages") }, { url: `${SITE}/b`, page: p("Same title for both pages") }, { url: `${SITE}/c`, page: p("A different title here") }]);
  assert.deepEqual(f.filter((x) => x.checkId === "title_duplicate").map((x) => x.url), [`${SITE}/a`, `${SITE}/b`]);
  assert.equal(f.filter((x) => x.checkId === "description_duplicate").length, 3);
});

test("internal links: same site only, absolute, no fragments or mail links", () => {
  assert.deepEqual(
    internalLinks(["/pricing/", "products#x", "https://other.pk/a", "mailto:a@b.pk", "#top", `${SITE}/help/`], `${SITE}/products/`).sort(),
    [`${SITE}/help/`, `${SITE}/pricing/`, `${SITE}/products/products`].sort(),
  );
});

test("robots.txt: closed site is a note, open-but-blocked is critical, an indexable app is critical", () => {
  const blocked = ok(`${SITE}/robots.txt`, "User-agent: *\nDisallow: /\n", "text/plain");
  const appBlocked = ok(`${APP}/robots.txt`, "User-agent: *\nDisallow: /\n", "text/plain");
  assert.deepEqual(checkRobots(blocked, appBlocked, { siteUrl: SITE, appUrl: APP, published: false }).map((f) => [f.checkId, f.severity]), [["site_closed", "info"]]);
  assert.deepEqual(checkRobots(blocked, appBlocked, { siteUrl: SITE, appUrl: APP, published: true }).map((f) => f.checkId), ["robots_blocks_site", "robots_no_sitemap"]);
  const open = ok(`${SITE}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`, "text/plain");
  const appOpen = ok(`${APP}/robots.txt`, "User-agent: *\nAllow: /\n", "text/plain");
  assert.deepEqual(checkRobots(open, appOpen, { siteUrl: SITE, appUrl: APP, published: true }).map((f) => [f.checkId, f.severity]), [["app_indexable", "critical"]]);
});

test("sitemap: empty is fine while closed; once open every public page must be listed", () => {
  const empty = ok(`${SITE}/sitemap.xml`, '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', "application/xml");
  assert.equal(checkSitemap(empty, { siteUrl: SITE, published: false, expectedPaths: ["/"] })[0].severity, "info");
  const partial = ok(`${SITE}/sitemap.xml`, `<urlset><url><loc>${SITE}</loc></url><url><loc>${SITE}/pricing</loc></url></urlset>`, "application/xml");
  const f = checkSitemap(partial, { siteUrl: SITE, published: true, expectedPaths: ["/", "/pricing", "/help"] });
  assert.deepEqual(f.map((x) => x.checkId), ["sitemap_incomplete"]);
  assert.deepEqual((f[0].evidence as { missing: string[] }).missing, ["/help"]);
  assert.equal(checkSitemap(ok("x", "<html></html>"), { siteUrl: SITE, published: true, expectedPaths: [] })[0].checkId, "sitemap_invalid");
});

test("findings are added once, refreshed, then resolved; one proposed fix per problem", async () => {
  const f1 = { checkId: "title_missing", url: `${SITE}/a`, severity: "critical" as const, message: "No <title>." };
  const note = { checkId: "site_closed", url: `${SITE}/robots.txt`, severity: "info" as const, message: "closed" };
  assert.deepEqual(await recordFindings(sql, ["title_", "site_closed"], [f1, note]), { added: 2, resolved: 0, proposals: 1 });
  assert.deepEqual(await recordFindings(sql, ["title_", "site_closed"], [f1, note]), { added: 0, resolved: 0, proposals: 0 }, "no duplicate fix proposed");
  assert.deepEqual(await recordFindings(sql, ["title_", "site_closed"], [note]), { added: 0, resolved: 1, proposals: 0 }, "fixed on the site: resolved");
  assert.ok((db.prepare(`SELECT resolved_at FROM seo_audit_findings WHERE check_id = 'title_missing'`).get() as { resolved_at: string }).resolved_at);
  const rec = db.prepare(`SELECT id, status FROM seo_recommendations`).all() as { id: string; status: string }[];
  assert.equal(rec.length, 1, "notes get no proposal");
  await assert.rejects(decideRecommendation(sql, "admin:1", rec[0].id, "rejected", ""), /Say why/);
  await decideRecommendation(sql, "admin:1", rec[0].id, "approved", null);
  assert.equal((db.prepare(`SELECT status FROM seo_recommendations`).get() as { status: string }).status, "approved");
  // The problem comes back while its fix is approved: still one proposal.
  await recordFindings(sql, ["title_"], [f1]);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM seo_recommendations`).get() as { n: number }).n, 1);
});

test("the full audit on a fake site: pages, broken links, robots, sitemap; business data untouched", async () => {
  db.prepare(`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ('t1', 'Synthetic Store', 'x', 'x')`).run();
  const before = JSON.stringify(db.prepare(`SELECT * FROM tenants`).all());
  const pages: Record<string, string> = {
    [`${SITE}/`]: html({ title: "MAVIN.pk", desc: "Offline-first pharmacy management", links: ["/pricing", "/gone"] }),
    [`${SITE}/pricing`]: html({ title: "Pricing | MAVIN.pk business software", desc: GOOD_DESC, canonical: `${SITE}/pricing` }),
  };
  const calls: string[] = [];
  const fetcher: Fetcher = async (url, o) => {
    calls.push(`${o?.method ?? "GET"} ${url}`);
    if (url === `${SITE}/robots.txt` || url === `${APP}/robots.txt`) return ok(url, "User-agent: *\nDisallow: /\n", "text/plain");
    if (url === `${SITE}/sitemap.xml`) return ok(url, "<urlset></urlset>", "application/xml");
    if (pages[url]) return ok(url, pages[url]);
    return { url, status: 404, finalUrl: url, body: "", contentType: "text/html" };
  };
  const r = await runTechnicalAudit(ctx, { siteUrl: SITE, appUrl: APP, published: false, paths: ["/", "/pricing"], fetcher });
  const ids = (db.prepare(`SELECT check_id, url FROM seo_audit_findings WHERE resolved_at IS NULL`).all() as { check_id: string; url: string }[]).map((x) => `${x.check_id} ${x.url.replace(SITE, "")}`).sort();
  assert.deepEqual(ids, [
    "broken_link /gone", "canonical_missing /", "description_length /", "jsonld_missing /", "site_closed /robots.txt", "sitemap_empty /sitemap.xml", "title_short /",
  ]);
  assert.equal(r.pages, 2);
  assert.ok(calls.every((c) => c.includes("example-site.pk")), "only our own site is fetched");
  assert.ok(calls.includes(`HEAD ${SITE}/gone`), "links are checked with HEAD");
  assert.equal(JSON.stringify(db.prepare(`SELECT * FROM tenants`).all()), before);
});

test("PageSpeed: field data first, lab data otherwise; Google's thresholds", () => {
  const field = parsePsi("u", {
    loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4200 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 }, INTERACTION_TO_NEXT_PAINT: { percentile: 150 } } },
    lighthouseResult: { categories: { performance: { score: 0.42 } }, audits: { "largest-contentful-paint": { numericValue: 3000 } } },
  });
  assert.deepEqual(field, { url: "u", source: "field", score: 42, lcpMs: 4200, cls: 0.05, inpMs: 150 });
  assert.deepEqual(vitalsFindings(field).map((f) => [f.checkId, f.severity]), [["cwv_performance", "critical"], ["cwv_lcp", "critical"]]);
  const lab = parsePsi("u", { lighthouseResult: { categories: { performance: { score: 0.95 } }, audits: { "largest-contentful-paint": { numericValue: 1800 }, "cumulative-layout-shift": { numericValue: 0.15 } } } });
  assert.equal(lab.source, "lab");
  assert.deepEqual(vitalsFindings(lab).map((f) => [f.checkId, f.severity]), [["cwv_cls", "warning"]]);
});

test("PageSpeed run: a page that fails this time keeps its earlier findings", async () => {
  const slow = { lighthouseResult: { categories: { performance: { score: 0.3 } }, audits: {} } };
  await runPageSpeed(ctx, { urls: ["https://s/a", "https://s/b"], fetch: async () => slow });
  const open = () => (db.prepare(`SELECT url FROM seo_audit_findings WHERE resolved_at IS NULL ORDER BY url`).all() as { url: string }[]).map((r) => r.url);
  assert.deepEqual(open(), ["https://s/a", "https://s/b"]);
  const fast = { lighthouseResult: { categories: { performance: { score: 0.97 } }, audits: {} } };
  await runPageSpeed(ctx, { urls: ["https://s/a", "https://s/b"], fetch: async (u) => { if (u.endsWith("/b")) throw new Error("timeout"); return fast; } });
  assert.deepEqual(open(), ["https://s/b"], "a fixed, b untested and still open");
  await assert.rejects(runPageSpeed(ctx, { urls: ["https://s/a"], fetch: async () => { throw new Error("quota"); } }), /could not test any page/);
});
