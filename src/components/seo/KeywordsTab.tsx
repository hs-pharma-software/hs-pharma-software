"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { serverJson } from "@/lib/serverMode";
import { ListState, Notice, errText } from "@/components/subsupers/shared";

/** SEO > Keywords: the research list. Every number has a source; search volume
 * shows "Unknown" unless a real source supplied it. */

interface Target { path: string; label: string; tier: number }
interface Keyword {
  id: string; keyword: string; target: string | null; intent: string | null; priority: number; volume: number | null; volumeSource: string | null;
  sources: string[]; gsc: { impressions: number; clicks: number; position: number | null } | null; why: string[]; manual: boolean; ignored: boolean; updatedAt: string;
}

const seoCall = async <T,>(action: string, body: Record<string, unknown> = {}) => (await serverJson<{ result: T }>("/api/seo/admin/", { action, ...body })).result;
const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const SOURCE_LABEL: Record<string, string> = { seed: "Starter list", autocomplete: "Google suggests", search_console: "Search Console", manual: "Added by you" };
const INTENT_CLS: Record<string, string> = {
  transactional: "bg-emerald-50 text-emerald-800", commercial: "bg-sky-50 text-sky-800", informational: "bg-neutral-100 text-neutral-700", navigational: "bg-violet-50 text-violet-800",
};

export function KeywordsTab() {
  const [data, setData] = useState<{ targets: Target[]; keywords: Keyword[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [intent, setIntent] = useState("");
  const [q, setQ] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [newKw, setNewKw] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { setError(null); seoCall<NonNullable<typeof data>>("keywords").then(setData).catch((e) => setError(errText(e))); }, []);
  useEffect(load, [load]);

  const label = useMemo(() => new Map((data?.targets ?? []).map((t) => [t.path, t.label])), [data]);
  const shown = useMemo(() => (data?.keywords ?? []).filter((k) =>
    k.ignored === showIgnored && (!target || k.target === target) && (!intent || k.intent === intent) && (!q.trim() || k.keyword.includes(q.trim().toLowerCase()))), [data, target, intent, q, showIgnored]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await fn();
      setMsg(ok);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} />;
  const active = data.keywords.filter((k) => !k.ignored);
  const withData = active.filter((k) => k.gsc && k.gsc.impressions > 0).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        Keyword research runs weekly (or now, from Automation Schedule). Candidates come from a Pakistan-focused starter list, Google&apos;s search suggestions and
        the searches the site already appears for. <b>Search volume shows Unknown</b>: no free source gives real volumes, and none are estimated.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="ok">{msg}</Notice>}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 font-medium text-neutral-700">{active.length} keywords</span>
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 font-medium text-neutral-700">{withData} with Search Console data</span>
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 font-medium text-neutral-700">{active.filter((k) => k.priority >= 70).length} high priority (70+)</span>
      </div>

      <div className={`${card} flex flex-wrap items-end gap-2`}>
        <label htmlFor="kw-new" className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-neutral-600">Add a keyword
          <Input id="kw-new" value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="e.g. pharmacy software lahore" />
        </label>
        <label htmlFor="kw-new-target" className="flex flex-col gap-1 text-xs text-neutral-600">Page
          <Select id="kw-new-target" value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
            <option value="">Match automatically</option>
            {data.targets.map((t) => <option key={t.path} value={t.path}>{t.label}</option>)}
          </Select>
        </label>
        <Button disabled={busy || newKw.trim().length < 3} onClick={() => void act(async () => { await seoCall("addKeyword", { keyword: newKw, target: newTarget }); setNewKw(""); }, "Keyword added. It is kept on every research run.")}>Add</Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor="kw-q" className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-neutral-600">Search
          <Input id="kw-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter keywords" />
        </label>
        <label htmlFor="kw-target" className="flex flex-col gap-1 text-xs text-neutral-600">Page
          <Select id="kw-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">All pages</option>
            {data.targets.map((t) => <option key={t.path} value={t.path}>{t.label}</option>)}
          </Select>
        </label>
        <label htmlFor="kw-intent" className="flex flex-col gap-1 text-xs text-neutral-600">Intent
          <Select id="kw-intent" value={intent} onChange={(e) => setIntent(e.target.value)}>
            <option value="">Any intent</option>
            {["transactional", "commercial", "informational", "navigational"].map((i) => <option key={i} value={i}>{i}</option>)}
          </Select>
        </label>
        <span className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
          {([false, true] as const).map((v) => (
            <button key={String(v)} type="button" aria-pressed={showIgnored === v} onClick={() => setShowIgnored(v)}
              className={`rounded-md px-2.5 py-1 font-medium ${showIgnored === v ? "bg-white shadow-sm" : "text-neutral-500"}`}>{v ? "Ignored" : "Active"}</button>
          ))}
        </span>
      </div>

      <div className={card}>
        {!shown.length ? (
          <p className="py-6 text-center text-sm text-neutral-400">
            {data.keywords.length ? "No keywords match these filters." : "No research yet. Run “Keyword research” from Automation Schedule."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Keyword</th>
                  <th className="py-1.5 pr-3 font-medium">Page</th>
                  <th className="py-1.5 pr-3 font-medium">Intent</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Priority</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Google, 28 days</th>
                  <th className="py-1.5 pr-3 font-medium">Volume</th>
                  <th className="py-1.5 pr-3 font-medium">Source</th>
                  <th className="py-1.5 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-800">
                {shown.map((k) => (
                  <tr key={k.id} className="align-top">
                    <td className="py-2 pr-3 font-medium">{k.keyword}</td>
                    <td className="py-2 pr-3 text-neutral-600">{k.target ? label.get(k.target) ?? k.target : <span className="text-neutral-400">none</span>}</td>
                    <td className="py-2 pr-3">{k.intent && <span className={`rounded px-1.5 py-0.5 text-[11px] ${INTENT_CLS[k.intent] ?? ""}`}>{k.intent}</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums" title={k.why.join("\n")}>{k.ignored ? "–" : k.priority}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-neutral-600">
                      {k.gsc && k.gsc.impressions > 0 ? <>{k.gsc.impressions.toLocaleString("en-PK")} impr. · {k.gsc.clicks} clicks{k.gsc.position !== null ? ` · pos ${k.gsc.position.toFixed(1)}` : ""}</> : <span className="text-neutral-400">no data</span>}
                    </td>
                    <td className="py-2 pr-3 text-neutral-500">{k.volume !== null ? `${k.volume.toLocaleString("en-PK")} (${k.volumeSource ?? "source"})` : "Unknown"}</td>
                    <td className="py-2 pr-3">
                      <span className="flex flex-wrap gap-1">{k.sources.map((s) => <span key={s} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">{SOURCE_LABEL[s] ?? s}</span>)}</span>
                    </td>
                    <td className="py-2 text-right">
                      <button type="button" disabled={busy} className="text-[11px] font-medium text-neutral-500 underline hover:text-neutral-800"
                        onClick={() => void act(() => seoCall("ignoreKeyword", { id: k.id, ignored: !k.ignored }), k.ignored ? "Keyword restored; the next run scores it again." : "Keyword ignored. Research will not bring it back.")}>
                        {k.ignored ? "Restore" : "Ignore"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-neutral-500">Priority (0 to 100) adds up: focus product (Pharmacy, Retail, FBR), buying intent, Pakistan or a city in the phrase, Google suggesting it, and impressions the site already gets. Hover a priority to see its parts.</p>
      </div>
    </div>
  );
}
