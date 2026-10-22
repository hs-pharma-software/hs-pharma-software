"use client";

import { useEffect, useRef, useState } from "react";

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export function FbrCombobox({ value, onChange, options, placeholder = "Search or type...", required, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep input text in sync when value changes externally
  useEffect(() => { setQuery(value); }, [value]);

  const filtered = query.trim()
    ? options.filter(
        (o) =>
          o.value.toLowerCase().includes(query.toLowerCase()) ||
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          (o.sublabel ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : options;

  function select(opt: Option) {
    onChange(opt.value);
    setQuery(opt.value);
    setOpen(false);
  }

  function handleBlur() {
    // Small delay so click on option registers before we close
    setTimeout(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        setOpen(false);
        // If user typed something not in list, keep it (free-form); otherwise validate
        onChange(query);
      }
    }, 150);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    onChange(e.target.value);
    setOpen(true);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-black/[0.06] disabled:opacity-50"
      />

      {open && filtered.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.04]">
          {filtered.slice(0, 30).map((opt) => (
            <li
              key={opt.value}
              onMouseDown={(e) => { e.preventDefault(); select(opt); }}
              className={`cursor-pointer px-3 py-2 transition-colors hover:bg-neutral-50 ${opt.value === value ? "bg-[#006633]/[0.06]" : ""}`}
            >
              <span className="block text-sm font-medium text-neutral-800">{opt.label}</span>
              {opt.sublabel && (
                <span className="block text-[11px] leading-snug text-neutral-400">{opt.sublabel}</span>
              )}
            </li>
          ))}
          {filtered.length > 30 && (
            <li className="px-3 py-1.5 text-[11px] text-neutral-400">
              {filtered.length - 30} more — type to narrow
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
