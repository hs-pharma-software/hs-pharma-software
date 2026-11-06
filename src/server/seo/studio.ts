/** Content Studio actions (Super Admin only, via /api/seo/admin): list, write,
 * edit and review drafts, then open a pull request for an approved one.
 * Status: draft -> in_review -> approved -> (pull request merged) published;
 * rejected drafts can be reopened. Every step is in the activity log. */
import { HttpError } from "../db";
import type { Sql } from "../subSupers";
import { logActivity } from "./engine";
import {
  DRAFT_TARGETS, briefFor, checkDraft, otherDrafts, parseBody, parseChecks, platformWriter, saveDraft, writeArticle,
  type Checks, type DraftBody, type DraftKind, type DraftStatus, type Writer,
} from "./content";
import { githubConfig, openPullRequest, pullRequestState, type GitHubConfig } from "./github";
import type { Http } from "./google";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface StudioDeps { writer?: Writer | null; github?: GitHubConfig | null; http?: Http }

async function load(sql: Sql, id: string) {
  const r = (await sql.execute(`SELECT * FROM seo_content_drafts WHERE id = ?`, [id])).rows[0];
  if (!r) throw new HttpError(404, "Draft not found.");
  return {
    id: String(r.id), kind: r.kind as DraftKind, title: String(r.title), keyword: (r.target_keyword as string | null) ?? null, path: (r.target_path as string | null) ?? null,
    body: parseBody(r.body), status: r.status as DraftStatus, checks: parseChecks(r.checks), prUrl: (r.pr_url as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null, reviewedBy: (r.reviewed_by as string | null) ?? null, reviewedAt: (r.reviewed_at as string | null) ?? null,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}
export type Draft = Awaited<ReturnType<typeof load>>;

export async function listDrafts(sql: Sql, deps: StudioDeps = {}) {
  const rows = (await sql.execute(`SELECT id, kind, title, target_keyword, target_path, status, checks, pr_url, created_at, updated_at FROM seo_content_drafts ORDER BY updated_at DESC LIMIT 300`)).rows;
  const writer = deps.writer === undefined ? await platformWriter(sql) : deps.writer;
  const gh = deps.github === undefined ? githubConfig() : deps.github;
  return {
    aiReady: Boolean(writer), githubReady: Boolean(gh), targets: DRAFT_TARGETS,
    drafts: rows.map((r) => {
      const c = parseChecks(r.checks);
      return {
        id: String(r.id), kind: String(r.kind), title: String(r.title), keyword: (r.target_keyword as string | null) ?? null, path: (r.target_path as string | null) ?? null,
        status: String(r.status), blocking: c ? c.issues.filter((i) => i.level === "block").length : 0, warnings: c ? c.issues.filter((i) => i.level === "warn").length : 0,
        prUrl: (r.pr_url as string | null) ?? null, updatedAt: String(r.updated_at),
      };
    }),
  };
}

export const getDraft = (sql: Sql, id: string) => load(sql, id);

/** Writes one article now (AI, or a brief without it). */
export async function createDraft(sql: Sql, actor: string, keyword: unknown, path: unknown, deps: StudioDeps = {}) {
  const k = typeof keyword === "string" ? keyword.trim().toLowerCase().replace(/\s+/g, " ") : "";
  if (k.length < 3 || k.length > 80) throw new HttpError(400, "Enter the search phrase the article should answer (3 to 80 characters).");
  const p = typeof path === "string" && path ? path : null;
  if (p && !DRAFT_TARGETS.some((t) => t.path === p)) throw new HttpError(400, "Unknown page.");
  const writer = deps.writer === undefined ? await platformWriter(sql) : deps.writer;
  let d: { title: string; body: DraftBody };
  try {
    d = writer ? await writeArticle(writer, k, p) : briefFor(k, p);
  } catch (e) {
    throw new HttpError(502, e instanceof Error ? e.message : "The AI writer failed.");
  }
  const s = await saveDraft(sql, { kind: "article", title: d.title, keyword: k, path: p, body: d.body, by: actor });
  await logActivity(sql, { actor, action: "draft_created", detail: { id: s.id, keyword: k, writer: writer ? "ai" : "brief" } });
  return { id: s.id };
}

async function store(sql: Sql, d: Draft, patch: { title?: string; body?: DraftBody; status?: DraftStatus; checks?: Checks; reviewer?: string | null; prUrl?: string | null }) {
  const t = new Date().toISOString();
  await sql.execute(
    `UPDATE seo_content_drafts SET title = ?, body = ?, status = ?, checks = ?, reviewed_by = ?, reviewed_at = ?, pr_url = ?, updated_at = ? WHERE id = ?`,
    [
      patch.title ?? d.title, JSON.stringify(patch.body ?? d.body), patch.status ?? d.status, JSON.stringify(patch.checks ?? d.checks),
      patch.reviewer === undefined ? d.reviewedBy : patch.reviewer, patch.reviewer === undefined ? d.reviewedAt : patch.reviewer ? t : null,
      patch.prUrl === undefined ? d.prUrl : patch.prUrl, t, d.id,
    ],
  );
}

async function recheck(sql: Sql, d: Draft, title: string, body: DraftBody): Promise<Checks> {
  const c = checkDraft({ id: d.id, kind: d.kind, title, keyword: d.keyword, path: d.path, body }, await otherDrafts(sql));
  if (body.brief) c.issues.push({ level: "block", check: "brief", message: "This is an outline: replace it with the finished article before approving." });
  c.ok = !c.issues.some((i) => i.level === "block");
  return c;
}

/** Edits title, description and text; checks run again. Only before approval. */
export async function updateDraft(sql: Sql, actor: string, id: string, p: { title?: unknown; description?: unknown; markdown?: unknown }) {
  const d = await load(sql, id);
  if (d.status !== "draft" && d.status !== "in_review") throw new HttpError(409, "Only drafts and drafts in review can be edited. Reopen it first.");
  const title = typeof p.title === "string" ? p.title.trim().slice(0, 200) : d.title;
  if (title.length < 3) throw new HttpError(400, "Give the draft a title.");
  const body: DraftBody = { ...d.body };
  if (typeof p.description === "string") body.description = p.description.trim().slice(0, 400);
  if (typeof p.markdown === "string" && d.kind !== "meta") {
    body.markdown = p.markdown.replace(/\r\n/g, "\n").slice(0, 60_000);
    body.brief = Boolean(d.body.brief && body.markdown.includes("Brief for a writer"));
  }
  const checks = await recheck(sql, d, title, body);
  checks.reviewNote = d.checks?.reviewNote;
  await store(sql, d, { title, body, checks });
  await logActivity(sql, { actor, action: "draft_edited", detail: { id, ok: checks.ok } });
  return checks;
}

/** submit: draft -> in_review; approve: -> approved (no blocking problem); reject (needs a note); reopen: rejected/approved -> draft. */
export async function decideDraft(sql: Sql, actor: string, id: string, action: unknown, note: unknown) {
  const d = await load(sql, id);
  const why = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (action === "submit") {
    if (d.status !== "draft") throw new HttpError(409, "Only a draft can be sent for review.");
    await store(sql, d, { status: "in_review" });
  } else if (action === "approve") {
    if (d.status !== "draft" && d.status !== "in_review") throw new HttpError(409, "This draft is not waiting for approval.");
    const checks = await recheck(sql, d, d.title, d.body);
    if (!checks.ok) {
      await store(sql, d, { checks });
      throw new HttpError(400, `Fix the blocking problems first: ${checks.issues.filter((i) => i.level === "block").map((i) => i.message).join(" ")}`);
    }
    await store(sql, d, { status: "approved", checks, reviewer: actor });
  } else if (action === "reject") {
    if (d.status === "published") throw new HttpError(409, "A published draft cannot be rejected.");
    if (why.length < 3) throw new HttpError(400, "Say why you are rejecting it.");
    await store(sql, d, { status: "rejected", checks: { ...(d.checks ?? { ok: false, issues: [], words: 0, keywordCount: 0, checkedAt: new Date().toISOString() }), reviewNote: why }, reviewer: actor });
  } else if (action === "reopen") {
    if (d.status !== "rejected" && d.status !== "approved") throw new HttpError(409, "Only rejected or approved drafts can be reopened.");
    if (d.prUrl) throw new HttpError(409, "A pull request is open for this draft: close it on GitHub first.");
    await store(sql, d, { status: "draft", reviewer: null });
  } else {
    throw new HttpError(400, "Unknown action.");
  }
  await logActivity(sql, { actor, level: action === "reject" ? "warn" : "info", action: `draft_${String(action)}`, detail: { id, title: d.title, note: why || null } });
}

/** Opens the pull request of an approved draft. */
export async function openDraftPullRequest(sql: Sql, actor: string, id: string, deps: StudioDeps = {}) {
  const d = await load(sql, id);
  if (d.status !== "approved") throw new HttpError(409, "Approve the draft first.");
  if (d.prUrl) throw new HttpError(409, "A pull request is already open for this draft.");
  const cfg = deps.github === undefined ? githubConfig() : deps.github;
  if (!cfg) throw new HttpError(400, "GitHub is not connected: set GITHUB_TOKEN and GITHUB_REPO (Settings tab).");
  const c = d.checks;
  const summary = c ? `${c.issues.filter((i) => i.level === "warn").length} warning(s), no blocking problems; ${c.words} words.` : "checked";
  let pr: { url: string; number: number; branch: string };
  try {
    pr = await openPullRequest({ id: d.id, kind: d.kind, title: d.title, keyword: d.keyword, path: d.path, body: d.body, checksSummary: summary, reviewer: actor }, { cfg, http: deps.http });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logActivity(sql, { actor, level: "error", action: "pull_request_failed", detail: { id, error: msg } });
    throw new HttpError(502, msg);
  }
  await store(sql, d, { prUrl: pr.url });
  await logActivity(sql, { actor, action: "pull_request_opened", detail: { id, url: pr.url, branch: pr.branch } });
  return pr;
}

/** Marks drafts published when their pull request was merged; a closed one can be opened again. */
export async function refreshPullRequests(sql: Sql, actor: string, deps: StudioDeps = {}) {
  const cfg = deps.github === undefined ? githubConfig() : deps.github;
  if (!cfg) return { checked: 0, published: 0, closed: 0 };
  const rows = (await sql.execute(`SELECT id FROM seo_content_drafts WHERE status = 'approved' AND pr_url IS NOT NULL`)).rows;
  let published = 0;
  let closed = 0;
  for (const r of rows) {
    const d = await load(sql, String(r.id));
    const state = await pullRequestState(d.prUrl!, { cfg, http: deps.http });
    if (state === "merged") {
      await store(sql, d, { status: "published" });
      await logActivity(sql, { actor, action: "draft_published", detail: { id: d.id, url: d.prUrl } });
      published++;
    } else if (state === "closed") {
      await store(sql, d, { prUrl: null, checks: { ...(d.checks as Checks), reviewNote: "The pull request was closed without merging." } });
      await logActivity(sql, { actor, level: "warn", action: "pull_request_closed", detail: { id: d.id, url: d.prUrl } });
      closed++;
    }
  }
  return { checked: rows.length, published, closed };
}
