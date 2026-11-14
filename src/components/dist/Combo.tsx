"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboItem {
  id: string;
  label: string;
  /** Second line (code, company, ATL …). */
  sub?: string;
  /** Right-hand figure (price, stock …). */
  right?: string;
  disabled?: boolean;
}

/** A searchable list: type to filter, ↑ / ↓ to move, Enter to pick, Esc to close.
 * With `clearOnPick` it stays empty after a pick (adding product lines);
 * otherwise it shows the picked item. */
export function Combo({
  items, value, onPick, placeholder = "Search…", clearOnPick = false, autoFocus = false, emptyText = "Nothing found.", loading = false, onQuery, inputRef, max = 50,
}: {
  items: ComboItem[];
  value?: string | null;
  onPick: (id: string) => void;
  placeholder?: string;
  clearOnPick?: boolean;
  autoFocus?: boolean;
  emptyText?: string;
  loading?: boolean;
  /** Called with the typed text (for lists searched on the server). */
  onQuery?: (q: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  max?: number;
}) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const picked = value ? items.find((i) => i.id === value) : undefined;
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? items.filter((i) => { const t = `${i.label} ${i.sub ?? ""}`.toLowerCase(); return words.every((w) => t.includes(w)); }) : items;
    return hits.slice(0, max);
  }, [items, q, max]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const pick = (i: ComboItem | undefined) => {
    if (!i || i.disabled) return;
    onPick(i.id);
    setQ("");
    setOpen(false);
    if (clearOnPick) requestAnimationFrame(() => ref.current?.focus());
    else ref.current?.blur();
  };
  const text = open || clearOnPick ? q : picked ? picked.label : q;
  return (
    <div className="relative">
      <input
        ref={ref}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        placeholder={picked && !clearOnPick ? picked.label : placeholder}
        value={text}
        onFocus={() => { setOpen(true); setQ(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); onQuery?.(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(shown.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { if (open && shown.length) { e.preventDefault(); pick(shown[active]); } }
          else if (e.key === "Escape") { setOpen(false); }
        }}
      />
      {open && (
        <ul ref={listRef} id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl bg-white py-1 text-sm shadow-lg ring-1 ring-black/10">
          {shown.map((i, n) => (
            <li
              key={i.id}
              id={`${listId}-${n}`}
              data-i={n}
              role="option"
              aria-selected={n === active}
              aria-disabled={i.disabled || undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setActive(n)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 ${n === active ? "bg-amber-50" : ""} ${i.disabled ? "cursor-not-allowed opacity-50" : ""} ${i.id === value ? "font-semibold" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate">{i.label}</span>
                {i.sub && <span className="block truncate text-[11px] text-neutral-500">{i.sub}</span>}
              </span>
              {i.right && <span className="shrink-0 text-xs tabular-nums text-neutral-600">{i.right}</span>}
            </li>
          ))}
          {!shown.length && <li className="px-3 py-3 text-center text-xs text-neutral-400">{loading ? "Loading…" : emptyText}</li>}
        </ul>
      )}
    </div>
  );
}
