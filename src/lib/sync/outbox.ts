import { dbExecute, dbSelect } from "../db";
import { newId, nowIso } from "../id";

export type SyncOp = "insert" | "update" | "delete";

/** Every local write is mirrored into `sync_outbox`. The sync engine drains
 * this table (oldest first) whenever the app is online, and marks each row
 * `synced_at` once it has been replayed against Turso. */
export async function recordOutbox(
  table: string,
  rowId: string,
  op: SyncOp,
  payload: Record<string, unknown> | null
): Promise<void> {
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
