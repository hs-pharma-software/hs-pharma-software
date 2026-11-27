/** Nightly clean-up of log tables that would otherwise grow for ever.
 *
 * Rows are removed oldest first, a few thousand per statement, and only for a
 * limited time per night: one huge DELETE could run past the host's time limit
 * and fail as a whole, and a table that is already clean costs one short read
 * (only its first rows are looked at, never the whole table). Whatever is left
 * is removed the next night. */
import type { Sql } from "./subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface PruneResult { removed: number; more: boolean }

/** Removes rows older than `days` from `table`. `key` must follow insert order
 * (an AUTOINCREMENT key, or rowid for tables written in time order). */
export async function pruneOldest(sql: Sql, table: string, timeColumn: string, days: number,
  opts: { key?: string; batch?: number; budgetMs?: number; now?: number } = {}): Promise<PruneResult> {
  const { key = "rowid", batch = 2000, budgetMs = 10_000, now = Date.now() } = opts;
  const cut = new Date(now - days * 86_400_000).toISOString();
  const started = Date.now();
  let removed = 0;
  for (;;) {
    // Only the oldest `batch` rows are read; those past the cut-off go.
    const r = await sql.execute(
      `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} ORDER BY ${key} LIMIT ${batch}) AND ${timeColumn} < ?`, [cut]);
    removed += r.rowsAffected;
    if (r.rowsAffected < batch) return { removed, more: false };
    if (Date.now() - started > budgetMs) return { removed, more: true };
  }
}

/** How long each log is kept (days). */
export const KEEP_DAYS = {
  /** Desktop change logs: a computer away longer copies everything again. */
  changes: 45,
  /** Who changed what through the server (statement text, IP): half a year. */
  serverAudit: 180,
} as const;
