"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting", cls: "bg-sky-100 text-sky-700" },
  in_progress: { label: "In progress", cls: "bg-amber-100 text-amber-800" },
  performed: { label: "Examined, to report", cls: "bg-violet-100 text-violet-700" },
  reported: { label: "Reported", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-neutral-100 text-neutral-500" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-neutral-100 text-neutral-600" };
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

const PRIORITY: Record<string, string> = {
  stat: "bg-rose-600 text-white",
  urgent: "bg-orange-100 text-orange-800",
  routine: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

export function PriorityPill({ priority }: { priority: string }) {
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PRIORITY[priority] ?? PRIORITY.routine}`}>{priority}</span>;
}

export function FeePill({ fee, paid }: { fee: number | null | undefined; paid: number | null | undefined }) {
  if (!(Number(fee) > 0)) return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">No fee</span>;
  return Number(paid) === 1
    ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">Paid</span>
    : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Fee due Rs {Number(fee).toFixed(0)}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="mb-4 grid gap-1 rounded-xl bg-neutral-100 p-1 text-sm" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={`rounded-lg px-2 py-1.5 font-medium transition ${value === t.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, icon, actions, children, className = "" }: { title?: string; icon?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">{icon}{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, icon, tone = "neutral" }: { label: string; value: number | string; icon?: React.ReactNode; tone?: "neutral" | "warn" | "good" | "info" }) {
  const toneCls = { neutral: "text-neutral-900", warn: "text-amber-700", good: "text-emerald-700", info: "text-sky-700" }[tone];
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="flex items-center justify-between text-sm font-medium text-neutral-600">{label}<span className="text-neutral-400">{icon}</span></div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

/** Reloads every `seconds` while on; shows the last refresh and a manual button. */
export function useAutoRefresh(load: () => Promise<void>, seconds = 30) {
  const [auto, setAuto] = useState(true);
  const [last, setLast] = useState<Date | null>(null);
  const [left, setLeft] = useState(seconds);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const refresh = useCallback(async () => {
    await loadRef.current();
    setLast(new Date());
    setLeft(seconds);
  }, [seconds]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setLeft((n) => {
      if (n <= 1) { void refresh(); return seconds; }
      return n - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [auto, refresh, seconds]);
  const bar = (
    <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
      {last && <span>Last refresh {last.toLocaleTimeString()}</span>}
      {auto && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />next in {left}s</span>}
      <Button variant="secondary" onClick={() => setAuto((a) => !a)} aria-pressed={auto}>{auto ? "Auto ON" : "Auto OFF"}</Button>
      <Button variant="secondary" onClick={() => void refresh()}><RefreshCw size={14} />Refresh</Button>
    </div>
  );
  return { refresh, bar };
}

export const ageGender = (p: { age_years?: number | null; dob?: string | null; gender?: string | null }) => {
  const age = p.age_years != null ? `${p.age_years}Y` : p.dob ? `DOB ${p.dob}` : "—";
  return `${age} / ${p.gender ?? "—"}`;
};

/** Opens the study in the PACS viewer, or says why it cannot. */
export function openImages(url: string | null, reason: string) {
  if (url) window.open(url, "_blank", "noopener");
  else window.alert(reason);
}

export const imagesMissingReason = (o: { images_received_at?: string | null }, pacsConfigured: boolean) =>
  !pacsConfigured
    ? "The PACS is not set up yet (Radiology > PACS / Orthanc)."
    : !o.images_received_at
      ? "The PACS has not received images for this study yet."
      : "The PACS has no viewer address. Add one on Radiology > PACS / Orthanc.";
