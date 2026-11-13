"use client";

import { money } from "./ui";

const STATUS: Record<string, { label: string; bar: string; text: string; icon: string }> = {
  achieved: { label: "Achieved", bar: "bg-emerald-600", text: "text-emerald-700", icon: "✓" },
  on_track: { label: "On track", bar: "bg-sky-600", text: "text-sky-700", icon: "→" },
  below: { label: "Below pace", bar: "bg-amber-500", text: "text-amber-700", icon: "!" },
};

/** A salesman's month against target: the bar fills to what was achieved (it
 * can pass 100 %), a tick marks where they should be by today, and the
 * percentage is written on it. Status is shown in words, not colour alone. */
export function TargetBar({ name, code, target, achieved, pct, status, elapsedDays, daysInMonth }: {
  name: string; code?: string; target: number; achieved: number; pct: number; status: string; elapsedDays: number; daysInMonth: number;
}) {
  const s = STATUS[status] ?? STATUS.below;
  const fill = Math.max(0, Math.min(100, pct));
  const pace = daysInMonth > 0 ? Math.min(100, (elapsedDays / daysInMonth) * 100) : 0;
  const label = target > 0 ? `${pct.toFixed(pct >= 100 ? 0 : 1)} %` : "No target";
  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium text-neutral-800">{name} {code && <span className="text-xs font-normal text-neutral-400">{code}</span>}</span>
        <span className={`shrink-0 text-xs font-medium ${s.text}`}>{s.icon} {target > 0 ? s.label : ""}</span>
      </div>
      <div
        className="relative mt-1 h-5 overflow-hidden rounded-md bg-neutral-100"
        role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill)}
        aria-label={`${name}: ${label} of target`}
        title={`Achieved ${money(achieved)} of ${money(target)} (${label}). Expected by today: ${pace.toFixed(0)} %.`}
      >
        <div className={`h-full rounded-md ${s.bar}`} style={{ width: `${fill}%` }} />
        {target > 0 && pace > 0 && pace < 100 && <div className="absolute inset-y-0 w-0.5 bg-neutral-800/40" style={{ left: `${pace}%` }} aria-hidden />}
        <span className={`absolute inset-y-0 flex items-center px-2 text-xs font-semibold ${fill > 18 ? "text-white" : "text-neutral-700"}`} style={fill > 18 ? { left: 0 } : { left: `${fill}%` }}>
          {label}
        </span>
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-neutral-500">
        <span>{money(achieved)} achieved</span>
        <span>target {money(target)}</span>
      </div>
    </div>
  );
}
