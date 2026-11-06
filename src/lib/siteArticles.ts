/** Articles of the public site (Resources), one Markdown file each in
 * src/content/articles, added by pull requests from the SEO Content Studio.
 * Read at build time by the server pages only. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Article { slug: string; title: string; description: string; keyword: string; product: string; date: string; markdown: string }

const DIR = join(process.cwd(), "src", "content", "articles");

/** Front matter is `key: "json string"` lines between --- markers. */
export function parseArticle(slug: string, raw: string): Article | null {
  const m = raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    try { meta[kv[1]] = String(JSON.parse(kv[2])); } catch { meta[kv[1]] = kv[2].trim(); }
  }
  if (!meta.title) return null;
  return { slug, title: meta.title, description: meta.description ?? "", keyword: meta.keyword ?? "", product: meta.product ?? "", date: meta.date ?? "", markdown: m[2].trim() };
}

export function listArticles(): Article[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => /^[a-z0-9-]+\.md$/.test(f))
    .map((f) => parseArticle(f.slice(0, -3), readFileSync(join(DIR, f), "utf8")))
    .filter((a): a is Article => a !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

export const getArticle = (slug: string) => listArticles().find((a) => a.slug === slug) ?? null;
