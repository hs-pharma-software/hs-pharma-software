/** Content Studio (phase 5): drafts of articles and page titles/descriptions.
 *
 * Drafts are written from the product registry only (config/siteProducts.ts,
 * which follows the app's own type registry), so they cannot claim features
 * the app lacks. Every draft is checked for unsupported claims, keyword
 * stuffing, duplicates and length; a draft with a blocking problem cannot be
 * approved. Nothing is published here: an approved draft becomes a GitHub
 * pull request (github.ts) that a person reviews and merges.
 *
 * The writer is the platform's AI (Super Admin > Billori: ChatGPT or Gemini).
 * Without it, article drafts are outlines (briefs) for a person to write. */
import { randomUUID } from "node:crypto";
import { JobSkip, type JobContext } from "./engine";
import { TARGETS, normalize } from "./keywords";
import type { Sql } from "../subSupers";
import { SITE_PRODUCTS, productFacts } from "../../config/siteProducts";
import {
  AI_PROVIDER_SETTING, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, OPENAI_KEY_SETTING, OPENAI_MODEL_SETTING,
  geminiModelChain, geminiNotSpent, geminiShouldFallBack, markGeminiSpent,
} from "../../config/aiModels";
import { pickAiConfig } from "../ai";
import { callOpenAI, toOpenAIRequest } from "../../lib/aiOpenAI";
import type { GeminiRequest, GeminiSchema } from "../../lib/gemini";

if (typeof window !== "undefined") throw new Error("src/server/seo is server-only code.");

export type DraftKind = "article" | "meta" | "landing";
export type DraftStatus = "draft" | "in_review" | "approved" | "rejected" | "published";
/** What a draft holds besides its title. Articles: description and Markdown. Meta: the page and its new description. */
export interface DraftBody { description: string; markdown?: string; path?: string | null; current?: { title?: string; description?: string }; brief?: boolean }
export interface Issue { level: "block" | "warn"; check: string; message: string }
export interface Checks { ok: boolean; issues: Issue[]; words: number; keywordCount: number; checkedAt: string; reviewNote?: string }

/** Up to this many new drafts per weekly run (keeps AI use and review work small). */
const MAX_ARTICLES = 2;
const MAX_META = 3;

// ── Facts ─────────────────────────────────────────────────────────────────

const FBR_FACTS = [
  "FBR Digital Invoicing submission is built in for FBR-registered businesses and is switched on per business during onboarding, after the registration and the FBR/PRAL integration token are checked.",
  "Needs: an active FBR registration (NTN/STRN), the business's FBR/PRAL integration token, and an HS code, sale type and unit for each product invoiced.",
  "Invoices are first tested in the FBR sandbox; then submission is switched on. Staff can submit only when the owner allows it.",
  "Each invoice shows whether it was sent; when FBR accepts it, the FBR invoice number is kept and printed. FBR errors are shown so the invoice can be corrected.",
  "Some sectors report to a provincial authority instead; MAVIN.pk confirms what applies before go-live.",
];
const PLATFORM_FACTS = [
  "MAVIN.pk is business software for billing, stock and daily operations, for businesses in Pakistan.",
  "It runs as a Windows desktop app that keeps billing offline and syncs when online, or in a web browser (the web version needs internet).",
  "Products can be imported from a CSV file. Staff get their own logins with roles.",
  "Prints on thermal (80 mm), A5 or A4.",
];

/** The facts a draft for this page may use, and the features it must not present as available. */
export function factsFor(path: string | null): { name: string; facts: string[]; notYet: string[] } {
  const slug = path?.startsWith("/products/") ? path.slice("/products/".length) : null;
  const p = slug ? SITE_PRODUCTS.find((x) => x.slug === slug) : null;
  if (p) {
    const f = productFacts(p);
    return {
      name: p.name,
      facts: [
        ...PLATFORM_FACTS, `${p.name}: ${p.headline} ${p.intro}`, `Purpose: ${f.purpose}`,
        ...f.workflow.map((w) => `Workflow step: ${w}`), ...f.mvp.map((m) => `Available: ${m}`),
        ...p.faqs.map((q) => `Q: ${q.q} A: ${q.a}`), p.cta === "pilot" ? `${p.name} is offered as a supervised pilot, not a standard rollout.` : "",
      ].filter(Boolean),
      notYet: f.planned,
    };
  }
  if (path === "/integrations/fbr-digital-invoicing") return { name: "FBR Digital Invoicing", facts: [...PLATFORM_FACTS, ...FBR_FACTS], notYet: [] };
  return { name: "MAVIN.pk", facts: [...PLATFORM_FACTS, ...FBR_FACTS, ...SITE_PRODUCTS.map((x) => `${x.name}: ${x.headline}`)], notYet: [] };
}

// ── Checks ────────────────────────────────────────────────────────────────

const BLOCK_CLAIMS: [RegExp, string][] = [
  [/\b(fbr|pral|drap|phc|government)[- ](approved|certified|authori[sz]ed|licensed|endorsed|accredited)\b|\b(approved|certified|authori[sz]ed|licensed|endorsed|accredited) by (the )?(fbr|pral|drap|phc|government)\b/i, "Claims an official approval or certification."],
  [/#\s?1\b|\b(no\.? ?1|number one|best in pakistan|pakistan'?s best|top-rated)\b/i, "Ranks itself best or number one."],
  [/\b\d[\d,]*\s*\+?\s*(customers|clients|pharmacies|businesses|stores|shops|users|companies|outlets)\b/i, "States a customer count that is not on record."],
  [/\b\d+(\.\d+)?\s*%/, "States a percentage figure that is not on record."],
  [/\bguarantee[sd]?\b|\b100 ?percent\b|\bnever (fails|goes down)\b|\bzero (errors|downtime)\b/i, "Makes a guarantee."],
  [/lorem ipsum|\[insert|\bTODO\b|\bTBD\b|\{\{/i, "Contains placeholder text."],
];
const WARN_CLAIMS: [RegExp, string][] = [
  [/\bfree\b/i, "Mentions free use; pricing is not published yet, so confirm this."],
  [/\b(leading|trusted by|award|most popular|fastest|cheapest)\b/i, "Uses a superlative; make sure it can be backed up."],
  [/https?:\/\/(?!(www\.)?mavin\.pk)/i, "Links to another website; check the link is wanted."],
];

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const shingles = (s: string, n = 5) => {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
};
export function similarity(a: string, b: string): number {
  const x = shingles(a);
  const y = shingles(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const s of x) if (y.has(s)) both++;
  return both / Math.min(x.size, y.size);
}
const count = (hay: string, needle: string) => (needle ? hay.toLowerCase().split(needle.toLowerCase()).length - 1 : 0);

/** Checks a draft. `others` are the other drafts (not rejected) for duplicate checks. */
export function checkDraft(
  d: { id?: string; kind: DraftKind; title: string; keyword: string | null; path: string | null; body: DraftBody },
  others: { id: string; title: string; keyword: string | null; markdown: string }[],
  now = new Date(),
): Checks {
  const issues: Issue[] = [];
  const text = `${d.title}\n${d.body.description}\n${d.body.markdown ?? ""}`;
  for (const [re, msg] of BLOCK_CLAIMS) {
    const m = text.match(re);
    if (m) issues.push({ level: "block", check: "claim", message: `${msg} (“${m[0].trim()}”)` });
  }
  for (const [re, msg] of WARN_CLAIMS) {
    const m = text.match(re);
    if (m) issues.push({ level: "warn", check: "claim", message: `${msg} (“${m[0].trim()}”)` });
  }
  const { notYet } = factsFor(d.path);
  for (const p of notYet) {
    const key = words(p).filter((w) => w.length > 3).slice(0, 3).join(" ");
    if (key && words(text).join(" ").includes(key)) issues.push({ level: "warn", check: "planned_feature", message: `Mentions “${p}”, which is planned, not available. Say so or remove it.` });
  }

  const desc = d.body.description.trim();
  const titleLen = d.title.trim().length;
  if (d.kind === "meta" || d.kind === "article") {
    if (titleLen > 70) issues.push({ level: "block", check: "title_length", message: `Title is ${titleLen} characters; search results cut it after about 60.` });
    else if (titleLen > 60 || titleLen < 20) issues.push({ level: "warn", check: "title_length", message: `Title is ${titleLen} characters; aim for 30 to 60.` });
    if (desc.length < 30 || desc.length > 200) issues.push({ level: "block", check: "description_length", message: `Description is ${desc.length} characters; it needs 70 to 160.` });
    else if (desc.length < 70 || desc.length > 160) issues.push({ level: "warn", check: "description_length", message: `Description is ${desc.length} characters; aim for 70 to 160.` });
  }

  const md = d.body.markdown ?? "";
  const n = words(md).length;
  const kw = d.keyword ? normalize(d.keyword) : "";
  const kc = count(md, kw);
  if (d.kind === "article" && !d.body.brief) {
    if (n < 250) issues.push({ level: "block", check: "length", message: `Only ${n} words; an article needs at least 500.` });
    else if (n < 500) issues.push({ level: "warn", check: "length", message: `${n} words; aim for at least 500.` });
    if (!/^##\s/m.test(md)) issues.push({ level: "warn", check: "structure", message: "No section headings (##)." });
    if (/^#\s/m.test(md)) issues.push({ level: "warn", check: "structure", message: "Use ## for sections: the page title is the only top heading." });
    if (kw) {
      const density = n ? (kc * words(kw).length) / n : 0;
      if (density > 0.04 || kc > 15) issues.push({ level: "block", check: "stuffing", message: `The keyword appears ${kc} times (${(density * 100).toFixed(1)}% of words): keyword stuffing.` });
      else if (density > 0.025) issues.push({ level: "warn", check: "stuffing", message: `The keyword appears ${kc} times (${(density * 100).toFixed(1)}%); use it less.` });
      if (kc === 0) issues.push({ level: "warn", check: "keyword", message: "The keyword does not appear in the text." });
    }
  }
  if (kw && d.kind !== "landing" && !normalize(d.title).includes(kw.split(" ").slice(0, 2).join(" "))) {
    issues.push({ level: "warn", check: "keyword", message: "The title does not contain the keyword." });
  }
  for (const o of others) {
    if (o.id === d.id) continue;
    if (kw && o.keyword && normalize(o.keyword) === kw && d.kind === "article") issues.push({ level: "warn", check: "duplicate", message: `Another draft targets the same keyword (“${o.title}”).` });
    const sim = md && o.markdown ? similarity(md, o.markdown) : 0;
    if (sim > 0.5) issues.push({ level: "block", check: "duplicate", message: `${Math.round(sim * 100)}% the same as “${o.title}”.` });
  }
  return { ok: !issues.some((i) => i.level === "block"), issues, words: n, keywordCount: kc, checkedAt: now.toISOString() };
}

// ── Writer ────────────────────────────────────────────────────────────────

/** Writes JSON for a prompt (injectable for tests). */
export type Writer = (system: string, prompt: string, schema: GeminiSchema) => Promise<string>;

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

/** The platform's AI (global keys only, never a tenant's), or null when not set up. */
export async function platformWriter(sql: Sql): Promise<Writer | null> {
  const keys = [AI_PROVIDER_SETTING, BILLORI_KEY_SETTING, BILLORI_MODEL_SETTING, OPENAI_KEY_SETTING, OPENAI_MODEL_SETTING];
  const rows = (await sql.execute(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`, keys)).rows;
  const cfg = pickAiConfig(null, new Map(rows.map((r) => [String(r.key), r.value == null ? "" : String(r.value)])));
  if (!cfg) return null;
  return async (system, prompt, schema) => {
    const req: GeminiRequest = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: schema },
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 50_000);
    try {
      let r = { status: 0, body: "" };
      if (cfg.provider === "openai") {
        r = await callOpenAI(fetch, cfg.apiKey, toOpenAIRequest(req, cfg.model), ctrl.signal);
      } else {
        for (const m of geminiNotSpent(geminiModelChain(cfg.model))) {
          const res = await fetch(`${GEMINI}/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey }, body: JSON.stringify(req), signal: ctrl.signal });
          r = { status: res.status, body: await res.text() };
          if (!geminiShouldFallBack(r.status, r.body)) break;
          markGeminiSpent(m);
        }
      }
      if (r.status < 200 || r.status >= 300) throw new Error(`The AI writer answered ${r.status}.`);
      const j = JSON.parse(r.body) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      return (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    } finally {
      clearTimeout(timer);
    }
  };
}

const RULES = `Rules you must follow:
- Use only the facts given. Do not add features, prices, customer numbers, percentages, awards or rankings.
- Never say MAVIN.pk is approved, certified or endorsed by FBR, PRAL, DRAP or any government body.
- Do not call it the best, number one or leading. No guarantees.
- When something is listed as planned, do not present it as available.
- Plain, helpful English for business owners in Pakistan. Short sentences. Explain terms like STRN or HS code briefly.
- Use the keyword naturally: in the title, once early in the text, and a few more times at most. Never stuff it.`;

const ARTICLE_SCHEMA: GeminiSchema = {
  type: "OBJECT", required: ["title", "description", "markdown"],
  properties: {
    title: { type: "STRING", description: "30 to 60 characters, contains the keyword" },
    description: { type: "STRING", description: "Meta description, 70 to 160 characters" },
    markdown: { type: "STRING", description: "Article body in Markdown, 600 to 1000 words, ## section headings, no # heading, ends with a short call to book a demo" },
  },
};
const META_SCHEMA: GeminiSchema = {
  type: "OBJECT", required: ["title", "description"],
  properties: { title: { type: "STRING", description: "30 to 60 characters" }, description: { type: "STRING", description: "70 to 160 characters" } },
};

function parseJson<T>(raw: string): T {
  const s = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(s) as T;
}

export async function writeArticle(w: Writer, keyword: string, path: string | null): Promise<{ title: string; body: DraftBody }> {
  const f = factsFor(path);
  const prompt = `Write a helpful article for the website www.mavin.pk that answers the search “${keyword}”.
It should lead readers to the page ${path ?? "/products"} (${f.name}).
Facts you may use:
${f.facts.map((x) => `- ${x}`).join("\n")}
${f.notYet.length ? `Planned, NOT available yet (do not present as available):\n${f.notYet.map((x) => `- ${x}`).join("\n")}` : ""}`;
  const j = parseJson<{ title?: string; description?: string; markdown?: string }>(await w(`You write website content for MAVIN.pk, business software in Pakistan.\n${RULES}`, prompt, ARTICLE_SCHEMA));
  if (!j.title || !j.markdown) throw new Error("The AI writer returned an incomplete article.");
  return { title: j.title.trim(), body: { description: (j.description ?? "").trim(), markdown: j.markdown.trim(), path } };
}

export async function writeMeta(w: Writer, path: string, keyword: string | null, current: { title?: string; description?: string }, problem: string): Promise<{ title: string; body: DraftBody }> {
  const f = factsFor(path === "/" ? null : path);
  const prompt = `Rewrite the search result title and meta description of the page ${path} on www.mavin.pk (${f.name}).
Problem to fix: ${problem}
${keyword ? `Main search to answer: “${keyword}”.` : ""}
Current title: ${current.title ?? "(none)"}
Current description: ${current.description ?? "(none)"}
Facts:
${f.facts.slice(0, 12).map((x) => `- ${x}`).join("\n")}
Do not add “| MAVIN.pk” to the title; the site adds it.`;
  const j = parseJson<{ title?: string; description?: string }>(await w(`You write search result snippets for MAVIN.pk.\n${RULES}`, prompt, META_SCHEMA));
  if (!j.title || !j.description) throw new Error("The AI writer returned an incomplete title or description.");
  return { title: j.title.trim(), body: { description: j.description.trim(), path, current } };
}

/** Without AI: an outline for a person to write from (marked as a brief). */
export function briefFor(keyword: string, path: string | null): { title: string; body: DraftBody } {
  const f = factsFor(path);
  const t = keyword.replace(/\b\w/g, (c) => c.toUpperCase());
  const markdown = `> Brief for a writer: the AI writer is not set up, so this is an outline. Replace it with the article before approving.

## Who searches “${keyword}”
Business owners in Pakistan comparing software for ${f.name.toLowerCase()}. Answer their question in the first paragraph.

## Points to cover (from the product record)
${f.facts.slice(0, 14).map((x) => `- ${x}`).join("\n")}
${f.notYet.length ? `\n## Do not present as available\n${f.notYet.map((x) => `- ${x}`).join("\n")}\n` : ""}
## End with
A short invitation to book a demo, linking to ${path ?? "/products"}.`;
  return { title: t.length > 60 ? t.slice(0, 60) : t, body: { description: `${t}: what to look for and how MAVIN.pk handles it, for businesses in Pakistan.`.slice(0, 160), markdown, path, brief: true } };
}

// ── Storage ───────────────────────────────────────────────────────────────

export const parseBody = (s: unknown): DraftBody => { try { return s ? (JSON.parse(String(s)) as DraftBody) : { description: "" }; } catch { return { description: "", markdown: String(s ?? "") }; } };
export const parseChecks = (s: unknown): Checks | null => { try { return s ? (JSON.parse(String(s)) as Checks) : null; } catch { return null; } };

/** The other drafts a draft is compared with (not rejected). */
export async function otherDrafts(sql: Sql) {
  return (await sql.execute(`SELECT id, title, target_keyword, body FROM seo_content_drafts WHERE status != 'rejected'`)).rows
    .map((r) => ({ id: String(r.id), title: String(r.title), keyword: (r.target_keyword as string | null) ?? null, markdown: parseBody(r.body).markdown ?? "" }));
}

export async function saveDraft(sql: Sql, d: { kind: DraftKind; title: string; keyword: string | null; path: string | null; body: DraftBody; by: string }, now = new Date()) {
  const id = randomUUID();
  const checks = checkDraft({ ...d, id }, await otherDrafts(sql), now);
  const t = now.toISOString();
  await sql.execute(
    `INSERT INTO seo_content_drafts (id, kind, title, target_keyword, target_path, body, status, checks, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [id, d.kind, d.title, d.keyword, d.path, JSON.stringify(d.body), JSON.stringify(checks), d.by, t, t],
  );
  return { id, checks };
}

// ── The job ───────────────────────────────────────────────────────────────

/** Titles and descriptions the audit or keyword research flagged, per page. */
async function metaCandidates(sql: Sql, siteUrl: string) {
  const recs = (await sql.execute(
    `SELECT kind, url, title, evidence FROM seo_recommendations WHERE status IN ('proposed','approved')
     AND kind IN ('title_missing','title_long','title_short','title_duplicate','description_missing','description_duplicate','keyword_low_ctr') ORDER BY created_at`,
  )).rows;
  const byPath = new Map<string, { problem: string; keyword: string | null }>();
  for (const r of recs) {
    const path = String(r.url ?? "").replace(siteUrl, "") || "/";
    let keyword: string | null = null;
    try { keyword = (JSON.parse(String(r.evidence ?? "{}")) as { keyword?: string }).keyword ?? null; } catch { /* no keyword */ }
    const prev = byPath.get(path);
    byPath.set(path, { problem: prev ? `${prev.problem}; ${r.title}` : String(r.title), keyword: prev?.keyword ?? keyword });
  }
  return byPath;
}

export async function runContentProposals(ctx: JobContext, o: { writer?: Writer | null; siteUrl: string; currentMeta?: (path: string) => Promise<{ title?: string; description?: string }> }) {
  const { sql } = ctx;
  const writer = o.writer === undefined ? await platformWriter(sql) : o.writer;
  const existing = (await sql.execute(`SELECT kind, target_keyword, target_path, status FROM seo_content_drafts`)).rows;
  const haveKeyword = new Set(existing.filter((r) => r.kind === "article").map((r) => normalize(String(r.target_keyword ?? ""))));
  const openMeta = new Set(existing.filter((r) => r.kind === "meta" && ["draft", "in_review", "approved"].includes(String(r.status))).map((r) => String(r.target_path)));
  const made: { kind: string; title: string; ok: boolean }[] = [];
  const failed: string[] = [];

  // Articles for the strongest keywords that have none yet (learning or comparing searches).
  const kws = (await sql.execute(
    `SELECT keyword, product, intent, priority, notes FROM seo_keywords WHERE priority >= 60 AND intent IN ('informational','commercial') ORDER BY priority DESC, keyword LIMIT 200`,
  )).rows.filter((r) => !String(r.notes ?? "").includes('"ignored":true') && !haveKeyword.has(String(r.keyword)));
  for (const r of kws.slice(0, MAX_ARTICLES)) {
    const keyword = String(r.keyword);
    const path = (r.product as string | null) ?? null;
    try {
      const d = writer ? await writeArticle(writer, keyword, path) : briefFor(keyword, path);
      const s = await saveDraft(sql, { kind: "article", title: d.title, keyword, path, body: d.body, by: writer ? "job:ai" : "job:brief" }, ctx.now);
      made.push({ kind: "article", title: d.title, ok: s.checks.ok });
    } catch (e) {
      failed.push(`${keyword}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // New titles and descriptions where a page has a flagged snippet (AI only).
  let metaSkipped = 0;
  const meta = await metaCandidates(sql, o.siteUrl);
  for (const [path, m] of Array.from(meta).slice(0, MAX_META + openMeta.size)) {
    if (openMeta.has(path) || made.filter((x) => x.kind === "meta").length >= MAX_META) continue;
    if (!writer) { metaSkipped++; continue; }
    try {
      const current = o.currentMeta ? await o.currentMeta(path).catch(() => ({})) : {};
      const d = await writeMeta(writer, path, m.keyword, current, m.problem);
      const s = await saveDraft(sql, { kind: "meta", title: d.title, keyword: m.keyword, path, body: d.body, by: "job:ai" }, ctx.now);
      made.push({ kind: "meta", title: d.title, ok: s.checks.ok });
    } catch (e) {
      failed.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (failed.length) await ctx.log("warn", "drafts_failed", failed);
  if (!made.length && failed.length) throw new Error(`No draft could be written: ${failed[0]}`);
  if (!made.length && !writer && !kws.length) throw new JobSkip("Nothing to draft: run keyword research first (keywords with priority 60+ and no draft yet).");
  const summary = { writer: writer ? "ai" : "briefs only (AI not set up)", drafts: made.length, blocked: made.filter((x) => !x.ok).length, failed: failed.length, metaWaitingForAi: metaSkipped };
  await ctx.log("info", "drafts_written", { ...summary, titles: made.map((x) => x.title) });
  return summary;
}

/** Pages a draft can target (for the manual "new draft" form). */
export const DRAFT_TARGETS = [{ path: "/", label: "Home page" }, ...TARGETS.map((t) => ({ path: t.path, label: t.label }))];
