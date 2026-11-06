"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { serverJson } from "@/lib/serverMode";
import { ListState, Notice, errText } from "@/components/subsupers/shared";
import { Markdown } from "@/components/site/Markdown";

/** SEO > Content Studio: drafts written from the product record, checked for
 * unsupported claims, stuffing and duplicates, reviewed here, and published
 * only through a GitHub pull request that a person merges. */

interface Row { id: string; kind: string; title: string; keyword: string | null; path: string | null; status: string; blocking: number; warnings: number; prUrl: string | null; updatedAt: string }
interface Issue { level: "block" | "warn"; check: string; message: string }
interface Draft {
  id: string; kind: string; title: string; keyword: string | null; path: string | null; status: string; prUrl: string | null; reviewedBy: string | null;
  body: { description: string; markdown?: string; path?: string | null; current?: { title?: string; description?: string }; brief?: boolean };
  checks: { ok: boolean; issues: Issue[]; words: number; keywordCount: number; reviewNote?: string } | null;
}
interface List { aiReady: boolean; githubReady: boolean; targets: { path: string; label: string }[]; drafts: Row[] }

const seoCall = async <T,>(action: string, body: Record<string, unknown> = {}) => (await serverJson<{ result: T }>("/api/seo/admin/", { action, ...body })).result;
const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const STATUS: Record<string, [string, string]> = {
  draft: ["Draft", "bg-neutral-100 text-neutral-700"], in_review: ["In review", "bg-sky-100 text-sky-800"], approved: ["Approved", "bg-emerald-100 text-emerald-800"],
  rejected: ["Rejected", "bg-rose-100 text-rose-700"], published: ["Published", "bg-violet-100 text-violet-800"],
};
const Status = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[s]?.[1] ?? ""}`}>{STATUS[s]?.[0] ?? s}</span>;
const KIND: Record<string, string> = { article: "Article", meta: "Title & description", landing: "Landing page" };

export function ContentStudio() {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [kw, setKw] = useState("");
  const [kwPath, setKwPath] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { setError(null); seoCall<List>("drafts").then(setList).catch((e) => setError(errText(e))); }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!list) return <ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} />;
  const shown = list.drafts.filter((d) => (filter === "open" ? ["draft", "in_review", "approved"].includes(d.status) : filter === "all" ? true : d.status === filter));

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        Drafts are written only from the product record and checked before you see them. Approving a draft does not publish it: it becomes a GitHub pull request,
        and the change goes live when you merge it.
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-medium ${list.aiReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          AI writer: {list.aiReady ? "ready" : "not set up (outlines only; set it on the Billori AI page)"}
        </span>
        <span className={`rounded-full px-2.5 py-1 font-medium ${list.githubReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          GitHub: {list.githubReady ? "connected" : "not connected (see Settings)"}
        </span>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="ok">{msg}</Notice>}

      <div className={`${card} flex flex-wrap items-end gap-2`}>
        <label htmlFor="cs-kw" className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-neutral-600">Write an article for a search
          <Input id="cs-kw" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="e.g. how to manage medicine expiry in a pharmacy" />
        </label>
        <label htmlFor="cs-path" className="flex flex-col gap-1 text-xs text-neutral-600">Leads to
          <Select id="cs-path" value={kwPath} onChange={(e) => setKwPath(e.target.value)}>
            <option value="">Match automatically</option>
            {list.targets.map((t) => <option key={t.path} value={t.path}>{t.label}</option>)}
          </Select>
        </label>
        <Button variant="primary" disabled={busy || kw.trim().length < 3}
          onClick={() => void act(async () => { const r = await seoCall<{ id: string }>("createDraft", { keyword: kw, path: kwPath }); setKw(""); setOpenId(r.id); }, list.aiReady ? "Draft written. Review it below." : "Outline created. Write the article in it before approving.")}>
          {busy ? "Writing…" : list.aiReady ? "Write draft" : "Create outline"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
          {[["open", "Open"], ["published", "Published"], ["rejected", "Rejected"], ["all", "All"]].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={`rounded-md px-2.5 py-1 font-medium ${filter === v ? "bg-white shadow-sm" : "text-neutral-500"}`}>{l}</button>
          ))}
        </span>
        {list.githubReady && list.drafts.some((d) => d.prUrl && d.status === "approved") && (
          <Button className="ml-auto" disabled={busy} onClick={() => void act(async () => {
            const r = await seoCall<{ checked: number; published: number; closed: number }>("refreshPullRequests");
            setMsg(`${r.checked} pull request(s) checked: ${r.published} merged (published), ${r.closed} closed.`);
          }, "")}>Check pull requests</Button>
        )}
      </div>

      <div className={card}>
        {!shown.length ? (
          <p className="py-6 text-center text-sm text-neutral-400">{list.drafts.length ? "No drafts here." : "No drafts yet. Run “Content proposals” from Automation Schedule, or write one above."}</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {shown.map((d) => (
              <li key={d.id} className="py-2.5">
                <button type="button" onClick={() => setOpenId(openId === d.id ? null : d.id)} aria-expanded={openId === d.id} className="flex w-full flex-wrap items-start justify-between gap-2 text-left">
                  <span className="min-w-0">
                    <span className="font-medium text-neutral-800">{d.title}</span>
                    <span className="mt-0.5 block text-[11px] text-neutral-500">{KIND[d.kind] ?? d.kind}{d.keyword ? ` · “${d.keyword}”` : ""}{d.path ? ` · ${d.path}` : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {d.blocking > 0 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">{d.blocking} to fix</span>}
                    {d.warnings > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{d.warnings} to check</span>}
                    <Status s={d.status} />
                  </span>
                </button>
                {openId === d.id && <DraftEditor id={d.id} githubReady={list.githubReady} onChanged={load} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DraftEditor({ id, githubReady, onChanged }: { id: string; githubReady: boolean; onChanged: () => void }) {
  const [d, setD] = useState<Draft | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [md, setMd] = useState("");
  const [preview, setPreview] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    seoCall<Draft>("draft", { id }).then((x) => { setD(x); setTitle(x.title); setDesc(x.body.description); setMd(x.body.markdown ?? ""); }).catch((e) => setError(errText(e)));
  }, [id]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      load();
      onChanged();
    } catch (e) {
      setError(errText(e));
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <div className="mt-3"><ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} /></div>;
  const editable = d.status === "draft" || d.status === "in_review";
  const dirty = title !== d.title || desc !== d.body.description || md !== (d.body.markdown ?? "");
  const issues = d.checks?.issues ?? [];
  const decide = (decision: string, ok: string) => act(() => seoCall("decideDraft", { id, decision, note }), ok);

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="ok">{msg}</Notice>}
      {d.checks?.reviewNote && <Notice kind="warn">{d.checks.reviewNote}</Notice>}

      {issues.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {issues.map((i, n) => (
            <li key={n} className={i.level === "block" ? "text-rose-700" : "text-amber-800"}>
              <b>{i.level === "block" ? "Must fix" : "Check"}:</b> {i.message}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-emerald-700">All checks passed{d.checks ? ` · ${d.checks.words} words` : ""}.</p>}

      {d.kind === "meta" && d.body.current && (
        <div className="rounded-lg bg-white p-2 text-xs text-neutral-600">
          <p className="font-medium text-neutral-700">Now on {d.path}</p>
          <p>Title: {d.body.current.title ?? "(none)"}</p>
          <p>Description: {d.body.current.description ?? "(none)"}</p>
        </div>
      )}

      <label htmlFor={`t-${id}`} className="flex flex-col gap-1 text-xs text-neutral-600">Title <span className="text-neutral-400">{title.length} characters (30 to 60)</span>
        <Input id={`t-${id}`} value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label htmlFor={`d-${id}`} className="flex flex-col gap-1 text-xs text-neutral-600">Description <span className="text-neutral-400">{desc.length} characters (70 to 160)</span>
        <textarea id={`d-${id}`} value={desc} disabled={!editable} onChange={(e) => setDesc(e.target.value)} rows={2}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-[var(--accent)] focus:outline-none disabled:bg-neutral-100" />
      </label>
      {d.kind !== "meta" && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-neutral-600">
            <span>Article (Markdown: ## headings, - lists, **bold**, [links](/products))</span>
            <button type="button" className="font-medium text-[var(--accent)] underline" onClick={() => setPreview(!preview)}>{preview ? "Edit" : "Preview"}</button>
          </div>
          {preview ? (
            <div className="max-h-[32rem] overflow-auto rounded-lg bg-white p-4"><Markdown source={md} base="/site" /></div>
          ) : (
            <textarea id={`m-${id}`} aria-label="Article text" value={md} disabled={!editable} onChange={(e) => setMd(e.target.value)} rows={18}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-neutral-800 focus:border-[var(--accent)] focus:outline-none disabled:bg-neutral-100" />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-neutral-200 pt-3">
        {editable && <Button disabled={busy || !dirty} onClick={() => void act(() => seoCall("updateDraft", { id, title, description: desc, markdown: md }), "Saved. Checks ran again.")}>Save changes</Button>}
        {d.status === "draft" && <Button disabled={busy || dirty} onClick={() => void decide("submit", "Sent for review.")}>Send for review</Button>}
        {editable && <Button variant="primary" disabled={busy || dirty} onClick={() => void decide("approve", githubReady ? "Approved. Open the pull request when ready." : "Approved. Connect GitHub to open the pull request.")}>Approve</Button>}
        {d.status === "approved" && !d.prUrl && (
          <Button variant="primary" disabled={busy || !githubReady} title={githubReady ? undefined : "Connect GitHub in Settings"}
            onClick={() => void act(() => seoCall("openPullRequest", { id }), "Pull request opened on GitHub. Review and merge it there to publish.")}>Open pull request</Button>
        )}
        {d.prUrl && <a href={d.prUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[var(--accent)] underline">View pull request</a>}
        {(d.status === "rejected" || (d.status === "approved" && !d.prUrl)) && <Button disabled={busy} onClick={() => void decide("reopen", "Reopened as a draft.")}>Reopen</Button>}
        {d.status !== "rejected" && d.status !== "published" && !d.prUrl && (
          <span className="ml-auto flex flex-wrap items-end gap-2">
            <label htmlFor={`r-${id}`} className="flex flex-col gap-1 text-xs text-neutral-600">Reason (to reject)
              <Input id={`r-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. off topic" />
            </label>
            <Button variant="danger" disabled={busy || note.trim().length < 3} onClick={() => void decide("reject", "Rejected.")}>Reject</Button>
          </span>
        )}
      </div>
      {d.reviewedBy && <p className="text-[11px] text-neutral-400">Reviewed by {d.reviewedBy}</p>}
    </div>
  );
}

/** Settings: how to connect GitHub so approved drafts become pull requests. */
export function GitHubSetupGuide() {
  return (
    <div className={card}>
      <p className="text-sm font-semibold text-neutral-800">Connect GitHub (Content Studio pull requests)</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-neutral-700">
        <li>On GitHub, open Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
        <li>Repository access: <b>Only select repositories</b> → this website&apos;s repository. Expiry: 90 days or a year (renew it when it expires).</li>
        <li>Repository permissions: <b>Contents: Read and write</b> and <b>Pull requests: Read and write</b>. Nothing else.</li>
        <li>In Vercel → Settings → Environment Variables (Production, Secret), add <code>GITHUB_TOKEN</code> (the token) and <code>GITHUB_REPO</code> (<code>owner/repository</code>). Redeploy.</li>
      </ol>
      <p className="mt-2 text-xs text-neutral-500">The token can only open branches and pull requests in that one repository. Changes reach the website only when you merge a pull request.</p>
    </div>
  );
}
