"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { serverJson } from "@/lib/serverMode";
import { subSupersAvailable, when } from "@/lib/subSupersClient";
import { ListState, Notice, errText } from "@/components/subsupers/shared";
import { GoogleSetupGuide, SearchPerformance, type SearchDashboard } from "@/components/seo/SearchPerformance";

/** Super Admin > SEO: the Mavin SEO Manager. Scheduler, kill switch and logs
 * (phase 1), technical audit (2), Google search data (3); later phases fill
 * the remaining tabs. */
const TABS = [
  ["overview", "SEO Overview"], ["keywords", "Keywords"], ["audit", "Technical Audit"], ["content", "Content Studio"],
  ["schedule", "Automation Schedule"], ["recommendations", "Recommendations"], ["reports", "Reports"], ["activity", "Activity Logs"], ["settings", "Settings"],
] as const;
type Tab = (typeof TABS)[number][0];

const seoCall = async <T,>(action: string, body: Record<string, unknown> = {}) => (await serverJson<{ result: T }>("/api/seo/admin/", { action, ...body })).result;

interface Integration { id: string; name: string; purpose: string; needs: string[]; configured: boolean; phase: number; access: string }
interface Overview {
  killSwitch: boolean; sitePublished: boolean; integrations: Integration[]; lastRun: Record<string, unknown> | null; failedRuns7d: number;
  openFindings: number; openRecommendations: number; drafts: number; keywords: number; metricsDays: number;
}
interface Job { id: string; label: string; description: string; phase: number; available: boolean; enabled: boolean; cadence: string; lastRunAt: string | null; lastSuccessAt: string | null; lastStatus: string | null; running: boolean; due: boolean }

const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const STATUS_CLS: Record<string, string> = {
  succeeded: "bg-emerald-100 text-emerald-800", failed: "bg-rose-100 text-rose-700", blocked: "bg-amber-100 text-amber-800",
  skipped: "bg-neutral-100 text-neutral-600", running: "bg-sky-100 text-sky-800",
};
const Pill = ({ s }: { s: string | null }) => s ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[s] ?? "bg-neutral-100 text-neutral-600"}`}>{s}</span> : <span className="text-xs text-neutral-400">never run</span>;

export default function SeoManagerPage() {
  const [tab, setTab] = useState<Tab>("overview");
  if (!subSupersAvailable()) {
    return <div className="space-y-4"><PageHeader title="SEO Manager" /><Notice kind="warn">The SEO Manager works through the server: use the web version.</Notice></div>;
  }
  return (
    <div className="space-y-4">
      <PageHeader title="SEO Manager" />
      <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 text-xs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 font-medium ${tab === id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>{label}</button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab onOpen={setTab} />}
      {tab === "schedule" && <ScheduleTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "keywords" && <LaterTab table="keywords" phase={4} text="Pakistan-focused keyword candidates for Pharmacy POS, Retail POS and FBR Digital Invoicing, with search intent and the source of every number. Volume shows as unknown unless a real source provides it." />}
      {tab === "audit" && <AuditTab onOpen={setTab} />}
      {tab === "content" && <LaterTab table="drafts" phase={5} text="Draft landing pages, articles and metadata improvements, checked against the product registry for unsupported claims and duplicates. Approving one opens a GitHub pull request; nothing is published automatically." />}
      {tab === "recommendations" && <RecommendationsTab />}
      {tab === "reports" && <LaterTab table="reports" phase={6} text="Monthly report: search performance, technical health and progress on recommendations." />}
    </div>
  );
}

function OverviewTab({ onOpen }: { onOpen: (t: Tab) => void }) {
  const [o, setO] = useState<Overview | null>(null);
  const [d, setD] = useState<SearchDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    Promise.all([seoCall<Overview>("overview"), seoCall<SearchDashboard>("dashboard")]).then(([ov, dash]) => { setO(ov); setD(dash); }).catch((e) => setError(errText(e)));
  }, []);
  useEffect(load, [load]);
  if (error || !o) return <ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} />;
  const configured = o.integrations.filter((i) => i.configured).length;
  const tiles: [string, string, Tab][] = [
    ["Days of search data", o.metricsDays ? `${o.metricsDays} days` : "None yet", "schedule"],
    ["Open audit findings", String(o.openFindings), "audit"],
    ["Recommendations to review", String(o.openRecommendations), "recommendations"],
    ["Drafts to review", String(o.drafts), "content"],
    ["Tracked keywords", String(o.keywords), "keywords"],
    ["Failed runs (7 days)", String(o.failedRuns7d), "activity"],
  ];
  return (
    <div className="space-y-4">
      {o.killSwitch && <Notice kind="error">The kill switch is on: all automated SEO jobs are stopped. Turn it off in Settings.</Notice>}
      {!o.sitePublished && (
        <Notice kind="warn">
          The public site is closed to search engines (draft mode), so Google has no data to report yet. Clicks, impressions and rankings appear after you approve the
          site content and open it (NEXT_PUBLIC_SITE_PUBLISHED=1).
        </Notice>
      )}
      {d && <SearchPerformance d={d} onSetup={() => onOpen("settings")} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([label, value, to]) => (
          <button key={label} type="button" onClick={() => onOpen(to)} className={`${card} text-left transition hover:ring-[var(--accent)]`}>
            <p className="text-xs text-neutral-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{value}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold text-neutral-800">Last automated run</p>
          {o.lastRun ? (
            <p className="mt-2 text-sm text-neutral-700">{String(o.lastRun.job_id).replace(/_/g, " ")} · <Pill s={String(o.lastRun.status)} /> · {when(o.lastRun.started_at)}
              {o.lastRun.error ? <span className="mt-1 block text-xs text-rose-700">{String(o.lastRun.error)}</span> : null}</p>
          ) : <p className="mt-2 text-sm text-neutral-500">No run yet. Start the health check from Automation Schedule.</p>}
        </div>
        <button type="button" onClick={() => onOpen("settings")} className={`${card} text-left transition hover:ring-[var(--accent)]`}>
          <p className="text-sm font-semibold text-neutral-800">Integrations</p>
          <p className="mt-2 text-sm text-neutral-700">{configured} of {o.integrations.length} set up</p>
          <p className="mt-1 text-xs text-neutral-500">{o.integrations.filter((i) => !i.configured).map((i) => i.name).join(", ") || "All set up."}</p>
        </button>
      </div>
    </div>
  );
}

function ScheduleTab() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    Promise.all([seoCall<Job[]>("jobs"), seoCall<Record<string, unknown>[]>("runs", { limit: 30 })])
      .then(([j, r]) => { setJobs(j); setRuns(r); }).catch((e) => setError(errText(e)));
  }, []);
  useEffect(load, [load]);

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    setMsg(null);
    try {
      const r = await fn();
      const status = (r as { status?: string } | undefined)?.status;
      setMsg({ ok: !status || status === "succeeded", text: status ? `${ok}: ${status}` : ok });
      load();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  if (error || !jobs) return <ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">The scheduler runs once a day (06:00 Pakistan time) and starts every enabled job that is due. Jobs only read, audit and draft; they never change the site or business data.</p>
      {msg && <Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] uppercase tracking-widest text-neutral-400">
            <tr>{["Job", "How often", "On", "Last run", ""].map((h) => <th key={h} className="px-4 py-2.5">{h}</th>)}</tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-neutral-100 align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-neutral-800">{j.label}</p>
                  <p className="mt-0.5 max-w-md text-xs text-neutral-500">{j.description}</p>
                  {!j.available && <span className="mt-1 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">Arrives in phase {j.phase}</span>}
                </td>
                <td className="px-4 py-3">
                  <label htmlFor={`cad-${j.id}`} className="sr-only">How often</label>
                  <Select id={`cad-${j.id}`} value={j.cadence} disabled={!j.available || busy === j.id} onChange={(e) => void act(j.id, () => seoCall("updateJob", { id: j.id, cadence: e.target.value }), "Saved")}>
                    <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <input type="checkbox" aria-label={`${j.label} enabled`} checked={j.enabled} disabled={!j.available || busy === j.id}
                    onChange={(e) => void act(j.id, () => seoCall("updateJob", { id: j.id, enabled: e.target.checked }), e.target.checked ? "Enabled" : "Disabled")} />
                </td>
                <td className="px-4 py-3 text-xs text-neutral-600">
                  <Pill s={j.running ? "running" : j.lastStatus} />
                  {j.lastRunAt && <p className="mt-1">{when(j.lastRunAt)}</p>}
                  {j.due && <p className="mt-1 text-sky-700">Due on the next scheduled run</p>}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button disabled={!j.available || busy !== null} onClick={() => void act(j.id, () => seoCall("runNow", { id: j.id }), `${j.label}`)}>
                    {busy === j.id ? "Running…" : "Run now"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={card}>
        <p className="mb-2 text-sm font-semibold text-neutral-800">Recent runs</p>
        {!runs.length ? <p className="text-sm text-neutral-400">No runs yet.</p> : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {runs.map((r) => (
              <li key={String(r.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{String(r.job_id).replace(/_/g, " ")} · <span className="text-neutral-500">{String(r.trigger)}{r.attempts ? `, ${r.attempts} attempt${Number(r.attempts) === 1 ? "" : "s"}` : ""}</span></span>
                <span className="flex items-center gap-2 text-xs text-neutral-500"><Pill s={String(r.status)} />{when(r.started_at)}</span>
                {r.error ? <p className="w-full text-xs text-rose-700">{String(r.error)}</p> : r.summary && r.status !== "succeeded" ? <p className="w-full text-xs text-neutral-500">{String(r.summary)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActivityTab() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await seoCall<Record<string, unknown>[]>("activity", { level, q, before, limit: 50 });
      setRows((r) => (before ? [...r, ...page] : page));
      setMore(page.length === 50);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [level, q]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label htmlFor="act-level" className="sr-only">Level</label>
        <Select id="act-level" value={level} onChange={(e) => setLevel(e.target.value)} className="w-40">
          <option value="">All levels</option><option value="info">Info</option><option value="warn">Warnings</option><option value="error">Errors</option>
        </Select>
        <label htmlFor="act-q" className="sr-only">Search the log</label>
        <Input id="act-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions and details" className="max-w-xs" />
      </div>
      <div className={card}>
        {!rows.length ? <ListState loading={loading} error={error} empty emptyText="Nothing logged yet." onRetry={() => void load()} /> : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {rows.map((r) => (
              <li key={String(r.id)} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-neutral-800">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] uppercase ${r.level === "error" ? "bg-rose-100 text-rose-700" : r.level === "warn" ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"}`}>{String(r.level)}</span>
                    {String(r.action).replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-neutral-500">{String(r.actor)} · {when(r.created_at)}</span>
                </div>
                {r.detail ? <p className="mt-1 break-words font-mono text-[11px] text-neutral-500">{String(r.detail)}</p> : null}
              </li>
            ))}
          </ul>
        )}
        {more && <div className="mt-2 text-center"><Button disabled={loading} onClick={() => void load(String(rows.at(-1)?.created_at ?? ""))}>{loading ? "Loading…" : "Older entries"}</Button></div>}
      </div>
    </div>
  );
}

function SettingsTab() {
  const [s, setS] = useState<{ killSwitch: boolean; killReason: string | null; integrations: Integration[]; sitePublished: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); seoCall<NonNullable<typeof s>>("settings").then(setS).catch((e) => setError(errText(e))); }, []);
  useEffect(load, [load]);
  async function toggle(on: boolean) {
    setMsg(null);
    setError(null);
    try {
      await seoCall("killSwitch", { on, reason });
      setReason("");
      setMsg(on ? "All automated SEO jobs are stopped." : "Automated SEO jobs can run again.");
      load();
    } catch (e) {
      setError(errText(e));
    }
  }
  if (!s) return <ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} />;
  return (
    <div className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="ok">{msg}</Notice>}
      <div className={card}>
        <p className="text-sm font-semibold text-neutral-800">Kill switch</p>
        <p className="mt-1 text-sm text-neutral-600">
          {s.killSwitch ? <>All automated jobs are <b className="text-rose-700">stopped</b>{s.killReason ? `: ${s.killReason}` : ""}.</> : "Jobs run on their schedule. Stopping blocks every scheduled and manual run, and stops retries."}
        </p>
        {s.killSwitch ? (
          <Button className="mt-3" onClick={() => void toggle(false)}>Resume automated jobs</Button>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label htmlFor="kill-reason" className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-neutral-600">Reason
              <Input id="kill-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. checking a wrong recommendation" />
            </label>
            <Button variant="danger" onClick={() => void toggle(true)}>Stop all jobs</Button>
          </div>
        )}
      </div>
      <div className={card}>
        <p className="text-sm font-semibold text-neutral-800">Search engines</p>
        <p className="mt-1 text-sm text-neutral-600">
          Public site: {s.sitePublished ? <b className="text-emerald-700">open to search engines</b> : <b className="text-amber-700">closed (draft)</b>}. App, Super Admin and Sub Super pages are always kept out of search.
        </p>
      </div>
      <GoogleSetupGuide />
      <div className={card}>
        <p className="mb-2 text-sm font-semibold text-neutral-800">Integrations</p>
        <p className="mb-3 text-xs text-neutral-500">Secrets are set in Vercel → Settings → Environment Variables, never here. Only whether each one is set is shown.</p>
        <ul className="divide-y divide-neutral-100 text-sm">
          {s.integrations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 max-w-xl">
                <p className="font-medium text-neutral-800">{i.name} <span className="text-xs font-normal text-neutral-400">· phase {i.phase}</span></p>
                <p className="text-xs text-neutral-500">{i.purpose}</p>
                <p className="mt-1 text-[11px] text-neutral-500">Needs: <code>{i.needs.join(", ")}</code>. Access: {i.access}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${i.configured ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"}`}>
                {i.configured ? "Set up" : "Not set up"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LaterTab({ table, phase, text }: { table: string; phase: number; text: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { seoCall<Record<string, unknown>[]>("list", { table }).then(setRows).catch((e) => setError(errText(e))); }, [table]);
  return (
    <div className={card}>
      <p className="text-sm text-neutral-700">{text}</p>
      <p className="mt-2 text-xs text-neutral-500">Built in phase {phase}.</p>
      {error && <div className="mt-3"><Notice kind="error">{error}</Notice></div>}
      {rows && rows.length > 0 && <p className="mt-3 text-sm text-neutral-600">{rows.length} item{rows.length === 1 ? "" : "s"} recorded.</p>}
    </div>
  );
}

const SEV_CLS: Record<string, string> = { critical: "bg-rose-100 text-rose-700", warning: "bg-amber-100 text-amber-800", info: "bg-neutral-100 text-neutral-600" };
const shortUrl = (u: unknown) => String(u ?? "").replace(/^https?:\/\/[^/]+/, "") || "/";

function Evidence({ raw }: { raw: unknown }) {
  if (!raw) return null;
  let text = String(raw);
  try {
    text = JSON.stringify(JSON.parse(text), null, 1);
  } catch {
    // plain text
  }
  return (
    <details className="mt-1 text-[11px] text-neutral-500">
      <summary className="cursor-pointer">Evidence</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-2">{text}</pre>
    </details>
  );
}

function AuditTab({ onOpen }: { onOpen: (t: Tab) => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [show, setShow] = useState<"open" | "resolved">("open");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); seoCall<Record<string, unknown>[]>("list", { table: "findings" }).then(setRows).catch((e) => setError(errText(e))); }, []);
  useEffect(load, [load]);
  if (!rows) return <ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} />;
  const open = rows.filter((r) => !r.resolved_at);
  const shown = show === "open" ? open : rows.filter((r) => r.resolved_at);
  const n = (sev: string) => open.filter((r) => r.severity === sev).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        The audit checks every public page daily (run it now from Automation Schedule). Each problem becomes a proposed fix in{" "}
        <button type="button" className="font-medium text-[var(--accent)] underline" onClick={() => onOpen("recommendations")}>Recommendations</button>.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-medium ${SEV_CLS.critical}`}>{n("critical")} critical</span>
        <span className={`rounded-full px-2.5 py-1 font-medium ${SEV_CLS.warning}`}>{n("warning")} warnings</span>
        <span className={`rounded-full px-2.5 py-1 font-medium ${SEV_CLS.info}`}>{n("info")} notes</span>
        <span className="ml-auto flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
          {(["open", "resolved"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className={`rounded-md px-2.5 py-1 font-medium ${show === v ? "bg-white shadow-sm" : "text-neutral-500"}`}>
              {v === "open" ? "Open" : "Fixed"}
            </button>
          ))}
        </span>
      </div>
      <div className={card}>
        {!shown.length ? (
          <p className="py-6 text-center text-sm text-neutral-400">
            {rows.length ? (show === "open" ? "No open findings." : "Nothing fixed yet.") : "No audit has run yet. Start one from Automation Schedule."}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {shown.map((r) => (
              <li key={String(r.id)} className="py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-neutral-800">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] uppercase ${SEV_CLS[String(r.severity)]}`}>{String(r.severity)}</span>
                    {String(r.message)}
                  </p>
                  <span className="shrink-0 font-mono text-xs text-neutral-500">{shortUrl(r.url)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-neutral-400">
                  First seen {when(r.first_seen_at)} · last seen {when(r.last_seen_at)}{r.resolved_at ? ` · fixed ${when(r.resolved_at)}` : ""}
                </p>
                <Evidence raw={r.evidence} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const IMPACT_CLS: Record<string, string> = { high: "text-rose-700", medium: "text-amber-700", low: "text-neutral-500" };

function RecommendationsTab() {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [show, setShow] = useState<"proposed" | "approved" | "closed">("proposed");
  const load = useCallback(() => { setError(null); seoCall<Record<string, unknown>[]>("list", { table: "recommendations" }).then(setRows).catch((e) => setError(errText(e))); }, []);
  useEffect(load, [load]);
  async function decide(id: string, status: string) {
    setMsg(null);
    try {
      await seoCall("decide", { id, status, note: notes[id] ?? "" });
      setMsg({
        ok: true,
        text: status === "approved" ? "Approved. Make the change by hand for now; from phase 5 an approved fix becomes a GitHub pull request."
          : status === "rejected" ? "Rejected." : status === "done" ? "Marked done." : "Reopened.",
      });
      load();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  }
  if (!rows) return <ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} />;
  const inView = (r: Record<string, unknown>, v: typeof show) => (v === "closed" ? r.status === "rejected" || r.status === "done" : r.status === v);
  const shown = rows.filter((r) => inView(r, show));
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">Proposed fixes from the audits, each with its evidence. Nothing changes on the site until you approve, and redirects, indexing and robots changes always need you.</p>
      {msg && <Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
      <div className="flex w-fit gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
        {(["proposed", "approved", "closed"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className={`rounded-md px-2.5 py-1 font-medium ${show === v ? "bg-white shadow-sm" : "text-neutral-500"}`}>
            {v === "proposed" ? "To review" : v === "approved" ? "Approved" : "Done / rejected"} ({rows.filter((r) => inView(r, v)).length})
          </button>
        ))}
      </div>
      <div className={card}>
        {!shown.length ? (
          <p className="py-6 text-center text-sm text-neutral-400">{rows.length ? "Nothing here." : "No recommendations yet. They appear after an audit finds something to fix."}</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {shown.map((r) => {
              const id = String(r.id);
              return (
                <li key={id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-800">
                        {String(r.title)} <span className={`ml-1 text-xs font-normal ${IMPACT_CLS[String(r.impact)] ?? ""}`}>{String(r.impact ?? "")} impact</span>
                      </p>
                      <p className="text-xs text-neutral-600">{String(r.detail ?? "")}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-neutral-500">{shortUrl(r.url)}</p>
                    </div>
                    <span className="text-[11px] text-neutral-400">{when(r.created_at)}</span>
                  </div>
                  <Evidence raw={r.evidence} />
                  {r.decided_at ? <p className="mt-1 text-[11px] text-neutral-500">{String(r.status)} {when(r.decided_at)}{r.decision_note ? `: ${String(r.decision_note)}` : ""}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {r.status === "proposed" && (
                      <>
                        <label htmlFor={`note-${id}`} className="sr-only">Note</label>
                        <Input id={`note-${id}`} value={notes[id] ?? ""} onChange={(e) => setNotes({ ...notes, [id]: e.target.value })} placeholder="Note (needed to reject)" className="max-w-xs" />
                        <Button variant="primary" onClick={() => void decide(id, "approved")}>Approve</Button>
                        <Button onClick={() => void decide(id, "rejected")}>Reject</Button>
                      </>
                    )}
                    {r.status === "approved" && <Button onClick={() => void decide(id, "done")}>Mark done</Button>}
                    {(r.status === "rejected" || r.status === "done") && <Button onClick={() => void decide(id, "proposed")}>Reopen</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
