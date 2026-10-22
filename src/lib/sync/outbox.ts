import { dbExecute, dbSelect } from "../db";
import { newId, nowIso } from "../id";
import { isTauriShell as isTauri } from "../platform";

export type SyncOp = "insert" | "update" | "delete";

/** Every local write on the desktop is mirrored into `sync_outbox` so the
 * sync engine can replay it against Turso when online.
 * On the web (Vercel), writes go directly to Turso \u2014 no outbox needed. */
export async function recordOutbox(
  table: string,
  rowId: string,
  op: SyncOp,
  payload: Record<string, unknown> | null
): Promise<void> {
  // Web: writing directly to Turso already \u2014 outbox is desktop-only
  if (!isTauri()) return;

  await dbExecute(
    `INSERT INTO sync_outbox (id, table_name, row_id, op, payload, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [newId(), table, rowId, op, payload ? JSON.stringify(payload) : null, nowIso()]
  );
}

export async function countPendingOutbox(): Promise<number> {
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) as n FROM sync_outbox WHERE synced_at IS NULL`
  );
  return rows[0]?.n ?? 0;
}
