"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { serverJson } from "@/lib/serverMode";
import { ListState, Notice, errText } from "@/components/subsupers/shared";
import { LineChart, TopTable } from "./SearchPerformance";

/** SEO > Reports: one report per month, built on the 1st from recorded numbers
 * (or now, for any month). Prints as a clean page (Save as PDF). */

interface Totals { days: number; clicks: number; impressions: number; ctr: number | null; position: number | null }
interface Top { key: string; clicks: number; impressions: number; position: number | null }
interface Deployment { id: string; state: string; createdAt: string; commit: string | null; message: string | null }
interface Report {
  period: string; from: string; to: string; partial: boolean; generatedAt: string; sitePublished: boolean; highlights: string[];
  search: { current: Totals; previous: Totals | null; daily: { day: string; clicks: number; impressions: number }[]; topQueries: Top[]; topPages: Top[] } | null;
  analytics: { organic: number; previousOrganic: number | null; organicKeyEvents: number; channels: { channel: string; sessions: number; keyEvents: number }[] } | null;
  indexing: { checked?: number; indexed?: number; notIndexed?: number; reason?: string } | null;
  technical: { open: { critical: number; warning: number; info: number }; newInMonth: number; fixedInMonth: number; vitals: string[] };
  keywords: { active: number; addedInMonth: number; withSearchData: number; top: { keyword: string; priority: number; impressions: number | null; position: number | null }[] };
  recommendations: { createdInMonth: number; approved: number; rejected: number; done: number; waiting: number };
  content: { drafted: number; approved: number; published: number; openPullRequests: number };
  automation: { jobs: { job: string; succeeded: number; failed: number; skipped: number; blocked: number }[]; failures: { job: string; at: string; error: string }[] };
  deployments: { connected: false } | { connected: true; error: string } | { connected: true; total: number; ready: number; failed: number; latest: Deployment | null };
}

const seoCall = async <T,>(action: string, body: Record<string, unknown> = {}) => (await serverJson<{ result: T }>("/api/seo/admin/", { action, ...body })).result;
const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] break-inside-avoid";
const int = (n: number) => Math.round(n).toLocaleString("en-PK");
const monthName = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The last 18 months, newest first, for the "build a report" picker. */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 18 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function ReportsTab() {
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [pick, setPick] = useState(recentMonths()[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    seoCall<{ period: string }[]>("list", { table: "reports" }).then((rows) => {
      const ps = rows.map((r) => String(r.period));
      setPeriods(ps);
      setOpen((cur) => cur ?? ps[0] ?? null);
    }).catch((e) => setError(errText(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!open) { setReport(null); return; }
    seoCall<Report>("report", { period: open }).then(setReport).catch((e) => setError(errText(e)));
  }, [open]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await seoCall<Report>("generateReport", { period: pick });
      setReport(r);
      setOpen(pick);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!periods) return <ListState loading={!error} error={error} empty={false} emptyText="" onRetry={load} />;
  return (
    <div className="space-y-3">
      <style>{`@media print { body * { visibility: hidden !important; } #seo-report, #seo-report * { visibility: visible !important; } #seo-report { position: absolute; inset: 0 auto auto 0; width: 100%; } }`}</style>
      <p className="text-sm text-neutral-600">A report is built on the 1st of each month for the month before. Build one now for any month; the current month is marked as partial.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        {periods.length > 0 && (
          <label htmlFor="rep-open" className="flex flex-col gap-1 text-xs text-neutral-600">Report
            <Select id="rep-open" value={open ?? ""} onChange={(e) => setOpen(e.target.value)}>
              {periods.map((p) => <option key={p} value={p}>{monthName(p)}</option>)}
            </Select>
          </label>
        )}
        <label htmlFor="rep-pick" className="flex flex-col gap-1 text-xs text-neutral-600">Build for
          <Select id="rep-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
            {recentMonths().map((p) => <option key={p} value={p}>{monthName(p)}</option>)}
          </Select>
        </label>
        <Button disabled={busy} onClick={() => void generate()}>{busy ? "Building…" : periods.includes(pick) ? "Rebuild report" : "Build report"}</Button>
        {report && <Button className="ml-auto" onClick={() => window.print()}>Print or save as PDF</Button>}
      </div>
      {!report ? (
        <div className={`${card} py-6 text-center text-sm text-neutral-400`}>{periods.length ? "Loading…" : "No reports yet. Build one above, or wait for the 1st of the month."}</div>
      ) : <ReportView r={report} />}
    </div>
  );
}

function Delta({ now, before, lowerIsBetter = false }: { now: number | null; before: number | null | undefined; lowerIsBetter?: boolean }) {
  if (now === null || before === null || before === undefined || before === 0) return <span className="text-xs text-neutral-400">no earlier month</span>;
  const d = (now - before) / before;
  if (Math.abs(d) < 0.005) return <span className="text-xs text-neutral-500">no change</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return <span className={`text-xs font-medium ${good ? "text-emerald-700" : "text-rose-700"}`}><span aria-hidden>{d > 0 ? "▲" : "▼"}</span> {Math.abs(Math.round(d * 100))}% <span className="font-normal text-neutral-500">vs month before</span></span>;
}

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className={card}>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{value}</p>
      <div className="mt-1 min-h-4">{children}</div>
    </div>
  );
}

function Facts({ title, rows }: { title: string; rows: [string, string | number][] }) {
  return (
    <div className={card}>
      <p className="mb-2 text-sm font-semibold text-neutral-800">{title}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-neutral-600">{k}</dt><dd className="text-right tabular-nums text-neutral-900">{typeof v === "number" ? int(v) : v}</dd></div>)}
      </dl>
    </div>
  );
}

function ReportView({ r }: { r: Report }) {
  const s = r.search;
  const totalFailed = r.automation.jobs.reduce((n, j) => n + j.failed, 0);
  const totalRuns = r.automation.jobs.reduce((n, j) => n + j.succeeded + j.failed + j.skipped + j.blocked, 0);
  return (
    <div id="seo-report" className="space-y-3">
      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-neutral-900">SEO report · {monthName(r.period)}</h2>
          <p className="text-xs text-neutral-500">
            {r.partial ? <b className="text-amber-700">Partial month · </b> : null}built {shortDate(r.generatedAt)} · www.mavin.pk
          </p>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-800">{r.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
      </div>

      {s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Clicks from Google" value={int(s.current.clicks)}><Delta now={s.current.clicks} before={s.previous?.clicks} /></Tile>
            <Tile label="Impressions" value={int(s.current.impressions)}><Delta now={s.current.impressions} before={s.previous?.impressions} /></Tile>
            <Tile label="Click-through rate" value={s.current.ctr === null ? "–" : `${(s.current.ctr * 100).toFixed(1)}%`}><Delta now={s.current.ctr} before={s.previous?.ctr} /></Tile>
            <Tile label="Average position" value={s.current.position === null ? "–" : s.current.position.toFixed(1)}><Delta now={s.current.position} before={s.previous?.position} lowerIsBetter /></Tile>
          </div>
          {s.daily.length > 1 && <LineChart title="Clicks per day" unit="clicks" points={s.daily.map((d) => ({ day: d.day, value: d.clicks }))} />}
          <div className="grid gap-3 lg:grid-cols-2">
            <TopTable title="Top searches" label="Query" period={monthName(r.period)} rows={s.topQueries.map((q) => ({ ...q, ctr: q.impressions ? q.clicks / q.impressions : null }))} />
            <TopTable title="Top pages" label="Page" period={monthName(r.period)} rows={s.topPages.map((q) => ({ ...q, ctr: q.impressions ? q.clicks / q.impressions : null }))} />
          </div>
        </>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {r.analytics && (
          <Facts title="Visits (Google Analytics)" rows={[
            ["From Google search", r.analytics.organic],
            ["Month before", r.analytics.previousOrganic ?? "–"],
            ["Key events from search", r.analytics.organicKeyEvents],
            ...r.analytics.channels.slice(0, 4).map((c): [string, number] => [`All ${c.channel}`, c.sessions]),
          ]} />
        )}
        <Facts title="Technical health (now)" rows={[
          ["Critical problems", r.technical.open.critical], ["Warnings", r.technical.open.warning], ["Notes", r.technical.open.info],
          ["Found this month", r.technical.newInMonth], ["Fixed this month", r.technical.fixedInMonth],
          ...(r.indexing?.checked ? [["Pages in Google's index", `${r.indexing.indexed ?? 0} of ${r.indexing.checked}`] as [string, string]] : []),
        ]} />
        <Facts title="Keywords" rows={[["Tracked", r.keywords.active], ["Added this month", r.keywords.addedInMonth], ["With search data", r.keywords.withSearchData]]} />
        <Facts title="Recommendations" rows={[
          ["Proposed this month", r.recommendations.createdInMonth], ["Approved", r.recommendations.approved], ["Rejected", r.recommendations.rejected],
          ["Marked done", r.recommendations.done], ["Waiting for a decision (now)", r.recommendations.waiting],
        ]} />
        <Facts title="Content" rows={[["Drafts written", r.content.drafted], ["Approved", r.content.approved], ["Published", r.content.published], ["Pull requests open (now)", r.content.openPullRequests]]} />
        <Facts title="Website deployments" rows={
          !r.deployments.connected ? [["Vercel", "not connected"]]
            : "error" in r.deployments ? [["Vercel", "could not be read"]]
              : [["Production deployments", r.deployments.total], ["Succeeded", r.deployments.ready], ["Failed", r.deployments.failed],
                ["Latest", r.deployments.latest ? `${r.deployments.latest.state.toLowerCase()} · ${shortDate(r.deployments.latest.createdAt)}` : "–"]]
        } />
      </div>

      {r.technical.vitals.length > 0 && (
        <div className={card}>
          <p className="mb-2 text-sm font-semibold text-neutral-800">Mobile speed problems (Core Web Vitals)</p>
          <ul className="space-y-1 text-xs text-neutral-700">{r.technical.vitals.map((v) => <li key={v}>{v}</li>)}</ul>
        </div>
      )}

      {r.keywords.top.length > 0 && (
        <div className={card}>
          <p className="mb-2 text-sm font-semibold text-neutral-800">Top keywords by priority</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-neutral-500"><tr><th className="py-1 pr-2 font-medium">Keyword</th><th className="py-1 pr-2 text-right font-medium">Priority</th><th className="py-1 pr-2 text-right font-medium">Impressions</th><th className="py-1 text-right font-medium">Position</th></tr></thead>
              <tbody className="divide-y divide-neutral-100 tabular-nums text-neutral-800">
                {r.keywords.top.map((k) => (
                  <tr key={k.keyword}><td className="py-1.5 pr-2">{k.keyword}</td><td className="py-1.5 pr-2 text-right">{k.priority}</td><td className="py-1.5 pr-2 text-right">{k.impressions === null ? "–" : int(k.impressions)}</td><td className="py-1.5 text-right">{k.position === null ? "–" : k.position.toFixed(1)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={card}>
        <p className="mb-2 text-sm font-semibold text-neutral-800">Automation <span className="text-xs font-normal text-neutral-500">· {totalRuns} runs, {totalFailed} failed</span></p>
        {r.automation.jobs.length === 0 ? <p className="text-sm text-neutral-500">No job ran this month.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-neutral-500"><tr><th className="py-1 pr-2 font-medium">Job</th><th className="py-1 pr-2 text-right font-medium">Succeeded</th><th className="py-1 pr-2 text-right font-medium">Failed</th><th className="py-1 pr-2 text-right font-medium">Skipped</th><th className="py-1 text-right font-medium">Stopped</th></tr></thead>
              <tbody className="divide-y divide-neutral-100 tabular-nums text-neutral-800">
                {r.automation.jobs.map((j) => (
                  <tr key={j.job}><td className="py-1.5 pr-2">{j.job.replace(/_/g, " ")}</td><td className="py-1.5 pr-2 text-right">{j.succeeded}</td><td className={`py-1.5 pr-2 text-right ${j.failed ? "font-semibold text-rose-700" : ""}`}>{j.failed}</td><td className="py-1.5 pr-2 text-right">{j.skipped}</td><td className="py-1.5 text-right">{j.blocked}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r.automation.failures.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-rose-700">{r.automation.failures.slice(0, 5).map((f) => <li key={`${f.job}${f.at}`}>{f.job.replace(/_/g, " ")} · {shortDate(f.at)}: {f.error}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
