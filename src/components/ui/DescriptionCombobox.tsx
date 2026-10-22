"use client";

import { useMemo, useRef, useState } from "react";
import { findExact, findSimilar } from "@/lib/repo/genericNames";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the user settles on a value (picked, added, or left the field). */
  onCommit: (value: string) => void;
  options: string[];
  onAdd: (value: string) => Promise<void>;
  placeholder?: string;
}

/** Searchable Description field backed by the shared generic-name list. Free
 * text is allowed; anything not in the list can be added to it, with similar
 * existing names shown first so near-duplicates aren't created by accident. */
export function DescriptionCombobox({ value, onChange, onCommit, options, onAdd, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  const terms = value.toUpperCase().split(/[\s,+/]+/).filter(Boolean);
  const matches = useMemo(() => {
    if (terms.length === 0) return options.slice(0, 50);
    return options.filter((o) => {
      const u = o.toUpperCase();
      return terms.every((t) => u.includes(t));
    }).slice(0, 50);
  }, [options, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const exact = value.trim() ? findExact(options, value) : undefined;
  const similar = value.trim() && !exact ? findSimilar(options, value) : [];
  const canAdd = !!value.trim() && !exact;

  function pick(v: string) {
    onChange(v);
    onCommit(v);
    setOpen(false);
    setActive(-1);
  }

  async function add() {
    setAdding(true);
    try {
      await onAdd(value);
      setOpen(false);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={value}
        placeholder={placeholder ?? "Search or type a generic name..."}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() =>
          setTimeout(() => {
            if (!boxRef.current?.contains(document.activeElement)) {
              setOpen(false);
              onCommit(value);
            }
          }, 150)
        }
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && active >= 0 && matches[active]) { e.preventDefault(); pick(matches[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06]"
      />
      {value.trim() && !exact && (
        <span className="mt-0.5 block text-[11px] text-amber-600">Not in the description list yet</span>
      )}

      {open && (matches.length > 0 || canAdd) && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_4px_16px_rgba(0,0,0,0.10)]">
          {similar.length > 0 && (
            <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
              Similar names already in the list - pick one instead of adding a near-duplicate:
            </div>
          )}
          <ul className="max-h-56 overflow-y-auto py-1">
            {[...similar, ...matches.filter((m) => !similar.includes(m))].map((m, i) => (
              <li
                key={m}
                onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                className={`cursor-pointer px-3 py-1.5 text-sm ${i === active ? "bg-neutral-100" : "hover:bg-neutral-50"} ${similar.includes(m) ? "text-amber-900" : "text-neutral-800"}`}
              >
                {m}
              </li>
            ))}
          </ul>
          {canAdd && (
            <button
              type="button"
              disabled={adding}
              onMouseDown={(e) => { e.preventDefault(); void add(); }}
              className="block w-full border-t border-neutral-100 px-3 py-2 text-left text-sm font-medium text-[#006633] hover:bg-[#006633]/[0.05] disabled:opacity-50"
            >
              {adding ? "Adding..." : `+ Add "${value.trim()}" to description list`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
