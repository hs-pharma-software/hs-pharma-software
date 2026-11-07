/** "Popular searches" on the public website: the strongest keywords from the
 * weekly keyword research (SEO Manager), each linking to the page it belongs
 * to. Updated automatically whenever research runs. Limited to a short list of
 * relevant, non-brand phrases (a long keyword list would read as spam). */
import type { Sql } from "../subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface PopularSearch { keyword: string; href: string }
const MAX = 24;
const MISLEADING = /\b(free|download|crack|cracked|apk|torrent|full version|key|keygen|jobs?|salary)\b/;
let cache: { at: number; items: PopularSearch[] } | null = null;

export async function popularSearches(sql: Sql, now = Date.now()): Promise<PopularSearch[]> {
  if (cache && now - cache.at < 15 * 60_000) return cache.items;
  let items: PopularSearch[] = [];
  try {
    const rows = (await sql.execute(
      `SELECT keyword, product, notes FROM seo_keywords WHERE priority > 0 AND (intent IS NULL OR intent != 'navigational') ORDER BY priority DESC, keyword LIMIT 80`,
    )).rows;
    const seen = new Set<string>();
    for (const r of rows) {
      const k = String(r.keyword ?? "").trim().toLowerCase();
      if (!k || k.length > 60 || seen.has(k) || String(r.notes ?? "").includes('"ignored":true')) continue;
      // Shown as our own words on the site: nothing we do not offer (free downloads, cracks).
      if (MISLEADING.test(k)) continue;
      seen.add(k);
      const path = typeof r.product === "string" && /^\/[a-z0-9/-]*$/.test(r.product) ? r.product : "/products";
      items.push({ keyword: k, href: path });
      if (items.length >= MAX) break;
    }
  } catch {
    items = []; // before SEO tables exist: no strip
  }
  cache = { at: now, items };
  return items;
}
export const resetPopularSearches = () => { cache = null; };
