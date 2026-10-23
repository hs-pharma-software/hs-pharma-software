"use client";

import { Field, Input } from "@/components/ui/Field";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ScheduleValue {
  start_date?: string | null;
  end_date?: string | null;
  days?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export function scheduleText(s: ScheduleValue): string {
  const parts: string[] = [];
  if (s.start_date || s.end_date) parts.push(`${s.start_date ?? "…"} to ${s.end_date ?? "…"}`);
  if (s.days) parts.push(s.days.split(",").map((d) => DAYS[Number(d)]).join(" "));
  if (s.start_time && s.end_time) parts.push(`${s.start_time}–${s.end_time}`);
  return parts.length ? parts.join(" · ") : "Always";
}

/** Date range, weekdays and time window shared by deals and offers. */
export function ScheduleFields({ value, onChange }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void }) {
  const days = (value.days ?? "").split(",").filter(Boolean);
  return (
    <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
      <p className="text-xs font-medium text-neutral-600">When it applies (leave empty for always)</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From date"><Input type="date" value={value.start_date ?? ""} onChange={(e) => onChange({ start_date: e.target.value || null })} /></Field>
        <Field label="To date"><Input type="date" value={value.end_date ?? ""} onChange={(e) => onChange({ end_date: e.target.value || null })} /></Field>
        <Field label="From time"><Input type="time" value={value.start_time ?? ""} onChange={(e) => onChange({ start_time: e.target.value || null })} /></Field>
        <Field label="To time"><Input type="time" value={value.end_time ?? ""} onChange={(e) => onChange({ end_time: e.target.value || null })} /></Field>
      </div>
      <div className="flex flex-wrap gap-1">
        {DAYS.map((d, i) => {
          const on = days.includes(String(i));
          return (
            <button
              key={d}
              type="button"
              onClick={() => {
                const next = on ? days.filter((x) => x !== String(i)) : [...days, String(i)];
                onChange({ days: next.sort().join(",") || null });
              }}
              className={`rounded-full px-2.5 py-1 text-xs ${on ? "bg-neutral-900 text-white" : "ring-1 ring-neutral-200"}`}
            >
              {d}
            </button>
          );
        })}
        <span className="ml-1 self-center text-[11px] text-neutral-400">{days.length ? "" : "every day"}</span>
      </div>
    </div>
  );
}
