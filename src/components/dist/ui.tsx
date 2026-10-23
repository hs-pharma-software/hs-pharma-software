"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { dist, DIST_TYPE, MAPS_KEY, openMaps } from "@/lib/dist";
import type { DistMode, DistSettings } from "@/lib/dist/engine";
import { useLoad } from "@/components/restaurant/ui";

export { useLoad, useAction } from "@/components/restaurant/ui";

export const money = (n: number | null | undefined) => `Rs ${(Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayYmd = () => ymd(new Date());
export const thisMonth = () => todayYmd().slice(0, 7);
export const monthStart = () => `${thisMonth()}-01`;
export const ago = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export function Note({ tone = "neutral", children }: { tone?: "neutral" | "amber" | "rose" | "emerald" | "sky"; children: React.ReactNode }) {
  const cls = {
    neutral: "border-neutral-200 bg-neutral-50 text-neutral-700",
    amber: "border-amber-300 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
  }[tone];
  return <div className={`rounded-xl border px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}

export const Err = ({ error }: { error: string | null | undefined }) => (error ? <Note tone="rose">{error}</Note> : null);

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "green" | "amber" | "red" | "blue" | "violet"; children: React.ReactNode }) {
  const cls = { neutral: "bg-neutral-100 text-neutral-600", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800", red: "bg-rose-100 text-rose-700", blue: "bg-sky-100 text-sky-800", violet: "bg-violet-100 text-violet-800" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export const BOOKING_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue" | "violet"> = {
  draft: "neutral", submitted: "blue", pending_approval: "amber", approved: "green", rejected: "red", converted: "violet", cancelled: "neutral",
};
export const LIVE_TONE: Record<string, "green" | "amber" | "neutral" | "red"> = { live: "green", stale: "amber", stopped: "neutral", never: "neutral" };

export function PageTitle({ title, actions, sub }: { title: string; actions?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
        {sub && <div className="text-sm text-neutral-500">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface DistCtx {
  mode: DistMode;
  settings: DistSettings;
  perms: Set<string>;
  admin: boolean;
  fields: string[];
  salesmanId: string | null;
  can: (p: string) => boolean;
}

/** Distributor screens: right tenant type, set up (mode chosen), with this user's permissions. */
export function DistGuard({ children, need }: { children: (c: DistCtx) => React.ReactNode; need?: string }) {
  const type = useAuthStore((s) => businessType(s.currentTenant?.businessType).id);
  const tenantId = useAuthStore((s) => s.currentTenant?.id);
  const data = useLoad(async () => {
    if (type !== DIST_TYPE) return null;
    const [cfg, perms, me] = await Promise.all([dist.config(), dist.myPerms(), dist.me()]);
    return { cfg, perms, me };
  }, [type, tenantId]);
  if (type !== DIST_TYPE) return <Note tone="amber">These screens are for Wholesaler / Distributor accounts.</Note>;
  if (data.error) return <Err error={data.error} />;
  if (!data.data) return <p className="text-sm text-neutral-400">Loading…</p>;
  const { cfg, perms, me } = data.data;
  if (!cfg)
    return perms.admin ? (
      <Note tone="amber">
        Choose your distributor type first: <Link className="underline" href="/dist/settings">Distributor Settings</Link>.
      </Note>
    ) : (
      <Note tone="amber">The distributor administrator has not set up the module yet.</Note>
    );
  const set = new Set(perms.perms);
  const c: DistCtx = { mode: cfg.mode, settings: cfg.settings, perms: set, admin: perms.admin, fields: perms.fields, salesmanId: me?.id ?? null, can: (p) => perms.admin || set.has(p) };
  if (need && !c.can(need)) return <Note tone="amber">You don&apos;t have permission to open this screen ({need}). Ask the distributor administrator.</Note>;
  return <>{children(c)}</>;
}

// ── Google Map ────────────────────────────────────────────────────────

export interface Marker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  /** Colour of the marker dot. */
  color?: string;
  /** Short text inside the marker (e.g. "S" for salesman, "C" for customer). */
  glyph?: string;
  info?: string;
  onClick?: () => void;
}

// The Maps JavaScript API has no bundled types here; it is used through this narrow surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
let mapsPromise: Promise<any> | null = null;
function loadMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as any;
  if (w.google?.maps) return Promise.resolve(w.google.maps);
  if (!mapsPromise)
    mapsPromise = new Promise((resolve, reject) => {
      const cb = `__distMaps${Date.now()}`;
      w[cb] = () => resolve(w.google.maps);
      w.gm_authFailure = () => reject(new Error("Google Maps refused the API key (check key restrictions / billing)."));
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly&callback=${cb}`;
      s.async = true;
      s.onerror = () => {
        mapsPromise = null;
        reject(new Error("Could not load Google Maps (offline or blocked)."));
      };
      document.head.appendChild(s);
    });
  return mapsPromise;
}

/** Markers on a Google Map; optional editable pin (click / drag) for manual
 * customer locations. Without an API key it falls back to a list with
 * "Open in Google Maps" links — no fake map. */
export function MapView({ markers, pin, onPin, height = 380 }: { markers: Marker[]; pin?: { lat: number; lng: number } | null; onPin?: (p: { lat: number; lng: number }) => void; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const drawn = useRef<any[]>([]);
  const pinMarker = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!MAPS_KEY || !el.current) return;
    let alive = true;
    loadMaps()
      .then((g) => {
        if (!alive || !el.current) return;
        map.current = new g.Map(el.current, { center: { lat: 30.3753, lng: 69.3451 }, zoom: 5, mapTypeControl: false, streetViewControl: false });
        if (onPin) map.current.addListener("click", (e: any) => onPin({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const w = window as any;
    if (!ready || !w.google?.maps) return;
    const g = w.google.maps;
    for (const m of drawn.current) m.setMap(null);
    drawn.current = [];
    const bounds = new g.LatLngBounds();
    const info = new g.InfoWindow();
    for (const m of markers) {
      const mk = new g.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: map.current,
        title: m.title,
        label: m.glyph ? { text: m.glyph, color: "#fff", fontSize: "11px", fontWeight: "700" } : undefined,
        icon: { path: g.SymbolPath.CIRCLE, scale: 11, fillColor: m.color ?? "#2563eb", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
      });
      mk.addListener("click", () => {
        info.setContent(`<div style="font:13px sans-serif"><b>${escapeHtml(m.title)}</b>${m.info ? `<br>${escapeHtml(m.info)}` : ""}</div>`);
        info.open({ map: map.current, anchor: mk });
        m.onClick?.();
      });
      drawn.current.push(mk);
      bounds.extend({ lat: m.lat, lng: m.lng });
    }
    if (pin) bounds.extend(pin);
    if (markers.length + (pin ? 1 : 0) === 1) {
      map.current.setCenter(pin ?? { lat: markers[0].lat, lng: markers[0].lng });
      map.current.setZoom(16);
    } else if (markers.length + (pin ? 1 : 0) > 1) map.current.fitBounds(bounds, 40);
  }, [ready, markers, pin]);

  useEffect(() => {
    const w = window as any;
    if (!ready || !w.google?.maps) return;
    const g = w.google.maps;
    if (!pin) {
      pinMarker.current?.setMap(null);
      pinMarker.current = null;
      return;
    }
    if (!pinMarker.current) {
      pinMarker.current = new g.Marker({ position: pin, map: map.current, draggable: !!onPin, title: "Customer location" });
      if (onPin) pinMarker.current.addListener("dragend", (e: any) => onPin({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
    } else pinMarker.current.setPosition(pin);
  }, [ready, pin, onPin]);

  if (!MAPS_KEY || error)
    return (
      <div className="space-y-2">
        <Note tone="amber">
          {error ?? "Google Maps is not configured (set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, a browser key restricted to this app's origins and the Maps JavaScript API)."} Locations are listed below and open in Google Maps.
        </Note>
        <ul className="max-h-80 divide-y divide-neutral-100 overflow-y-auto rounded-xl bg-white text-sm ring-1 ring-black/5">
          {pin && <MarkerRow m={{ id: "pin", lat: pin.lat, lng: pin.lng, title: "Selected location", color: "#dc2626" }} />}
          {markers.map((m) => (
            <MarkerRow key={m.id} m={m} />
          ))}
          {!markers.length && !pin && <li className="px-3 py-4 text-center text-neutral-400">No locations.</li>}
        </ul>
      </div>
    );
  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-xl ring-1 ring-black/10" />;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function MarkerRow({ m }: { m: Marker }) {
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2">
      <button type="button" className="flex min-w-0 items-center gap-2 text-start" onClick={m.onClick}>
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: m.color ?? "#2563eb" }} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{m.title}</span>
          <span className="text-[11px] text-neutral-500">
            {m.lat.toFixed(6)}, {m.lng.toFixed(6)} {m.info ? `· ${m.info}` : ""}
          </span>
        </span>
      </button>
      <button type="button" className="flex shrink-0 items-center gap-1 text-xs text-sky-700 underline" onClick={() => void openMaps(m.lat, m.lng)}>
        <ExternalLink size={12} /> Google Maps
      </button>
    </li>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ── Target ring ───────────────────────────────────────────────────────

export interface Progress {
  target: number;
  achieved: number;
  remaining: number;
  pct: number;
  status: "achieved" | "on_track" | "below";
  elapsedDays: number;
  daysInMonth: number;
}

const STATUS_COLOR = { achieved: "#059669", on_track: "#2563eb", below: "#dc2626" };
const STATUS_LABEL = { achieved: "Target achieved", on_track: "On track", below: "Below target" };
const METRIC_LABEL: Record<string, string> = { bookings: "Submitted booking value", approved: "Approved order value", invoiced: "Invoiced sales", net_sales: "Net sales (after returns)" };

/** Circular target progress, same figures for the admin and the salesman. */
export function TargetRing({ progress, month, metric }: { progress: Progress; month: string; metric: string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, progress.target > 0 ? progress.achieved / progress.target : 0);
  const color = STATUS_COLOR[progress.status];
  return (
    <div className="flex flex-wrap items-center gap-6 rounded-xl bg-white p-4 ring-1 ring-black/5">
      <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label={`${progress.pct}% of target`}>
        <circle cx="90" cy="90" r={r} fill="none" stroke="#e5e7eb" strokeWidth="18" />
        <circle cx="90" cy="90" r={r} fill="none" stroke={color} strokeWidth="18" strokeLinecap="round" strokeDasharray={`${frac * c} ${c}`} transform="rotate(-90 90 90)" />
        <text x="90" y="86" textAnchor="middle" fontSize="28" fontWeight="700" fill="#111827">
          {progress.pct}%
        </text>
        <text x="90" y="108" textAnchor="middle" fontSize="11" fill="#6b7280">
          {month}
        </text>
      </svg>
      <dl className="grid min-w-56 flex-1 grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-neutral-500">Target</dt>
        <dd className="text-end font-semibold">{money(progress.target)}</dd>
        <dt className="text-neutral-500">Achieved</dt>
        <dd className="text-end font-semibold" style={{ color }}>
          {money(progress.achieved)}
        </dd>
        <dt className="text-neutral-500">Remaining</dt>
        <dd className="text-end font-semibold">{money(progress.remaining)}</dd>
        <dt className="text-neutral-500">Status</dt>
        <dd className="text-end">
          <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: color }}>
            {STATUS_LABEL[progress.status]}
          </span>
        </dd>
        <dt className="text-neutral-500">Measured by</dt>
        <dd className="text-end text-xs">{METRIC_LABEL[metric] ?? metric}</dd>
        <dt className="text-neutral-500">Days elapsed</dt>
        <dd className="text-end text-xs">
          {progress.elapsedDays} / {progress.daysInMonth}
        </dd>
      </dl>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {hint && <p className="text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

export function Bars({ rows, empty = "No data." }: { rows: { label: string; amount: number }[]; empty?: string }) {
  if (!rows.length) return <p className="py-3 text-center text-xs text-neutral-400">{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.amount)), 1);
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.slice(0, 12).map((r, i) => (
        <li key={i}>
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate">{r.label}</span>
            <span>{money(r.amount)}</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-full bg-neutral-100">
            <div className="h-1.5 rounded-full bg-sky-500" style={{ width: `${(Math.max(0, r.amount) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** CSV download of the rows (only shown to users allowed to see the data). */
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
