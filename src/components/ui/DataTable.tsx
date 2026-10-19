"use client";

import { motion } from "motion/react";

export interface Column<T> {
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  emptyMessage = "No content in table",
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200/70 bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="bg-gradient-to-r from-neutral-900 to-neutral-800 text-left text-white">
            {columns.map((col) => (
              <th key={col.header} className="whitespace-nowrap px-3 py-2.5 font-medium">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-neutral-400">
                {emptyMessage}
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
                whileHover={onRowClick ? { backgroundColor: "rgba(251,191,36,0.08)" } : undefined}
                className={`border-b border-neutral-100 last:border-0 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((col) => (
                  <td key={col.header} className={`whitespace-nowrap px-3 py-2 ${col.className ?? ""}`}>
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
