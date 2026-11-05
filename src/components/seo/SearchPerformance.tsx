"use client";

import { useEffect, useRef, useState } from "react";

/** SEO Overview: search performance from imported Google data only. Each
 * measure has its own chart (no shared axis); empty states say why. */

interface Totals { from: string; to: string; days: number; clicks: number; impressions: number; ctr: number | null; position: number | null }
interface TopRow { key: string; clicks: number; impressions: number; ctr: number | null; position: number | null }
export interface SearchDashboard {
  sitePublished: boolean;
  gscConnected: boolean;
  ga4Connected: boolean;
  search: { latest: string; current: Totals; previous: Totals; series: { day: string; clicks: number; impressions: number }[]; topQueries: TopRow[]; topPages: TopRow[] } | null;
  analytics: {
    latest: string; organicSessions: number; previousOrganicSessions: number;
    channels: { channel: string; sessions: number; engaged: number; keyEvents: number }[];
    series: { day: string; sessions: number }[];
  } | null;
  indexing: { checked?: number; indexed?: number; notIndexed?: number; failed?: number; at?: string; reason?: string } | null;
}

const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const int = (n: number) => Math.round(n).toLocaleString("en-PK");
const pct = (n: number | null) => (n === null ? "–" : `${(n * 100).toFixed(1)}%`);
const pos = (n: number | null) => (n === null ? "–" : n.toFixed(1));
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Change against the previous period; `lowerIsBetter` for average position. */
function Delta({ now, before, lowerIsBetter = false, asPoints = false }: { now: number | null; before: number | null; lowerIsBetter?: boolean; asPoints?: boolean }) {
  if (now === null || before === null || (!asPoints && before === 0)) return <span className="text-xs text-neutral-400">no earlier data</span>;
  const diff = asPoints ? now - before : (now - before) / before;
  if (Math.abs(diff) < 0.0005) return <span className="text-xs text-neutral-500">no change</span>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  const text = asPoints ? `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)}` : `${diff > 0 ? "+" : "−"}${Math.abs(diff * 100).toFixed(0)}%`;
  return (
    <span className={`text-xs font-medium ${better ? "text-emerald-700" : "text-rose-700"}`}>
      <span aria-hidden>{diff > 0 ? "▲" : "▼"}</span> {text} <span className="font-normal text-neutral-500">vs previous 28 days</span>
    </span>
  );
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

/** Nice round top for the y axis. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** One measure over time: 2px line, faint grid, crosshair and tooltip on hover. */
function LineChart({ title, points, unit }: { title: string; points: { day: string; value: number }[]; unit: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 170;
  const pad = { l: 40, r: 12, t: 10, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const x = (i: number) => pad.l + (points.length < 2 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const labelIdx = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);
  const h = hover === null ? null : points[hover];
  const total = points.reduce((n, p) => n + p.value, 0);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * iw;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(points.length < 2 ? 0 : (rel / iw) * (points.length - 1)))));
  }

  return (
    <div className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-800">{title}</p>
        <p className="text-xs tabular-nums text-neutral-500">{int(total)} {unit} in {points.length} days</p>
      </div>
      <div ref={box} className="relative mt-2">
        <svg width={w} height={H} role="img" aria-label={`${title}: ${int(total)} ${unit} from ${shortDay(points[0].day)} to ${shortDay(points[points.length - 1].day)}`} className="block max-w-full">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-neutral-200" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-neutral-500 text-[10px] tabular-nums">{int(t)}</text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-neutral-500 text-[10px]">{shortDay(points[i].day)}</text>
          ))}
          <path d={path} fill="none" stroke="var(--accent, #0f766e)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="currentColor" className="text-neutral-300" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(h.value)} r={4} fill="var(--accent, #0f766e)" stroke="white" strokeWidth={2} />
            </g>
          )}
          <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-neutral-900 px-2 py-1 text-[11px] text-white shadow"
            style={{ left: Math.min(Math.max(x(hover), 60), w - 60) }}>
            <span className="text-neutral-300">{shortDay(h.day)}</span> · <b className="tabular-nums">{int(h.value)}</b> {unit}
          </div>
        )}
      </div>
    </div>
  );
}

function TopTable({ title, rows, label }: { title: string; rows: TopRow[]; label: string }) {
  return (
    <div className={card}>
      <p className="mb-2 text-sm font-semibold text-neutral-800">{title} <span className="text-xs font-normal text-neutral-500">· last 28 days</span></p>
      {rows.length === 0 ? <p className="text-sm text-neutral-500">No rows in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-neutral-500">
              <tr><th className="py-1 pr-2 font-medium">{label}</th><th className="py-1 pr-2 text-right font-medium">Clicks</th><th className="py-1 pr-2 text-right font-medium">Impr.</th><th className="py-1 pr-2 text-right font-medium">CTR</th><th className="py-1 text-right font-medium">Pos.</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 tabular-nums text-neutral-800">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="max-w-[16rem] truncate py-1.5 pr-2" title={r.key}>{label === "Page" ? r.key.replace(/^https?:\/\/[^/]+/, "") || "/" : r.key}</td>
                  <td className="py-1.5 pr-2 text-right">{int(r.clicks)}</td>
                  <td className="py-1.5 pr-2 text-right">{int(r.impressions)}</td>
                  <td className="py-1.5 pr-2 text-right">{pct(r.ctr)}</td>
                  <td className="py-1.5 text-right">{pos(r.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SearchPerformance({ d, onSetup }: { d: SearchDashboard; onSetup: () => void }) {
  const s = d.search;
  const a = d.analytics;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-800">Search performance</p>
        {s && <p className="text-xs text-neutral-500">Google Search · {shortDay(s.current.from)} – {shortDay(s.current.to)} (data arrives about two days late)</p>}
      </div>

      {!s && (
        <div className={`${card} text-sm text-neutral-600`}>
          {!d.gscConnected ? (
            <>Search Console is not connected, so there are no clicks or impressions to show. <button type="button" onClick={onSetup} className="font-medium text-[var(--accent)] underline">See how to connect it</button>.</>
          ) : !d.sitePublished ? (
            <>Search Console is connected. The site is still in draft, so Google has little or nothing to report; numbers appear here after the site is opened and Google starts showing it.</>
          ) : (
            <>Search Console is connected but nothing has been imported yet. Run “Search Console import” from Automation Schedule.</>
          )}
        </div>
      )}

      {s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Clicks" value={int(s.current.clicks)}><Delta now={s.current.clicks} before={s.previous.days ? s.previous.clicks : null} /></Tile>
            <Tile label="Impressions" value={int(s.current.impressions)}><Delta now={s.current.impressions} before={s.previous.days ? s.previous.impressions : null} /></Tile>
            <Tile label="Click-through rate" value={pct(s.current.ctr)}><Delta now={s.current.ctr === null ? null : s.current.ctr * 100} before={s.previous.ctr === null ? null : s.previous.ctr * 100} asPoints /></Tile>
            <Tile label="Average position" value={pos(s.current.position)}><Delta now={s.current.position} before={s.previous.position} lowerIsBetter asPoints /></Tile>
          </div>
          {s.series.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              <LineChart title="Clicks per day" unit="clicks" points={s.series.map((p) => ({ day: p.day, value: p.clicks }))} />
              <LineChart title="Impressions per day" unit="impressions" points={s.series.map((p) => ({ day: p.day, value: p.impressions }))} />
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <TopTable title="Top search queries" rows={s.topQueries} label="Query" />
            <TopTable title="Top pages" rows={s.topPages} label="Page" />
          </div>
        </>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold text-neutral-800">Google index</p>
          {d.indexing?.checked ? (
            <p className="mt-2 text-sm text-neutral-700">
              <b className="tabular-nums">{d.indexing.indexed ?? 0}</b> of {d.indexing.checked} public pages are in Google&apos;s index
              {d.indexing.notIndexed ? <> · <b className="tabular-nums text-amber-700">{d.indexing.notIndexed}</b> not indexed (see Technical Audit)</> : null}
              {d.indexing.failed ? <> · {d.indexing.failed} could not be checked</> : null}.
            </p>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">{d.indexing?.reason ?? (d.gscConnected ? "Not checked yet." : "Needs Search Console.")}</p>
          )}
        </div>
        <div className={card}>
          <p className="text-sm font-semibold text-neutral-800">Visits from Google (Analytics)</p>
          {a ? (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{int(a.organicSessions)} <span className="text-sm font-normal text-neutral-500">organic sessions, 28 days</span></p>
              <Delta now={a.organicSessions} before={a.previousOrganicSessions || null} />
              {a.channels.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-neutral-600">
                  {a.channels.slice(0, 5).map((c) => <li key={c.channel} className="flex justify-between gap-2"><span>{c.channel}</span><span className="tabular-nums">{int(c.sessions)} sessions · {int(c.keyEvents)} key events</span></li>)}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">{d.ga4Connected ? "Not imported yet. Run “Analytics import” from Automation Schedule." : "Google Analytics is not connected (optional)."}</p>
          )}
        </div>
      </div>
      {a && a.series.length > 1 && <LineChart title="Organic sessions per day" unit="sessions" points={a.series.map((p) => ({ day: p.day, value: p.sessions }))} />}
    </div>
  );
}

/** Settings: how to connect Google, step by step (read-only access). */
export function GoogleSetupGuide() {
  return (
    <div className={card}>
      <p className="text-sm font-semibold text-neutral-800">Connect Google (Search Console and Analytics)</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-neutral-700">
        <li>In Google Cloud Console, create a project, enable the <b>Google Search Console API</b> and the <b>Google Analytics Data API</b>.</li>
        <li>Create a <b>service account</b> (no roles needed) and download a JSON key for it.</li>
        <li>In Search Console, verify <code>www.mavin.pk</code> (a Domain property <code>mavin.pk</code> covers every subdomain). Under Settings → Users and permissions, add the service account&apos;s email as a <b>Restricted</b> user.</li>
        <li>In Google Analytics, create a GA4 property for www.mavin.pk; under Admin → Property access management add the service account&apos;s email as <b>Viewer</b>. Note the numeric Property ID, and the web stream&apos;s Measurement ID (<code>G-…</code>).</li>
        <li>In Vercel → Settings → Environment Variables (Production), add <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (the whole key file), <code>GSC_SITE_URL</code> (<code>sc-domain:mavin.pk</code> or <code>https://www.mavin.pk/</code>, exactly as Search Console shows it), <code>GA4_PROPERTY_ID</code> and <code>NEXT_PUBLIC_GA_MEASUREMENT_ID</code> (the tag only loads on www.mavin.pk, never on app pages). Redeploy.</li>
        <li>Run “Search Console import” from Automation Schedule. The first import fetches the last 90 days; after that it runs daily.</li>
      </ol>
      <p className="mt-2 text-xs text-neutral-500">Access is read-only. The key stays on the server and is never shown here or written to the database.</p>
    </div>
  );
}
