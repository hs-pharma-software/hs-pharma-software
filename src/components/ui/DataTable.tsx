"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

export interface Column<T> {
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

/** One record as a compact phone row: title (up to two lines) and a short
 * second line on the left, the key amount on the right, actions in a "⋯" menu. */
export interface MobileRow {
  title: React.ReactNode;
  meta?: React.ReactNode;
  value?: React.ReactNode;
  sub?: React.ReactNode;
  actions?: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[];
}

/** A list of records. Computers: a table (scrolls sideways in its own box when
 * wide). Phones: compact rows when the page gives `mobile`, otherwise one card
 * per row with every column as "label: value". */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  emptyMessage = "No content in table",
  loading = false,
  mobile,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /** Rows not loaded yet: says so instead of the empty message. */
  loading?: boolean;
  /** Phones: a compact row per record instead of a card of every column. */
  mobile?: (row: T) => MobileRow;
}) {
  return (
    <>
      {mobile && (
        <div className="rounded-xl bg-white ring-1 ring-black/[0.06] sm:hidden">
          {rows.length === 0 ? (
            loading ? (
              <ul aria-hidden="true" className="divide-y divide-neutral-100">
                {[0, 1, 2].map((k) => (
                  <li key={k} className="flex min-h-14 items-center gap-3 px-3 py-2">
                    <div className="flex-1 space-y-2"><span className="skeleton block h-3 w-3/4 rounded-full" /><span className="skeleton block h-2.5 w-1/2 rounded-full" /></div>
                    <span className="skeleton block h-3 w-14 rounded-full" />
                  </li>
                ))}
              </ul>
            ) : <p className="fade-in px-3 py-8 text-center text-sm text-neutral-400">{emptyMessage}</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {rows.map((row) => <CompactRow key={row.id} m={mobile(row)} onOpen={onRowClick ? () => onRowClick(row) : undefined} />)}
            </ul>
          )}
        </div>
      )}
      <div
        role="region"
        aria-label="Table"
        aria-busy={loading || undefined}
        tabIndex={0}
        className={`overflow-x-auto rounded-2xl bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:bg-white sm:shadow-[0_1px_4px_rgba(0,0,0,0.07)] sm:ring-1 sm:ring-black/[0.04] ${mobile ? "max-sm:hidden" : ""}`}
      >
        <table className="rt w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left">
              {columns.map((col) => (
                <th key={col.header} className="whitespace-nowrap px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && loading ? (
              [0, 1, 2, 3].map((k) => (
                <tr key={`sk-${k}`} aria-hidden="true" className="border-b border-neutral-50 last:border-0">
                  {columns.map((col, c) => (
                    <td key={col.header} data-label="" className="px-4 py-3">
                      <span className="skeleton block h-3 rounded-full" style={{ width: `${c === 0 ? 70 : 45 + ((k * 17 + c * 23) % 40)}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="fade-in px-3 py-10 text-center text-neutral-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  style={i < 12 ? { animationDelay: `${i * 25}ms` } : undefined}
                  className={`border-b border-neutral-50 last:border-0 ${i < 12 ? "row-in" : ""} ${
                    onRowClick ? "row-clickable cursor-pointer" : ""
                  }`}
                >
                  {columns.map((col, c) => (
                    <td key={col.header} data-label={col.header} className={`whitespace-nowrap px-4 py-2.5 ${c === 0 ? "rt-title" : ""} ${col.className ?? ""}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CompactRow({ m, onOpen }: { m: MobileRow; onOpen?: () => void }) {
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);
  const actions = (m.actions ?? []).filter(Boolean);
  return (
    <li ref={box} className="relative flex items-stretch">
      <div
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen}
        onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined}
        className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-3 ${actions.length ? "pr-1" : "pr-3"} ${onOpen ? "cursor-pointer active:bg-neutral-50" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] font-medium leading-snug text-neutral-900">{m.title}</div>
          {m.meta != null && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500">{m.meta}</div>}
        </div>
        {(m.value != null || m.sub != null) && (
          <div className="shrink-0 text-right">
            {m.value != null && <div className="whitespace-nowrap text-[15px] font-semibold tabular-nums text-neutral-900">{m.value}</div>}
            {m.sub != null && <div className="mt-0.5 whitespace-nowrap text-xs text-neutral-500">{m.sub}</div>}
          </div>
        )}
      </div>
      {actions.length > 0 && (
        <button
          type="button"
          aria-label="Actions"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
          className="flex w-10 shrink-0 items-center justify-center text-neutral-500 active:bg-neutral-100"
        >
          <MoreVertical size={18} />
        </button>
      )}
      {menu && (
        <div role="menu" className="pop-in absolute right-2 top-full z-20 -mt-1 min-w-40 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 text-sm shadow-xl">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => { setMenu(false); a.onClick(); }}
              className={`block min-h-11 w-full px-4 text-left disabled:opacity-40 ${a.danger ? "text-rose-600" : "text-neutral-800"} active:bg-neutral-50`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
