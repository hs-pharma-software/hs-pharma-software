import { createClient, type Client } from "@libsql/client/web";
import { dbExecute, dbSelect } from "../db";
import { nowIso } from "../id";
import { SYNCABLE_TABLES, TENANT_SCOPED_TABLES } from "./tables";
import { useAuthStore } from "../../store/authStore";

export class TursoNotConfiguredError extends Error {
  constructor() {
    super(
      "Turso is not configured. Set NEXT_PUBLIC_TURSO_DATABASE_URL and NEXT_PUBLIC_TURSO_AUTH_TOKEN in .env.local (see README)."
    );
    this.name = "TursoNotConfiguredError";
  }
}

let client: Client | null = null;

function getRemoteClient(): Client {
  const url = process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const authToken = process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new TursoNotConfiguredError();
  if (!client) client = createClient({ url, authToken });
  return client;
}

export function isTursoConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_TURSO_DATABASE_URL && process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN
  );
}

type OutboxRow = {
  id: string;
  table_name: string;
  row_id: string;
  op: "insert" | "update" | "delete";
  payload: string | null;
};

/** Push every un-synced local write to Turso, oldest first. Uses
 * INSERT ... ON CONFLICT DO UPDATE so replaying an insert for a row that
 * already exists remotely (e.g. created on another machine) safely merges
 * instead of erroring. */
export async function pushOutbox(): Promise<{ pushed: number; errors: number }> {
  const remote = getRemoteClient();
  const pending = await dbSelect<OutboxRow>(
    `SELECT * FROM sync_outbox WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT 200`
  );
  let pushed = 0;
  let errors = 0;

  for (const entry of pending) {
    try {
      if (entry.op === "delete") {
        const ts = nowIso();
        await remote.execute({
          sql: `UPDATE ${entry.table_name} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
          args: [ts, ts, entry.row_id],
        });
      } else {
        const record = JSON.parse(entry.payload ?? "{}") as Record<string, unknown>;
        const keys = Object.keys(record);
        const updates = keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ");
        await remote.execute({
          sql: `INSERT INTO ${entry.table_name} (${keys.join(", ")})
                VALUES (${keys.map(() => "?").join(", ")})
                ON CONFLICT(id) DO UPDATE SET ${updates}`,
          args: keys.map((k) => record[k] as never),
        });
      }
      await dbExecute(`UPDATE sync_outbox SET synced_at = ? WHERE id = ?`, [nowIso(), entry.id]);
      pushed++;
    } catch (err) {
      console.error(`[sync] failed to push ${entry.table_name}/${entry.row_id}`, err);
      errors++;
    }
  }

  return { pushed, errors };
}

/** Pull rows changed remotely since the last cursor per table, and upsert
 * them locally — but only when the remote row is actually newer
 * (last-write-wins on `updated_at`), so a local edit made while offline
 * isn't clobbered by a stale remote copy during the same sync pass. */
export async function pullChanges(): Promise<{ pulled: number }> {
  const remote = getRemoteClient();
  let pulled = 0;

  const session = useAuthStore.getState();
  const tenantId = session.currentTenant?.id ?? null;
  const isSuperAdmin = session.currentUser?.role === "super_admin";

  for (const table of SYNCABLE_TABLES) {
    const isTenantScoped = (TENANT_SCOPED_TABLES as readonly string[]).includes(table);
    // The Super Admin has no tenant and no business seeing any tenant's
    // private stock/pricing/sales — skip these tables for that session
    // entirely rather than pulling everyone's data down.
    if (isTenantScoped && isSuperAdmin) continue;
    // Not logged in yet, or a tenant user with no tenant resolved somehow —
    // nothing safe to pull for tenant-scoped tables.
    if (isTenantScoped && !tenantId) continue;

    // Tenant-scoped tables get their own pull cursor per tenant, so
    // switching which tenant is logged in on one device (testing, a shared
    // machine) doesn't skip re-pulling data the previous session already
    // advanced the cursor past.
    const cursorKey = isTenantScoped ? `last_pull_${table}_${tenantId}` : `last_pull_${table}`;
    const cursorRows = await dbSelect<{ value: string }>(
      `SELECT value FROM sync_meta WHERE key = ?`,
      [cursorKey]
    );
    const cursor = cursorRows[0]?.value ?? "1970-01-01T00:00:00.000Z";

    const result = await remote.execute(
      isTenantScoped
        ? {
            sql: `SELECT * FROM ${table} WHERE tenant_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500`,
            args: [tenantId as string, cursor],
          }
        : {
            sql: `SELECT * FROM ${table} WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 500`,
            args: [cursor],
          }
    );

    for (const row of result.rows) {
      const record: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        record[col] = row[i];
      });

      const localRows = await dbSelect<{ updated_at: string }>(
        `SELECT updated_at FROM ${table} WHERE id = ?`,
        [record.id as string]
      );
      const local = localRows[0];
      if (local && new Date(local.updated_at) >= new Date(record.updated_at as string)) {
        continue; // local copy is already current or newer
      }

      const keys = Object.keys(record);
      const updates = keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ");
      await dbExecute(
        `INSERT INTO ${table} (${keys.join(", ")})
         VALUES (${keys.map(() => "?").join(", ")})
         ON CONFLICT(id) DO UPDATE SET ${updates}`,
        keys.map((k) => record[k])
      );
      pulled++;
    }

    if (result.rows.length > 0) {
      const lastUpdatedAt = result.rows[result.rows.length - 1][
        result.columns.indexOf("updated_at")
      ] as string;
      await dbExecute(
        `INSERT INTO sync_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [cursorKey, lastUpdatedAt]
      );
    }
  }

  return { pulled };
}

export async function syncNow(): Promise<{ pushed: number; pulled: number; errors: number }> {
  const { pushed, errors } = await pushOutbox();
  const { pulled } = await pullChanges();
  return { pushed, pulled, errors };
}
