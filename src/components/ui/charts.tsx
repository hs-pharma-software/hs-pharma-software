"use client";

/* Dashboard charts shared by every business type: a breakdown wheel (part of a
 * whole), a flow (how many reach each step) and a short trend (bars per day).
 * The colours are a fixed, colour-blind-checked order: a series keeps its
 * colour whatever else is on screen. Every chart writes its numbers as text
 * too, so nothing depends on colour alone. */

import { useId, useState } from "react";
import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { EASE_OUT } from "@/lib/motion";

/** Categorical order (validated: neighbours stay apart for colour-blind readers). */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] as const;
const OTHER = "#a3a3a3";

export interface Slice { label: string; value: number; color?: string }

const fmtNum = (n: number) => Math.round(n).toLocaleString();

/** At most `max` slices; the smallest rest are folded into "Other". */
function fold(data: Slice[], max: number): Slice[] {
  const rows = data.filter((d) => d.value > 0);
  if (rows.length <= max) return rows.map((d, i) => ({ ...d, color: d.color ?? SERIES[i % SERIES.length] }));
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const keep = sorted.slice(0, max - 1).map((d, i) => ({ ...d, color: d.color ?? SERIES[i] }));
  const rest = sorted.slice(max - 1).reduce((s, d) => s + d.value, 0);
  return [...keep, { label: "Other", value: rest, color: OTHER }];
}

/** A wheel: each part of a whole as a ring segment, the total (or the part
 * under the pointer) in the middle, and a legend with figures beside it. */
export function BreakdownWheel({
  data, centerLabel = "Total", format = fmtNum, size = 140, max = 6, empty = "Nothing to show yet",
}: {
  data: Slice[]; centerLabel?: string; format?: (n: number) => string; size?: number; max?: number; empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = fold(data, max);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return <div className="flex h-36 items-center justify-center text-xs text-neutral-400">{empty}</div>;

  const r = 52, stroke = 16, c = 2 * Math.PI * r;
  // A 2px gap between neighbouring segments (none when there is only one).
  const gap = rows.length > 1 ? 2 : 0;
  // Each segment starts where the ones before it end.
  const segs = rows.map((row, i) => {
    const start = (rows.slice(0, i).reduce((s, r) => s + r.value, 0) / total) * c;
    const len = (row.value / total) * c;
    return { ...row, start, len: Math.max(len - gap, 0.5), frac: row.value / total };
  });
  const shown = hover !== null ? segs[hover] : null;
  const summary = segs.map((s) => `${s.label} ${format(s.value)} (${Math.round(s.frac * 100)}%)`).join(", ");

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 140 140" width={size} height={size} role="img" aria-label={`${centerLabel}: ${format(total)}. ${summary}`}>
          <circle cx="70" cy="70" r={r} fill="none" stroke="#f1f1f1" strokeWidth={stroke} />
          {segs.map((s, i) => (
            <motion.circle
              key={s.label}
              cx="70" cy="70" r={r} fill="none"
              stroke={s.color}
              strokeWidth={hover === i ? stroke + 4 : stroke}
              strokeDashoffset={-s.start}
              transform="rotate(-90 70 70)"
              initial={{ strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: `${s.len} ${c}`, opacity: hover === null || hover === i ? 1 : 0.35 }}
              transition={{ delay: 0.05 + i * 0.07, duration: 0.6, ease: EASE_OUT }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer", transition: "stroke-width 150ms" }}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-bold leading-tight text-neutral-900 tabular-nums">{format(shown ? shown.value : total)}</span>
          <span className="mt-0.5 max-w-[5.5rem] truncate text-[10px] font-medium uppercase tracking-wider text-neutral-400">
            {shown ? `${shown.label} · ${Math.round(shown.frac * 100)}%` : centerLabel}
          </span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-1">
        {segs.map((s, i) => (
          <li
            key={s.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors ${hover === i ? "bg-neutral-50" : ""}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 truncate text-neutral-600">{s.label}</span>
            <span className="ml-auto shrink-0 font-semibold text-neutral-800 tabular-nums">{format(s.value)}</span>
            <span className="w-9 shrink-0 text-right text-neutral-400 tabular-nums">{Math.round(s.frac * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface FlowStep { label: string; value: number; hint?: string }

/** A flow: the steps something passes through, each with how many reached it
 * and what share of the first step that is. Across on wide screens, down on phones. */
export function FlowChart({ steps, format = fmtNum }: { steps: FlowStep[]; format?: (n: number) => string }) {
  const first = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <ol className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-0">
      {steps.map((s, i) => {
        const share = Math.min(s.value / first, 1);
        return (
          <li key={s.label} className="flex flex-col md:flex-1 md:flex-row md:items-center">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.35, ease: EASE_OUT }}
              className="flex-1 rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-neutral-500">{s.label}</span>
                {i > 0 && <span className="shrink-0 text-[10px] font-semibold text-neutral-400 tabular-nums">{Math.round(share * 100)}%</span>}
              </div>
              <p className="mt-1 text-xl font-bold text-neutral-900 tabular-nums">{format(s.value)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200/70">
                <motion.div
                  className="h-full origin-left rounded-full"
                  style={{ width: `${share * 100}%`, background: SERIES[0] }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.15 + i * 0.08, duration: 0.55, ease: EASE_OUT }}
                />
              </div>
              {s.hint && <p className="mt-1.5 truncate text-[10px] text-neutral-400">{s.hint}</p>}
            </motion.div>
            {i < steps.length - 1 && (
              <span aria-hidden className="flex items-center justify-center py-0.5 text-neutral-300 md:px-1 md:py-0">
                <ChevronRight size={18} className="rotate-90 md:rotate-0" />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface TrendPoint { label: string; value: number }

/** Bars per day (or week): the value of each under the pointer, the latest one stronger. */
export function TrendBars({ points, format = fmtNum, height = 120 }: { points: TrendPoint[]; format?: (n: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(...points.map((p) => p.value), 0);
  if (points.length === 0 || max <= 0) return <div className="flex h-32 items-center justify-center text-xs text-neutral-400">No sales in this period</div>;
  const active = hover ?? points.length - 1;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs" aria-live="polite" id={id}>
        <span className="text-neutral-500">{points[active].label}</span>
        <span className="font-semibold text-neutral-900 tabular-nums">{format(points[active].value)}</span>
      </div>
      <div className="flex items-end gap-1.5 border-b border-neutral-200" style={{ height }} role="img" aria-label={points.map((p) => `${p.label} ${format(p.value)}`).join(", ")}>
        {points.map((p, i) => (
          <button
            key={p.label + i}
            type="button"
            aria-describedby={id}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className="group flex h-full flex-1 items-end justify-center"
            aria-label={`${p.label}: ${format(p.value)}`}
          >
            <motion.span
              className="block w-full max-w-[2.25rem] origin-bottom rounded-t"
              style={{ height: `${Math.max((p.value / max) * 100, p.value > 0 ? 2 : 0)}%`, background: SERIES[0], opacity: i === active ? 1 : 0.45 }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: i * 0.04, duration: 0.5, ease: EASE_OUT }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {points.map((p, i) => (
          <span key={p.label + i} className={`flex-1 truncate text-center text-[10px] ${i === active ? "font-semibold text-neutral-700" : "text-neutral-400"}`}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}
