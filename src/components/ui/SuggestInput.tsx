"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const INPUT = "w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06]";

/** A free-text field that suggests values entered before (for example company
 * names). ↑ / ↓ move through the suggestions, Enter picks one, Esc closes. */
export function SuggestInput({ value, onChange, suggestions, placeholder, id }: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const matches = useMemo(() => {
    const terms = value.toLowerCase().split(/\s+/).filter(Boolean);
    const all = terms.length ? suggestions.filter((s) => terms.every((t) => s.toLowerCase().includes(t))) : suggestions;
    return all.filter((s) => s.toLowerCase() !== value.trim().toLowerCase()).slice(0, 40);
  }, [suggestions, value]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (s: string) => { onChange(s); setOpen(false); setActive(-1); };

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && active >= 0 && matches[active]) { e.preventDefault(); pick(matches[active]); }
          else if (e.key === "Escape") { setOpen(false); setActive(-1); }
        }}
        className={INPUT}
      />
      {open && matches.length > 0 && (
        <div className="absolute left-0 top-full z-[100] mt-1 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
          <ul ref={listRef} className="max-h-48 overflow-y-auto py-1">
            {matches.map((s, i) => (
              <li key={s} data-i={i} onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-1.5 text-sm ${i === active ? "bg-neutral-100 text-neutral-900" : "text-neutral-800"}`}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
