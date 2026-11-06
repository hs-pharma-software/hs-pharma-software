/** Keyword research (weekly, read-only towards the site). Candidates come from
 * three real sources, each recorded as evidence:
 *   - seed: a curated Pakistan-focused list for the products we sell;
 *   - autocomplete: what Google suggests for those seeds (people search it;
 *     no volume). Can be switched off in Settings;
 *   - search_console: queries the site already appears for, with real
 *     impressions, clicks and position.
 * Search volume and competition stay unknown: no free source gives real
 * numbers and none are estimated. Intent and priority are rule-based so every
 * score can be explained. Opportunities become proposed recommendations. */
import { randomUUID } from "node:crypto";
import { getSetting, type JobContext } from "./engine";
import { GSC_SOURCES } from "./gsc";
import { isoDay } from "./google";
import type { Sql } from "../subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const AUTOCOMPLETE_SETTING = "keyword_autocomplete";

export type Intent = "transactional" | "commercial" | "informational" | "navigational";

/** Where a keyword belongs on the site. Tier 1 is the focus: Pharmacy POS, Retail POS, FBR. */
export interface Target { path: string; label: string; tier: 1 | 2 | 3; match: RegExp }
export const TARGETS: Target[] = [
  { path: "/integrations/fbr-digital-invoicing", label: "FBR Digital Invoicing", tier: 1, match: /\bfbr\b|digital invoic|e-?invoic|\bpral\b|sales tax invoice|\bstrn\b/ },
  { path: "/products/hospital-pharmacy", label: "Hospital Pharmacy", tier: 2, match: /hospital pharmac/ },
  { path: "/products/medical-store-pos", label: "Medical Store POS", tier: 1, match: /medical (store|shop)/ },
  { path: "/products/retail-pharmacy-pos", label: "Retail Pharmacy POS", tier: 1, match: /pharmac|chemist|drug store|medicine (shop|store)/ },
  { path: "/products/general-store-pos", label: "General Store POS", tier: 1, match: /general store|kiryana|karyana|grocery|super ?market|super ?store|\bmart\b|retail/ },
  { path: "/products/restaurant-pos", label: "Restaurant POS", tier: 2, match: /restaurant|cafe|\bhotel\b|fast food|bakery/ },
  { path: "/products/mobile-shop-pos", label: "Mobile Shop POS", tier: 2, match: /mobile (shop|store)|\bimei\b|phone shop/ },
  { path: "/products/cloth-store-pos", label: "Cloth Store POS", tier: 2, match: /cloth|garment|boutique|fabric|apparel/ },
  { path: "/products/electronics-solar-pos", label: "Electronics & Solar POS", tier: 2, match: /electronic|solar|appliance/ },
  { path: "/products/distribution-software", label: "Distribution Software", tier: 2, match: /distribut|wholesale/ },
  { path: "/products/diagnostic-lab-software", label: "Diagnostic Lab Software", tier: 2, match: /\blab\b|laborator|diagnostic|pathology/ },
  { path: "/products/clinic-management", label: "Clinic Management", tier: 2, match: /clinic|doctor|\bopd\b/ },
  { path: "/products/hospital-management", label: "Hospital Management", tier: 2, match: /hospital/ },
  { path: "/products/marquee-banquet-software", label: "Marquee & Banquet Software", tier: 2, match: /marquee|banquet|wedding hall|event hall/ },
  { path: "/products/contractor-invoicing", label: "Contractor Invoicing", tier: 2, match: /contractor|construction/ },
  { path: "/products", label: "All products", tier: 3, match: /\bpos\b|point of sale|billing|invoic|inventory|stock|accounting|\berp\b|shop software|store software/ },
];

/** The curated starting list (Pakistan-focused, our products only). */
export const SEEDS = [
  "pharmacy pos pakistan", "pharmacy software pakistan", "pharmacy management system pakistan", "pharmacy billing software",
  "medical store software", "medical store software pakistan", "chemist software pakistan",
  "fbr digital invoicing", "fbr digital invoicing software", "fbr pos integration", "fbr e invoicing software", "pral digital invoicing",
  "retail pos pakistan", "pos software pakistan", "pos system pakistan", "general store software", "kiryana store software",
  "billing software pakistan", "inventory software pakistan",
  "restaurant pos pakistan", "mobile shop software", "cloth shop software", "solar shop software", "distribution software pakistan",
  "clinic management software pakistan", "lab management software pakistan", "hospital management system pakistan", "marquee management software",
];
/** Only these get autocomplete expansion (a few polite requests a week). */
const EXPAND = SEEDS.slice(0, 19);

const SOFTWARE = /software|\bpos\b|point of sale|system|\bapp\b|invoic|billing|management|program|\berp\b|inventory|integration|solution|portal/;
const OFF_TOPIC = /\b(jobs?|salary|vacanc\w*|course|courses|degree|admission|crack|cracked|apk|mod|near me|license fee|licen[cs]e renewal|pdf)\b/;
const LOCAL = /pakistan|\bpk\b|lahore|karachi|islamabad|rawalpindi|faisalabad|multan|peshawar|quetta|sialkot|gujranwala|hyderabad|urdu/;

export const normalize = (k: string) => k.toLowerCase().replace(/[^\p{L}\p{N}\s.+&-]/gu, " ").replace(/\s+/g, " ").trim();

export function targetFor(k: string): Target | null {
  return TARGETS.find((t) => t.match.test(k)) ?? null;
}

export function classifyIntent(k: string): Intent {
  if (/\bmavin\b/.test(k)) return "navigational";
  if (/^(what|how|why|when|which|who|is|are|can|does|do)\b|\bguide\b|\bmeaning\b|\brules?\b|\blist of\b|\bregistration\b|\bsro\b|\bformat\b|\bsample\b|\bexample\b|\btutorial\b/.test(k)) return "informational";
  if (/\b(price|prices|pricing|cost|buy|free|download|demo|trial|quote|rates?|package|plans?|subscription)\b/.test(k)) return "transactional";
  if (/\b(best|top|software|pos|system|app|solution|program|erp|compan(y|ies)|provider|vs|review|reviews)\b/.test(k)) return "commercial";
  return "informational";
}

/** Whether a candidate belongs in the list: about our products and about software. */
export function relevant(k: string): boolean {
  return k.length >= 3 && k.length <= 80 && !OFF_TOPIC.test(k) && (targetFor(k) !== null || /\bmavin\b/.test(k)) && (SOFTWARE.test(k) || /\bmavin\b|\bfbr\b|\bpral\b/.test(k));
}

export interface GscStat { impressions: number; clicks: number; position: number | null }
export interface Evidence { sources: string[]; seed?: string; gsc?: GscStat & { from: string; to: string }; manual?: boolean; ignored?: boolean; why?: string[] }

/** Priority 0 to 100, with the reasons that add up to it. */
export function score(k: string, intent: Intent, target: Target | null, e: Pick<Evidence, "sources" | "gsc">): { priority: number; why: string[] } {
  const why: string[] = [];
  let p = 0;
  const add = (n: number, r: string) => { p += n; why.push(`${r} +${n}`); };
  if (target) add(target.tier === 1 ? 40 : target.tier === 2 ? 20 : 15, target.tier === 1 ? "focus product" : "product page");
  add({ transactional: 25, commercial: 20, informational: 8, navigational: 5 }[intent], `${intent} intent`);
  if (LOCAL.test(k)) add(10, "Pakistan or city");
  if (e.sources.includes("autocomplete")) add(10, "Google suggests it");
  if (e.gsc && e.gsc.impressions > 0) add(Math.min(15, Math.round(Math.log10(e.gsc.impressions + 1) * 7)), "seen in our search results");
  return { priority: Math.min(100, p), why };
}

/** Google's autocomplete for Pakistan (English). Answer: [query, [suggestions...]]. */
export type Suggest = (q: string) => Promise<string[]>;
export const googleSuggest: Suggest = async (q) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=pk&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Autocomplete answered ${res.status}`);
    const j = (await res.json()) as [string, string[]];
    return Array.isArray(j?.[1]) ? j[1].filter((s) => typeof s === "string") : [];
  } finally {
    clearTimeout(timer);
  }
};

/** Search Console queries over the last 28 imported days. */
export async function gscQueries(sql: Sql): Promise<Map<string, GscStat & { from: string; to: string }>> {
  const latest = (await sql.execute(`SELECT MAX(day) AS d FROM seo_metrics_daily WHERE source = ?`, [GSC_SOURCES.query])).rows[0]?.d as string | null;
  const out = new Map<string, GscStat & { from: string; to: string }>();
  if (!latest) return out;
  const from = isoDay(new Date(`${latest}T00:00:00Z`), -27);
  const rows = (await sql.execute(
    `SELECT query, SUM(impressions) AS i, SUM(clicks) AS c, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p
     FROM seo_metrics_daily WHERE source = ? AND day >= ? AND day <= ? AND query IS NOT NULL GROUP BY query ORDER BY i DESC LIMIT 500`,
    [GSC_SOURCES.query, from, latest],
  )).rows;
  for (const r of rows) out.set(normalize(String(r.query)), { impressions: Number(r.i) || 0, clicks: Number(r.c) || 0, position: r.p === null ? null : Number(r.p), from, to: latest });
  return out;
}

const parse = (s: unknown): Evidence => { try { return s ? (JSON.parse(String(s)) as Evidence) : { sources: [] }; } catch { return { sources: [] }; } };

/** Opportunities in our own search data, as proposed recommendations (one per keyword and kind). */
export function opportunities(k: string, target: Target | null, g: GscStat | undefined): { kind: string; title: string; detail: string; impact: string }[] {
  if (!g || !target) return [];
  const out: { kind: string; title: string; detail: string; impact: string }[] = [];
  const ctr = g.impressions ? g.clicks / g.impressions : 0;
  if (g.position !== null && g.position > 3.5 && g.position <= 20 && g.impressions >= 20) {
    out.push({
      kind: "keyword_striking", title: `Move “${k}” onto page one`,
      detail: `The site already appears for this search at average position ${g.position.toFixed(1)} (${g.impressions} impressions in 28 days). Strengthen ${target.path}: use the phrase in the title, a heading and the first paragraph, and link to the page from related pages.`,
      impact: target.tier === 1 ? "high" : "medium",
    });
  }
  if (g.position !== null && g.position <= 5 && g.impressions >= 100 && ctr < 0.02) {
    out.push({
      kind: "keyword_low_ctr", title: `Make the search result for “${k}” more clickable`,
      detail: `The page ranks well (position ${g.position.toFixed(1)}) but only ${(ctr * 100).toFixed(1)}% of ${g.impressions} people clicked. Rewrite the title and meta description of ${target.path} to answer this search directly.`,
      impact: "medium",
    });
  }
  return out;
}

export async function runKeywordResearch(ctx: JobContext, o: { suggest?: Suggest; siteUrl: string; pause?: number }) {
  const { sql } = ctx;
  const t = ctx.now.toISOString();
  const useSuggest = (await getSetting(sql, AUTOCOMPLETE_SETTING)) !== "off";
  const suggest = o.suggest ?? googleSuggest;
  const pause = o.pause ?? 400;

  // Candidates and where each came from.
  const found = new Map<string, Evidence>();
  const note = (raw: string, source: string, seed?: string) => {
    const k = normalize(raw);
    if (!relevant(k)) return;
    const e = found.get(k) ?? { sources: [] };
    if (!e.sources.includes(source)) e.sources.push(source);
    if (seed && !e.seed) e.seed = seed;
    found.set(k, e);
  };
  for (const s of SEEDS) note(s, "seed");

  let suggested = 0;
  let suggestErrors = 0;
  if (useSuggest) {
    for (const s of EXPAND) {
      try {
        const list = await suggest(s);
        for (const x of list.slice(0, 10)) { note(x, "autocomplete", s); suggested++; }
      } catch (e) {
        suggestErrors++;
        await ctx.log("warn", "autocomplete_failed", { seed: s, error: e instanceof Error ? e.message : String(e) });
        if (suggestErrors >= 3) break;
      }
      if (pause) await new Promise((r) => setTimeout(r, pause));
    }
  }

  const gsc = await gscQueries(sql);
  for (const [q] of gsc) note(q, "search_console");

  // Existing rows: manual ones are kept as the owner set them; ignored ones are left alone.
  const existing = new Map((await sql.execute(`SELECT id, keyword, product, intent, notes FROM seo_keywords`)).rows.map((r) => [String(r.keyword), r]));
  for (const [k, r] of existing) {
    const e = parse(r.notes);
    if (e.manual && !found.has(k)) found.set(k, { sources: ["manual"] });
  }

  let added = 0;
  let updated = 0;
  let proposals = 0;
  const stmts: { sql: string; args: unknown[] }[] = [];
  for (const [k, e] of found) {
    const row = existing.get(k);
    const prev = row ? parse(row.notes) : null;
    if (prev?.ignored) continue;
    const g = gsc.get(k);
    const target = row?.product ? TARGETS.find((x) => x.path === row.product) ?? targetFor(k) : targetFor(k);
    const intent = (prev?.manual && row?.intent ? String(row.intent) : classifyIntent(k)) as Intent;
    const sources = Array.from(new Set([...(prev?.manual ? ["manual"] : []), ...e.sources]));
    const { priority, why } = score(k, intent, target, { sources, gsc: g ? { ...g, from: "", to: "" } : undefined });
    const ev: Evidence = { sources, ...(e.seed ? { seed: e.seed } : {}), ...(g ? { gsc: g } : {}), ...(prev?.manual ? { manual: true } : {}), why };
    if (row) {
      stmts.push({ sql: `UPDATE seo_keywords SET product = ?, intent = ?, priority = ?, notes = ?, updated_at = ? WHERE id = ?`, args: [target?.path ?? null, intent, priority, JSON.stringify(ev), t, row.id] });
      updated++;
    } else {
      stmts.push({
        sql: `INSERT INTO seo_keywords (id, keyword, product, intent, priority, search_volume, volume_source, competition, competition_source, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        args: [randomUUID(), k, target?.path ?? null, intent, priority, JSON.stringify(ev), t, t],
      });
      added++;
    }
    for (const op of opportunities(k, target, g)) {
      const url = `${o.siteUrl}${target!.path}`;
      const open = (await sql.execute(`SELECT 1 FROM seo_recommendations WHERE kind = ? AND title = ? AND status IN ('proposed','approved')`, [op.kind, op.title])).rows[0];
      if (open) continue;
      stmts.push({
        sql: `INSERT INTO seo_recommendations (id, kind, title, detail, evidence, url, impact, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
        args: [randomUUID(), op.kind, op.title, op.detail, JSON.stringify({ keyword: k, searchConsole: g }), url, op.impact, t, t],
      });
      proposals++;
    }
  }
  for (let i = 0; i < stmts.length; i += 200) await sql.batch(stmts.slice(i, i + 200));

  const summary = { candidates: found.size, added, updated, proposals, autocomplete: useSuggest ? { suggestions: suggested, errors: suggestErrors } : "off", searchConsoleQueries: gsc.size };
  await ctx.log("info", "keywords_researched", summary);
  return summary;
}
