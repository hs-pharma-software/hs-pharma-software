/** SEO Manager, phase 5: Content Studio with a fake AI writer and a fake
 * GitHub (no network). Checks block unsupported claims, stuffing and
 * duplicates; briefs cannot be approved; approval needs a clean draft; a pull
 * request writes only the article file or the metadata overrides; merged pull
 * requests mark drafts published; business data is untouched. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import type { JobContext } from "@/server/seo/engine";
import { checkDraft, factsFor, runContentProposals, similarity, type DraftBody, type Writer } from "@/server/seo/content";
import { articleFile, slugify, type GitHubConfig } from "@/server/seo/github";
import { createDraft, decideDraft, getDraft, listDrafts, openDraftPullRequest, refreshPullRequests, updateDraft } from "@/server/seo/studio";
import { parseArticle } from "@/lib/siteArticles";
import type { Http } from "@/server/seo/google";
import type { Sql } from "@/server/subSupers";

const SITE = "https://www.example-site.pk";
const NOW = new Date("2026-11-06T01:00:00.000Z");
const GH: GitHubConfig = { token: "test-token-not-real", repo: "example/site", base: "main" };
let db: DatabaseSync;
let sql: Sql;
let ctx: JobContext;
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  ctx = { sql, now: NOW, log: async () => {} };
});

/** ~650 words that differ per seed, mentioning the keyword three times. */
function article(keyword: string, seed: number, extra = "") {
  const paras = Array.from({ length: 13 }, (_, i) => `Step ${seed}${i} covers ${["batches", "expiry", "billing", "stock", "returns", "printing", "staff", "branches", "reports", "suppliers", "purchases", "customers", "invoices"][i]} for case ${seed * 100 + i}: owners record each item once, check figure ${seed}${i}${i} daily, and review the list ${seed + i} times each month before closing the books carefully.`);
  return `## Why ${keyword} matters\n\n${keyword} helps businesses keep records. ${paras.slice(0, 4).join(" ")}\n\n## How it works\n\n${paras.slice(4, 9).join(" ")} Using ${keyword} daily keeps stock right.\n\n## Getting started\n\n${paras.slice(9).join(" ")} Ask about ${keyword} when you book a demo. ${extra}`;
}
const writer = (opts: { extra?: string } = {}): Writer => async (_system, prompt) => {
  const k = /search “([^”]+)”/.exec(prompt)?.[1] ?? /answer: “([^”]+)”/.exec(prompt)?.[1] ?? "pharmacy software";
  if (prompt.startsWith("Rewrite the search result")) return JSON.stringify({ title: "Pharmacy POS for batch and expiry control", description: "Pharmacy billing with batch and expiry tracking, controlled-medicine records and FBR Digital Invoicing for registered businesses." });
  return JSON.stringify({ title: `${k.replace(/\b\w/g, (c) => c.toUpperCase())} Guide`.slice(0, 58), description: `A practical guide to ${k} for business owners in Pakistan, from setup to daily billing and stock.`, markdown: article(k, k.length, opts.extra) });
};

const addKeyword = (keyword: string, product: string, priority: number, intent = "commercial") =>
  db.prepare(`INSERT INTO seo_keywords (id, keyword, product, intent, priority, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{"sources":["seed"]}', ?, ?)`).run(randomUUID(), keyword, product, intent, priority, NOW.toISOString(), NOW.toISOString());

test("checks: unsupported claims block, superlatives and planned features warn, lengths and stuffing", () => {
  const base = { kind: "article" as const, keyword: "pharmacy software", path: "/products/retail-pharmacy-pos" };
  const body = (markdown: string, description = "A practical guide to pharmacy software for owners in Pakistan, from setup to daily billing."): DraftBody => ({ description, markdown });
  const clean = checkDraft({ ...base, title: "Pharmacy Software Guide", body: body(article("pharmacy software", 7)) }, []);
  assert.ok(clean.ok, JSON.stringify(clean.issues));
  for (const claim of ["MAVIN.pk is FBR approved.", "Certified by FBR.", "Used by 500+ pharmacies.", "Pakistan's #1 pharmacy system.", "Cuts losses by 40%.", "We guarantee accuracy.", "[insert price]"]) {
    const c = checkDraft({ ...base, title: "Pharmacy Software Guide", body: body(article("pharmacy software", 7, claim)) }, []);
    assert.ok(!c.ok, claim);
    assert.ok(c.issues.some((i) => i.level === "block" && (i.check === "claim")), claim);
  }
  const warn = checkDraft({ ...base, title: "Pharmacy Software Guide", body: body(article("pharmacy software", 7, "A leading choice, free to try.")) }, []);
  assert.ok(warn.ok);
  assert.equal(warn.issues.filter((i) => i.check === "claim").length, 2);

  assert.ok(!checkDraft({ ...base, title: "Pharmacy Software Guide", body: body("## Short\n\nToo short for an article about pharmacy software.") }, []).ok);
  const stuffed = checkDraft({ ...base, title: "Pharmacy Software Guide", body: body(`## A\n\n${"pharmacy software is good. ".repeat(80)}`) }, []);
  assert.ok(stuffed.issues.some((i) => i.check === "stuffing" && i.level === "block"));
  assert.ok(!checkDraft({ kind: "meta", keyword: null, path: "/pricing", title: "x".repeat(75), body: { description: "short" } }, []).ok);

  const ms = factsFor("/products/medical-store-pos");
  assert.ok(ms.notYet.length > 0, "medical store has planned items");
  const planned = checkDraft({ kind: "article", keyword: "medical store software", path: "/products/medical-store-pos", title: "Medical Store Software Guide", body: body(article("medical store software", 9, `It supports ${ms.notYet[0]}.`)) }, []);
  assert.ok(planned.issues.some((i) => i.check === "planned_feature"));
});

test("duplicates: near-identical text blocks; same keyword warns", () => {
  const a = article("pharmacy software", 7);
  assert.ok(similarity(a, a) > 0.99);
  assert.ok(similarity(a, article("pharmacy software", 3)) < 0.5);
  const c = checkDraft({ kind: "article", keyword: "pharmacy software", path: null, title: "Pharmacy Software Guide", body: { description: "A practical guide to pharmacy software for owners in Pakistan, from setup to billing.", markdown: a } },
    [{ id: "other", title: "Older", keyword: "pharmacy software", markdown: a }]);
  assert.ok(c.issues.some((i) => i.check === "duplicate" && i.level === "block"));
  assert.ok(c.issues.some((i) => i.check === "duplicate" && i.level === "warn"));
});

test("weekly job: two articles for the top keywords, a meta draft for a flagged page, nothing twice", async () => {
  addKeyword("pharmacy software lahore", "/products/retail-pharmacy-pos", 85);
  addKeyword("medical store software", "/products/medical-store-pos", 80);
  addKeyword("fbr digital invoicing software", "/integrations/fbr-digital-invoicing", 75);
  addKeyword("pharmacy pos price", "/products/retail-pharmacy-pos", 95, "transactional");
  addKeyword("low priority thing software", "/products", 40);
  db.prepare(`INSERT INTO seo_recommendations (id, kind, title, detail, url, impact, status, created_at, updated_at) VALUES (?, 'title_long', 'Shorten the page title', 'x', ?, 'medium', 'proposed', ?, ?)`)
    .run(randomUUID(), `${SITE}/products/retail-pharmacy-pos`, NOW.toISOString(), NOW.toISOString());

  const r = await runContentProposals(ctx, { writer: writer(), siteUrl: SITE, currentMeta: async () => ({ title: "Old title", description: "Old description" }) }) as { drafts: number; blocked: number };
  assert.equal(r.drafts, 3);
  const drafts = db.prepare(`SELECT kind, target_keyword, target_path, status, checks, body FROM seo_content_drafts ORDER BY kind, target_keyword`).all() as Record<string, string>[];
  assert.deepEqual(drafts.map((d) => [d.kind, d.target_keyword]), [["article", "medical store software"], ["article", "pharmacy software lahore"], ["meta", null]]);
  assert.ok(drafts.every((d) => d.status === "draft"));
  assert.ok(drafts.filter((d) => d.kind === "article").every((d) => JSON.parse(d.checks).ok), "clean AI drafts pass");
  const meta = JSON.parse(drafts[2].body);
  assert.equal(meta.path, "/products/retail-pharmacy-pos");
  assert.equal(meta.current.title, "Old title");

  const again = await runContentProposals(ctx, { writer: writer(), siteUrl: SITE, currentMeta: async () => ({}) }) as { drafts: number };
  assert.equal(again.drafts, 1, "only the third keyword is new; the page already has a meta draft");
});

test("without the AI writer: outlines that cannot be approved until written", async () => {
  addKeyword("pharmacy software lahore", "/products/retail-pharmacy-pos", 85);
  const r = await runContentProposals(ctx, { writer: null, siteUrl: SITE }) as { writer: string; drafts: number };
  assert.match(r.writer, /briefs only/);
  const d = one(`SELECT id, body FROM seo_content_drafts`);
  assert.ok(JSON.parse(String(d.body)).brief);
  await assert.rejects(decideDraft(sql, "admin:1", String(d.id), "approve", ""), /outline/);
  await updateDraft(sql, "admin:1", String(d.id), { markdown: article("pharmacy software lahore", 5), title: "Pharmacy Software in Lahore Guide", description: "A practical guide to pharmacy software in Lahore for owners, from setup to daily billing and stock." });
  await decideDraft(sql, "admin:1", String(d.id), "approve", "");
  assert.equal((await getDraft(sql, String(d.id))).status, "approved");
});

test("review flow: edits re-check, approval needs a clean draft, rejection needs a reason, reopen", async () => {
  const { id } = await createDraft(sql, "admin:1", "Pharmacy Software Lahore", "/products/retail-pharmacy-pos", { writer: writer() });
  let d = await getDraft(sql, id);
  assert.equal(d.keyword, "pharmacy software lahore");
  await decideDraft(sql, "admin:1", id, "submit", "");
  const checks = await updateDraft(sql, "admin:1", id, { markdown: `${d.body.markdown}\n\nTrusted by 300 pharmacies across Pakistan.` });
  assert.ok(!checks.ok);
  await assert.rejects(decideDraft(sql, "admin:1", id, "approve", ""), /blocking problems/);
  await updateDraft(sql, "admin:1", id, { markdown: d.body.markdown });
  await decideDraft(sql, "admin:1", id, "approve", "");
  d = await getDraft(sql, id);
  assert.equal(d.status, "approved");
  assert.equal(d.reviewedBy, "admin:1");
  await assert.rejects(updateDraft(sql, "admin:1", id, { title: "Changed after approval" }), /Reopen it first/);
  await assert.rejects(decideDraft(sql, "admin:1", id, "reject", ""), /why/);
  await decideDraft(sql, "admin:1", id, "reject", "Off topic for now");
  assert.equal((await getDraft(sql, id)).checks?.reviewNote, "Off topic for now");
  await decideDraft(sql, "admin:1", id, "reopen", "");
  assert.equal((await getDraft(sql, id)).status, "draft");
  const list = await listDrafts(sql, { writer: null, github: null });
  assert.equal(list.aiReady, false);
  assert.equal(list.drafts.length, 1);
});

/** A fake GitHub repository: refs, contents and pulls. */
function fakeGitHub(files: Record<string, string> = {}) {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const branches = new Set(["main"]);
  const pulls: Record<number, { state: string; merged: boolean }> = {};
  const http: Http = async (url, init) => {
    const path = url.replace("https://api.github.com/repos/example/site", "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body });
    assert.equal(init.headers?.Authorization, "Bearer test-token-not-real");
    if (init.method === "GET" && path.startsWith("/git/ref/heads/")) return { status: 200, json: { object: { sha: "abc123" } } };
    if (init.method === "POST" && path === "/git/refs") {
      const b = String(body.ref).replace("refs/heads/", "");
      if (branches.has(b)) return { status: 422, json: { message: "Reference already exists" } };
      branches.add(b);
      return { status: 201, json: {} };
    }
    if (path.startsWith("/contents/")) {
      const file = decodeURIComponent(path.slice("/contents/".length).split("?")[0]);
      if (init.method === "GET") return files[file] ? { status: 200, json: { sha: "filesha", content: Buffer.from(files[file]).toString("base64") } } : { status: 404, json: {} };
      files[file] = Buffer.from(String(body.content), "base64").toString("utf8");
      return { status: 201, json: {} };
    }
    if (init.method === "POST" && path === "/pulls") {
      const n = Object.keys(pulls).length + 1;
      pulls[n] = { state: "open", merged: false };
      return { status: 201, json: { html_url: `https://github.com/example/site/pull/${n}`, number: n } };
    }
    const pr = path.match(/^\/pulls\/(\d+)$/);
    if (pr) return { status: 200, json: pulls[Number(pr[1])] };
    return { status: 404, json: { message: "Not Found" } };
  };
  return { http, calls, files, pulls };
}

test("pull requests: article file and metadata overrides, merged means published, closed can reopen", async () => {
  const gh = fakeGitHub({ "src/content/seo-meta.json": JSON.stringify({ "/about": { title: "About us", description: "Kept as it was." } }) });
  const { id } = await createDraft(sql, "admin:1", "pharmacy software lahore", "/products/retail-pharmacy-pos", { writer: writer() });
  await assert.rejects(openDraftPullRequest(sql, "admin:1", id, { github: GH, http: gh.http }), /Approve the draft first/);
  await decideDraft(sql, "admin:1", id, "approve", "");
  await assert.rejects(openDraftPullRequest(sql, "admin:1", id, { github: null }), /not connected/);
  const pr = await openDraftPullRequest(sql, "admin:1", id, { github: GH, http: gh.http });
  assert.equal(pr.url, "https://github.com/example/site/pull/1");
  assert.match(pr.branch, /^seo\/pharmacy-software-lahore-/);
  const file = gh.files["src/content/articles/pharmacy-software-lahore.md"];
  const parsed = parseArticle("pharmacy-software-lahore", file)!;
  const d = await getDraft(sql, id);
  assert.equal(parsed.title, d.title);
  assert.equal(parsed.keyword, "pharmacy software lahore");
  assert.equal(parsed.product, "/products/retail-pharmacy-pos");
  assert.equal(parsed.markdown, d.body.markdown);
  const prBody = String(gh.calls.find((c) => c.path === "/pulls")!.body!.body);
  assert.match(prBody, /merging publishes it/);
  assert.ok(!JSON.stringify(gh.calls).includes("test-token-not-real"), "token only in headers");
  await assert.rejects(openDraftPullRequest(sql, "admin:1", id, { github: GH, http: gh.http }), /already open/);

  // Meta: merged into the overrides file, other pages kept.
  const metaId = randomUUID();
  db.prepare(`INSERT INTO seo_content_drafts (id, kind, title, target_path, body, status, checks, created_at, updated_at) VALUES (?, 'meta', ?, '/pricing', ?, 'approved', ?, ?, ?)`)
    .run(metaId, "Pricing for Pharmacy and Retail POS", JSON.stringify({ description: "Plans for pharmacies, stores and clinics in Pakistan, with setup and support included in every plan.", path: "/pricing" }), JSON.stringify({ ok: true, issues: [], words: 0, keywordCount: 0, checkedAt: "" }), NOW.toISOString(), NOW.toISOString());
  await openDraftPullRequest(sql, "admin:1", metaId, { github: GH, http: gh.http });
  const meta = JSON.parse(gh.files["src/content/seo-meta.json"]);
  assert.deepEqual(Object.keys(meta), ["/about", "/pricing"]);
  assert.equal(meta["/pricing"].title, "Pricing for Pharmacy and Retail POS");
  assert.equal(gh.calls.find((c) => c.method === "PUT" && c.path.includes("seo-meta"))!.body!.sha, "filesha");

  gh.pulls[1] = { state: "closed", merged: true };
  gh.pulls[2] = { state: "closed", merged: false };
  const r = await refreshPullRequests(sql, "admin:1", { github: GH, http: gh.http });
  assert.deepEqual(r, { checked: 2, published: 1, closed: 1 });
  assert.equal((await getDraft(sql, id)).status, "published");
  const m = await getDraft(sql, metaId);
  assert.equal(m.status, "approved");
  assert.equal(m.prUrl, null);
  assert.match(m.checks?.reviewNote ?? "", /closed without merging/);
});

test("the article file round-trips; slugs are safe", () => {
  const f = articleFile({ title: 'Say "hello": a guide', keyword: "x y", path: "/products", body: { description: "Line with: colon", markdown: "## A\n\nText." } }, "2026-11-06");
  const a = parseArticle("say-hello", f)!;
  assert.equal(a.title, 'Say "hello": a guide');
  assert.equal(a.description, "Line with: colon");
  assert.equal(a.markdown, "## A\n\nText.");
  assert.equal(slugify("Pharmacy POS — Lahore / Karachi!"), "pharmacy-pos-lahore-karachi");
  assert.equal(slugify("../../etc"), "etc");
});

test("content work never touches business data", async () => {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'seo_%' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((t) => t.name);
  const snapshot = () => tables.map((t) => `${t}:${(db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n}`).join(",");
  const before = snapshot();
  addKeyword("pharmacy software lahore", "/products/retail-pharmacy-pos", 85);
  await runContentProposals(ctx, { writer: writer(), siteUrl: SITE });
  const { id } = await createDraft(sql, "admin:1", "medical store software", "", { writer: writer() });
  await decideDraft(sql, "admin:1", id, "approve", "");
  await openDraftPullRequest(sql, "admin:1", id, { github: GH, http: fakeGitHub().http });
  assert.equal(snapshot(), before);
});
