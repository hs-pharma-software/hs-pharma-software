"use client";

import { useLayoutEffect, useRef } from "react";
import { narrativeTitle, toTemplate, tokensOf, type NarrativeView } from "@/config/ultrasoundNarrative";
import type { UsTemplate } from "@/config/ultrasoundReports";

/** A textarea as tall as its text. */
function GrowingText({ value, onChange, label, invalid, describedBy }: { value: string; onChange: (v: string) => void; label: string; invalid: boolean; describedBy?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref} rows={2} value={value} aria-label={label} aria-invalid={invalid} aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full resize-none overflow-hidden rounded-lg border bg-white px-2.5 py-1.5 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-violet-500/30 ${invalid ? "border-rose-400" : "border-neutral-200 focus:border-violet-500"}`}
    />
  );
}

/** The report as it will print, written out from the entered values. Each
 * paragraph's wording can be changed; its values stay as entered (they are
 * changed in the form above). */
export function NarrativePreview({ template, gender, paragraphs, edits, onEdits }: {
  template: UsTemplate;
  gender: string | null;
  paragraphs: NarrativeView[];
  edits: Record<string, string>;
  onEdits: (e: Record<string, string>) => void;
}) {
  if (!paragraphs.length) {
    return <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">Enter the scan&apos;s values above: the report is written out here as you go.</p>;
  }
  const set = (id: string, text: string, p: NarrativeView) => onEdits({ ...edits, [id]: toTemplate(text, tokensOf(p.item)) });
  const reset = (id: string) => {
    const next = { ...edits };
    delete next[id];
    onEdits(next);
  };
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-[#0b2a6b]">{narrativeTitle(template, gender)}</p>
        <p className="text-xs text-neutral-500">Change the wording if needed. <b>Bold</b> numbers are the entered values: change them in the form above.</p>
      </div>
      <div className="flex flex-col gap-2">
        {paragraphs.map((p, i) => {
          // A group heading over the first paragraph of each group.
          const heading = p.item.group && p.item.group !== paragraphs[i - 1]?.item.group ? p.item.group : null;
          const errId = `narr-err-${p.item.id}`;
          return (
            <div key={p.item.id}>
              {heading && <p className="mt-2 border-b border-neutral-300 pb-0.5 text-xs font-bold uppercase tracking-wide text-[#0b2a6b]">{heading}</p>}
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-800">{p.item.label}</p>
                <p className="text-[11px] text-neutral-500">
                  Values:{" "}
                  {tokensOf(p.item).length ? tokensOf(p.item).map((t, i) => <b key={t.key + i} className="ml-1 text-neutral-800">{t.value}</b>) : <span className="ml-1">none</span>}
                  {p.edited && <button type="button" onClick={() => reset(p.item.id)} className="ml-3 text-violet-700 hover:underline">Reset wording</button>}
                </p>
              </div>
              <GrowingText value={p.text} label={`${p.item.label}: report text`} invalid={Boolean(p.error)} describedBy={p.error ? errId : undefined} onChange={(t) => set(p.item.id, t, p)} />
              {p.error && <p id={errId} className="mt-0.5 text-xs text-rose-700">{p.error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
