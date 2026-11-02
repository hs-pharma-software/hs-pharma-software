"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Customer } from "@/lib/types";

interface Props {
  customers: Customer[];
  /** Selected customer id ("" = walk-in). */
  value: string;
  onSelect: (id: string) => void;
  /** A name typed that matches no saved customer (a walk-in by name). */
  onFreeText?: (name: string) => void;
  placeholder?: string;
}

const WALK_IN = { id: "", name: "Walk-in" } as const;

/** Customer search for the invoice: type a name, mobile or NTN/CNIC, move
 * with the arrow keys and pick with Enter (Esc closes). */
export function CustomerPicker({ customers, value, onSelect, onFreeText, placeholder = "Search customer..." }: Props) {
  const selected = customers.find((c) => c.id === value) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => setQuery(selected?.name ?? ""), [selected?.name]);

  const term = typed ? query.trim().toLowerCase() : "";
  const matches = term
    ? customers.filter((c) =>
        [c.name, c.phone, c.cnic_ntn, c.ntn, c.business_name].some((v) => (v ?? "").toLowerCase().includes(term))
      )
    : customers;
  const options: { id: string; name: string; detail?: string }[] = [
    ...(term ? [] : [WALK_IN]),
    ...matches.slice(0, 50).map((c) => ({ id: c.id, name: c.name, detail: [c.phone, c.cnic_ntn || c.ntn].filter(Boolean).join(" · ") })),
  ];

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(id: string) {
    onSelect(id);
    setQuery(customers.find((c) => c.id === id)?.name ?? "");
    setTyped(false);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (!open || options.length === 0) return;
      e.preventDefault();
      choose(options[active].id);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  }

  function onBlur() {
    setTimeout(() => {
      setOpen(false);
      if (!typed) return;
      const exact = customers.find((c) => c.name.trim().toLowerCase() === query.trim().toLowerCase());
      if (exact) choose(exact.id);
      else {
        if (value) onSelect("");
        onFreeText?.(query.trim());
        setTyped(false);
      }
    }, 150);
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={(e) => {
          e.target.select();
          setTyped(false);
          setActive(0);
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setTyped(true);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06]"
      />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full min-w-[14rem] overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.04]"
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-xs text-neutral-400">No saved customer. The typed name is used as walk-in; + adds a new customer.</li>
          )}
          {options.map((o, i) => (
            <li
              key={o.id || "walk-in"}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o.id);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-[#006633]/[0.08]" : ""}`}
            >
              <span className="block text-sm font-medium text-neutral-800">{o.name}</span>
              {o.detail && <span className="block text-[11px] text-neutral-400">{o.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
