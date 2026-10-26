"use client";

import { useEffect, useRef, useState } from "react";

export interface SearchOption {
  value: string;
  label: string;
  /** Shown faintly after the label (for example a unit's description). */
  hint?: string | null;
}

const INPUT = "w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06] disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400";

/** A dropdown you can type into. ↑ / ↓ move, Enter picks (without submitting
 * the form), Esc closes. Options with the same label and hint are listed once
 * (a business's own copy and the shared catalog's), keeping the selected one. */
export function SearchSelect({ value, onChange, options, placeholder = "Select...", required, disabled, emptyText = "Nothing to choose yet", id }: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  emptyText?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const key = (o: SearchOption) => `${o.label.trim().toLowerCase()}|${(o.hint ?? "").trim().toLowerCase()}`;
  const unique = options.filter((o, i) => {
    if (o.value === value) return true;
    if (selected && key(selected) === key(o)) return false;
    return options.findIndex((x) => key(x) === key(o)) === i;
  });
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = (terms.length ? unique.filter((o) => terms.every((t) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(t))) : unique).slice(0, 100);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(o: SearchOption) {
    onChange(o.value);
    setQuery("");
    setOpen(false);
    setActive(-1);
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        value={open ? query : (selected?.label ?? "")}
        placeholder={open ? "Type to filter..." : placeholder}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(e.target.value ? 0 : -1); }}
        onFocus={() => { setQuery(""); setOpen(true); setActive(-1); }}
        onBlur={() => setTimeout(() => { if (!boxRef.current?.contains(document.activeElement)) { setOpen(false); setQuery(""); } }, 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setQuery(""); setActive(-1); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open) {
            e.preventDefault();
            const o = filtered[active >= 0 ? active : 0];
            if (o) pick(o);
          }
        }}
        className={INPUT}
      />
      {required && <input type="hidden" value={value} required />}
      {open && !disabled && (
        <div className="absolute left-0 top-full z-[100] mt-1 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
          <ul ref={listRef} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-neutral-400">{options.length === 0 ? emptyText : "No match"}</li>
            ) : filtered.map((o, i) => (
              <li
                key={o.value}
                data-i={i}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-1.5 text-sm ${i === active ? "bg-neutral-100" : ""} ${o.value === value ? "font-medium text-[#006633] bg-[#006633]/[0.04]" : "text-neutral-800"}`}
              >
                {o.label}
                {o.hint ? <span className="ml-1.5 text-xs text-neutral-400">{o.hint}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
