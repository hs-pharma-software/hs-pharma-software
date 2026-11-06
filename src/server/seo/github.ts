/** Approved drafts become a branch and pull request on GitHub; nothing reaches
 * the website until a person merges it. Uses a fine-grained token limited to
 * this repository (contents and pull requests). The token is never logged.
 *
 * Files written:
 *   article -> src/content/articles/<slug>.md (front matter + Markdown)
 *   meta    -> src/content/seo-meta.json (path -> title, description)  */
import type { Http } from "./google";
import { defaultHttp } from "./google";
import type { DraftBody } from "./content";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface GitHubConfig { token: string; repo: string; base: string }

export function githubConfig(env: Record<string, string | undefined> = process.env): GitHubConfig | null {
  const token = env.GITHUB_TOKEN?.trim();
  const repo = env.GITHUB_REPO?.trim();
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { token, repo, base: env.GITHUB_BASE_BRANCH?.trim() || "main" };
}

export const ARTICLES_DIR = "src/content/articles";
export const META_FILE = "src/content/seo-meta.json";

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "article";

const yaml = (s: string) => JSON.stringify(s);

/** The article file: front matter the site reads, then the Markdown. */
export function articleFile(d: { title: string; keyword: string | null; path: string | null; body: DraftBody }, date: string): string {
  return `---
title: ${yaml(d.title)}
description: ${yaml(d.body.description)}
keyword: ${yaml(d.keyword ?? "")}
product: ${yaml(d.path ?? "")}
date: ${yaml(date)}
---

${(d.body.markdown ?? "").trim()}
`;
}

async function gh<T>(http: Http, cfg: GitHubConfig, method: "GET" | "POST" | "PUT", path: string, body?: unknown, okStatuses = [200, 201]): Promise<{ status: number; json: T }> {
  const res = await http(
    `https://api.github.com/repos/${cfg.repo}${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "mavin-seo-manager" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (!okStatuses.includes(res.status)) {
    const msg = (res.json as { message?: string })?.message ?? "no details";
    const hint = res.status === 401 ? " The GitHub token is wrong or expired." : res.status === 403 || res.status === 404 ? " Check the token can read and write contents and pull requests of this repository." : "";
    throw new Error(`GitHub answered ${res.status} for ${method} ${path.split("?")[0]}: ${msg}.${hint}`);
  }
  return { status: res.status, json: res.json as T };
}

/** Opens the pull request for an approved draft; returns its address. */
export async function openPullRequest(
  d: { id: string; kind: string; title: string; keyword: string | null; path: string | null; body: DraftBody; checksSummary: string; reviewer: string },
  o: { cfg: GitHubConfig; http?: Http; now?: Date },
): Promise<{ url: string; number: number; branch: string }> {
  const http = o.http ?? defaultHttp;
  const cfg = o.cfg;
  const now = o.now ?? new Date();
  const slug = d.kind === "meta" ? slugify(`meta-${d.path === "/" ? "home" : d.path ?? "page"}`) : slugify(d.keyword || d.title);
  const branch = `seo/${slug}-${d.id.slice(0, 6)}`;

  const base = await gh<{ object: { sha: string } }>(http, cfg, "GET", `/git/ref/heads/${encodeURIComponent(cfg.base)}`);
  const created = await gh(http, cfg, "POST", `/git/refs`, { ref: `refs/heads/${branch}`, sha: base.json.object.sha }, [201, 422]);
  if (created.status === 422) throw new Error(`The branch ${branch} already exists on GitHub; a pull request was probably opened before.`);

  let file: string;
  let content: string;
  let sha: string | undefined;
  if (d.kind === "article") {
    file = `${ARTICLES_DIR}/${slug}.md`;
    content = articleFile(d, now.toISOString().slice(0, 10));
    const ex = await gh<{ sha?: string }>(http, cfg, "GET", `/contents/${file}?ref=${encodeURIComponent(branch)}`, undefined, [200, 404]);
    if (ex.status === 200) throw new Error(`${file} already exists; edit the keyword or title so the article gets its own address.`);
  } else {
    file = META_FILE;
    const ex = await gh<{ sha?: string; content?: string }>(http, cfg, "GET", `/contents/${file}?ref=${encodeURIComponent(branch)}`, undefined, [200, 404]);
    let current: Record<string, { title: string; description: string }> = {};
    if (ex.status === 200 && ex.json.content) {
      sha = ex.json.sha;
      try { current = JSON.parse(Buffer.from(ex.json.content, "base64").toString("utf8")); } catch { throw new Error(`${file} on GitHub is not valid JSON; fix it first.`); }
    }
    current[d.path ?? "/"] = { title: d.title, description: d.body.description };
    content = `${JSON.stringify(Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
  }
  await gh(http, cfg, "PUT", `/contents/${file}`, {
    message: `SEO: ${d.kind === "meta" ? `title and description for ${d.path}` : d.title}`,
    content: Buffer.from(content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}),
  });
  const pr = await gh<{ html_url: string; number: number }>(http, cfg, "POST", `/pulls`, {
    title: `SEO: ${d.kind === "meta" ? `new title and description for ${d.path}` : d.title}`,
    head: branch, base: cfg.base,
    body: [
      `Proposed by the Mavin SEO Manager and approved in Super Admin → SEO → Content Studio by ${d.reviewer}.`,
      "",
      d.kind === "meta"
        ? `**Page:** \`${d.path}\`\n**New title:** ${d.title}\n**New description:** ${d.body.description}`
        : `**Article:** ${d.title}\n**Keyword:** ${d.keyword ?? "–"}\n**Address after merge:** /resources/${slug}`,
      "",
      `**Checks:** ${d.checksSummary}`,
      "",
      "Review the text before merging: merging publishes it on the next deployment.",
    ].join("\n"),
  });
  return { url: pr.json.html_url, number: pr.json.number, branch };
}

/** Whether a pull request was merged or closed. */
export async function pullRequestState(url: string, o: { cfg: GitHubConfig; http?: Http }): Promise<"open" | "merged" | "closed"> {
  const n = url.match(/\/pull\/(\d+)/)?.[1];
  if (!n) throw new Error("Not a pull request address.");
  const r = await gh<{ state: string; merged?: boolean; merged_at?: string | null }>(o.http ?? defaultHttp, o.cfg, "GET", `/pulls/${n}`);
  if (r.json.merged || r.json.merged_at) return "merged";
  return r.json.state === "closed" ? "closed" : "open";
}
