import { createClient, type Client } from "@libsql/client/web";
import { dbExecute, dbSelect, tursoConfigFor } from "../db";
import { ALL_SYSTEMS, isPlatformTable, systemForBusinessType, type DbSystem } from "../dbRouting";
import { businessType } from "../../config/businessTypes";
import { nowIso } from "../id";
import { CATALOG_TABLES, SYNCABLE_TABLES, TENANT_SCOPED_TABLES } from "./tables";
import { useAuthStore } from "../../store/authStore";

export class TursoNotConfiguredError extends Error {
  constructor() {
    super(
      "Turso is not configured. Set NEXT_PUBLIC_TURSO_DATABASE_URL and NEXT_PUBLIC_TURSO_AUTH_TOKEN in .env.local (see README)."
    );
    this.name = "TursoNotConfiguredError";
  }
}

const clients = new Map<string, Client>();

/** The Turso database of a system. Hospital and Clinic use their own once
 * configured, otherwise the platform database (see tursoConfigFor). */
function getRemoteClient(system: DbSystem = "platform"): Client {
  const cfg = tursoConfigFor(system);
  if (!cfg) throw new TursoNotConfiguredError();
  let c = clients.get(cfg.url);
  if (!c) {
    c = createClient(cfg);
    clients.set(cfg.url, c);
  }
  return c;
}

/** The database system the signed-in tenant works in (platform for the Super Admin). */
function sessionSystem(): DbSystem {
  const raw = useAuthStore.getState().currentTenant?.businessType;
  return raw ? systemForBusinessType(businessType(raw).id) : "platform";
}

/** Local databases whose outbox this session pushes: the platform one, plus its own. */
function systemsToPush(): DbSystem[] {
  const own = sessionSystem();
  return ALL_SYSTEMS.filter((s) => s === "platform" || s === own);
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
  op: "insert" | "insert_if_absent" | "update" | "delete";
  payload: string | null;
};

/** Whether this session may write `row` (null for deletes) of `table`:
 * tenant users only their own tenant's rows; the Super Admin only catalog
 * rows (review and hand-over of unowned catalog rows). A refused entry stays
 * in the outbox and is reported as an error. */
export function mayPush(table: string, op: OutboxRow["op"], row: Record<string, unknown> | null, session: { tenantId: string | null; superAdmin: boolean }): boolean {
  const scoped = TENANT_SCOPED_TABLES.includes(table);
  if (session.superAdmin) return !scoped || CATALOG_TABLES.includes(table);
  if (!scoped || op === "delete") return session.tenantId != null || !scoped;
  // Catalog entries queued before v29 carry no tenant_id and leave ownership untouched.
  if (!row || !("tenant_id" in row)) return CATALOG_TABLES.includes(table);
  return session.tenantId != null && row.tenant_id === session.tenantId;
}

/** Push every un-synced local write to Turso, oldest first. Uses
 * INSERT ... ON CONFLICT DO UPDATE so replaying an insert for a row that
 * already exists remotely (e.g. created on another machine) safely merges
 * instead of erroring. */
export async function pushOutbox(): Promise<{ pushed: number; errors: number }> {
  let pushed = 0;
  let errors = 0;
  for (const system of systemsToPush()) {
    const r = await pushOutboxOf(system);
    pushed += r.pushed;
    errors += r.errors;
  }
  return { pushed, errors };
}

async function pushOutboxOf(system: DbSystem): Promise<{ pushed: number; errors: number }> {
  const pending = await dbSelect<OutboxRow>(
    `SELECT * FROM sync_outbox WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT 200`,
    [],
    { system }
  );
  let pushed = 0;
  let errors = 0;
  const auth = useAuthStore.getState();
  const session = { tenantId: auth.currentTenant?.id ?? null, superAdmin: auth.currentUser?.role === "super_admin" };

  for (const entry of pending) {
    try {
      // A write to a platform table (the pharmacy mailbox) may sit in a
      // clinic's outbox, but it belongs on the platform remote.
      const remote = getRemoteClient(isPlatformTable(entry.table_name) ? "platform" : system);
      const record = entry.op === "delete" ? null : (JSON.parse(entry.payload ?? "{}") as Record<string, unknown>);
      if (!mayPush(entry.table_name, entry.op, record, session)) {
        console.error(`[sync] refused to push ${entry.table_name}/${entry.row_id}: not this session's tenant`);
        errors++;
        continue;
      }
      const scoped = TENANT_SCOPED_TABLES.includes(entry.table_name);
      if (entry.op === "delete") {
        const ts = nowIso();
        // A delete only ever reaches this session's own rows remotely.
        await remote.execute(
          !scoped
            ? { sql: `UPDATE ${entry.table_name} SET deleted_at = ?, updated_at = ? WHERE id = ?`, args: [ts, ts, entry.row_id] }
            : session.superAdmin
              ? { sql: `UPDATE ${entry.table_name} SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id IS NULL`, args: [ts, ts, entry.row_id] }
              : { sql: `UPDATE ${entry.table_name} SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, args: [ts, ts, entry.row_id, session.tenantId] }
        );
      } else {
        const keys = Object.keys(record!);
        const updates = keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ");
        await remote.execute({
          sql: `INSERT INTO ${entry.table_name} (${keys.join(", ")})
                VALUES (${keys.map(() => "?").join(", ")})
                ON CONFLICT(id) DO ${entry.op === "insert_if_absent" ? "NOTHING" : `UPDATE SET ${updates}`}`,
          args: keys.map((k) => record![k] as never),
        });
      }
      await dbExecute(`UPDATE sync_outbox SET synced_at = ? WHERE id = ?`, [nowIso(), entry.id], { system });
      pushed++;
    } catch (err) {
      console.error(`[sync] failed to push ${entry.table_name}/${entry.row_id}`, err);
      errors++;
    }
  }

  return { pushed, errors };
}

/** Pull rows changed remotely since the last cursor per table, and upsert
 * them locally \u2014 but only when the remote row is actually newer
 * (last-write-wins on `updated_at`), so a local edit made while offline
 * isn't clobbered by a stale remote copy during the same sync pass. */
/** Pulls one batch (up to 500 rows) of a table changed since its cursor.
 * `tenantId` filters tenant-scoped tables. Returns the rows applied and
 * whether a full batch came back (more may be waiting). */
async function pullTable(remote: Client, table: string, tenantId: string | null, unownedOnly = false, system: DbSystem = "platform"): Promise<{ applied: number; more: boolean }> {
  const isTenantScoped = (TENANT_SCOPED_TABLES as readonly string[]).includes(table) && !unownedOnly;
  // Tenant-scoped tables get their own pull cursor per tenant, so
  // switching which tenant is logged in on one device (testing, a shared
  // machine) doesn't skip re-pulling data the previous session already
  // advanced the cursor past.
  const cursorKey = unownedOnly ? `last_pull_${table}_unowned` : isTenantScoped ? `last_pull_${table}_${tenantId}` : `last_pull_${table}`;
  const cursorRows = await dbSelect<{ value: string }>(`SELECT value FROM sync_meta WHERE key = ?`, [cursorKey], { system });
  const cursor = cursorRows[0]?.value ?? "1970-01-01T00:00:00.000Z";

  const result = await remote.execute(
    isTenantScoped
      ? {
          sql: `SELECT * FROM ${table} WHERE tenant_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500`,
          args: [tenantId as string, cursor],
        }
      : {
          sql: `SELECT * FROM ${table} WHERE ${unownedOnly ? "tenant_id IS NULL AND " : ""}updated_at > ? ORDER BY updated_at ASC LIMIT 500`,
          args: [cursor],
        }
  );

  let applied = 0;
  for (const row of result.rows) {
    const record: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      record[col] = row[i];
    });

    const localRows = await dbSelect<{ updated_at: string }>(`SELECT updated_at FROM ${table} WHERE id = ?`, [
      record.id as string,
    ], { system });
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
      keys.map((k) => record[k]),
      { system }
    );
    applied++;
  }

  if (result.rows.length > 0) {
    const lastUpdatedAt = result.rows[result.rows.length - 1][result.columns.indexOf("updated_at")] as string;
    await dbExecute(
      `INSERT INTO sync_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [cursorKey, lastUpdatedAt],
      { system }
    );
  }
  return { applied, more: result.rows.length === 500 };
}

export async function pullChanges(): Promise<{ pulled: number }> {
  let pulled = 0;
  const ownSystem = sessionSystem();

  const session = useAuthStore.getState();
  const tenantId = session.currentTenant?.id ?? null;
  const isSuperAdmin = session.currentUser?.role === "super_admin";

  for (const table of SYNCABLE_TABLES) {
    // Sign-in tables belong to the platform database; the rest to the tenant's own.
    const system: DbSystem = isPlatformTable(table) ? "platform" : ownSystem;
    const remote = getRemoteClient(system);
    const isTenantScoped = (TENANT_SCOPED_TABLES as readonly string[]).includes(table);
    // The Super Admin has no tenant and no business seeing any tenant's
    // private stock/pricing/sales — skip these tables for that session
    // entirely rather than pulling everyone's data down.
    // Except the catalog's unowned rows (quarantine / templates), which only
    // the Super Admin reviews and hands over to tenants.
    if (isTenantScoped && isSuperAdmin) {
      if (CATALOG_TABLES.includes(table)) pulled += (await pullTable(remote, table, null, true, system)).applied;
      continue;
    }
    // Not logged in yet, or a tenant user with no tenant resolved somehow —
    // nothing safe to pull for tenant-scoped tables.
    if (isTenantScoped && !tenantId) continue;
    pulled += (await pullTable(remote, table, tenantId, false, system)).applied;
  }

  return { pulled };
}

/** Tables login needs. Normal sync only starts after sign-in, so a fresh
 * install would otherwise have no users to sign in with. */
const AUTH_TABLES = ["subscription_plans", "tenants", "users"] as const;

/** Brings plans, tenants and users down from Turso before login (all
 * batches). Throws when Turso is not configured or unreachable. */
export async function pullAuthData(): Promise<number> {
  const remote = getRemoteClient("platform");
  let pulled = 0;
  for (const table of AUTH_TABLES) {
    for (let more = true; more; ) {
      const r = await pullTable(remote, table, null);
      pulled += r.applied;
      more = r.more;
    }
  }
  return pulled;
}

export async function syncNow(): Promise<{ pushed: number; pulled: number; errors: number }> {
  const { pushed, errors } = await pushOutbox();
  const { pulled } = await pullChanges();
  return { pushed, pulled, errors };
}
