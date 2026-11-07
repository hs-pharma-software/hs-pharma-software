"use client";

import { motion } from "motion/react";

export interface Column<T> {
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

/** A list of records. Computers: a table (scrolls sideways in its own box when
 * wide). Phones: one card per row with every column as "label: value" (the
 * first column is the card's title), so nothing is hidden or cut off. */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  emptyMessage = "No content in table",
  loading = false,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /** Rows not loaded yet: says so instead of the empty message. */
  loading?: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Table"
      tabIndex={0}
      className="overflow-x-auto rounded-2xl bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:bg-white sm:shadow-[0_1px_4px_rgba(0,0,0,0.07)] sm:ring-1 sm:ring-black/[0.04]"
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-neutral-400">
                {loading ? "Loading…" : emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <motion.tr
                key={row.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(i, 12) * 0.02 }}
                onClick={() => onRowClick?.(row)}
                whileHover={onRowClick ? { backgroundColor: "rgba(0,0,0,0.025)" } : undefined}
                className={`border-b border-neutral-50 last:border-0 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((col, c) => (
                  <td key={col.header} data-label={col.header} className={`whitespace-nowrap px-4 py-2.5 ${c === 0 ? "rt-title" : ""} ${col.className ?? ""}`}>
                    {col.render(row)}
                  </td>
                ))}
              </motion.tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
